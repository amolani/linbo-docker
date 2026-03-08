# Architecture Patterns

**Domain:** Fresh install flow, configuration validation, and setup documentation for existing LINBO Docker multi-container system
**Researched:** 2026-03-08

## Recommended Architecture

The v1.1 milestone adds **no new containers**. All fresh install, configuration validation, and error handling improvements integrate into existing components: the init container, the API server, and the install script. The frontend gains a setup wizard page. No architectural paradigm shifts -- this is surgical enhancement of the bootstrap pipeline.

### High-Level Integration Map

```
EXISTING                          NEW / MODIFIED
========                          ==============

install.sh ----[modify]--------> install.sh (validation, preflight checks, rsync secrets)
                                      |
.env.example --[modify]--------> .env.example (minimal + documented, env groups)
                                      |
                                      v
docker compose up
      |
      v
init container --[modify]------> entrypoint.sh (structured errors, progress markers, retry)
      |                               |
      | writes .needs-rebuild         | writes .init-status.json (progress/errors)
      v                               v
API startup ----[modify]--------> index.js (setup wizard detection, config validation)
      |                               |
      |                               | new: GET /api/v1/system/setup-status
      |                               | new: POST /api/v1/system/setup/validate
      v                               v
web frontend ---[new page]------> SetupWizardPage.tsx (first-run guided setup)
      |
      v
(Normal operation -- unchanged)
```

### Component Boundaries

| Component | Responsibility | Changes for v1.1 | Communicates With |
|-----------|---------------|-------------------|-------------------|
| `scripts/install.sh` | Automated first-run setup (clone, .env, docker compose up) | Add preflight validation, env validation, better error messages, rsync secrets generation | Host OS, Docker, git |
| `containers/init/entrypoint.sh` | Download LINBO packages from APT repo, provision boot files | Add structured status reporting (.init-status.json), better error categorization, retry with backoff for network failures | APT repo (deb.linuxmuster.net), shared volumes |
| `containers/api/src/index.js` | API startup, secret validation, auto-rebuild | Add setup-status detection (is this a fresh install?), config completeness check | Redis, filesystem, init status file |
| `containers/api/src/routes/system/` | System management endpoints | New: setup-status, setup-validate, setup-complete endpoints | Settings service, linbofs service |
| `containers/api/src/services/setup.service.js` | **NEW** -- Setup state machine, validation, first-run detection | Validate .env completeness, check init status, check key status, check linbofs status | Settings service, linbofs service, Redis, filesystem |
| `containers/web/frontend/src/pages/SetupWizardPage.tsx` | **NEW** -- Guided first-run configuration | Step-by-step: network config, auth check, init status, linbofs rebuild, PXE test | API client (setup endpoints) |
| `.env.example` | Reference configuration | Reorganize into required/optional groups with validation hints | install.sh reads this |
| `docs/` | Admin documentation | **NEW** -- INSTALL.md, ARCHITECTURE-OVERVIEW.md, TROUBLESHOOTING.md updates | Human readers |

### New vs Modified Files (Explicit)

**New Files:**
- `containers/api/src/services/setup.service.js` -- setup state machine and validation
- `containers/web/frontend/src/pages/SetupWizardPage.tsx` -- first-run wizard UI
- `docs/INSTALL.md` -- admin installation guide
- `docs/ARCHITECTURE-OVERVIEW.md` -- admin-facing architecture documentation

**Modified Files:**
- `scripts/install.sh` -- preflight checks, validation, structured output
- `containers/init/entrypoint.sh` -- status reporting, error categorization
- `containers/api/src/index.js` -- setup detection on startup
- `containers/api/src/routes/system/index.js` -- new setup endpoints
- `containers/api/src/services/settings.service.js` -- network config validation additions
- `containers/web/frontend/src/App.tsx` -- setup wizard route
- `.env.example` -- reorganized with validation hints
- `docker-compose.yml` -- possible minor env var additions for setup mode

