# Codebase Concerns

**Analysis Date:** 2026-03-06

## Tech Debt

**Silent Empty Catch Blocks (31 occurrences across 11 files):**
- Issue: 31 `catch {}` blocks silently swallow errors with no logging. While some are intentional (e.g., cleanup operations where failure is acceptable), many hide real issues during debugging.
- Files: `containers/api/src/services/linbo-update.service.js` (8), `containers/api/src/services/sync.service.js` (6), `containers/api/src/index.js` (5), `containers/api/src/services/terminal.service.js` (3), `containers/api/src/services/settings.service.js` (2), `containers/api/src/middleware/auth.js` (1), `containers/api/src/routes/images.js` (1), `containers/api/src/middleware/audit.js` (1), `containers/api/src/routes/auth.js` (1), `containers/api/src/routes/sync.js` (1), `containers/api/src/routes/internal.js` (2)
- Impact: Debugging production issues becomes harder when errors are silently consumed. Failed WebSocket broadcasts, failed Redis operations, and failed file cleanups all pass unnoticed.
- Fix approach: For each `catch {}`, decide: (a) log at `debug` level if truly ignorable, (b) log at `warn` level if it indicates a degraded state, (c) rethrow if it's a genuine error. Group by category: cleanup (acceptable to swallow), WS broadcasts (should log), state mutations (should log).

**Operation Worker Requires Prisma (standalone-mode only):**
- Issue: `containers/api/src/workers/operation.worker.js` hardcodes `const { prisma } = require('../lib/prisma')` at the top level without a try/catch guard. In sync mode (DB-free), importing this file crashes.
- Files: `containers/api/src/workers/operation.worker.js:6`
- Impact: The operation worker cannot run in sync mode. Currently mitigated by conditional loading in `containers/api/src/index.js:453`, but any accidental import path would break.
- Fix approach: Apply the Prisma-optional pattern (`let prisma = null; try { ... } catch { prisma = null; }`) consistent with other modules.

**Module-Level Mutable State in Services:**
- Issue: Several services store mutable state at the module level (`let lockRunId = null`, `let heartbeatTimer = null`, `let abortController = null`, `let cancelRequested = false` in linbo-update.service.js; `let activeAbort = null`, `let activeStream = null` in image-sync.service.js; `const sessions = new Map()` in terminal.service.js). This is fundamentally single-process, single-instance design.
- Files: `containers/api/src/services/linbo-update.service.js:46-49`, `containers/api/src/services/image-sync.service.js:35-36`, `containers/api/src/services/terminal.service.js:46`
- Impact: Cannot scale API horizontally (multiple API containers). Redis-based locks mitigate some race conditions for update/sync, but terminal sessions and in-flight downloads are bound to one process. Not a current problem (single API container), but blocks future scaling.
- Fix approach: Accept single-instance constraint for now. If horizontal scaling is needed, move terminal sessions to a dedicated gateway container and use Redis for download coordination.

**Rsync Secrets File Tracked in Git:**
- Issue: `config/rsyncd.secrets` is tracked in git (explicitly un-ignored via `!config/rsyncd.secrets` in `.gitignore`). It contains `linbo:Muster!` which is a default/example credential, but this file is mounted read-only into the rsync container at runtime.
- Files: `config/rsyncd.secrets`, `.gitignore:10`
- Impact: Anyone cloning the repo gets a working rsync credential. If operators forget to change it, production rsync is accessible with default credentials. The rsync module provides read/write access to `/srv/linbo` (boot files, images).
- Fix approach: Ship `config/rsyncd.secrets.example` instead, add `config/rsyncd.secrets` to `.gitignore` (remove the `!` exception), and add a setup step that copies the example and prompts for a password change.

