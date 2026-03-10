# Phase 9: Init Container Hardening - Research

**Researched:** 2026-03-08
**Domain:** POSIX shell error handling, idempotent container entrypoints, checkpoint-resume patterns
**Confidence:** HIGH

## Summary

Phase 9 hardens the existing `containers/init/entrypoint.sh` (633 lines, POSIX `#!/bin/sh`) with structured error reporting, pre-flight diagnostics, and checkpoint-based resume. The init container runs on Alpine 3.19 (busybox ash), downloads LINBO .deb packages from the APT repository, extracts and provisions boot files, kernels, GUI, and themes. The current error handling is minimal -- plain `echo "ERROR: ..."` messages and `set -e` for fail-fast.

No new dependencies are needed. The work is pure shell scripting within the existing Alpine container. All changes are to `entrypoint.sh` only. The checkpoint/error system uses marker files on the existing `/srv/linbo/` volume. Alpine's busybox ash supports `set -o pipefail` (despite ShellCheck warnings about POSIX compliance), so strictness can be improved.

**Primary recommendation:** Refactor entrypoint.sh in place -- add error reporting helper functions, wrap each major step in checkpoint-aware blocks, add pre-flight checks, and add a success summary. Keep `set -e` but supplement with explicit error handling in critical sections using `|| error_exit` pattern.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Structured error blocks with clear sections: ERROR title, details (Package/URL/Path), Cause, Diagnostics (when applicable), Fix suggestion, and resume hint
- Errors go to stderr (>&2), success/progress output stays on stdout
- Success steps keep the current simple echo style -- no structured blocks for non-errors
- Error messages in English (consistent with existing entrypoint.sh and shell conventions)
- Every error block ends with retry/reset commands: `To retry: docker compose up init` / `To reset: FORCE_UPDATE=true docker compose up init`
- 6 checkpoint steps: apt-index, linbo-deb, gui-deb, boot-files, kernels, themes
- Marker files in /srv/linbo/ volume (one per checkpoint, e.g., `.checkpoint-linbo-deb`)
- Each marker contains version hash + timestamp
- All checkpoints cleared when new LINBO version detected
- FORCE_UPDATE=true clears all checkpoints and starts fresh
- Download checkpoints mark complete after download+SHA256 verify (not after extraction/provisioning)
- Cached .deb files kept in a cache dir -- provisioning failure re-extracts from cached .deb without re-downloading
- Explicit "Resuming from partial install (version X)" banner when checkpoints exist
- Each skipped step prints a one-liner: `Skipping: LINBO .deb already downloaded (4.3.31-0, SHA256 OK)`
- Brief final summary on success showing: version, kernel variants with versions, GUI status, themes, duration
- Pre-flight checks before any downloads: disk space (>=500MB on /srv/linbo) and DNS resolution (deb.linuxmuster.net)
- On network failure: basic diagnostics -- DNS resolution check, HTTP_PROXY/HTTPS_PROXY detection
- On permission error (EACCES): show current ownership vs expected (1001:1001) with exact chown command
- On SHA256 mismatch: show expected vs actual hash, suggest retry or check APT mirror
- Diagnostics embedded in the structured error block under a "Diagnostics:" section

### Claude's Discretion
- Exact error classification logic (mapping curl exit codes to human-readable causes)
- Shell function structure for the error reporting helpers
- Checkpoint file format details (plain text vs key=value)
- How to detect EACCES vs other permission issues in shell
- Cache directory location for downloaded .deb files
- Whether to add `set -o pipefail` or other shell strictness improvements

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ERR-01 | Init Container zeigt actionable Fehlermeldungen bei APT-Fehlern, SHA256-Mismatches und Permission-Problemen | Structured error block format, curl exit code mapping, SHA256 mismatch pattern, EACCES detection via `test -w`, pre-flight checks, checkpoint-resume system |