**Unchanged:**
- All other containers (tftp, rsync, ssh, cache, web, dhcp)
- All existing API routes and services
- Frontend pages (except new wizard route)
- update-linbofs.sh (hooks system unchanged)
- Kernel variant system
- Sync/standalone mode logic

## Data Flow

### Fresh Install Flow (Happy Path)

```
1. Admin runs install.sh (or manually: git clone + cp .env.example .env + edit)
       |
       | install.sh:
       |   - Checks dependencies (docker, git, curl, openssl)
       |   - Detects server IP (or uses LINBO_IP env)
       |   - Generates secrets (JWT_SECRET, INTERNAL_API_KEY, RSYNC_PASSWORD)
       |   - Creates .env from template
       |   - Creates config/rsyncd.secrets from RSYNC_PASSWORD
       |   - docker compose build + up
       v
2. Init container starts (one-shot)
       |
       | entrypoint.sh:
       |   - Writes .init-status.json: {"phase": "starting", "progress": 0}
       |   - Fetches APT Packages index (retry with backoff)
       |   - Downloads linuxmuster-linbo7 + linuxmuster-linbo-gui7 .deb
       |   - Provisions boot files (GRUB, kernels, GUI, themes)
       |   - Writes .init-status.json: {"phase": "complete", "version": "4.3.31"}
       |   - Sets .needs-rebuild marker
       v
3. API container starts (waits for init + cache healthy)
       |
       | index.js startup:
       |   - validateSecrets() -- blocks in production if defaults
       |   - Redis connect
       |   - Setup detection: reads .init-status.json, checks key-status, checks linbofs
       |   - If fresh install: sets Redis key "setup:pending"
       |   - Mounts routes (including new setup endpoints)
       |   - Auto-rebuild: detects .needs-rebuild, triggers updateLinbofs()
       |     - Generates SSH keys if missing
       |     - Builds linbofs64 (inject keys, modules, firmware, hooks)
       |   - Starts workers
       v
4. Web container starts (waits for API healthy)
       |
       | Browser navigates to http://SERVER:8080
       |   - App.tsx checks GET /api/v1/system/setup-status
       |   - If setup incomplete: redirect to /setup wizard
       |   - SetupWizardPage shows:
       |     Step 1: Verify network config (LINBO_SERVER_IP)
       |     Step 2: Verify init completed (boot files present)
       |     Step 3: Verify SSH keys + linbofs64 built
       |     Step 4: PXE boot configuration instructions
       |     Step 5: Mark setup complete
       v
5. Normal operation
```

### Init Container Status Reporting (New Pattern)

The init container currently writes markers (`.needs-rebuild`, `.boot-files-installed`, `linbo-version`) as separate files. For v1.1, add a single structured status file that the API can read.

**File:** `/srv/linbo/.init-status.json`

```json
{
  "phase": "complete",
  "progress": 100,
  "timestamp": "2026-03-08T14:30:00Z",
  "version": "4.3.31-0",
  "packages": {
    "linbo7": {"version": "4.3.31-0", "sha256": "abc..."},
    "gui7": {"version": "4.3.31-0", "sha256": "def..."}
  },
  "errors": [],
  "warnings": ["Kernel variant 'legacy' not available in this release"]
}
```

**Error case:**
```json
{
  "phase": "download",
  "progress": 30,
  "timestamp": "2026-03-08T14:30:00Z",
  "error": {
    "code": "APT_FETCH_FAILED",
    "message": "Failed to fetch APT Packages index from https://deb.linuxmuster.net/...",
    "retries": 3,
    "hint": "Check DNS resolution and internet connectivity from the Docker host"
  }
}
```

This is a write-once file (init container exits after writing), read by the API on startup. No shared-state complexity.

### Setup State Machine

```
                    +-----------+
                    |  PENDING  |  (default after fresh install)
                    +-----+-----+
                          |
          setup-status API returns checklist:
          - init_complete: true/false
          - keys_present: true/false
          - linbofs_built: true/false
          - config_valid: true/false
                          |
                          v
                    +-----------+
                    | VALIDATING|  (wizard is running checks)
                    +-----+-----+
                          |
          All checks pass, admin clicks "Complete Setup"
          POST /api/v1/system/setup/complete
                          |
                          v
                    +-----------+
                    | COMPLETE  |  (Redis: setup:complete = true)
                    +-----------+
```

