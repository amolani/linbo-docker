# Phase 10: Configuration & Install Script - Research

**Researched:** 2026-03-08
**Domain:** Shell scripting (bash), .env generation, network auto-detection, port conflict detection, system prerequisites validation
**Confidence:** HIGH

## Summary

Phase 10 creates a `setup.sh` script at the project root that produces a validated `.env` file. An existing `scripts/install.sh` already exists (473 lines) that handles git cloning, dependency auto-install, .env generation, container building, database sync, and admin user creation. The new `setup.sh` is focused specifically on **configuration and prerequisite validation** -- it does NOT clone the repo or start containers (the admin has already cloned or downloaded the repo to run setup.sh).

The biggest technical challenge is **variable consolidation**: the current `.env` file has 13 variables, `.env.example` has 51 variables, and `containers/api/.env.example` has 47 variables. Many variables in `.env.example` are internal to Docker Compose (e.g., `REDIS_HOST=linbo-cache`) and should NOT appear in the root `.env` because `docker-compose.yml` already hardcodes them. The setup script needs to generate only the variables that the admin can meaningfully configure, while Docker Compose defaults handle the rest.

Port conflict detection for TFTP (69/udp) and rsync (873/tcp) is straightforward using `ss` (or `lsof` as fallback). The TFTP container uses `network_mode: host` (not port mapping), so port 69 conflicts are especially critical -- they cannot be remapped. The rsync container uses standard port mapping (`"873:873"`), which can theoretically be changed but typically is not since LINBO clients expect port 873.

**Primary recommendation:** Create `setup.sh` as a new bash script (~300 lines). Do NOT modify the existing `scripts/install.sh` (which serves the curl-pipe install use case). Also create a consolidated `.env.example` that matches exactly what `setup.sh` generates, replacing the current divergent `.env.example`.

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BOOT-01 | Admin kann `./setup.sh` ausfuehren und bekommt eine funktionierende `.env` mit validierten Werten | Variable audit complete: 15 user-facing variables identified from 51 in .env.example. Secret generation via `openssl rand`. Interactive IP confirmation pattern already proven in scripts/install.sh |
| BOOT-02 | Setup-Script prueft Prerequisites (Docker-Version, Ports, Disk, Netzwerk) und zeigt klare Pass/Fail-Meldungen | Docker version check via `docker compose version`, disk via `df -P`, DNS via `nslookup`, connectivity via `curl -sf`. Error style follows Phase 9 structured blocks |
| BOOT-03 | Setup-Script erkennt automatisch die LINBO_SERVER_IP auf dem PXE-Netzwerk-Interface | `ip route get 1.1.1.1` for default route interface IP (already implemented in scripts/install.sh detect_ip function). Fallback: `hostname -I`. Admin confirms or overrides |
| BOOT-04 | `.env`-Generierung erstellt sichere Secrets (JWT_SECRET, INTERNAL_API_KEY) automatisch | `openssl rand -base64 48` for JWT_SECRET, `openssl rand -hex 32` for INTERNAL_API_KEY. Must NOT match any value in API's `JWT_SECRET_DEFAULTS` or `INTERNAL_KEY_DEFAULTS` arrays |
| ERR-03 | Port-Konflikte (TFTP 69/udp, rsync 873) werden vor dem Start erkannt mit klarer Loesung | `ss -ulnp sport = :69` for TFTP, `ss -tlnp sport = :873` for rsync. Parse process name from output. TFTP is host-network (cannot remap), rsync uses port mapping |

</phase_requirements>

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| bash | 5.x (Ubuntu/Debian system) | Script interpreter (`#!/bin/bash`) | Target platform is Ubuntu/Debian VMs; bash arrays, `read -p`, color codes needed |
| openssl | system package | Secret generation | `openssl rand -base64 48` for JWT, `openssl rand -hex 32` for API keys. Already a dependency |
| ss | iproute2 package | Port conflict detection | Standard Linux socket stats tool, installed by default on all modern distros |
| ip | iproute2 package | Network interface detection | `ip route get 1.1.1.1` for default route, `ip -4 addr show` for interface IPs |
| docker | 20.10+ | Container runtime check | Minimum version for compose v2 plugin (`docker compose`) |
| docker compose | v2.x | Compose check | V2 plugin (not standalone `docker-compose`). Version check via `docker compose version` |
| df | coreutils | Disk space check | `df -P /srv` for available space; POSIX-portable output mode |
| curl | system package | Network connectivity test | Quick health check to verify outbound HTTPS works |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| lsof | system package | Fallback port detection | When `ss` output parsing fails (rare but possible on older systems) |
| nslookup | dnsutils or bind-utils | DNS resolution check | Verify `deb.linuxmuster.net` resolves before starting containers |
| tput | ncurses-bin | Terminal capability detection | Check if terminal supports colors before using ANSI codes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bash | POSIX sh | Need bash arrays for dependency checking, `read -p` for interactive prompts, `${var,,}` for case conversion. POSIX sh too limiting |
| ss for ports | netstat | netstat deprecated on modern Linux, ss is the replacement |
| openssl rand | /dev/urandom + base64 | openssl is more portable and produces URL-safe output with proper encoding |

