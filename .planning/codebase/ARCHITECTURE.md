# Architecture

**Analysis Date:** 2026-03-06

## Pattern Overview

**Overall:** Multi-container microservice architecture with a central Node.js API orchestrating network boot, imaging, and client management services via Docker Compose.

**Key Characteristics:**
- Docker Compose orchestration of 7 containers (init, tftp, rsync, ssh, cache, api, web) plus optional dhcp
- Two operating modes: **standalone** (PostgreSQL + full CRUD) and **sync** (Redis-only, read-only consumer of LMN Authority API)
- Read-only contract with LMN server -- Docker never writes hosts, configs, or rooms back
- File-system as primary data plane: boot files, GRUB configs, images, and start.conf all live on shared Docker volumes
- WebSocket-based real-time updates for operation progress, host status, and sync events

## Container Architecture

**init (one-shot):**
- Purpose: Downloads LINBO boot files from upstream APT repo on first start
- Location: `containers/init/entrypoint.sh`, `containers/init/Dockerfile`
- Downloads `linuxmuster-linbo7` and `linuxmuster-linbo-gui7` .deb packages
- Provisions kernel variants (stable/longterm/legacy) with atomic symlink-swap
- Sets `.needs-rebuild` marker for API to auto-rebuild linbofs64
- Depends on: Nothing
- Used by: All other containers (via `service_completed_successfully` dependency)

**tftp (long-running):**
- Purpose: Serves PXE boot files (GRUB, kernel, initramfs) via TFTP UDP/69
- Location: `containers/tftp/Dockerfile`
- Network mode: host (required for PXE)
- Volume: `linbo_srv_data:/srv/linbo:ro`
- Waits for `.linbofs-patch-status` marker before serving

**rsync (long-running):**
- Purpose: Image synchronization for LINBO clients via rsync TCP/873
- Location: `containers/rsync/Dockerfile`, `containers/rsync/scripts/`
- Has API hook scripts for pre/post download/upload notifications
- Config: `config/rsyncd.conf`

**ssh (long-running):**
- Purpose: Remote command execution to LINBO clients via SSH TCP/2222
- Location: `containers/ssh/Dockerfile`
- Runs OpenSSH + tmux + linbo-remote server-side scripts
- Used by API for operations (send commands, WoL, terminal)

**cache / Redis (long-running):**
- Purpose: Caching, sync state, host status, settings, pub/sub
- Image: `redis:7-alpine`
- Always required (both modes)

**api (long-running):**
- Purpose: Central REST API + WebSocket server, orchestrates all operations
- Location: `containers/api/src/index.js` (entry point)
- Port: 3000
- Contains: Express routes, services, workers, middleware, WebSocket
- Depends on: cache (healthy), ssh (started), init (completed)

**web (long-running):**
- Purpose: React SPA frontend served via Nginx
- Location: `containers/web/frontend/src/` (React), `containers/web/Dockerfile` (multi-stage build)
- Port: 8080 (Nginx reverse-proxies `/api/*` and `/ws` to api container)
- Depends on: api (healthy)

**dhcp (optional, profile-activated):**
- Purpose: dnsmasq DHCP proxy for PXE boot
- Location: `containers/dhcp/Dockerfile`
- Activated via: `docker compose --profile dhcp up -d`
- Network mode: host

## Layers

**Presentation Layer (Frontend):**
- Purpose: Admin dashboard for managing hosts, configs, images, operations
- Location: `containers/web/frontend/src/`
- Contains: React pages, components, Zustand stores, API client, WebSocket hooks
- Depends on: API layer via axios client (`containers/web/frontend/src/api/client.ts`)
- Used by: Browser users

**API Layer (Routes + Middleware):**
- Purpose: REST API endpoints with authentication, validation, audit logging
- Location: `containers/api/src/routes/` (16 route modules), `containers/api/src/middleware/`
- Contains: Express routers, Zod validation schemas, JWT/API-key auth, audit middleware
- Depends on: Service layer
- Used by: Frontend, DHCP container, rsync hooks, external consumers
- Key file: `containers/api/src/routes/index.js` (async route factory with mode-dependent mounting)

**Service Layer:**
- Purpose: Business logic, data access, external integrations
- Location: `containers/api/src/services/` (23 service modules)
- Contains: Config deployment, GRUB generation, image sync, remote commands, kernel management, etc.
- Depends on: Library layer, Redis, Prisma (optional), filesystem
- Used by: API routes, workers

**Worker Layer:**
- Purpose: Background processing tasks
- Location: `containers/api/src/workers/`
- Contains:
  - `operation.worker.js`: Polls pending operations from DB, executes via SSH
  - `host-status.worker.js`: Two-layer host status (stale timeout + TCP port scanning)