</phase_requirements>

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| busybox ash | Alpine 3.19 | Shell interpreter (`/bin/sh`) | Already the container shell; POSIX-compatible with pipefail extension |
| curl | Alpine package | HTTP downloads | Already installed; exit codes provide error classification |
| sha256sum | busybox | Hash verification | Already available; standard Unix tool |
| df | busybox | Disk space checks | Available in Alpine; POSIX-compliant with `-P` flag |
| stat | busybox | File ownership checks | Available; `-c %u:%g` for uid:gid |
| nslookup | busybox | DNS resolution check | Available in Alpine busybox; for pre-flight DNS test |
| date | busybox | Timestamps | Available; for checkpoint markers and duration tracking |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| dpkg-deb | Alpine package | .deb extraction | Already installed and used for package extraction |
| flock | busybox | Advisory locking | Already used in provision_kernels; for checkpoint concurrency safety |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nslookup for DNS | `getent hosts` | nslookup more verbose output for diagnostics; getent not in Alpine by default |
| stat for ownership | `ls -la` + parse | stat -c is cleaner and less error-prone than parsing ls output |
| plain text markers | JSON markers | JSON harder to write/parse in POSIX shell; plain key=value simpler |

**Installation:** No new packages needed. All tools already present in the Alpine 3.19 init container.

## Architecture Patterns

### Recommended Structure (within entrypoint.sh)

```
entrypoint.sh (refactored)
├── Configuration section (env vars, constants)
├── Error Reporting Functions
│   ├── error_block()        # Structured error output to stderr
│   ├── classify_curl_error() # Map curl exit codes to causes
│   ├── classify_error()     # Detect EACCES/disk/SHA256 errors
│   └── run_diagnostics()    # DNS + proxy checks for network errors
├── Checkpoint Functions
│   ├── checkpoint_exists()  # Check if step completed
│   ├── checkpoint_set()     # Mark step complete
│   ├── checkpoint_clear_all() # Reset on new version or FORCE_UPDATE
│   └── checkpoint_detect_resume() # Print resume banner if resuming
├── Pre-flight Checks
│   ├── check_disk_space()   # >= 500MB on /srv/linbo
│   └── check_dns()          # Resolve deb.linuxmuster.net
├── Existing Functions (hardened)
│   ├── fetch_packages_index()    # + checkpoint + structured errors
│   ├── download_and_extract_deb() # + cache dir + checkpoint
│   ├── provision_boot_files()    # + checkpoint
│   ├── provision_gui()           # + checkpoint
│   ├── provision_kernels()       # + checkpoint
│   └── provision_themes()        # + checkpoint
└── Main Flow (checkpoint-aware)
    ├── Pre-flight checks
    ├── Version detection + checkpoint invalidation
    ├── Resume banner (if checkpoints exist)
    ├── 6 checkpoint-gated steps
    └── Success summary
```

### Pattern 1: Structured Error Block

**What:** A reusable function that prints a consistent error block to stderr.
**When to use:** Every error exit point in the script.
**Example:**

```sh
# Source: CONTEXT.md user-specified format
error_block() {
    _title="$1"
    _details="$2"
    _cause="$3"
    _diagnostics="$4"  # optional, empty string if none
    _fix="$5"

    {
        echo ""
        echo "=== ERROR: ${_title} ==="
        echo "${_details}"
        echo "Cause:   ${_cause}"
        if [ -n "${_diagnostics}" ]; then
            echo ""
            echo "Diagnostics:"
            echo "${_diagnostics}"
        fi
        echo ""
        echo "Fix: ${_fix}"
        echo ""
        echo "To retry:  docker compose up init"
        echo "To reset:  FORCE_UPDATE=true docker compose up init"
        echo "==========================================="
        echo ""
    } >&2
}
```

### Pattern 2: Checkpoint Guard

**What:** Wrap each major step in a checkpoint check that skips if already completed.
**When to use:** Around each of the 6 checkpointed steps.
**Example:**

```sh
CHECKPOINT_DIR="${LINBO_DIR}/.checkpoints"

checkpoint_exists() {
    _step="$1"
    [ -f "${CHECKPOINT_DIR}/${_step}" ]
}

checkpoint_set() {
    _step="$1"
    _version="$2"
    mkdir -p "${CHECKPOINT_DIR}"
    printf 'version=%s\ntimestamp=%s\n' "${_version}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        > "${CHECKPOINT_DIR}/${_step}"
}

checkpoint_clear_all() {
    rm -rf "${CHECKPOINT_DIR}"
}

# Usage in main flow:
if checkpoint_exists "linbo-deb"; then
    echo "Skipping: LINBO .deb already downloaded (${LINBO_VERSION}, SHA256 OK)"
else
    download_linbo_deb  # downloads + verifies + sets checkpoint
fi
```