**Installation:** No new packages needed. All tools present on standard Ubuntu 22.04/24.04 server installations.

## Architecture Patterns

### Recommended Project Structure

```
project root/
├── setup.sh                    # NEW: Configuration wizard (this phase)
├── .env                        # Generated by setup.sh (gitignored)
├── .env.example                # UPDATED: Matches setup.sh output exactly
├── docker-compose.yml          # Existing (unchanged)
├── scripts/
│   ├── install.sh              # Existing: full automated install (clone+setup+start)
│   ├── deploy.sh               # Existing
│   ├── update.sh               # Existing
│   ├── status.sh               # Existing
│   └── uninstall.sh            # Existing
└── config/
    ├── rsyncd.conf             # Existing
    ├── rsyncd.secrets          # Generated by setup.sh (gitignored)
    └── rsyncd.secrets.example  # Existing
```

### Pattern 1: Structured Prerequisites Check

**What:** Run all prerequisite checks upfront with PASS/FAIL output before any configuration.
**When to use:** At the start of setup.sh, before asking any questions.
**Example:**

```bash
# Source: Phase 9 error_block pattern adapted for setup context
check_docker() {
    if ! command -v docker &>/dev/null; then
        print_check "FAIL" "Docker" "docker not found"
        echo "  Fix: curl -fsSL https://get.docker.com | sh"
        return 1
    fi

    local version
    version=$(docker version --format '{{.Server.Version}}' 2>/dev/null)
    if [ -z "$version" ]; then
        print_check "FAIL" "Docker" "Docker daemon not running"
        echo "  Fix: systemctl start docker"
        return 1
    fi

    print_check "PASS" "Docker" "version $version"
}

check_compose() {
    if ! docker compose version &>/dev/null; then
        print_check "FAIL" "Docker Compose" "docker compose plugin not found"
        echo "  Fix: apt-get install docker-compose-plugin"
        return 1
    fi

    local version
    version=$(docker compose version --short 2>/dev/null)
    print_check "PASS" "Docker Compose" "version $version"
}
```

### Pattern 2: Port Conflict Detection with Process Identification

**What:** Check if TFTP (69/udp) or rsync (873/tcp) ports are in use, identify the conflicting process.
**When to use:** After prerequisites pass, before generating .env.
**Example:**

```bash
check_port_conflict() {
    local port="$1"
    local proto="$2"  # tcp or udp
    local service="$3"

    local flag
    case "$proto" in
        tcp) flag="-tlnp" ;;
        udp) flag="-ulnp" ;;
    esac

    local ss_output
    ss_output=$(ss "$flag" sport = :"$port" 2>/dev/null)

    if echo "$ss_output" | grep -q ":${port}"; then
        # Extract process name from ss output
        local process
        process=$(echo "$ss_output" | grep ":${port}" | grep -oP 'users:\(\("\K[^"]+' | head -1)
        process=${process:-"unknown"}

        print_check "FAIL" "$service port $port/$proto" "in use by '$process'"

        if [ "$process" = "docker-proxy" ]; then
            echo "  Fix: Another Docker container is using port $port."
            echo "       Run: docker ps --filter 'publish=$port' to identify it"
            echo "       Then: docker stop <container-name>"
        elif [ "$service" = "TFTP" ]; then
            echo "  Fix: TFTP uses host networking and CANNOT be remapped."
            echo "       Stop the conflicting service: systemctl stop $process"
            echo "       Disable it: systemctl disable $process"
        else
            echo "  Fix: Stop the conflicting service: systemctl stop $process"
        fi
        return 1
    fi

    print_check "PASS" "$service port $port/$proto" "available"
}
```

### Pattern 3: IP Auto-Detection with Confirmation