The setup state is stored in Redis (`setup:status` key) so it survives API restarts but not volume wipes (which is correct -- a volume wipe IS a fresh install).

## Patterns to Follow

### Pattern 1: Preflight Validation in install.sh

**What:** Validate host environment BEFORE starting Docker containers.
**When:** Always, at the top of install.sh.
**Why:** Failing fast with a clear message is better than containers crashing with cryptic errors.

```bash
preflight_check() {
    local errors=()

    # 1. Docker daemon running
    if ! docker info &>/dev/null; then
        errors+=("Docker daemon is not running")
    fi

    # 2. Required ports available
    for port in 69 873 2222 3000 6379 8080; do
        if ss -tlnp | grep -q ":${port} "; then
            errors+=("Port $port is already in use (required by LINBO Docker)")
        fi
    done

    # 3. Network interface exists (for LINBO_SERVER_IP)
    if [ -n "$LINBO_IP" ] && ! ip addr show | grep -q "$LINBO_IP"; then
        errors+=("LINBO_IP=$LINBO_IP is not assigned to any network interface")
    fi

    # 4. DNS resolution works (for APT repo)
    if ! host deb.linuxmuster.net &>/dev/null 2>&1; then
        errors+=("Cannot resolve deb.linuxmuster.net (DNS issue)")
    fi

    if [ ${#errors[@]} -gt 0 ]; then
        log_error "Preflight checks failed:"
        for err in "${errors[@]}"; do
            echo "  - $err"
        done
        exit 1
    fi
    log_success "Preflight checks passed"
}
```

### Pattern 2: Setup Service as Checklist Aggregator

**What:** A service that aggregates status from multiple sources into a single setup checklist.
**When:** First-run detection on API startup and on-demand via setup API endpoints.
**Why:** The API already checks multiple subsystems on startup; centralizing this into a service makes it queryable from the frontend.

```javascript
// containers/api/src/services/setup.service.js
const fs = require('fs').promises;
const redis = require('../lib/redis');

const LINBO_DIR = process.env.LINBO_DIR || '/srv/linbo';
const CONFIG_DIR = process.env.CONFIG_DIR || '/etc/linuxmuster/linbo';

async function getSetupStatus() {
  const client = redis.getClient();

  // Check if setup was already completed
  const isComplete = await client.get('setup:complete');
  if (isComplete === 'true') {
    return { status: 'complete', checklist: null };
  }

  // Build checklist from filesystem + Redis state
  const checklist = {
    init_complete: await checkInitComplete(),
    keys_present: await checkKeysPresent(),
    linbofs_built: await checkLinbofsBuilt(),
    config_valid: await checkConfigValid(),
  };

  const allPassed = Object.values(checklist).every(c => c.ok);

  return {
    status: allPassed ? 'ready' : 'pending',
    checklist,
  };
}

async function checkInitComplete() {
  try {
    const status = JSON.parse(
      await fs.readFile(`${LINBO_DIR}/.init-status.json`, 'utf8')
    );
    return {
      ok: status.phase === 'complete',
      detail: status.phase === 'complete'
        ? `LINBO ${status.version} installed`
        : `Init in phase: ${status.phase}`,
      error: status.error || null,
    };
  } catch {
    // Fallback: check legacy markers
    try {
      await fs.access(`${LINBO_DIR}/.boot-files-installed`);
      return { ok: true, detail: 'Boot files installed (legacy marker)' };
    } catch {
      return { ok: false, detail: 'Init container has not completed', error: null };
    }
  }
}

async function checkKeysPresent() {
  const keys = [
    `${CONFIG_DIR}/ssh_host_rsa_key`,
    `${CONFIG_DIR}/ssh_host_rsa_key.pub`,
    `${CONFIG_DIR}/linbo_client_key`,
  ];
  const missing = [];
  for (const key of keys) {
    try { await fs.access(key); } catch { missing.push(key); }
  }
  return {
    ok: missing.length === 0,
    detail: missing.length === 0
      ? 'All SSH keys present'
      : `Missing: ${missing.map(k => k.split('/').pop()).join(', ')}`,
  };
}
// ... etc
```