**Large Route Files (God Objects):**
- Issue: Several route files are excessively large: `containers/api/src/routes/system.js` (1483 lines), `containers/api/src/routes/images.js` (1162 lines), `containers/api/src/routes/operations.js` (1127 lines), `containers/api/src/routes/internal.js` (993 lines), `containers/api/src/routes/hosts.js` (963 lines), `containers/api/src/routes/configs.js` (910 lines).
- Files: `containers/api/src/routes/system.js`, `containers/api/src/routes/images.js`, `containers/api/src/routes/operations.js`
- Impact: Difficult to navigate, review, and test. `system.js` handles kernel management, firmware management, WLAN configuration, GRUB themes, GRUB configs, worker management, and LINBO updates -- at least 7 unrelated concerns in one file.
- Fix approach: Split `system.js` into sub-routers: `system/kernel.js`, `system/firmware.js`, `system/grub-theme.js`, `system/grub-config.js`, `system/linbo-update.js`, `system/worker.js`. Mount them from a `system/index.js` barrel router. Same pattern for `images.js` and `internal.js`.

**Deploy Script Contains Hardcoded Default Password:**
- Issue: `scripts/deploy.sh:59` uses `\"password\":\"Muster!\"` as the admin password to authenticate with the API when performing rebuilds.
- Files: `scripts/deploy.sh:59`
- Impact: If the admin password is changed from the default, the deploy script's `--rebuild` flag silently fails (falls back to direct docker exec). The script assumes the default password is always valid.
- Fix approach: Use `INTERNAL_API_KEY` for internal operations instead of user credentials, or read the admin password from `.env` on the target server.

## Security Considerations

**Default JWT Secret in Production:**
- Risk: `containers/api/src/middleware/auth.js:17` falls back to `'linbo-docker-secret-change-in-production'` if `JWT_SECRET` env var is not set. The docker-compose.yml default is `${JWT_SECRET:-your_jwt_secret_here_change_in_production}`.
- Files: `containers/api/src/middleware/auth.js:17`, `docker-compose.yml:165`
- Current mitigation: The fallback string contains "change-in-production" as a hint, but there is no startup validation that rejects a known-bad secret.
- Recommendations: Add a startup check in `containers/api/src/index.js` that refuses to start (or logs a loud warning) if `JWT_SECRET` matches the default value when `NODE_ENV=production`.

**Default Internal API Key:**
- Risk: `INTERNAL_API_KEY` defaults to `'linbo-internal-secret'` in both `docker-compose.yml:198` and `containers/api/src/routes/internal.js:17`. This key grants full admin access to internal endpoints (rsync events, host status updates, macct provisioning).
- Files: `docker-compose.yml:198`, `containers/api/src/routes/internal.js:17`
- Current mitigation: Internal endpoints are on the Docker bridge network (not exposed to external traffic by default), but the API port (3000) is published to the host.
- Recommendations: Generate a random key on first `make up`, store in `.env`, and validate it is not the default at startup.

**TLS Certificate Verification Disabled:**
- Risk: `docker-compose.yml:156` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` by default. This disables TLS certificate validation for ALL outgoing HTTPS connections from the API container, including connections to the LMN Authority API.
- Files: `docker-compose.yml:156`
- Current mitigation: None. The setting is needed because self-signed LMN server certs are common, but it disables verification globally.
- Recommendations: Use the `NODE_EXTRA_CA_CERTS` env var to add the LMN server's CA cert instead of disabling all validation. Or scope the insecure fetch to only the LMN API client.

**WebSocket Endpoint Has No Authentication:**
- Risk: The main WebSocket endpoint (`/ws`) accepts connections without authentication. While the frontend sends a token as a query parameter, the server-side handler in `containers/api/src/index.js:268-312` never verifies it. Any client can connect and receive all broadcast events (host status, operations, sync progress, system events).
- Files: `containers/api/src/index.js:268-312`, `containers/web/frontend/src/stores/wsStore.ts:56`
- Current mitigation: The terminal WebSocket (`/ws/terminal`) properly authenticates via `verifyToken()`. Only the broadcast WebSocket is unprotected.
- Recommendations: Add token verification to the `/ws` upgrade handler. Reject connections without a valid JWT. The frontend already sends the token (`wsStore.ts:56`).

**CORS Wildcard Default:**
- Risk: `CORS_ORIGIN` defaults to `*` in `docker-compose.yml:202`, allowing any origin to make authenticated API requests.
- Files: `containers/api/src/index.js:50-53`, `docker-compose.yml:202`
- Current mitigation: JWT tokens are not sent as cookies (they're in Authorization headers), so CSRF is not a direct risk. But API keys could be misused from malicious origins.
- Recommendations: Default to the web container's origin (e.g., `http://localhost:8080`) and require explicit configuration for other origins.