**What:** Detect the server IP on the PXE subnet, let admin confirm or override.
**When to use:** During interactive configuration.
**Example:**

```bash
detect_server_ip() {
    local ip=""

    # Method 1: IP on default route interface
    ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')

    # Method 2: First non-loopback IPv4
    if [ -z "$ip" ]; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    fi

    # Method 3: Fallback
    echo "${ip:-127.0.0.1}"
}

# Usage:
detected_ip=$(detect_server_ip)
echo ""
echo "Detected server IP: $detected_ip"
read -p "Use this IP for LINBO_SERVER_IP? [Y/n]: " confirm
if [[ "$confirm" =~ ^[Nn] ]]; then
    read -p "Enter server IP: " detected_ip
fi
```

### Pattern 4: Secure Secret Generation

**What:** Generate cryptographically secure random values for JWT_SECRET, INTERNAL_API_KEY, DB_PASSWORD, RSYNC_PASSWORD.
**When to use:** During .env file generation.
**Example:**

```bash
generate_secret() {
    local type="$1"
    case "$type" in
        jwt)      openssl rand -base64 48 | tr -d '\n' ;;
        api_key)  openssl rand -hex 32 ;;
        password) openssl rand -base64 24 | tr -d '\n/+=' | head -c 32 ;;
    esac
}

# Generate all secrets upfront
JWT_SECRET=$(generate_secret jwt)
INTERNAL_API_KEY=$(generate_secret api_key)
DB_PASSWORD=$(generate_secret password)
RSYNC_PASSWORD=$(generate_secret password)
```

### Pattern 5: .env File Write with Validation

**What:** Write the .env file atomically and validate it can be read by docker compose.
**When to use:** After all configuration values are determined.
**Example:**

```bash
write_env_file() {
    local env_file="$1"
    local tmp_file="${env_file}.tmp"

    cat > "$tmp_file" << EOF
# LINBO Docker - Environment Configuration
# Generated by setup.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Re-run ./setup.sh to regenerate

# === Server ===
LINBO_SERVER_IP=${LINBO_SERVER_IP}
NODE_ENV=production

# === Secrets (auto-generated) ===
JWT_SECRET=${JWT_SECRET}
INTERNAL_API_KEY=${INTERNAL_API_KEY}
DB_PASSWORD=${DB_PASSWORD}
RSYNC_PASSWORD=${RSYNC_PASSWORD}

# ... (remaining variables)
EOF

    mv "$tmp_file" "$env_file"
    chmod 600 "$env_file"  # Restrict permissions (contains secrets)
}
```

### Anti-Patterns to Avoid
- **Including internal Docker variables in .env:** Variables like `REDIS_HOST=linbo-cache`, `SSH_HOST=linbo-ssh`, `DATABASE_URL=...` are Docker Compose internal wiring. They belong in `docker-compose.yml` (where they already are), NOT in the user-facing `.env`. Including them confuses admins and creates maintenance burden.
- **Generating .env with shell variable expansion inside heredoc:** Use quoted heredoc (`<< 'EOF'`) for template parts and explicit variable insertion for dynamic values. Prevents accidental expansion of `${}` syntax.
- **Silently overwriting existing .env:** Always detect existing `.env` and offer backup + overwrite confirmation.
- **Hardcoding port numbers without checking docker-compose.yml:** The ports 69, 873, 2222, 3000, 8080 are in docker-compose.yml. setup.sh should check the critical ones (69, 873) but not all.
- **Using `docker-compose` (v1) syntax:** The project uses `docker compose` (v2 plugin). Never reference `docker-compose` as a command.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Secret generation | Custom random string generator | `openssl rand -base64` / `openssl rand -hex` | Cryptographically secure, handles encoding, widely available |
| Port detection | Raw `/proc/net/tcp` parsing | `ss` command with sport filter | Handles IPv4+IPv6, shows process names, standard interface |
| IP detection | Manual `/proc/net/route` parsing | `ip route get 1.1.1.1` | Handles policy routing, VRFs, multiple default routes |
| Docker version check | String comparison | `docker compose version --short` + numeric comparison | Handles pre-release versions, build metadata |
| .env backup | Manual cp | `cp .env .env.backup.$(date +%Y%m%d-%H%M%S)` | Timestamped backups prevent overwrite of previous backups |
| Color output | Raw ANSI codes everywhere | Centralized color functions with `tput` or `$TERM` check | Graceful degradation in non-interactive terminals (CI, pipes) |