### Pattern 3: Curl Exit Code Classification

**What:** Map curl exit codes to human-readable causes for the error block.
**When to use:** After every curl download failure.
**Example:**

```sh
# Source: https://everything.curl.dev/cmdline/exitcode.html
classify_curl_error() {
    _exit_code="$1"
    case "${_exit_code}" in
        5)  echo "Could not resolve proxy" ;;
        6)  echo "DNS resolution failed" ;;
        7)  echo "Connection refused" ;;
        22) echo "HTTP error (404 or server error)" ;;
        28) echo "Connection timeout" ;;
        35) echo "TLS/SSL handshake failed" ;;
        47) echo "Too many redirects" ;;
        52) echo "Server returned empty response" ;;
        56) echo "Network data transfer failed" ;;
        *)  echo "Download failed (curl exit code: ${_exit_code})" ;;
    esac
}
```

### Pattern 4: Pre-flight Check with Structured Error

**What:** Validate prerequisites before attempting downloads.
**When to use:** At script start, before any checkpoint-gated work.
**Example:**

```sh
check_disk_space() {
    # df -P for POSIX-portable output, extract Available (KB) for /srv/linbo
    _avail_kb=$(df -P "${LINBO_DIR}" | awk 'NR==2 {print $4}')
    _avail_mb=$((_avail_kb / 1024))
    _min_mb=500

    if [ "${_avail_mb}" -lt "${_min_mb}" ]; then
        error_block \
            "Insufficient disk space" \
            "Path:      ${LINBO_DIR}\nAvailable: ${_avail_mb}MB\nRequired:  ${_min_mb}MB" \
            "Not enough free space to download and extract LINBO packages" \
            "" \
            "Free up space on the volume mounted at ${LINBO_DIR}"
        return 1
    fi
    echo "  Disk space: ${_avail_mb}MB available (>= ${_min_mb}MB required)"
}

check_dns() {
    _host="deb.linuxmuster.net"
    if ! nslookup "${_host}" >/dev/null 2>&1; then
        _diag="  DNS:   FAIL - cannot resolve ${_host}"
        if [ -n "${HTTP_PROXY:-}" ] || [ -n "${HTTPS_PROXY:-}" ]; then
            _diag="${_diag}\n  Proxy: HTTP_PROXY=${HTTP_PROXY:-unset}, HTTPS_PROXY=${HTTPS_PROXY:-unset}"
        else
            _diag="${_diag}\n  Proxy: not set (HTTP_PROXY/HTTPS_PROXY)"
        fi
        error_block \
            "DNS resolution failed" \
            "Host: ${_host}" \
            "Cannot resolve the APT repository hostname" \
            "${_diag}" \
            "Check /etc/resolv.conf or configure HTTP_PROXY/HTTPS_PROXY"
        return 1
    fi
    echo "  DNS: ${_host} resolves OK"
}
```

### Pattern 5: EACCES Detection

**What:** Detect permission errors and show ownership fix commands.
**When to use:** Before writing to volume paths, and in error handling for write failures.
**Example:**

```sh
check_write_permission() {
    _path="$1"
    if [ -d "${_path}" ] && ! touch "${_path}/.write-test" 2>/dev/null; then
        _current_owner=$(stat -c '%u:%g' "${_path}" 2>/dev/null || echo "unknown")
        error_block \
            "Permission denied (EACCES)" \
            "Path:     ${_path}\nOwner:    ${_current_owner}\nExpected: 1001:1001" \
            "Cannot write to the volume directory" \
            "" \
            "Run: docker run --rm -v linbo_srv_data:${_path} alpine chown -R 1001:1001 ${_path}"
        return 1
    fi
    rm -f "${_path}/.write-test" 2>/dev/null
}
```