- Depends on: Service layer, Prisma, Redis, WebSocket

**Library Layer:**
- Purpose: Shared utilities and client abstractions
- Location: `containers/api/src/lib/`
- Contains:
  - `redis.js`: Redis singleton with cache helpers and pub/sub
  - `prisma.js`: Prisma client singleton with retry logic
  - `websocket.js`: WebSocket broadcast utilities with typed event methods
  - `lmn-api-client.js`: HTTP client for LMN Authority API (auto-detects port 8001 vs 8400)
  - `image-path.js`: Image path resolution
  - `atomic-write.js`: Crash-safe file writes with MD5
  - `startconf-rewrite.js`: start.conf server= field rewriting
  - `driver-*.js`: Driver management utilities (path, shell, fs, catalog)
  - `firmware-*.js`: Firmware scanning and catalog

**Boot Infrastructure Layer:**
- Purpose: PXE boot chain scripts running on host/client
- Location: `scripts/server/` (server-side), `containers/init/entrypoint.sh`
- Contains: `update-linbofs.sh` (linbofs64 builder), `linbo-remote`, rsync hooks
- Key file: `scripts/server/update-linbofs.sh` -- extracts linbofs64.xz template, injects SSH keys, password hash, kernel modules, firmware, runs hooks, repacks

## Data Flow

**PXE Boot Flow:**

1. Client sends DHCP request, gets PXE boot options (TFTP server IP + boot file)
2. Client downloads GRUB via TFTP from `linbo-tftp` container (`/srv/linbo/boot/grub/`)
3. GRUB loads `grub.cfg` which loads group config (generated by `grub-generator.js` or `grub.service.js`)
4. GRUB downloads `linbo64` kernel + `linbofs64` initramfs via HTTP from `linbo-web` container
5. Kernel boots, `init.sh` runs: hwsetup, network config, dropbear SSH, rsync, linbo_gui
6. Client appears online (detected by host-status worker via port scanning)

**Sync Mode Data Flow:**

1. Admin triggers sync via `POST /api/v1/sync/trigger` (or auto-sync timer)
2. `sync.service.js` fetches delta changes from LMN Authority API via `lmn-api-client.js`
3. Writes start.conf files to `/srv/linbo/` with `server=` rewrite + MD5 + symlinks
4. Caches configs/hosts in Redis (`sync:host:{mac}`, `sync:config:{id}`)
5. Regenerates GRUB configs via `grub-generator.js`
6. Updates DHCP export file (watched by dhcp container via inotify)
7. Broadcasts `sync.completed` via WebSocket

**Operation Execution Flow:**

1. Admin creates operation via `POST /api/v1/operations` (or `POST /operations/direct`)
2. `operation.worker.js` polls for pending operations every 5s
3. Worker creates SSH sessions to target hosts via `ssh.service.js`
4. Commands sent to LINBO clients (partition, sync, start, reboot, etc.)
5. Progress broadcast via WebSocket (`operation.progress`, `session.updated`)

**Image Sync Flow:**

1. `image-sync.service.js` fetches manifest from LMN Authority API
2. Downloads QCOW2 images via HTTP Range requests (resume support)
3. Verifies MD5 checksum, atomic directory swap
4. Progress broadcast via WebSocket, job queue in Redis

**State Management (Frontend):**
- Zustand stores persist auth state to localStorage
- WebSocket store maintains real-time connection with auto-reconnect
- Host store merges REST data with WebSocket status updates
- Server config store caches operating mode (sync vs standalone)

## Key Abstractions

**Dual Mode System:**
- Purpose: Support both standalone operation and LMN-integrated sync mode
- Implementation: `containers/api/src/routes/index.js` -- async factory reads `sync_enabled` from Redis/env, conditionally mounts Prisma-dependent routes or returns 409
- Pattern: Prisma is optional everywhere -- `let prisma = null; try { prisma = require('./lib/prisma').prisma; } catch {}`
- Sync routes use Redis for data storage; standalone routes use PostgreSQL via Prisma

**Atomic File Operations:**
- Purpose: Crash-safe writes for boot files and configs
- Examples: `containers/api/src/lib/atomic-write.js`
- Pattern: Write to temp file, then rename (atomic on same filesystem)

**Kernel Variant System:**
- Purpose: Support multiple Linux kernel variants (stable, longterm, legacy)
- Location: `containers/api/src/services/kernel.service.js`, `containers/init/entrypoint.sh`
- Pattern: Kernel sets stored in `/var/lib/linuxmuster/linbo/sets/{hash}/`, active set via `current` symlink, switch via API triggers linbofs64 rebuild

