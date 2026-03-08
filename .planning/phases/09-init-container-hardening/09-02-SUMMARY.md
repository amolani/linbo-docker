---
phase: 09-init-container-hardening
plan: 02
subsystem: infra
tags: [shell, posix, checkpoint, init-container, alpine, error-handling, idempotent]

# Dependency graph
requires:
  - phase: 09-init-container-hardening (plan 01)
    provides: 15 POSIX shell helper functions for error reporting, pre-flight, checkpoint, download, summary
provides:
  - Checkpoint-aware main flow with 6 guard points (apt-index, linbo-deb, gui-deb, boot-files, kernels, themes)
  - Structured error output for APT fetch, SHA256 mismatch, extraction, and permission failures
  - Persistent .deb cache in /srv/linbo/.cache/ surviving container restarts
  - Resume detection with skip messages for previously completed steps
  - FORCE_UPDATE=true full reset clearing checkpoints and cache
  - Version change detection with automatic checkpoint invalidation
  - Pre-flight checks (disk space, DNS, write permissions) running before any downloads
  - Success summary with version, kernels, GUI, themes, duration
affects: [10-configuration-install-script, 12-admin-documentation]

# Tech tracking
tech-stack:
  added: []
  patterns: [checkpoint-guarded-main-flow, cached-deb-downloads, version-based-checkpoint-invalidation, pre-flight-then-download, structured-error-on-failure]

key-files:
  created: []
  modified:
    - containers/init/entrypoint.sh

key-decisions:
  - "Separated download (download_and_cache_deb) from extraction (dpkg-deb -x) for independent checkpointing"
  - "Version change clears all checkpoints except apt-index (already freshly fetched)"
  - "Cached .debs persist across restarts; only FORCE_UPDATE or version change removes them"
  - "APT index always re-fetched on resume (needed for version/filename/sha256 parsing) but checkpoint tracks fetch-vs-skip messaging"

patterns-established:
  - "Checkpoint guard pattern: if checkpoint_exists && checkpoint_version_match then skip else do+checkpoint_set"
  - "Error exit pattern: if ! function_call; then exit 1; fi (not || exit 1) to ensure structured error prints before set -e"
  - "Cache path convention: /srv/linbo/.cache/debs/<package>.deb"

requirements-completed: [ERR-01]

# Metrics
duration: 2min
completed: 2026-03-08
---

# Phase 9 Plan 02: Main Flow Rewire Summary

**Checkpoint-guarded main flow with 6 resume points, structured error reporting, persistent .deb caching, pre-flight checks, and version-aware checkpoint invalidation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-08T16:40:00Z
- **Completed:** 2026-03-08T16:56:06Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Rewired entire entrypoint.sh main flow from linear to checkpoint-guarded with 6 resume points
- Every failure path now produces a structured error block (title, details, cause, diagnostics, fix)
- Pre-flight checks (write permission, disk space, DNS) run before any network operations
- Cached .deb files persist in /srv/linbo/.cache/ across container restarts, verified by SHA256
- Resume detection shows skip messages for completed steps; fresh runs process everything
- FORCE_UPDATE=true clears all checkpoints and cache for a clean re-install
- Version change detection automatically invalidates stale checkpoints
- Success summary prints LINBO version, kernel variants, GUI status, themes, and duration
- All 5 human verification steps passed (clean run, resume, force update, cache, checkpoints)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewire main flow with checkpoint guards, pre-flight, and structured errors** - `f3474e1` (feat)
2. **Task 2: Verify init container hardening end-to-end** - checkpoint:human-verify (approved, no code commit)

## Files Created/Modified
- `containers/init/entrypoint.sh` - Replaced linear main flow (lines ~510-634) with 11-step checkpoint-aware flow: setup, pre-flight, FORCE_UPDATE handling, APT index fetch, version detection, resume detection, LINBO .deb download, GUI .deb download, boot file extraction+provisioning, kernel provisioning, theme provisioning, success summary

## Decisions Made
- Separated download and extraction into independent checkpointed steps (linbo-deb/gui-deb vs boot-files) so a download can succeed and persist even if extraction fails later
- APT index is always re-fetched on resume because version/filename/SHA256 info is needed for subsequent steps -- the checkpoint only controls the skip-vs-fetch messaging
- Version change clears all checkpoints except apt-index (which was just freshly fetched in the current run)
- Kept the legacy download_and_extract_deb() function defined for backwards compatibility, though main flow no longer calls it

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 9 is fully complete: init container has structured error reporting, checkpoint-based resume, and pre-flight checks
- Phase 10 (Configuration & Install Script) can proceed -- the init container is now hardened against all common failure modes
- The error reporting patterns established here (error_block format, pre-flight checks) can serve as a reference for Phase 10's setup.sh

## Self-Check: PASSED

- FOUND: containers/init/entrypoint.sh
- FOUND: 09-02-SUMMARY.md
- FOUND: commit f3474e1

---
*Phase: 09-init-container-hardening*
*Completed: 2026-03-08*
