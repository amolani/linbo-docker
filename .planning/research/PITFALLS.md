# Domain Pitfalls

**Domain:** Adding fresh install flow, configuration management, error handling, and admin documentation to a Docker-based network boot system (LINBO Docker)
**Researched:** 2026-03-08
**Confidence:** HIGH (based on existing codebase analysis, 33+ sessions of operational history, documented troubleshooting incidents, and community patterns)

---

## Critical Pitfalls

Mistakes that cause rewrites, broken deployments, or stranded users.

### Pitfall 1: .env Drift Between .env.example and docker-compose.yml Defaults

**What goes wrong:** The `.env.example` file, the actual `.env` file, and the `docker-compose.yml` inline defaults (`${VAR:-default}`) define different variable sets with conflicting defaults. A fresh user copies `.env.example` but misses variables only defined in `docker-compose.yml` defaults. Or worse, `.env.example` defines `DB_PASSWORD` but `docker-compose.yml` references `POSTGRES_PASSWORD` -- and `DATABASE_URL` uses `${POSTGRES_PASSWORD}` interpolation. The naming is inconsistent.

**Why it happens:** Over 33 development sessions, variables were added to `docker-compose.yml` with inline defaults but never backported to `.env.example`. The project has TWO `.env.example` files (root and `containers/api/`) with different content. The root `.env` currently has 116 lines; the `.env.example` has 240 lines; `docker-compose.yml` sets ~60 env vars with its own defaults. These three sources tell different stories.

**Evidence from codebase:**
- Root `.env` uses `DB_PASSWORD`, but `docker-compose.yml` and `.env.example` use `POSTGRES_PASSWORD`
- `.env.example` includes `RSYNC_PASSWORD`, `RATE_LIMIT_MAX`, `PRISMA_LOG_QUERIES` -- none of which appear in `docker-compose.yml`
- `docker-compose.yml` sets `ADMIN_PASSWORD=${ADMIN_PASSWORD:-Muster!}` -- `.env` has no `ADMIN_PASSWORD`
- `GITHUB_TOKEN` is REQUIRED for web container build but appears only at the bottom of `.env`, not in `.env.example`

**Consequences:**
- Fresh install fails silently: web container build returns 401 because GITHUB_TOKEN was not set
- API starts with default `Muster!` password because user did not know to set `ADMIN_PASSWORD`
- Database auth fails after volume recreation because password vars have different names
- User copies `.env.example`, gets 240 lines of config, but only ~8 actually matter for getting started

**Prevention:**
- Create ONE canonical `.env.example` that matches exactly what `docker-compose.yml` consumes
- Remove the `containers/api/.env.example` (it is for local dev outside Docker, not the primary workflow)
- Group variables into REQUIRED (must change), RECOMMENDED (should change), and OPTIONAL (sensible defaults)
- Add inline comments explaining which variables are build-time vs runtime
- Add a `make check-env` target that validates `.env` against expected variables

**Detection:** User reports "web container won't build" or "can't login" within first 10 minutes of setup.

**Phase:** Should be addressed in the configuration management phase, before documentation is written.

---

### Pitfall 2: Init Container Failure Leaves System in Unrecoverable Partial State

**What goes wrong:** The init container (`restart: "no"`) runs once, downloads .deb packages from the LMN APT repo, extracts and provisions boot files, then exits. If it fails partway through (network timeout, disk full, corrupt download), the Docker volumes contain partial data. Every dependent container (tftp, rsync, ssh, api, web) has `condition: service_completed_successfully`, so they never start. The user must manually diagnose why init failed, fix the issue, and either `docker compose down -v` (losing all data) or manually clean up volumes.

**Why it happens:** The init container uses `set -e` but has no checkpoint/resume mechanism. Each run starts from scratch (downloads both .deb packages, re-extracts everything). Network issues to `deb.linuxmuster.net` are common in school networks behind proxies. The download-extract-provision flow has 12 sequential steps with no rollback.