**No Rate Limiting on Login Endpoint:**
- Risk: The `POST /auth/login` endpoint has no rate limiting. An attacker can brute-force passwords with unlimited attempts.
- Files: `containers/api/src/routes/auth.js:40-161`
- Current mitigation: None. No `express-rate-limit` or similar middleware is installed.
- Recommendations: Add rate limiting (e.g., 5 attempts per minute per IP) using `express-rate-limit` package. This is a low-effort, high-impact fix.

**Default Admin Credentials:**
- Risk: Default admin password `Muster!` is set in `docker-compose.yml:168` (`ADMIN_PASSWORD=${ADMIN_PASSWORD:-Muster!}`). Same password appears in `config/rsyncd.secrets`.
- Files: `docker-compose.yml:168`, `config/rsyncd.secrets`
- Current mitigation: Password can be changed via env var. The settings service supports a hashed password in Redis.
- Recommendations: On first startup, if no password hash exists in Redis and the env password matches the default, log a prominent warning. Consider requiring password change on first login.

**Shell Injection Surface in linbo-update.service.js:**
- Risk: `execAsync()` is called with template literals that interpolate file paths and version strings: `dpkg --compare-versions "${available}" gt "${installed}"` (line 182), `dpkg-deb -x "${debPath}" "${extractDir}"` (line 391). While inputs originate from APT metadata (not user input), a compromised APT repo could inject shell commands via crafted version strings.
- Files: `containers/api/src/services/linbo-update.service.js:182,317,391`
- Current mitigation: Version strings come from the Debian Packages index. `debPath` and `extractDir` are constructed from `os.tmpdir()` and timestamps.
- Recommendations: Use `execFile` instead of `exec` for `dpkg` and `dpkg-deb` calls, which avoids shell interpretation entirely. This is a simple refactor.

## Performance Bottlenecks

**API Key Authentication Scans All Keys:**
- Problem: `authenticateApiKey()` in `containers/api/src/middleware/auth.js:137-148` loads ALL API keys from the database, then bcrypt-compares each one sequentially. With N keys, this is O(N) bcrypt operations per request.
- Files: `containers/api/src/middleware/auth.js:137-148`
- Cause: bcrypt hashes are non-deterministic (different salt each time), so the key cannot be looked up by hash directly.
- Improvement path: Store a prefix/fingerprint alongside the bcrypt hash (e.g., first 8 chars of a SHA-256 of the key). Use the prefix for a quick DB lookup to narrow candidates to 1, then bcrypt-verify just that one. Or switch to HMAC-based API keys (deterministic hash, direct lookup).

**Sync Service Processes Entities Sequentially:**
- Problem: In `containers/api/src/services/sync.service.js`, host and config updates are processed one-at-a-time in a `for...of` loop. Each iteration involves a Redis SET + SADD + filesystem symlink operations.
- Files: `containers/api/src/services/sync.service.js:150-168` (hosts), `containers/api/src/services/sync.service.js:109-121` (configs)
- Cause: Sequential processing to avoid overwhelming Redis/filesystem.
- Improvement path: Use Redis pipelines for batch SET/SADD operations (already used for reads in `loadAllHostsFromRedis`). Batch symlink operations using `Promise.all` with a concurrency limit.

**Redis KEYS Command Used in Production:**
- Problem: `containers/api/src/lib/redis.js:140` uses `client.keys(pattern)` which scans ALL keys. In Redis documentation, KEYS is explicitly warned against for production use.
- Files: `containers/api/src/lib/redis.js:140`
- Cause: Convenience helper for `delPattern()`.
- Improvement path: Replace with `SCAN` cursor-based iteration, or better yet, use Redis Sets/Hashes to group related keys and delete by set/hash name.

## Fragile Areas