**Key insight:** The setup script runs on the HOST system (not in a container), so it has access to full Linux tooling. No busybox/Alpine restrictions.

## Common Pitfalls

### Pitfall 1: .env Variable Proliferation
**What goes wrong:** The .env file grows to 50+ variables, most of which the admin never needs to change. Admin edits a variable that docker-compose.yml also sets, causing confusion.
**Why it happens:** Current `.env.example` has 51 variables, mixing user-facing config with internal Docker wiring.
**How to avoid:** Classify variables into three tiers: (1) MUST configure (LINBO_SERVER_IP), (2) auto-generated secrets (JWT_SECRET, etc.), (3) optional overrides (WEB_PORT, LOG_LEVEL). Only include tiers 1+2 in the generated .env, with tier 3 as commented-out examples.
**Warning signs:** Admin asks "what is REDIS_HOST and should I change it?"

### Pitfall 2: TFTP Port 69 Cannot Be Remapped
**What goes wrong:** Admin has another TFTP server running, setup.sh suggests changing the port.
**Why it happens:** TFTP container uses `network_mode: host`, meaning it binds directly to the host's port 69. There is no port mapping to change.
**How to avoid:** The port conflict message for TFTP must clearly state that port 69 cannot be remapped and the conflicting service must be stopped/disabled. For rsync (port 873), the message can suggest either stopping the conflict OR changing the port in docker-compose.yml.
**Warning signs:** Admin changes port in .env but TFTP still fails because network_mode: host ignores port mappings.

### Pitfall 3: detect_ip Returns Wrong Interface
**What goes wrong:** On a multi-homed server, `ip route get 1.1.1.1` returns the WAN interface IP, not the PXE/LAN interface IP.
**Why it happens:** The default route goes out the WAN interface, but PXE clients are on a different subnet.
**How to avoid:** Always show the detected IP and ask for confirmation. List all available interfaces with IPs so the admin can pick the right one. Consider detecting the 10.x.x.x or 192.168.x.x range as more likely to be the PXE network.
**Warning signs:** PXE clients can't reach the LINBO server because the wrong IP is configured.

### Pitfall 4: openssl Not Installed
**What goes wrong:** `openssl rand` fails because openssl is not installed on a minimal server image.
**Why it happens:** Some minimal Ubuntu/Debian images don't include openssl.
**How to avoid:** Check for openssl in prerequisites. Fallback: `head -c 48 /dev/urandom | base64` produces equivalent output without openssl.
**Warning signs:** Empty or missing secrets in generated .env.

### Pitfall 5: Existing rsyncd.secrets Not Updated
**What goes wrong:** setup.sh generates a new RSYNC_PASSWORD in .env but the `config/rsyncd.secrets` file still has the old password.
**Why it happens:** rsyncd.secrets is a separate file mounted into the rsync container, not auto-generated from .env.
**How to avoid:** setup.sh must ALSO write `config/rsyncd.secrets` with the format `linbo:<password>` matching the RSYNC_PASSWORD in .env. Or at minimum, warn the admin to update it.
**Warning signs:** Image uploads via rsync fail with authentication errors.

### Pitfall 6: GITHUB_TOKEN Dependency
**What goes wrong:** Web container build fails because GITHUB_TOKEN is missing (needed for @edulution-io/ui-kit npm package).
**Why it happens:** GITHUB_TOKEN is in the current .env but is a private token that setup.sh cannot auto-generate.
**How to avoid:** setup.sh should detect if GITHUB_TOKEN is needed (check if web container references it), prompt for it, and warn that web UI builds will fail without it. This is a known issue tracked as OSS-01 for v1.2.
**Warning signs:** `docker compose build web` fails with 401 Unauthorized from npm registry.

### Pitfall 7: Running setup.sh as Non-Root
**What goes wrong:** Docker commands fail, port checks with ss require elevated privileges for process name detection.
**Why it happens:** Docker typically requires root or docker-group membership. `ss -p` needs root for process names.
**How to avoid:** Check at script start: either root or in docker group. Warn and exit early if neither.
**Warning signs:** "permission denied" errors during prerequisite checks.

## Code Examples

Verified patterns from the existing codebase:

### Variable Audit: What Goes in .env

Based on analysis of `docker-compose.yml` (43 env vars referenced), current `.env` (13 vars), and `.env.example` (51 vars):