### Anti-Patterns to Avoid
- **trap ERR in POSIX sh:** `trap ERR` is bash/ksh-only, not supported in POSIX sh (busybox ash). Use `trap ... EXIT` for cleanup and `|| error_exit` for explicit error handling instead.
- **Relying solely on set -e:** `set -e` has complex, counter-intuitive rules about when it triggers (e.g., not in `if` conditions, not in pipe non-last commands). Supplement with explicit `|| return 1` after critical commands.
- **Appending to marker files:** Creates duplicates on restart. Always overwrite markers atomically (write to temp, rename).
- **rm -f of .deb after download:** Current code removes the .deb immediately after extraction. The new design keeps cached .debs so provisioning failures can re-extract without re-downloading.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Curl error messages | Custom HTTP client | curl exit code mapping (6=DNS, 7=connection, 28=timeout, etc.) | curl's exit codes are standardized and comprehensive |
| Disk space checks | Manual /proc parsing | `df -P` (POSIX-portable output) | Handles all filesystem types, mount points |
| DNS resolution checks | Manual /etc/resolv.conf parsing | `nslookup` (busybox) | Handles DNS servers, search domains, timeouts |
| File ownership detection | `ls -la` parsing | `stat -c '%u:%g'` | Direct, no ambiguous parsing |
| Atomic file writes | Direct write-in-place | Write to temp + `mv` (rename) | Crash-safe; prevents partial writes |

**Key insight:** All tools needed for diagnostics are already present in Alpine's busybox. No additional packages required.

## Common Pitfalls

### Pitfall 1: set -e + Checkpoint Logic Conflict
**What goes wrong:** `set -e` causes the script to exit before the error_block function can print its structured message.
**Why it happens:** When a command fails in a `set -e` script, the shell exits immediately before reaching the error handler.
**How to avoid:** Use subshells or `if ! cmd; then error_block ...; exit 1; fi` patterns instead of relying on `set -e` to catch failures. For critical sections, temporarily work around `set -e` by putting failing commands in `if` blocks (which are immune to `set -e`).
**Warning signs:** Error blocks never appearing in output during failures.

### Pitfall 2: Checkpoint Invalidation Race
**What goes wrong:** Stale checkpoints from a previous version are honored, causing the script to skip downloading a new version.
**Why it happens:** The checkpoint markers exist from a previous run with a different version, but the version check did not clear them.
**How to avoid:** Always compare the version in each checkpoint marker against the current target version. Clear all checkpoints when version changes or when FORCE_UPDATE=true.
**Warning signs:** "Skipping" messages when a new version should be downloading.

### Pitfall 3: Cache Directory on Wrong Volume
**What goes wrong:** Cached .deb files are stored in a temp directory that doesn't survive container restarts.
**Why it happens:** Using `mktemp -d` (current approach) creates directories in `/tmp`, which is ephemeral.
**How to avoid:** Store cached .debs in a subdirectory of `/srv/linbo/` (the persistent volume), e.g., `/srv/linbo/.cache/`.
**Warning signs:** "Downloading" messages on every resume instead of "Re-extracting from cache".

### Pitfall 4: POSIX Shell String Handling in Error Messages
**What goes wrong:** Multi-line error messages break when using `echo` with embedded `\n` in POSIX sh.
**Why it happens:** POSIX `echo` behavior with escape sequences varies across shells. Busybox ash's `echo` does interpret `\n`, but this is not portable.
**How to avoid:** Use `printf` for all multi-line output in error blocks, or use multiple `echo` calls. `printf '%s\n'` is the most portable approach.
**Warning signs:** Literal `\n` appearing in error output.

### Pitfall 5: df Output Parsing on Different Filesystems
**What goes wrong:** `df` output may have the device name wrap to the next line if it is very long.
**Why it happens:** Without `-P`, df may break long device names across two lines.
**How to avoid:** Always use `df -P` (POSIX output format) which guarantees one-line-per-filesystem format.
**Warning signs:** Disk space check returning wrong values or errors.

### Pitfall 6: Duration Tracking With set -e
**What goes wrong:** The start timestamp is captured but the end timestamp is never written because the script exits on error.
**Why it happens:** `set -e` exits before reaching the summary block.
**How to avoid:** Capture start time at the beginning. Use `trap ... EXIT` to always print duration, even on failure. The EXIT trap runs regardless of `set -e`.
**Warning signs:** No duration shown on error exits.

## Code Examples

Verified patterns from official sources and project context:

