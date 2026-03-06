# External Integrations

**Analysis Date:** 2026-03-06

## APIs & External Services

**linuxmuster-api (LMN Server):**
- Purpose: Source of truth for hosts, configs, rooms, DHCP in sync mode
- SDK/Client: Custom HTTP client using native `fetch()` (`containers/api/src/lib/lmn-api-client.js`)
- Auth (port 8001, linuxmuster-api): HTTP Basic Auth → JWT token, cached with 5min buffer, `X-API-Key` header
- Auth (port 8400, legacy Authority API): Static Bearer token, `Authorization: Bearer` header
- Auto-detection: Client detects API mode from URL port (`_detectMode()`)
- Retry: 3 attempts with exponential backoff (500ms base), 10s request timeout
- Env vars: `LMN_API_URL`, `LMN_API_USER`, `LMN_API_PASSWORD` (port 8001) or `LMN_API_KEY` (port 8400)
- Endpoints consumed:
  - `GET /changes?since={cursor}` - Delta feed (cursor-based sync)
  - `POST /hosts:batch` - Batch fetch hosts by MAC
  - `POST /startconfs:batch` - Batch fetch start.conf content
  - `POST /configs:batch` - Batch fetch parsed configs
  - `GET /dhcp/export/dnsmasq-proxy` - DHCP export with ETag conditional GET
  - `GET /health` - Health check
  - Image download endpoints (Range request support for resume)

**linuxmuster.net APT Repository:**
- Purpose: Source of LINBO boot files (kernel, initramfs, GUI, GRUB)
- URL: `https://deb.linuxmuster.net` (configurable via `DEB_BASE_URL`)
- Distribution: `lmn73` (configurable via `DEB_DIST`)
- Packages consumed: `linuxmuster-linbo7`, `linuxmuster-linbo-gui7`
- Client: Init container downloads via `curl` (`containers/init/entrypoint.sh`)
- GitHub Actions also fetches from this repo (`/.github/workflows/update-boot-files.yml`)

**GitHub Packages (npm registry):**
- Purpose: Private npm package for shared UI components
- Package: `@edulution-io/ui-kit`
- Registry: `https://npm.pkg.github.com`
- Auth: `GITHUB_TOKEN` env var (required at build time)
- Config: `containers/web/frontend/.npmrc`

## Data Storage

**PostgreSQL 15 (optional, standalone mode only):**
- Connection: `DATABASE_URL` env var (format: `postgresql://user:pass@host:port/db?schema=public`)
- Container: Not in `docker-compose.yml` by default (external DB expected, or `linbo-db` can be added)
- Client: Prisma ORM (`@prisma/client` ^5.8.0)
- Schema: `containers/api/prisma/schema.prisma` (9 models)
- Models: Room, Config, ConfigPartition, ConfigOs, Host, Image, Operation, Session, User, ApiKey, AuditLog
- Prisma is completely optional: API degrades gracefully when DB unavailable (sync mode)
- Pattern: `let prisma = null; try { prisma = require('./lib/prisma').prisma; } catch {}`
- Schema changes: `npx prisma db push` (via `make db-push`)

**Redis 7 (always required):**
- Container: `linbo-cache` (redis:7-alpine)
- Connection: `REDIS_HOST` + `REDIS_PORT` + optional `REDIS_PASSWORD` + `REDIS_DB`
- Client: ioredis ^5.3.2 (`containers/api/src/lib/redis.js`)
- Features used: Key-value cache, pub/sub, streams (XREADGROUP), pipelining
- Key patterns:
  - `sync:cursor`, `sync:lastSyncAt`, `sync:host:{mac}`, `sync:config:{id}` - Sync state
  - `config:{key}` - Runtime settings (with env fallback)
  - `imgsync:lock`, `imgsync:queue`, `imgsync:job:{id}` - Image sync jobs
  - `ops:{id}` - Operations in sync mode
  - `linbo:jobs` - Redis Stream for DC worker jobs (consumer group: `dc-workers`)
  - `linbo:jobs:dlq` - Dead letter queue for failed jobs
- Subscriber: Separate Redis client for pub/sub (`getSubscriber()`)

**File Storage:**
- Local Docker volumes only (no cloud storage)
- Boot files: `linbo_srv_data` volume → `/srv/linbo/`
- Images (QCOW2): `/srv/linbo/images/`
- GRUB configs: `/srv/linbo/boot/grub/`
- Start.conf files: `/srv/linbo/start.conf.{group}`
- Driver patchclasses: `linbo_driver_data` volume → `/var/lib/linbo/drivers/`
- Kernel variants: `linbo_kernel_data` volume → `/var/lib/linuxmuster/linbo/`
- SSH keys: `linbo_config` volume → `/etc/linuxmuster/linbo/`