### Pattern 3: Structured Error Categories in Init Container

**What:** Categorize init container failures into actionable error codes.
**When:** Every failure point in entrypoint.sh.
**Why:** A generic "ERROR: curl failed" helps nobody. Knowing it is `APT_FETCH_FAILED` with a DNS hint is actionable.

**Error taxonomy for init container:**

| Code | Cause | User Action |
|------|-------|-------------|
| `APT_FETCH_FAILED` | Cannot reach APT repo | Check DNS, internet, firewall |
| `APT_PARSE_FAILED` | Packages index corrupted | Retry, or check DEB_BASE_URL |
| `DOWNLOAD_FAILED` | .deb download failed after retries | Check bandwidth, disk space |
| `CHECKSUM_MISMATCH` | SHA256 verification failed | Retry (possible mirror issue) |
| `EXTRACT_FAILED` | dpkg-deb extraction failed | Check disk space, .deb integrity |
| `PERMISSION_DENIED` | Cannot write to volume | Check Docker volume permissions |
| `DISK_FULL` | No space left on device | Free space on Docker host |

```bash
# Write structured status
write_status() {
    local phase="$1" progress="$2" error_code="${3:-}" error_msg="${4:-}" hint="${5:-}"
    local status_file="${LINBO_DIR}/.init-status.json"

    if [ -n "$error_code" ]; then
        printf '{"phase":"%s","progress":%d,"timestamp":"%s","error":{"code":"%s","message":"%s","hint":"%s"}}\n' \
            "$phase" "$progress" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$error_code" "$error_msg" "$hint" \
            > "$status_file"
    else
        printf '{"phase":"%s","progress":%d,"timestamp":"%s"}\n' \
            "$phase" "$progress" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            > "$status_file"
    fi
}
```

### Pattern 4: .env Validation on API Startup

**What:** Validate not just secrets (already done in validateSecrets()) but also functional configuration.
**When:** Early in startServer(), after validateSecrets().
**Why:** A missing LINBO_SERVER_IP or invalid subnet breaks PXE boot silently. Better to warn loudly at startup.