**Evidence from codebase:**
- `containers/init/entrypoint.sh`: `set -e` means any failure exits, `restart: "no"` means no retry
- No HTTP proxy configuration support in the init container
- No retry beyond the download step (3 retries for curl, but `dpkg-deb -x` failure is fatal)
- `.needs-rebuild` marker is written AFTER provisioning (step 8), so a failure at step 7 means no marker and API does not rebuild, but boot files are partially present

**Consequences:**
- Fresh install on a school network behind a proxy: init fails, all containers stay stopped
- User sees `linbo-init exited with code 1` but no clear error message in `docker compose ps`
- Volumes have partial data: GRUB files but no kernel, or kernel but no GUI
- Rerunning `docker compose up -d` does nothing because init is `restart: "no"` -- user must `docker compose up -d --force-recreate init`

**Prevention:**
- Add idempotent checkpoints: if linbo-version matches and all expected files exist, skip download
- Already partially implemented (version check at line 550), but only covers the happy path
- Add proxy configuration: `HTTP_PROXY`, `HTTPS_PROXY` env vars passed through to curl
- Add a health check or verification step before writing success markers
- Document the `docker compose up -d --force-recreate init` recovery command prominently
- Consider making init a simple download-and-verify step, moving provisioning to the API startup

**Detection:** All containers except init show "waiting" or "not started" status after `docker compose up -d`.

**Phase:** Bootstrap flow optimization phase. This is the single most important fresh-install pitfall.

---

### Pitfall 3: LINBO_SERVER_IP Misconfiguration Breaks PXE Boot Silently

**What goes wrong:** `LINBO_SERVER_IP` defaults to `10.0.0.1` in `docker-compose.yml`. This IP is written into GRUB configs and used by LINBO clients to reach the boot server. If the Docker host has a different IP (and it almost always does on a fresh install), PXE clients boot GRUB but then cannot download `linbo64` or `linbofs64` because they try to reach `10.0.0.1`. The LINBO client shows a cryptic GRUB error or hangs at "Loading linbo64...".

**Why it happens:** The default `10.0.0.1` is the linuxmuster.net convention, but fresh installs on VMs, cloud instances, or non-LMN networks use completely different IP ranges. The variable name sounds like it might auto-detect, but it does not -- it is a manually-set value that must match the Docker host's actual network interface IP visible to PXE clients.

**Evidence from codebase:**
- `docker-compose.yml` line 94: `LINBO_SERVER_IP=${LINBO_SERVER_IP:-10.0.0.1}`
- GRUB configs embed this IP for HTTP boot: `linux (http,$LINBO_SERVER_IP)/linbo64`
- DHCP container uses it as `next-server`
- The `.env.example` lists it first with a comment "IP address of the Docker host (visible to PXE clients)" but does not explain consequences of getting it wrong

**Consequences:**
- PXE clients reach GRUB via TFTP (which works because TFTP is on host network), but HTTP boot fails because GRUB tries to reach wrong IP
- User debugs for hours: TFTP works, GRUB menu shows, but kernel download fails
- In sync mode with a separate DHCP server, the DHCP server may announce a different `next-server` than LINBO_SERVER_IP, causing a second layer of confusion

**Prevention:**
- Add startup validation in the API that checks if `LINBO_SERVER_IP` matches any local network interface
- If no match, log a prominent warning: "LINBO_SERVER_IP=10.0.0.1 does not match any local interface. PXE boot will fail."
- In the install guide, make this the FIRST configuration step with a verification command: `ip -4 addr show | grep inet`
- Add a `make check-network` target that verifies LINBO_SERVER_IP, port availability, and TFTP reachability

**Detection:** PXE clients show GRUB menu but hang at kernel download, or show "error: no suitable address found".

**Phase:** Configuration management phase (validation) and documentation phase (install guide).

---

### Pitfall 4: Docker Volume Permissions Break Cross-Container File Access

**What goes wrong:** Multiple containers share Docker volumes (`linbo_srv_data`, `linbo_config`, `linbo_log`). The init container runs as root and creates files owned by `root:root`. The API container runs as non-root user `linbo` (UID 1001). The SSH container runs as root. When the API tries to write to files created by init (or vice versa), it fails with EACCES.

