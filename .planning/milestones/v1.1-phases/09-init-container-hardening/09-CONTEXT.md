# Phase 9: Init Container Hardening - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the init container's failure modes actionable and resumable. When something fails, the admin sees exactly what failed, why, and how to fix it. When re-running after a partial failure, completed steps are skipped without re-doing work. No new features — only hardening the existing entrypoint.sh bootstrap flow.

</domain>

<decisions>
## Implementation Decisions

### Error output format
- Structured error blocks with clear sections: ERROR title, details (Package/URL/Path), Cause, Diagnostics (when applicable), Fix suggestion, and resume hint
- Errors go to stderr (>&2), success/progress output stays on stdout
- Success steps keep the current simple echo style — no structured blocks for non-errors
- Error messages in English (consistent with existing entrypoint.sh and shell conventions)
- Every error block ends with retry/reset commands: `To retry: docker compose up init` / `To reset: FORCE_UPDATE=true docker compose up init`

### Checkpoint granularity
- 6 checkpoint steps: apt-index, linbo-deb, gui-deb, boot-files, kernels, themes
- Marker files in /srv/linbo/ volume (one per checkpoint, e.g., `.checkpoint-linbo-deb`)
- Each marker contains version hash + timestamp
- All checkpoints cleared when new LINBO version detected
- FORCE_UPDATE=true clears all checkpoints and starts fresh
- Download checkpoints mark complete after download+SHA256 verify (not after extraction/provisioning)
- Cached .deb files kept in a cache dir — provisioning failure re-extracts from cached .deb without re-downloading

### Resume UX
- Explicit "Resuming from partial install (version X)" banner when checkpoints exist
- Each skipped step prints a one-liner: `Skipping: LINBO .deb already downloaded (4.3.31-0, SHA256 OK)`
- Brief final summary on success showing: version, kernel variants with versions, GUI status, themes, duration

### Diagnostic depth
- Pre-flight checks before any downloads: disk space (>=500MB on /srv/linbo) and DNS resolution (deb.linuxmuster.net)
- On network failure: basic diagnostics — DNS resolution check, HTTP_PROXY/HTTPS_PROXY detection
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

</decisions>

<specifics>
## Specific Ideas

- Error blocks should look like the previewed format:
  ```
  === ERROR: APT fetch failed ===
  Package: linuxmuster-linbo7
  URL:     https://deb.linuxmuster.net/...
  Cause:   DNS resolution failed

  Diagnostics:
    DNS:   FAIL - cannot resolve deb.linuxmuster.net
    Proxy: not set (HTTP_PROXY/HTTPS_PROXY)

  Fix: Check /etc/resolv.conf or set HTTP_PROXY

  To retry:  docker compose up init
  To reset:  FORCE_UPDATE=true docker compose up init
  ===========================================
  ```

- Success summary should look like:
  ```
  === LINBO Init Complete ===
  Version:  4.3.31-0
  Kernels:  stable (6.18.4), longterm (6.12.8), legacy (6.6.72)
  GUI:      linbo_gui64_7.tar.lz installed
  Themes:   edulution
  Duration: 45s
  ===========================
  ```

- Resume output should show: banner + per-step skip messages + then normal flow for remaining steps

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `entrypoint.sh` (634 lines): Already has `verify_sha256()`, `download_and_extract_deb()` with 3-retry logic, `fetch_packages_index()` — these get hardened, not rewritten
- `provision_kernels()`: Already has atomic symlink-swap, flock-based locking, stale temp cleanup — good patterns to preserve
- `provision_themes()`, `provision_gui()`, `provision_boot_files()`: Existing provisioning functions that become checkpoint-aware

### Established Patterns
- Alpine-based container with minimal tools (curl, dpkg, tar, xz, zstd)
- POSIX shell (`#!/bin/sh`), not bash — all checkpoint/error logic must be POSIX-compatible
- `set -e` for fail-on-error — checkpoint logic needs to work with or replace this
- Version comparison via `linbo-version` file in /srv/linbo/
- Atomic operations: temp dir + rename pattern already used for kernel provisioning

### Integration Points
- `/srv/linbo/` volume: shared with tftp, rsync, api containers — checkpoint markers live here
- `/var/lib/linuxmuster/linbo/` volume: kernel variant sets
- `.needs-rebuild` marker: signals API container to rebuild linbofs64
- `.boot-files-installed` marker: existing version tracking
- Environment vars: `DEB_BASE_URL`, `DEB_DIST`, `FORCE_UPDATE`, `HTTP_PROXY`/`HTTPS_PROXY`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-init-container-hardening*
*Context gathered: 2026-03-08*