```javascript
function validateConfig() {
  const warnings = [];

  // LINBO_SERVER_IP must be a valid IP
  const serverIp = process.env.LINBO_SERVER_IP;
  if (!serverIp || serverIp === '10.0.0.1') {
    warnings.push(
      `LINBO_SERVER_IP is ${serverIp || 'not set'} -- PXE clients need the real IP of this server`
    );
  }

  // Network settings sanity
  const subnet = process.env.LINBO_SUBNET;
  const gateway = process.env.LINBO_GATEWAY;
  if (subnet && gateway && !isInSubnet(gateway, subnet, process.env.LINBO_NETMASK)) {
    warnings.push(`LINBO_GATEWAY ${gateway} is not in LINBO_SUBNET ${subnet}`);
  }

  // GITHUB_TOKEN is build-time only, not needed at runtime
  // But warn if build artifacts are missing
  // (handled by web container, not API)

  for (const w of warnings) {
    console.warn(`[config] WARNING: ${w}`);
  }

  return warnings;
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Setup-Blocking API Startup

**What:** Making the API refuse to start until setup is complete.
**Why bad:** The API must be running for the setup wizard to work. If the API blocks on "setup not complete," the frontend cannot reach the setup endpoints. Creates a chicken-and-egg problem.
**Instead:** API starts normally. Setup status is informational. The frontend detects incomplete setup and shows the wizard, but all API endpoints remain functional. The "setup" state is advisory, not enforced.

### Anti-Pattern 2: Separate Setup Container

**What:** Adding a new container just for initial setup/configuration.
**Why bad:** Adds operational complexity for a one-time flow. The init container already handles the "run once" pattern. Adding another one-shot container creates ordering issues (does setup run before or after init?). The API already has startup hooks -- use them.
**Instead:** Extend the existing init container for boot file provisioning. Use the existing API startup sequence for configuration validation. Use a frontend page for the guided wizard.

### Anti-Pattern 3: Storing Setup Config in Files Instead of Redis

**What:** Writing setup state to JSON files on the shared volume.
**Why bad:** The API already has a settings service backed by Redis with env-var fallback. Adding another persistence mechanism (JSON files for setup state) creates two sources of truth. File writes on shared Docker volumes have permission issues.
**Instead:** Use Redis for setup state (`setup:complete`, `setup:checklist`). The only file-based status is the init container's `.init-status.json` (because the init container has no Redis client).

### Anti-Pattern 4: Environment Variable Explosion

**What:** Adding dozens of new env vars for every configurable aspect of setup.
**Why bad:** The docker-compose.yml already has 50+ environment variables passed to the API container. Each new env var increases cognitive load and misconfiguration risk.
**Instead:** Use the existing settings service (Redis-backed with env fallback) for runtime-configurable settings. Keep .env to the true minimum: secrets (JWT_SECRET, INTERNAL_API_KEY), host identity (LINBO_SERVER_IP), and mode flags (SYNC_ENABLED). Everything else should have working defaults.

### Anti-Pattern 5: Interactive Docker Setup

**What:** Making docker compose up prompt for configuration.
**Why bad:** Docker containers are non-interactive by design. TTY allocation is unreliable. Breaks CI/CD and automated deployments.
**Instead:** All configuration happens BEFORE docker compose up (via install.sh or manual .env editing). The setup wizard runs AFTER containers are up, through the web UI.

## Scalability Considerations

Not a primary concern for v1.1 (single-school deployment), but noted for future reference.

| Concern | At 1 school (current) | At 10 schools | At 100 schools |
|---------|----------------------|---------------|----------------|
| Fresh install | Manual per server | Script per server | Ansible/Terraform playbook |
| Config validation | install.sh + wizard | Same per server | Config management tool |
| Setup documentation | Human-readable docs | Same | Video + docs |
| .env management | Manual edit | Template per site | Secrets manager (Vault) |

The v1.1 architecture explicitly supports the "1 school" case with room to grow. The install.sh with `--interactive` mode is the right interface for single-server setup. Multi-site automation is out of scope but not blocked.

## Build Order (Dependency-Aware)

Based on the data flow analysis, the recommended build order for v1.1 phases:

```
Phase 1: Init Container Hardening
    - Structured error reporting (.init-status.json)
    - Retry with backoff for network failures
    - Error categorization (APT_FETCH_FAILED, etc.)
    - No dependencies on other v1.1 changes
    |
    v
Phase 2: .env & Install Script Improvements
    - Preflight validation
    - .env.example reorganization
    - rsync secrets generation from template
    - Depends on: understanding init error format (Phase 1)
    |
    v
Phase 3: Setup Service & API Endpoints
    - setup.service.js (checklist aggregator)
    - GET /system/setup-status
    - POST /system/setup/validate
    - POST /system/setup/complete
    - Config validation on startup (validateConfig)
    - Depends on: init status format (Phase 1), .env structure (Phase 2)
    |
    v
Phase 4: Setup Wizard Frontend
    - SetupWizardPage.tsx
    - Route in App.tsx
    - API client additions for setup endpoints
    - Depends on: API endpoints exist (Phase 3)
    |
    v
Phase 5: Admin Documentation
    - INSTALL.md (references all above)
    - ARCHITECTURE-OVERVIEW.md
    - TROUBLESHOOTING.md updates
    - Depends on: final behavior settled (Phases 1-4)