### Checkpoint Marker File Format (key=value)
```sh
# Written to /srv/linbo/.checkpoints/<step-name>
# Example: /srv/linbo/.checkpoints/linbo-deb
version=4.3.31-0
sha256=a1b2c3d4e5f6...
timestamp=2026-03-08T14:30:00Z
```

### Cache Directory Layout
```
/srv/linbo/
├── .cache/                      # Cached downloads (persistent)
│   ├── linuxmuster-linbo7_4.3.31-0_amd64.deb
│   └── linuxmuster-linbo-gui7_4.3.31-0_amd64.deb
├── .checkpoints/                # Checkpoint markers (persistent)
│   ├── apt-index
│   ├── linbo-deb
│   ├── gui-deb
│   ├── boot-files
│   ├── kernels
│   └── themes
├── linbo-version                # Existing version file
├── .boot-files-installed        # Existing compat marker
├── .needs-rebuild               # Existing API signal
└── ... (boot files, icons, etc.)
```

### Resume Flow Logic
```sh
# Pseudocode for main flow
START_TIME=$(date +%s)
RESUMING=false

# 1. Pre-flight
check_disk_space || exit 1
check_dns || exit 1

# 2. Fetch APT index (checkpointed)
if ! checkpoint_exists "apt-index"; then
    fetch_packages_index || exit 1
    checkpoint_set "apt-index" "${LINBO_VERSION}"
fi

# 3. Version detection + checkpoint invalidation
# Compare target version against checkpoint versions
# If different: checkpoint_clear_all, re-fetch index

# 4. Resume banner
if has_any_checkpoint; then
    RESUMING=true
    echo "=== Resuming from partial install (version ${LINBO_VERSION}) ==="
fi

# 5. Download LINBO .deb (checkpointed)
if checkpoint_exists "linbo-deb"; then
    echo "Skipping: LINBO .deb already downloaded (${LINBO_VERSION}, SHA256 OK)"
else
    download_with_cache "${LINBO_FILENAME}" "${LINBO_SHA256}" || exit 1
    checkpoint_set "linbo-deb" "${LINBO_VERSION}"
fi

# ... similar for gui-deb, boot-files, kernels, themes ...

# 6. Success summary
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
print_success_summary "${LINBO_VERSION}" "${DURATION}"
```

### Network Error with Diagnostics (curl wrapper)
```sh
download_with_retry() {
    _url="$1"
    _output="$2"
    _max_retries=3
    _retry=0

    while [ ${_retry} -lt ${_max_retries} ]; do
        _curl_exit=0
        curl -fSL --progress-bar -o "${_output}" "${_url}" || _curl_exit=$?

        if [ ${_curl_exit} -eq 0 ]; then
            return 0
        fi

        _retry=$((_retry + 1))
        if [ ${_retry} -lt ${_max_retries} ]; then
            echo "  Download attempt ${_retry}/${_max_retries} failed, retrying in 5s..."
            sleep 5
        fi
    done

    # All retries exhausted -- build diagnostics
    _cause=$(classify_curl_error "${_curl_exit}")
    _diag=""

    # DNS check
    _host=$(echo "${_url}" | sed 's|https\?://||;s|/.*||')
    if nslookup "${_host}" >/dev/null 2>&1; then
        _diag="  DNS:   OK - ${_host} resolves"
    else
        _diag="  DNS:   FAIL - cannot resolve ${_host}"
    fi

    # Proxy check
    if [ -n "${HTTP_PROXY:-}" ] || [ -n "${HTTPS_PROXY:-}" ]; then
        _diag="${_diag}\n  Proxy: HTTP_PROXY=${HTTP_PROXY:-unset}, HTTPS_PROXY=${HTTPS_PROXY:-unset}"
    else
        _diag="${_diag}\n  Proxy: not set (HTTP_PROXY/HTTPS_PROXY)"
    fi

    error_block \
        "Download failed" \
        "URL:     ${_url}\nAttempts: ${_max_retries}" \
        "${_cause}" \
        "${_diag}" \
        "Check network connectivity, DNS, or configure HTTP_PROXY"
    return 1
}
```