**Why it happens:** Docker does not enforce consistent ownership across containers sharing volumes. The init container runs `chown -R 1001:1001` at the end, but:
1. If init fails before the chown step, files stay root-owned
2. The SSH container (running as root) creates new files as root
3. The API container creates files as 1001, but some paths are only writable by root
4. After a LINBO update (via API), new files from extracted .deb packages are root-owned

**Evidence from codebase:**
- Troubleshooting doc issue #1: "EACCES: permission denied, open '/srv/linbo/start.conf.testgruppe'" -- this is a documented recurrence
- Troubleshooting doc issue #23: SSH key permissions differ between servers
- `containers/init/entrypoint.sh` line 608-609: `chmod -R 755` + `chown -R 1001:1001` at the end
- `update-linbofs.sh` runs inside the API container as UID 1001 and creates temp files in `/var/cache/linbo`
- CONCERNS.md explicitly documents this as a fragile area

**Consequences:**
- Raw Config Editor returns 500 error on first use after fresh install
- update-linbofs.sh fails because it cannot create temp files or write to `/srv/linbo`
- GRUB config regeneration fails silently (EACCES when writing to `/srv/linbo/boot/grub/`)
- The fix (`chown -R 1001:1001 /var/lib/docker/volumes/linbo_srv_data/_data/`) requires root shell access to the Docker host

**Prevention:**
- Add a startup permission check in the API: verify write access to critical paths BEFORE starting services
- If permissions are wrong, log a clear error with the exact fix command
- Use a shared GID approach: create a `linbo` group in all containers, set group-writable permissions
- Add volume permission repair to the init container's idempotent startup check
- Document the permission model in the admin guide

**Detection:** API returns 500 errors for file operations; logs show "EACCES: permission denied".

**Phase:** Bootstrap flow phase (permission initialization) and error handling phase (startup checks).

---

### Pitfall 5: Documentation That Lies About Prerequisites and Steps

**What goes wrong:** The install documentation says "Clone, copy .env, run docker compose up, done" but omits critical prerequisites and intermediate failures. Users hit undocumented requirements: GITHUB_TOKEN for web build, network interface configuration for TFTP host-mode, port conflicts with existing services, Docker version requirements, disk space for boot file downloads.

**Why it happens:** Documentation was written by the developer who already has everything configured. The "works on my machine" problem: the development server has GITHUB_TOKEN set, has the right ports free, has fast internet, and runs Ubuntu with the right Docker version. Edge cases discovered in Sessions 1-33 are documented in TROUBLESHOOTING.md but not in the install guide.

**Evidence from codebase:**
- TROUBLESHOOTING.md has 25 documented issues, many of which are first-install problems
- Issue #6: Port 69/udp already in use by existing TFTP service
- Issue #7: Init container download failure with no recovery path documented
- Issue #20: Web build fails without GITHUB_TOKEN (401 Unauthorized)
- Issue #12: `docker compose restart` does not load new .env values (common mistake)
- The current "installation checklist" in TROUBLESHOOTING.md is 6 steps but misses GITHUB_TOKEN, proxy config, LINBO_SERVER_IP verification

**Consequences:**
- Every fresh install generates 2-3 support requests for issues already documented elsewhere
- Users lose trust in the project when the "quick start" takes 2 hours
- Multi-school rollout stalls because each school's admin hits different undocumented issues

**Prevention:**
- Write the install guide by ACTUALLY doing a fresh install on a clean VM and documenting every step
- Include a "prerequisites check" script that validates: Docker version, available ports, disk space, network config, GITHUB_TOKEN
- Add troubleshooting cross-references inline: "If you see 401 during build, see [GITHUB_TOKEN setup]"
- Test the install guide with someone who has NOT seen the codebase before
- Keep the install guide as a single path (no branching until absolutely necessary)