**Caching:**
- Redis for all runtime caching (settings, sync data, host status)
- In-memory cache with 2s TTL for settings (`containers/api/src/services/settings.service.js`)
- Image manifest cached in Redis with 60s TTL (`containers/api/src/services/image-sync.service.js`)

## Authentication & Identity

**Custom JWT Authentication:**
- Implementation: `containers/api/src/middleware/auth.js`
- Token generation: `jsonwebtoken` ^9.0.2 with `JWT_SECRET` env var
- Token expiry: Configurable via `JWT_EXPIRES_IN` (default: 24h)
- Token payload: `{ id, username, email, role }`
- Password hashing: `bcryptjs` (10 rounds)
- Admin credentials: `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars (or Redis-stored hash)
- Password change: Via settings API (`admin_password` key stores bcrypt hash in Redis)

**API Key Authentication:**
- Implementation: `authenticateApiKey()` in `containers/api/src/middleware/auth.js`
- Storage: API keys stored as bcrypt hashes in PostgreSQL `api_keys` table
- Header: `X-API-Key`
- Requires Prisma (not available in sync/DB-free mode)

**Internal Service Auth:**
- Container-to-container: `INTERNAL_API_KEY` env var as Bearer token
- Used by: DHCP container, rsync hooks, DC worker
- Bypasses JWT verification in `authenticateToken()` middleware

**Role-Based Access Control:**
- Roles: `admin`, `viewer`, `api`
- Middleware factory: `requireRole(['admin'])` in `containers/api/src/middleware/auth.js`
- Role stored in JWT payload and User model

**Frontend Auth:**
- Token stored in `localStorage` (key: `token` and Zustand persist `auth-storage`)
- Axios interceptor adds `Authorization: Bearer` header (`containers/web/frontend/src/api/client.ts`)
- 401 response → redirect to `/login`

## Network Protocols

**PXE Boot Chain:**
- TFTP (UDP 69): `tftpd-hpa` serves boot files (kernel, initramfs, GRUB) - host network mode
- HTTP (port 8080): Nginx serves `linbo64` and `linbofs64` for HTTP PXE boot
- DHCP (UDP 67): Optional `dnsmasq` proxy for PXE boot options - host network mode
- Rsync (TCP 873): Image synchronization between server and LINBO clients
- SSH (TCP 2222): Remote command execution on LINBO clients (dropbear on client side)

**SSH Integration:**
- Client library: `ssh2` ^1.15.0 (`containers/api/src/services/ssh.service.js`)
- Key: LINBO client key at `/etc/linuxmuster/linbo/linbo_client_key`
- Fallback key: SSH container host key at `/etc/linuxmuster/linbo/ssh_host_rsa_key`
- Used for: Remote LINBO commands (sync, start, shutdown, reboot), terminal sessions
- Terminal service: Interactive PTY sessions with exec fallback (`containers/api/src/services/terminal.service.js`)
- Max concurrent terminal sessions: 10 (configurable via `TERMINAL_MAX_SESSIONS`)
- Idle timeout: 30 minutes

**Wake-on-LAN:**
- Implementation: UDP magic packets via `dgram` module (`containers/api/src/services/wol.service.js`)
- Broadcast to subnet (configurable address, default `255.255.255.255`)
- Sends 3 packets per host with 100ms interval

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, etc.)
- Errors logged to stdout/stderr (Docker logs)

**Logging:**
- API: `morgan` for HTTP request logging (`combined` in production, `dev` in development)
- Console-based logging throughout all services (no structured logging library)
- Request tracking: Custom `X-Request-ID` header generated per request
- Log volume: `linbo_log` → `/var/log/linuxmuster/linbo/`

**Health Checks:**
- API: `GET /health` - checks PostgreSQL, Redis, WebSocket status
- API: `GET /ready` - readiness probe (Redis + optional DB)
- Docker healthchecks on all containers (curl, pgrep, redis-cli ping)

**Audit Logging:**
- AuditLog model in Prisma schema (`containers/api/prisma/schema.prisma`)
- Audit middleware: `containers/api/src/middleware/audit.js`
- Configurable via `ENABLE_AUDIT_LOG` env var

## Real-Time Communication

**WebSocket (Main - `/ws`):**
- Library: `ws` ^8.16.0
- Mode: `noServer` (shares HTTP server, upgrade routing by pathname)
- Channel-based subscriptions (client sends `{ type: 'subscribe', channels: [...] }`)
- Heartbeat: 30s ping interval, dead connection termination
- Events broadcast: `host.status.changed`, `sync.*`, `operation.*`, `session.updated`, `config.*`, `image.*`, `settings.changed`, `notification`
- Implementation: `containers/api/src/lib/websocket.js`

**WebSocket (Terminal - `/ws/terminal`):**
- Separate WebSocket server on same HTTP server
- Auth: JWT token via `?token=` query parameter
- Protocol: JSON messages (`terminal.open`, `terminal.input`, `terminal.resize`, `terminal.close`)
- Backend: SSH PTY sessions to LINBO clients

**Redis Pub/Sub:**
- Used internally for cross-process event propagation
- Separate subscriber Redis client (`getSubscriber()`)

## CI/CD & Deployment

**Hosting:**
- Self-hosted bare-metal Linux servers (linuxmuster.net school network)
- Primary server: 10.0.0.11 (development)
- Test server: 10.0.0.13 (staging)

**CI Pipeline:**
- GitHub Actions: Weekly boot file update workflow (`.github/workflows/update-boot-files.yml`)
  - Checks for new `linuxmuster-linbo7` releases in APT repo
  - Downloads, extracts, builds boot files
  - Creates GitHub Release with `linbo-boot-files.tar.gz`
  - Also maintains `latest` release tag

**Deployment:**
- Script: `scripts/deploy.sh` - rsync-based or git-based deploy to remote server
- Process: rsync code → rebuild API + Web containers → optional linbofs rebuild via API
- `.env` is NEVER overwritten during deploy (site-specific)
- Makefile targets: `make deploy` (code only), `make deploy-full` (+ linbofs + GRUB rebuild)

## Environment Configuration

**Required env vars (production):**
- `LINBO_SERVER_IP` - IP of Docker host visible to PXE clients
- `JWT_SECRET` - Must be changed from default (generate with `openssl rand -base64 64`)
- `INTERNAL_API_KEY` - Container-to-container auth key
- `GITHUB_TOKEN` - npm registry auth for `@edulution-io/ui-kit` (build-time only)

**Optional env vars (sync mode):**
- `SYNC_ENABLED` - Enable sync mode (disable Prisma-dependent routes)
- `LMN_API_URL` - linuxmuster-api URL (default: `https://10.0.0.11:8001`)
- `LMN_API_USER` / `LMN_API_PASSWORD` - LMN API credentials (port 8001)
- `LMN_API_KEY` - Legacy Authority API key (port 8400)
- `NODE_TLS_REJECT_UNAUTHORIZED=0` - Required for self-signed LMN certs