### SHA256 Mismatch Structured Error
```sh
verify_sha256_structured() {
    _file="$1"
    _expected="$2"
    _label="$3"  # e.g., "linuxmuster-linbo7"

    if [ -z "${_expected}" ]; then
        echo "  WARNING: No SHA256 to verify for ${_file}"
        return 0
    fi

    _actual=$(sha256sum "${_file}" | cut -d' ' -f1)
    if [ "${_actual}" != "${_expected}" ]; then
        error_block \
            "SHA256 verification failed" \
            "Package: ${_label}\nFile:    $(basename "${_file}")\nExpected: ${_expected}\nActual:   ${_actual}" \
            "Downloaded file does not match expected checksum" \
            "" \
            "Retry the download, or check if the APT mirror is up to date"
        return 1
    fi
    echo "  SHA256 OK: $(basename "${_file}")"
}
```

### Success Summary Block
```sh
# Source: CONTEXT.md user-specified format
print_success_summary() {
    _version="$1"
    _duration="$2"

    # Collect kernel versions
    _kernel_info=""
    for _v in stable longterm legacy; do
        _vfile="${LINBO_DIR}/kernels/${_v}/version"
        if [ -f "${_vfile}" ]; then
            _kver=$(cat "${_vfile}")
            if [ -n "${_kernel_info}" ]; then
                _kernel_info="${_kernel_info}, ${_v} (${_kver})"
            else
                _kernel_info="${_v} (${_kver})"
            fi
        fi
    done

    # GUI status
    if [ -f "${LINBO_DIR}/linbo_gui64_7.tar.lz" ]; then
        _gui="linbo_gui64_7.tar.lz installed"
    else
        _gui="not installed"
    fi

    # Themes
    _themes=""
    if [ -d "${LINBO_DIR}/gui-themes" ]; then
        for _td in "${LINBO_DIR}/gui-themes"/*/; do
            [ -d "${_td}" ] || continue
            _tn=$(basename "${_td}")
            if [ -n "${_themes}" ]; then
                _themes="${_themes}, ${_tn}"
            else
                _themes="${_tn}"
            fi
        done
    fi
    [ -z "${_themes}" ] && _themes="none"

    echo ""
    echo "=== LINBO Init Complete ==="
    echo "Version:  ${_version}"
    echo "Kernels:  ${_kernel_info:-none}"
    echo "GUI:      ${_gui}"
    echo "Themes:   ${_themes}"
    echo "Duration: ${_duration}s"
    echo "==========================="
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain `echo "ERROR: ..."` | Structured error blocks with cause, diagnostics, fix | This phase | Admins can self-diagnose without reading logs |
| `set -e` only | `set -e` + explicit `if ! cmd; then error_block; exit 1; fi` | This phase | Errors always show structured output before exit |
| No resume on failure | Checkpoint markers per step | This phase | Re-run skips completed steps |
| .deb deleted after extraction | .deb cached in .cache/ dir | This phase | Provisioning failure re-extracts without re-downloading |
| No pre-flight checks | Disk space + DNS checks at start | This phase | Fails early with actionable message |
| POSIX echo only | `set -o pipefail` added (busybox ash supports it) | This phase | Pipe failures propagate correctly |

**Deprecated/outdated:**
- `trap ERR`: Not POSIX-portable; do not use in `#!/bin/sh` scripts. Use `trap ... EXIT` for cleanup and explicit error checks instead.
- `set -euo pipefail`: The `-u` (nounset) flag is risky with the current code which uses unset variables as defaults via `${VAR:-default}`. Only add `pipefail`, not `-u`.

## Open Questions

1. **Should `set -o pipefail` be added?**
   - What we know: Busybox ash in Alpine 3.19 supports it. It causes pipe failures to propagate.
   - What's unclear: Whether any existing pipes in entrypoint.sh rely on non-zero exit from early pipe stages being swallowed.
   - Recommendation: Add it. The current pipes (e.g., `sha256sum | cut`, `awk` operations) should not be affected since they succeed. Flag as Claude's discretion.

2. **Checkpoint step ordering vs. existing flow**
   - What we know: The current flow is: fetch index -> parse packages -> version compare -> download linbo .deb -> download gui .deb -> provision boot files -> provision gui -> provision kernels -> provision themes.
   - What's unclear: The version comparison currently happens between APT index fetch and download, but after checkpoint refactoring the version needs to be known before checkpoint invalidation.
   - Recommendation: The apt-index checkpoint should store the parsed version info. On resume, read version from checkpoint marker rather than re-fetching the index.