```

**Phase ordering rationale:**
1. Init container errors are the most common fresh install failure. Fixing error reporting first makes all subsequent debugging easier.
2. Install script improvements are the entry point for fresh install -- get this right early so the remaining phases can be tested via the actual install flow.
3. Setup service and API endpoints are the backend for the wizard -- must exist before the frontend.
4. Frontend wizard depends on stable API endpoints.
5. Documentation references everything above and should reflect final behavior.

## Integration Points Detail

### Init Container -> API (via shared volume)

**Current:** Init writes `.needs-rebuild`, `.boot-files-installed`, `linbo-version` to `/srv/linbo/`. API reads `.needs-rebuild` on startup to trigger auto-rebuild.

**v1.1 Addition:** Init also writes `.init-status.json` to `/srv/linbo/`. API reads this in setup.service.js to populate the setup checklist. This is a passive integration (file-based IPC) -- no new inter-container communication channel needed.

**Risk:** File format must be backwards-compatible. If an older init container does not write `.init-status.json`, the setup service must fall back to legacy markers. The `checkInitComplete()` function above handles this.

### API -> Frontend (via REST + WebSocket)

**Current:** Frontend fetches from `/api/v1/*` endpoints. WebSocket delivers real-time updates.

**v1.1 Addition:** New REST endpoints under `/api/v1/system/setup-*`. Frontend adds a setup wizard page that calls these endpoints. No WebSocket changes needed (setup is not a real-time flow).

**Risk:** The setup wizard must work without WebSocket (since WebSocket requires auth, and during initial setup the auth state may be new). All setup endpoints should be accessible with basic JWT auth using the default admin credentials.

### install.sh -> .env -> docker-compose.yml

**Current:** install.sh generates .env, docker-compose.yml reads .env via `${VAR:-default}` syntax.

**v1.1 Addition:** install.sh validates .env values before starting containers. Also generates `config/rsyncd.secrets` from RSYNC_PASSWORD (currently tracked in git with default value -- this is a v1.0 concern that was identified but may not yet be fixed).

**Risk:** The install.sh must handle both fresh install (no .env) and re-run (existing .env). It must NEVER overwrite an existing .env without confirmation. Current script already handles this (`if [ -d "$INSTALL_DIR" ]` check).

## Configuration Validation Schema

The setup service validates the following configuration dimensions:

| Check | Source | Required For | Blocking? |
|-------|--------|-------------|-----------|
| `LINBO_SERVER_IP` is a real interface IP | .env + `ip addr` | PXE boot | Warning (non-blocking) |
| `JWT_SECRET` is not default | .env / env var | Security | Blocking in production |
| `INTERNAL_API_KEY` is not default | .env / env var | Security | Blocking in production |
| Init container completed | `.init-status.json` | Boot files | Blocking |
| SSH keys exist | Filesystem scan | linbofs64 build | Blocking |
| linbofs64 built and not stale | `.linbofs-patch-status` | PXE boot | Blocking |
| GRUB configs generated | `/srv/linbo/boot/grub/*.cfg` | PXE boot | Warning |
| At least one start.conf exists | `/srv/linbo/start.conf.*` | Client boot | Warning |
| Redis is accessible | Redis ping | Runtime | Blocking |
| PostgreSQL is accessible (standalone) | Prisma query | Standalone mode | Blocking for standalone |

## Sources

- Existing codebase analysis (HIGH confidence):
  - `docker-compose.yml` -- container definitions, volumes, environment variables
  - `containers/init/entrypoint.sh` -- current init flow, error handling gaps
  - `containers/api/src/index.js` -- startup sequence, secret validation, auto-rebuild
  - `scripts/install.sh` -- current install automation
  - `.env.example` -- configuration reference
  - `.planning/codebase/ARCHITECTURE.md` -- existing architecture documentation
  - `.planning/codebase/CONCERNS.md` -- known issues and tech debt
  - `.planning/codebase/INTEGRATIONS.md` -- external service integrations
- Docker Compose documentation (HIGH confidence): Multi-container orchestration patterns, healthcheck dependencies, one-shot containers
- Express.js patterns (HIGH confidence): Route organization, middleware ordering, startup sequences

---

*Architecture research: 2026-03-08*