**Detection:** Users report install taking longer than 30 minutes, or open issues for problems already documented in TROUBLESHOOTING.md.

**Phase:** Documentation phase. But the prerequisites check script should be built in the configuration management phase.

---

### Pitfall 6: TFTP/DHCP Host Network Mode Creates Silent Port Conflicts

**What goes wrong:** The TFTP container uses `network_mode: host` (required for PXE), which means it binds directly to the host's port 69/UDP. The optional DHCP container also uses `network_mode: host` on port 67/UDP. On a server that already runs a DHCP server (ISC DHCP, dnsmasq) or TFTP server (tftpd-hpa, dnsmasq), these ports are already occupied. Docker starts the container, but it cannot bind the port, and fails with a cryptic error or -- worse -- silently serves stale files from the wrong TFTP root.

**Why it happens:** School servers running linuxmuster.net already have dnsmasq or tftpd-hpa serving PXE. Docker host-mode containers compete for the same ports. Unlike bridge-mode port conflicts (which Docker clearly reports), host-mode conflicts manifest as service failures inside the container, not as Docker errors.

**Evidence from codebase:**
- Troubleshooting doc issue #6: "Port 69/udp already in use" -- documented occurrence
- `docker-compose.yml` line 34: `network_mode: host` for tftp
- `docker-compose.yml` line 263: `network_mode: host` for dhcp
- DHCP container is profile-gated (`profiles: ["dhcp"]`), but TFTP is always started

**Consequences:**
- On a LMN server: existing tftpd-hpa blocks Docker TFTP, PXE clients get files from the old TFTP, which may have outdated or incompatible boot files
- On a server with dnsmasq: dnsmasq binds both 67 and 69, Docker DHCP AND TFTP fail
- The error message ("address already in use") is buried in container logs, not visible in `docker compose ps`

**Prevention:**
- Add a pre-flight check script: `ss -tulpn | grep -E ':69|:67'` with human-readable output
- If port 69 is occupied, print: "Port 69/UDP in use by [process]. Stop it with: systemctl stop tftpd-hpa"
- In the install guide, make port conflict resolution a prerequisite step
- Consider a "co-existence mode" where Docker does NOT start TFTP and instead symlinks its boot files into the existing TFTP root

**Detection:** PXE clients boot old/wrong files or do not boot at all. `docker logs linbo-tftp` shows bind failure.

**Phase:** Configuration management phase (pre-flight checks) and documentation phase.

---

## Moderate Pitfalls

### Pitfall 7: Configuration Validation That Is Too Strict Blocks Legitimate Setups

**What goes wrong:** Adding startup validation for .env variables seems straightforward, but over-validation blocks legitimate edge cases. For example: validating that LINBO_SERVER_IP matches a local interface fails when the Docker host is behind a NAT or uses a virtual IP. Requiring a non-default JWT_SECRET in development mode breaks the developer workflow. Requiring GITHUB_TOKEN blocks builds when users fork the repo and remove the private npm dependency.

**Why it happens:** Developers add validation for every issue they have encountered, creating a "must be this tall to ride" experience where fresh installs are blocked by checks designed for production hardening.

**Evidence from codebase:**
- `validateSecrets()` already implements the right pattern: fatal in production, warning in development, silent in test
- But if new checks do not follow this pattern, they will be too strict

**Prevention:**
- Follow the existing `validateSecrets()` pattern: FATAL in production, WARNING in development
- Validation should INFORM, not BLOCK, in development mode
- Group checks into "required for any mode" vs "required for production" vs "recommended"
- Never validate external network state (like "is this IP reachable?") -- only validate configuration consistency

**Detection:** Users report "API won't start" after a clean install with default settings.

**Phase:** Error handling phase. Define validation tiers before implementing checks.

---

### Pitfall 8: docker compose restart vs docker compose up -d for .env Changes

**What goes wrong:** After editing `.env`, users run `docker compose restart api` instead of `docker compose up -d api`. The restart command reuses the existing container with OLD environment variables. The user thinks the change took effect, but the API still runs with the previous configuration.