**Hook System:**
- Purpose: Extensible linbofs64 customization without modifying core scripts
- Location: `/etc/linuxmuster/linbo/hooks/update-linbofs.pre.d/` and `.post.d/`
- Pattern: Numbered script files (`01_theme`, `02_patch`) executed in sort order
- Pre-hooks run in extracted linbofs root before CPIO repack
- Post-hooks run after repack

**GRUB Config Generation:**
- Purpose: Generate network boot menus with OS entries, linbocmd support
- Files: `containers/api/src/services/grub-generator.js` (sync mode), `containers/api/src/services/grub.service.js` (standalone mode)
- Templates: `containers/api/src/templates/grub/`
- Pattern: Template-based generation, host configs as symlinks to group configs
- Critical rule: Config named "grub" is written as `_grub.cfg` to avoid overwriting main PXE `grub.cfg`

**Patchclass / Driver Management:**
- Purpose: Windows driver injection for LINBO imaging with DMI-based hardware matching
- Location: `containers/api/src/services/patchclass.service.js`
- Supporting libs: `containers/api/src/lib/driver-path.js`, `driver-shell.js`, `driver-fs.js`, `driver-catalog.js`
- Pattern: Zod-validated driver maps, shell-escaped commands, postsync deploy scripts

## Entry Points

**API Server:**
- Location: `containers/api/src/index.js`
- Triggers: `node src/index.js` (via Docker CMD)
- Responsibilities: Initializes Express, Redis, Prisma (optional), WebSocket (main + terminal), workers, auto-rebuild check, GUI symlinks, mounts routes

**Frontend App:**
- Location: `containers/web/frontend/src/main.tsx` -> `containers/web/frontend/src/App.tsx`
- Triggers: Browser navigation
- Responsibilities: React Router, auth check, WebSocket connection

**Init Container:**
- Location: `containers/init/entrypoint.sh`
- Triggers: Docker container start (one-shot)
- Responsibilities: Download APT packages, provision boot files, kernel variants, GUI, themes

**Update Script:**
- Location: `scripts/server/update-linbofs.sh`
- Triggers: API `POST /system/update-linbofs`, auto-rebuild on startup, kernel switch
- Responsibilities: Build linbofs64 from template -- inject SSH keys, password hash, modules, firmware, run hooks, repack as XZ-compressed CPIO

## WebSocket Architecture

**Two WebSocket Servers (noServer mode):**
- Main WS at `/ws`: Channel-based pub/sub for real-time events (host status, sync progress, operations)
- Terminal WS at `/ws/terminal`: Authenticated SSH terminal sessions to LINBO clients
- HTTP upgrade routing in `containers/api/src/index.js` dispatches by pathname

**Event Types:**
- `host.status.changed` - Host online/offline transitions
- `sync.started`, `sync.completed` - Sync lifecycle
- `sync.progress` - Per-host sync progress
- `operation.started`, `operation.progress`, `operation.completed` - Operation lifecycle
- `session.updated` - Per-host session status
- `config.*`, `image.*` - CRUD notifications
- `notification` - System-level alerts (info/warning/error)

## Error Handling

**Strategy:** Layered error handling with typed error codes

**Patterns:**
- Global Express error handler in `containers/api/src/index.js` catches Prisma errors (P-codes), ZodErrors, JWT errors
- All API errors return structured JSON: `{ error: { code, message, requestId, details? } }`
- HTTP status mapping: 400 (validation/DB), 401 (auth), 403 (role), 404 (not found), 409 (sync mode), 500 (internal)
- Services throw errors, routes catch and format

## Cross-Cutting Concerns

**Logging:** `morgan` for HTTP request logging (combined in production, dev in development). Console.log for service-level logging with `[ServiceName]` prefixes.

**Validation:** Zod schemas in `containers/api/src/middleware/validate.js` validate request bodies, params, and queries. Centralized schemas for MAC addresses, IP addresses, UUIDs, pagination.

**Authentication:** JWT tokens (24h TTL) via `Authorization: Bearer` header. Internal API key for container-to-container auth. API key auth via `X-API-Key` header (standalone mode only, requires Prisma). Role-based access: `requireRole(['admin'])`.

**Audit Logging:** `containers/api/src/middleware/audit.js` records all mutating API actions to PostgreSQL `audit_logs` table. Degrades silently when DB is unavailable.

**Settings:** Runtime-configurable via `containers/api/src/services/settings.service.js`. Redis-backed with env-var fallback, 2s in-memory cache, secrets masked in API responses.

---

*Architecture analysis: 2026-03-06*