```bash
# === REQUIRED: Admin must configure ===
LINBO_SERVER_IP=<auto-detected>     # PXE server IP (clients connect here)

# === AUTO-GENERATED: Secrets (never defaults) ===
JWT_SECRET=<openssl rand -base64 48>
INTERNAL_API_KEY=<openssl rand -hex 32>
DB_PASSWORD=<openssl rand -base64 24>
RSYNC_PASSWORD=<openssl rand -base64 16>

# === DEFAULTS: Rarely changed ===
NODE_ENV=production
ADMIN_USERNAME=admin                 # Web UI login
ADMIN_PASSWORD=Muster!               # Web UI password (LMN default)
GITHUB_TOKEN=                        # Required for web container build

# === OPTIONAL: Uncomment to override ===
# WEB_PORT=8080
# API_PORT=3000
# LOG_LEVEL=info
# LINBO_SUBNET=10.0.0.0
# LINBO_NETMASK=255.255.0.0
# LINBO_GATEWAY=10.0.0.254
# LINBO_DNS=10.0.0.1
# LINBO_DOMAIN=linuxmuster.lan
```

### API Secrets Validation Cross-Reference

The API (index.js) rejects these known defaults in production mode:

```javascript
// From containers/api/src/index.js lines 191-201
const JWT_SECRET_DEFAULTS = [
  'linbo-docker-secret-change-in-production',
  'your_jwt_secret_here_change_in_production',
  'your_jwt_secret_here_change_me_in_production_use_openssl_rand',
  'development_secret_change_in_production',
];

const INTERNAL_KEY_DEFAULTS = [
  'linbo-internal-secret',
  'linbo-internal-secret-change-in-production',
];
```

setup.sh-generated secrets (openssl rand) will never match these static strings.

### Port Detection with ss

```bash
# Check TFTP (UDP 69) - critical, host network mode
ss -ulnp sport = :69 2>/dev/null
# Output example when in use:
# UNCONN 0 0 0.0.0.0:69 0.0.0.0:* users:(("in.tftpd",pid=1234,fd=4))

# Check rsync (TCP 873) - important, standard port mapping
ss -tlnp sport = :873 2>/dev/null
# Output example when in use:
# LISTEN 0 4096 0.0.0.0:873 0.0.0.0:* users:(("docker-proxy",pid=363854,fd=8))

# Parse process name:
ss -ulnp sport = :69 | grep ':69' | grep -oP 'users:\(\("\K[^"]+' | head -1
# Returns: "in.tftpd" or "docker-proxy"
```

### Complete Prerequisites Check List

```bash
# Per success criteria #2, these checks are required:
# 1. Docker version (>= 20.10 for compose v2)
# 2. Docker Compose v2 plugin installed
# 3. Disk space (>= 2GB for images + containers, check / and /var)
# 4. DNS resolution (deb.linuxmuster.net for init container downloads)
# 5. Network connectivity (curl to deb.linuxmuster.net)
# 6. TFTP port 69/udp available (ERR-03)
# 7. rsync port 873/tcp available (ERR-03)
```

### rsyncd.secrets File Format

```
# config/rsyncd.secrets
# Format: username:password
# Must match RSYNC_PASSWORD from .env
linbo:<RSYNC_PASSWORD>
```

setup.sh must write this file with mode 600 (rsync requires strict permissions).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Copy .env.example, manually edit | setup.sh auto-generates | This phase | Zero manual editing for standard deployments |
| Default secrets in .env.example | openssl-generated secrets | This phase | No known-default secrets reach production |
| Manual port conflict debugging | Pre-start port detection | This phase | Clear error before docker compose up fails cryptically |
| scripts/install.sh (clone+install+start) | setup.sh (configure only) | This phase | Separation of concerns: setup.sh configures, make up starts |

**Deprecated/outdated:**
- `docker-compose` (v1 standalone): Project uses `docker compose` (v2 plugin). Never reference the old command.
- `.env.example` with 51 variables: Will be replaced with a focused version matching setup.sh output (~15 active + commented optional).

## Open Questions

1. **Should setup.sh also update scripts/install.sh?**
   - What we know: `scripts/install.sh` has its own `generate_secrets()` and `configure_environment()` that duplicate what setup.sh will do. It also has `detect_ip()` which is identical to what setup.sh needs.
   - What's unclear: Whether `scripts/install.sh` should call `setup.sh` internally, or remain independent.
   - Recommendation: Keep them independent. `install.sh` is for curl-pipe automated installs on fresh VMs. `setup.sh` is for admins who already have the repo cloned. Document the relationship in a comment at the top of each script.