**Why it happens:** `docker compose restart` is the intuitive command. Docker's distinction between "restart existing container" and "recreate container with new config" is not obvious. This is already documented in TROUBLESHOOTING.md issue #12, proving it happens in practice.

**Evidence from codebase:**
- TROUBLESHOOTING.md issue #12: exact this problem documented with DC_PROVISIONING_ENABLED
- `docker-compose.yml` passes all env vars via `environment:` block which is read at container creation time
- The Makefile uses `docker compose up -d` (correct) but manual users often use `restart`

**Prevention:**
- Document this prominently in the admin guide with a callout box
- Add a `make reconfigure` target that runs `docker compose up -d` for all services
- Consider adding an env-hash check: API on startup compares running env vars against `.env` file and logs a warning if they differ

**Detection:** User changes `.env` but behavior does not change. `docker exec linbo-api env | grep VAR` shows old value.

**Phase:** Documentation phase (admin guide) and possibly error handling phase (env-hash check).

---

### Pitfall 9: Marker File State Machine Failures During Interrupted Rebuilds

**What goes wrong:** The linbofs64 rebuild lifecycle depends on three marker files: `.needs-rebuild` (init sets), `.needs-rebuild.running` (API renames during rebuild), `.linbofs-patch-status` (update-linbofs.sh writes on success). If the rebuild is interrupted (OOM kill, timeout, Docker restart), the state machine enters an ambiguous state. The API has recovery logic (line 690-694) but it only handles the `.running` marker, not cases where `update-linbofs.sh` itself fails mid-execution.

**Why it happens:** Marker-file-based state machines are inherently fragile. The state transitions span two processes (Node.js API and bash script) with no shared transaction. A crash during the bash script leaves `.running` but no `.linbofs-patch-status`, so TFTP blocks forever.

**Evidence from codebase:**
- `containers/api/src/index.js` lines 668-698: rebuild marker logic with `.running` rename
- `containers/tftp/entrypoint.sh` line 4: blocks on `.linbofs-patch-status` with busy-wait
- `scripts/server/update-linbofs.sh` line 542: writes `.linbofs-patch-status` only on success
- If rebuild fails: `.running` exists, `.linbofs-patch-status` does not exist, TFTP waits forever

**Prevention:**
- Add a timeout to TFTP's marker wait: after 10 minutes, start serving whatever exists (with a log warning)
- Add a rebuild timeout in the API: if update-linbofs.sh runs longer than 5 minutes, kill and reset marker
- Write `.linbofs-patch-status` with status "FAILED" on error, not just on success -- TFTP should serve files even if rebuild partially failed (better to boot with old keys than not boot at all)
- Add a `make repair-rebuild` target for manual recovery

**Detection:** After a Docker restart or OOM event, TFTP never starts. `docker logs linbo-tftp` shows "Waiting for linbofs64 rebuild...".

**Phase:** Error handling phase. This is a reliability improvement, not a feature.

---

### Pitfall 10: Two Docker Compose Files With Divergent Service Definitions

**What goes wrong:** The project has two `docker-compose.yml` files: root (`docker-compose.yml`) and deploy (`deploy/docker-compose.yml`). They define different services, different volume names, different healthchecks, and different environment variables. The deploy version does not include the init container, uses unpinned image tags, has different SSH port (22 vs 2222), and uses different volume names (`linbo_data` vs `linbo_srv_data`). Users or scripts that reference the wrong compose file get a completely different system.

**Why it happens:** The deploy compose file was likely an early version that was not maintained as the main compose file evolved. It serves a different purpose (standalone deployment without LMN) but shares the same project name.

**Evidence from codebase:**
- `docker-compose.yml` (root): 7 services, init container, health checks, kernel volumes, SYNC vars
- `deploy/docker-compose.yml`: 6 services, no init, no kernel provisioning, uses `version: '3.8'` (deprecated), different volume naming
- Deploy compose has `SSH_PORT: 22` while main has `SSH_PORT=2222`
- Deploy compose uses `linbo_data` volume name; main uses `linbo_srv_data`