3. **Cleanup of EXIT trap interaction**
   - What we know: Currently no EXIT trap. Adding one for cleanup (temp files, duration) is good practice.
   - What's unclear: How `set -e` interacts with EXIT traps in busybox ash -- the exit code should be preserved.
   - Recommendation: Test that `trap cleanup EXIT` preserves the exit code in Alpine's ash. This is standard POSIX behavior but worth verifying.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Shell-based integration testing (no framework -- POSIX sh validation) |
| Config file | none -- see Wave 0 |
| Quick run command | `docker compose run --rm init` (observe output) |
| Full suite command | `docker compose run --rm init && docker compose run --rm -e FORCE_UPDATE=true init` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ERR-01a | APT fetch error shows structured message | manual+smoke | Disconnect DNS and run `docker compose run --rm init` -- verify error block format | N/A - manual |
| ERR-01b | SHA256 mismatch shows expected vs actual | manual+smoke | Corrupt cached .deb and run init -- verify hash error | N/A - manual |
| ERR-01c | EACCES shows path and chown command | manual+smoke | Set volume to root:root and run init -- verify permission error | N/A - manual |
| ERR-01d | Resume skips completed checkpoints | smoke | Run init (success), corrupt one step, re-run -- verify skip messages | N/A - manual |

### Sampling Rate
- **Per task commit:** `docker compose build init && docker compose run --rm init` (verify no regressions)
- **Per wave merge:** Full cycle: clean run + forced re-run + simulated failure + resume
- **Phase gate:** All 4 success criteria verified manually with observed output

### Wave 0 Gaps
- [ ] No automated test infrastructure exists for init container shell scripts
- [ ] Validation is inherently integration-level (requires Docker, volumes, network)
- [ ] Recommend manual verification protocol with specific commands for each success criterion
- [ ] Consider a lightweight `entrypoint_test.sh` that sources functions and tests them in isolation (optional, Claude's discretion)

*(Shell script unit testing frameworks like bats-core or shunit2 are overkill for 6 checkpoint markers and 4 error types. Manual verification with specific commands is more practical.)*

## Sources

### Primary (HIGH confidence)
- **Existing codebase:** `containers/init/entrypoint.sh` (633 lines) -- fully read, all existing patterns documented
- **Existing codebase:** `containers/init/Dockerfile` -- Alpine 3.19 base image, available tools confirmed
- **Existing codebase:** `docker-compose.yml` -- init service config, volumes, environment variables
- **CONTEXT.md** -- All user decisions on error format, checkpoint granularity, diagnostics depth

### Secondary (MEDIUM confidence)
- [curl exit codes reference](https://everything.curl.dev/cmdline/exitcode.html) -- official curl documentation for exit code mapping
- [Idempotent Docker Entrypoint Scripts](https://oneuptime.com/blog/post/2026-02-08-how-to-write-idempotent-docker-entrypoint-scripts/view) -- marker file patterns, checkpoint approaches
- [ShellCheck SC3047](https://www.shellcheck.net/wiki/SC3047) -- trap ERR not POSIX-portable confirmation
- [BashFAQ/105](https://mywiki.wooledge.org/BashFAQ/105) -- set -e pitfalls and alternatives

### Tertiary (LOW confidence)
- [Alpine busybox pipefail support](https://github.com/alpinelinux/docker-alpine/issues/258) -- pipefail in ash confirmed via community issue, but not tested in this specific Alpine 3.19 image

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools already in the container, no new dependencies
- Architecture: HIGH -- clear patterns from user decisions, existing code structure well understood
- Pitfalls: HIGH -- POSIX shell gotchas are well-documented, set -e behavior extensively studied
- Curl exit codes: HIGH -- official curl documentation used
- Checkpoint pattern: HIGH -- simple marker files, no complex state machine
- Validation: MEDIUM -- no automated test framework for shell scripts; manual verification protocol sufficient

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable domain -- POSIX shell, curl, Alpine busybox do not change rapidly)