**Startup Initialization Sequence (index.js):**
- Files: `containers/api/src/index.js:160-598`
- Why fragile: The `startServer()` function is 440 lines long with 15+ sequential initialization steps. A failure in any middle step (Redis connect, route mount, GUI symlinks, rebuild marker, worker start) leaves the server in a partially-initialized state. The function continues after non-fatal failures but the order dependencies are implicit.
- Safe modification: Extract each initialization step into a named function. Add a manifest of steps with dependencies. Consider a state machine for startup health.
- Test coverage: No tests for the startup sequence itself.

**Sync Service Reconciliation Logic:**
- Files: `containers/api/src/services/sync.service.js:278-428`
- Why fragile: Three reconciliation paths (universe lists, full snapshot, incremental) handle deletion detection. Each path independently reads from Redis, scans the filesystem, and deletes entries. An edge case in any path could delete valid data. The `hostsChanged.includes('all')` fallback (line 143) recursively calls `getChanges('')` which could cause infinite loops if the API always returns "all".
- Safe modification: Add reconciliation logging with dry-run mode. Add a "sync audit" endpoint that compares local state vs remote without making changes. Add circuit breaker for the "all" fallback.
- Test coverage: `containers/api/tests/services/sync.service.test.js` exists (363 lines) but does not cover the universe list reconciliation or the "all" hosts fallback.

**GRUB Config File Naming ("grub" collision):**
- Files: `containers/api/src/services/grub-generator.js`, `containers/api/src/services/grub.service.js`
- Why fragile: A config named "grub" must be written as `_grub.cfg` to avoid overwriting the main PXE `grub.cfg`. This is a naming convention enforced in code but easy to violate if new code paths generate GRUB configs without the prefix logic.
- Safe modification: Always call a centralized `grubConfigFilename(configName)` helper that applies the underscore prefix. Add a startup assertion that `boot/grub/grub.cfg` is not a generated config.
- Test coverage: Covered in `containers/api/tests/services/grub-generator.test.js` and `containers/api/tests/services/grub.service.test.js`.

**Docker Volume Permissions:**
- Files: `docker-compose.yml` (volume mounts), `containers/api/Dockerfile`, `containers/init/Dockerfile`
- Why fragile: The API container runs as a non-root user (node, UID 1001) but multiple containers share the same volumes (`linbo_srv_data`, `linbo_config`). The init container runs as root and creates files owned by root. The API container may fail with EACCES when trying to write to files created by init. The SSH container (Ubuntu, root) also writes to shared volumes.
- Safe modification: Always `chown -R 1001:1001` in the init container before exiting. Add a healthcheck that verifies write permissions to critical paths.
- Test coverage: No automated tests for cross-container permission scenarios.

## Scaling Limits

**Single API Container:**
- Current capacity: One API container handling all REST, WebSocket, terminal SSH, workers.
- Limit: Module-level state (terminal sessions, update locks, active downloads) prevents running multiple API instances. Redis locks mitigate some issues but not all.
- Scaling path: Extract terminal service into a standalone gateway. Move operation worker to a separate container. Use Redis pub/sub for WebSocket fan-out across instances.

**Redis as Primary Data Store (Sync Mode):**
- Current capacity: All host/config data cached in Redis. Typical school network: 100-500 hosts, 5-20 configs.
- Limit: Redis is in-memory. With 10,000+ hosts (large district), memory usage could become significant. Redis persistence (RDB/AOF) adds I/O overhead.
- Scaling path: Current capacity is adequate for target use case (single school). If district-wide deployment is needed, consider Redis Cluster or moving host data to PostgreSQL.

## Dependencies at Risk

**No Pinned Docker Base Images:**
- Risk: Dockerfiles use unpinned tags (`alpine:3.19`, `ubuntu:24.04`, `node:20-alpine`, `redis:7-alpine`, `nginx:alpine`). A rebuild at different times may produce different images with breaking changes.
- Impact: Reproducibility issues. A security patch in alpine could break something; a node:20 minor bump could change behavior.
- Migration plan: Pin to digest hashes or specific version tags (e.g., `node:20.11.0-alpine3.19`). Use Renovate/Dependabot for controlled updates.