2. **GITHUB_TOKEN handling**
   - What we know: Required for `docker compose build web` because @edulution-io/ui-kit is a private npm package. Cannot be auto-generated.
   - What's unclear: Whether to prompt for it or just leave it empty with a warning.
   - Recommendation: Prompt with explanation. If left empty, warn that web container build will fail. Include in .env as empty with comment.

3. **Network settings (subnet/gateway/DNS)**
   - What we know: Variables LINBO_SUBNET, LINBO_NETMASK, LINBO_GATEWAY, LINBO_DNS, LINBO_DOMAIN are used for DHCP export and API defaults. Most admins will use defaults.
   - What's unclear: Whether to auto-detect these from the PXE interface or just use sensible defaults.
   - Recommendation: Use defaults (10.0.0.0/255.255.0.0/10.0.0.254/10.0.0.1/linuxmuster.lan) as commented-out optional overrides. Auto-detection adds complexity for little value since the DHCP profile is optional.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual shell testing + existing API test suite for secrets validation |
| Config file | none -- setup.sh is tested by running it |
| Quick run command | `bash setup.sh` (interactive run) |
| Full suite command | `bash setup.sh && docker compose config --quiet` (validate generated .env) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BOOT-01 | setup.sh produces valid .env | smoke | `bash setup.sh && docker compose config --quiet && echo "PASS"` | N/A - new script |
| BOOT-02 | Prerequisites show PASS/FAIL | smoke | Run `bash setup.sh` on system without Docker -- verify FAIL message. Run on system with Docker -- verify PASS | N/A - manual |
| BOOT-03 | IP auto-detected and confirmable | smoke | Run `bash setup.sh` -- verify detected IP matches `ip route get 1.1.1.1` output | N/A - manual |
| BOOT-04 | Secrets are cryptographically random | unit-like | `bash setup.sh && grep JWT_SECRET .env \| wc -c` (verify >= 60 chars). Verify value not in API's JWT_SECRET_DEFAULTS | N/A - manual |
| ERR-03 | Port conflicts detected with process name | smoke | Start a dummy listener on port 69/udp, run `bash setup.sh` -- verify FAIL with process name | N/A - manual |

### Sampling Rate
- **Per task commit:** `bash setup.sh` on the development server, verify .env output
- **Per wave merge:** Full cycle: fresh run + re-run (backup detection) + port conflict simulation
- **Phase gate:** All 5 success criteria verified manually

### Wave 0 Gaps
- [ ] `setup.sh` does not exist yet -- must be created
- [ ] `.env.example` needs consolidation to match setup.sh output
- [ ] `config/rsyncd.secrets` generation/sync with .env RSYNC_PASSWORD

*(Shell script testing via direct execution is the most practical approach. The script is run once per deployment -- complex test infrastructure is not warranted.)*

## Sources

### Primary (HIGH confidence)
- **Existing codebase:** `scripts/install.sh` (473 lines) -- existing install script with detect_ip, generate_secrets, configure_environment patterns
- **Existing codebase:** `.env` (current, 13 vars), `.env.example` (51 vars), `containers/api/.env.example` (47 vars) -- full variable audit
- **Existing codebase:** `docker-compose.yml` -- all 43 env var references with defaults mapped
- **Existing codebase:** `containers/api/src/index.js` lines 191-254 -- secrets validation, known-default lists
- **Existing codebase:** `config/rsyncd.secrets.example` -- rsync auth format
- **Existing codebase:** `config/rsyncd.conf` -- secrets file path reference
- **System verification:** `ss -ulnp sport = :69` and `ss -tlnp sport = :873` tested on running system -- output format confirmed

### Secondary (MEDIUM confidence)
- Phase 9 research patterns for error reporting style (structured error blocks) -- consistent UX across scripts
- `iproute2` documentation for `ip route get` output parsing

### Tertiary (LOW confidence)
- None -- all findings verified against existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools already available on target platform, no new dependencies
- Architecture: HIGH -- existing install.sh provides proven patterns, variable audit is complete
- Pitfalls: HIGH -- multi-homed IP detection, rsyncd.secrets sync, GITHUB_TOKEN dependency all identified from codebase analysis
- Port detection: HIGH -- `ss` output format verified on running system
- Variable consolidation: HIGH -- full audit of all three .env files completed, docker-compose.yml cross-referenced

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable domain -- bash scripting, Docker, Linux networking tools do not change rapidly)