**Secrets location:**
- `.env` file at project root (gitignored)
- `config/rsyncd.secrets` - rsync authentication
- SSH keys in `linbo_config` Docker volume
- Runtime secrets in Redis (admin password hash, API keys)

## Webhooks & Callbacks

**Incoming (rsync hooks):**
- Pre/post download hooks: `scripts/server/rsync-pre-download-api.sh`, `rsync-post-download-api.sh`
- Pre/post upload hooks: `scripts/server/rsync-pre-upload-api.sh`, `rsync-post-upload-api.sh`
- Hooks call LINBO API internal endpoints using `INTERNAL_API_KEY`
- Mounted into rsync container at `/usr/share/linuxmuster/linbo/`

**Incoming (linbofs hooks):**
- Pre-hooks: `/etc/linuxmuster/linbo/hooks/update-linbofs.pre.d/` (run in extracted linbofs root)
- Post-hooks: `/etc/linuxmuster/linbo/hooks/update-linbofs.post.d/` (run after repack)
- Active hook: `01_edulution-plymouth` (Plymouth splash theme)
- Hook system documented in `docs/hooks.md`

**Outgoing:**
- DC Worker job submission via Redis Streams (`linbo:jobs`)
- WebSocket broadcasts to connected frontend clients

## DC Worker Integration

**Machine Account Worker (`dc-worker/macct-worker.py`):**
- Purpose: Runs on AD Domain Controller, repairs Samba machine account passwords
- Language: Python 3
- Dependencies: `redis`, `requests` (pip)
- Communication: Redis Streams (consumer group `dc-workers` on stream `linbo:jobs`)
- Job types: `macct_repair`, `provision_host`
- Status reporting: HTTP callback to LINBO API (`/api/v1/internal/...`)
- Packaging: Debian package build support (`dc-worker/debian/`)

## Image Sync (LMN Server)

**Image Download Service (`containers/api/src/services/image-sync.service.js`):**
- Downloads QCOW2 images from LMN Authority API via HTTP Range requests
- Resume support for interrupted downloads
- MD5 verification after download
- Atomic directory swap on completion
- Redis-backed job queue with progress tracking
- Bandwidth limiting via `IMAGE_SYNC_BWLIMIT_MBPS`
- WebSocket progress events during download

---

*Integration audit: 2026-03-06*