**Prevention:**
- Either delete `deploy/docker-compose.yml` or mark it clearly as deprecated
- If both need to exist, document which one to use and when
- Add validation in the Makefile that prevents accidentally using the wrong compose file
- The install guide should reference exactly ONE compose file path

**Detection:** User runs `docker compose -f deploy/docker-compose.yml up` and gets a broken system with no init container.

**Phase:** Configuration management phase. Resolve before documentation.

---

### Pitfall 11: GITHUB_TOKEN Requirement for Web Container Build

**What goes wrong:** The web container's Dockerfile pulls `@edulution-io/ui-kit` from GitHub Packages, which requires a `GITHUB_TOKEN`. This token must be set in `.env` BEFORE the first `docker compose up -d --build`. If missing, the build fails with a `401 Unauthorized` error during `npm ci`. The error is buried in build output, not in container logs.

**Why it happens:** The private npm package is an internal dependency of the edulution project. External users forking the repo will not have access to this package. The token requirement is documented only in TROUBLESHOOTING.md issue #20, not in the install guide.

**Evidence from codebase:**
- `containers/web/Dockerfile` passes `GITHUB_TOKEN` as build arg
- `.env` has `GITHUB_TOKEN=ghp_...` (an actual token committed to the repo -- security issue)
- `.env.example` does NOT include GITHUB_TOKEN
- TROUBLESHOOTING.md issue #20 documents this as a recurring problem

**Consequences:**
- Fresh installs fail at web container build with no clear message
- External contributors cannot build without requesting a token
- The committed token in `.env` is a security risk (it may be revoked at any time)

**Prevention:**
- Add GITHUB_TOKEN to `.env.example` with instructions on how to obtain one
- Consider making `@edulution-io/ui-kit` a public package, or vendoring it
- Add a pre-build check in the web Dockerfile that prints a clear error if GITHUB_TOKEN is missing
- Remove the committed token from `.env` (rotate it, as it is now in git history)

**Detection:** `docker compose up -d` succeeds for all services except web, which shows "build failed".

**Phase:** Configuration management phase. Must be resolved before documentation.

---

## Minor Pitfalls

### Pitfall 12: rsyncd.secrets Default Credentials

**What goes wrong:** `config/rsyncd.secrets` ships with default credentials `linbo:Muster!`. If the user does not change them, rsync provides read/write access to `/srv/linbo` (boot files, images) with known credentials.

**Prevention:** Already addressed in v1.0 PROD-05 (rsyncd.secrets.example). Verify this is actually implemented. Add a startup check that warns if rsyncd.secrets contains "Muster!".

**Detection:** Security audit flags default credentials.

**Phase:** Configuration management phase (verification).

---

### Pitfall 13: PostgreSQL Volume Password Mismatch After Recreate

**What goes wrong:** PostgreSQL stores the password in its data volume on first initialization. If the user changes `POSTGRES_PASSWORD` in `.env` and recreates the container (but not the volume), authentication fails because the stored password does not match.

**Evidence from codebase:** TROUBLESHOOTING.md issue #5 documents this exact scenario.

**Prevention:**
- Document this in the admin guide with both solutions (volume delete vs ALTER USER)
- Add a healthcheck validation that catches "authentication failed" errors specifically
- Consider using a startup script that checks password match

**Detection:** API logs show "Authentication failed against database server".

**Phase:** Documentation phase.

---

### Pitfall 14: Nginx Reverse Proxy Assumes API Container Hostname

**What goes wrong:** The web container's Nginx config proxies `/api/*` and `/ws` to the API container using its Docker hostname (`linbo-api`). If the API container is renamed, uses a different network, or the web container starts before the API is reachable via DNS, requests fail with 502 Bad Gateway.

**Prevention:**
- Ensure the `depends_on: api: condition: service_healthy` dependency is maintained
- Document that container names are significant and should not be changed
- Add a healthcheck in the web container that verifies API reachability

**Detection:** Frontend loads but shows "Network Error" for all API calls.