**node_modules Committed (Implicit):**
- Risk: `containers/api/node_modules/` and `containers/web/frontend/node_modules/` exist in the working tree. While `.gitignore` excludes them, the Dockerfile copies them during build (`COPY . .` patterns). No lockfile-based `npm ci` is verified.
- Impact: Builds may pick up locally-installed packages that differ from `package-lock.json`.
- Migration plan: Verify Dockerfiles use `npm ci` (not `npm install`) and do not copy `node_modules/` from the host. Add `.dockerignore` files.

## Test Coverage Gaps

**No Tests for Image Sync Service:**
- What's not tested: `containers/api/src/services/image-sync.service.js` (695 lines) -- HTTP Range downloads, resume logic, MD5 verification, atomic directory swap, queue management, bandwidth throttling.
- Files: `containers/api/src/services/image-sync.service.js`
- Risk: Image sync is a critical production feature. Bugs in resume logic or atomic swap could corrupt images or leave downloads in an inconsistent state.
- Priority: High

**No Tests for Terminal Service:**
- What's not tested: `containers/api/src/services/terminal.service.js` (275 lines) -- SSH session management, PTY/exec fallback, idle timeout, session cleanup.
- Files: `containers/api/src/services/terminal.service.js`
- Risk: Orphaned SSH sessions could leak connections. The idle timeout and cleanup-on-disconnect paths are untested.
- Priority: Medium

**Minimal Frontend Test Coverage:**
- What's not tested: 102 frontend source files (`.ts`/`.tsx`) with only 4 test files (484 lines total). No component tests, no page tests, no integration tests for WebSocket behavior, no tests for any of the 14+ pages or complex components like `PatchclassManager.tsx` (1092 lines), `FirmwareManager.tsx` (1043 lines), `ConfigsPage.tsx` (811 lines).
- Files: `containers/web/frontend/src/__tests__/` (4 files covering only API client, response handling, auth flow, and auth store)
- Risk: UI regressions go unnoticed. Complex state management in Zustand stores is largely untested beyond `authStore`.
- Priority: Medium (API-side tests cover backend logic; frontend is primarily a thin client)

**No Tests for WebSocket Integration:**
- What's not tested: The main WebSocket server (connection handling, message routing, heartbeat, channel subscriptions) and terminal WebSocket (auth, session lifecycle) in `containers/api/src/index.js:264-450`.
- Files: `containers/api/src/index.js:264-450`, `containers/api/src/lib/websocket.js`
- Risk: WebSocket connection handling changes could break real-time updates silently.
- Priority: Medium

**No E2E/Integration Tests for Boot Chain:**
- What's not tested: The full PXE boot chain (GRUB config generation -> TFTP serving -> linbofs64 delivery -> client boot). This is the core functionality of the entire system.
- Files: `containers/tftp/`, `scripts/server/update-linbofs.sh`, `containers/api/src/services/grub.service.js`, `containers/api/src/services/grub-generator.js`
- Risk: Boot chain regressions discovered only during manual testing on real hardware. Currently verified by sessions 28-32 (manual testing with physical machines).
- Priority: Low (hard to automate PXE boot testing; manual verification is the realistic approach)

## Missing Critical Features

**Multicast Image Distribution (udpcast):**
- Problem: Production LINBO uses `udpcast` for multicast image distribution to many clients simultaneously. Docker deployment has no multicast support.
- Blocks: Efficient mass-deployment scenarios (30+ clients booting simultaneously).

**Torrent-Based Image Distribution (ctorrent):**
- Problem: Production LINBO uses `ctorrent` for peer-to-peer image distribution. Docker deployment has no torrent support.
- Blocks: Peer-to-peer image distribution for reduced server bandwidth.

**No Token Revocation:**
- Problem: JWT tokens cannot be revoked. Logout is client-side only (`containers/api/src/routes/auth.js:168-180`). A compromised token remains valid until expiry (24h default).
- Blocks: Proper security incident response. If a token is leaked, it cannot be invalidated server-side.

---

*Concerns audit: 2026-03-06*