**Phase:** Documentation phase (admin guide, "do not rename containers").

---

### Pitfall 15: Missing Firmware Volume Mount on Fresh Install

**What goes wrong:** The API container mounts `/lib/firmware:/lib/firmware:ro` from the Docker host. On a minimal VM or cloud instance, the host may not have `/lib/firmware` at all, or it may contain firmware for irrelevant hardware. If a user configures firmware injection in linbofs64, the update-linbofs.sh script fails with "WARN: not found" for every firmware entry.

**Prevention:**
- Document that firmware injection requires the Docker host to have the relevant firmware packages installed
- Add a check in update-linbofs.sh that logs a clear warning if `/lib/firmware` is empty or missing
- Consider shipping a minimal firmware bundle in the init container for common Intel NICs

**Detection:** update-linbofs.sh logs many "WARN: not found" messages; LINBO clients boot but NIC firmware fails.

**Phase:** Bootstrap flow phase (firmware handling) and documentation phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Bootstrap flow | Init container fails on proxied networks | Add HTTP_PROXY/HTTPS_PROXY support, document proxy setup |
| Bootstrap flow | Partial boot files after interrupted init | Add idempotent checkpoints and file verification |
| Bootstrap flow | TFTP blocks forever after failed rebuild | Add timeout to TFTP marker wait, write FAILED status |
| Configuration mgmt | .env.example does not match docker-compose.yml | Single source of truth, automated drift detection |
| Configuration mgmt | LINBO_SERVER_IP wrong, PXE boot fails | Startup validation against local interfaces |
| Configuration mgmt | Two compose files confuse users | Delete or clearly mark the deploy/docker-compose.yml |
| Configuration mgmt | GITHUB_TOKEN not documented | Add to .env.example, consider making ui-kit public |
| Error handling | Over-strict validation blocks dev mode | Follow existing validateSecrets() pattern: fatal=prod, warn=dev |
| Error handling | Silent permission failures | Startup write-permission checks on shared volumes |
| Error handling | Rebuild marker state machine stuck | Timeouts, FAILED status markers, manual recovery command |
| Documentation | Install guide assumes developer environment | Test on fresh VM, include prerequisites check |
| Documentation | restart vs up -d confusion | Prominent callout, make reconfigure target |
| Documentation | Two compose files, undocumented which to use | Single reference in install guide |

---

## Sources

### Project-Internal (HIGH confidence)
- Codebase analysis: `docker-compose.yml`, `deploy/docker-compose.yml`, `.env`, `.env.example`, `containers/init/entrypoint.sh`, `scripts/server/update-linbofs.sh`, `containers/api/src/index.js`
- `.planning/codebase/CONCERNS.md` -- security and fragility analysis
- `.planning/codebase/INTEGRATIONS.md` -- external service dependencies
- `.planning/codebase/ARCHITECTURE.md` -- container architecture
- `docs/TROUBLESHOOTING.md` -- 25 documented operational incidents

### External (MEDIUM confidence)
- [Docker Compose environment variable best practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/) -- official Docker guidance on .env management
- [Docker Compose in production](https://docs.docker.com/compose/how-tos/production/) -- official production deployment guidance
- [Common Docker Compose mistakes](https://moldstud.com/articles/p-avoid-these-common-docker-compose-pitfalls-tips-and-best-practices) -- community patterns for compose pitfalls
- [PXE boot with Docker containers](https://jpetazzo.github.io/2013/12/07/pxe-netboot-docker/) -- foundational reference for Docker PXE challenges
- [DHCP/PXE Docker setup](https://betelgeuse.work/dhcp-pxe-server/) -- network boot Docker patterns
- [Docker compose restart does not reload env](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/) -- official documentation on env var lifecycle
- [Docker remove obsolete version keys](https://adamj.eu/tech/2025/05/05/docker-remove-obsolete-compose-version/) -- deploy/docker-compose.yml uses deprecated `version` key

---

*Pitfalls analysis: 2026-03-08*
