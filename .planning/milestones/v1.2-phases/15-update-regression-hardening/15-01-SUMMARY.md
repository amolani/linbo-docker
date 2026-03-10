---
phase: 15-update-regression-hardening
plan: 01
subsystem: infra
tags: [bash, shell-hardening, cpio, xz, linbofs64, diagnostics]

# Dependency graph
requires:
  - phase: 13-pipeline-diff-documentation
    provides: BusyBox-compatible shell patterns (grep || true, awk fallback)
  - phase: 14-hook-observability
    provides: Hook infrastructure and build manifest in update-linbofs.sh
provides:
  - Pre-injection path validation in update-linbofs.sh
  - Size range checks (80MB warn, 200MB fail) in update-linbofs.sh
  - Post-rebuild CPIO verification (XZ integrity, dev/console, module count) in update-linbofs.sh
  - Module-diff script for Docker vs LMN linbofs64 comparison
  - APT repository connectivity check in doctor.sh
  - Boot-test runbook in docs/linbo-upgrade-flow.md
affects: [15-02-PLAN, update-linbofs, doctor, linbo-upgrade]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Size guard pattern: min/warn/max thresholds with distinct messaging"
    - "CPIO verification pattern: xz -t + cpio -t + grep for critical files"
    - "Module diff using comm(1) on sorted cpio -t output"

key-files:
  created:
    - scripts/server/linbofs-module-diff.sh
  modified:
    - scripts/server/update-linbofs.sh
    - scripts/doctor.sh
    - docs/linbo-upgrade-flow.md
    - Makefile

key-decisions:
  - "Pre-injection validation checks bin/ and etc/ only (not lib/usr which may not exist in all templates)"
  - "Size thresholds: 80MB warning, 200MB hard reject per requirements UPD-03"
  - "Module-diff script runs inside Docker container, accepts optional LMN reference path argument"
  - "APT repo check uses curl with 5s connect timeout to avoid blocking doctor.sh"

patterns-established:
  - "Size guard: min (10MB) + warn (80MB) + max (200MB) three-tier validation"
  - "CPIO content verification: xz -dc | cpio -t, then grep for expected files"
  - "Module count guard: { grep || true; } | wc -l for BusyBox-safe zero-match handling"

requirements-completed: [UPD-02, UPD-03, UPD-04, UPD-05, UPD-06, UPD-07]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 15 Plan 01: Shell-Side Update Regression Hardening Summary

**Pre-injection path validation, size/module guards, CPIO verification, module-diff script, APT repo check, and boot-test runbook**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T13:20:39Z
- **Completed:** 2026-03-10T13:23:57Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Hardened update-linbofs.sh with pre-injection validation (Step 6.5), size guards (Step 12 extension), and post-rebuild CPIO verification (Step 12.5)
- Fixed extraction check logic bug (was &&, should be || -- either directory missing is an error)
- Created linbofs-module-diff.sh (107 lines) for comparing Docker vs LMN module lists
- Extended doctor.sh with Category 7: APT Repository connectivity check
- Appended boot-test runbook to docs/linbo-upgrade-flow.md with pre-boot, PXE, functional, and rollback sections
- Added module-diff Makefile target with help entry

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pre-injection path validation, size/module guards, and CPIO verification** - `8666920` (feat)
2. **Task 2: Create module-diff script, extend doctor.sh, add runbook, update Makefile** - `0b40d30` (feat)

## Files Created/Modified
- `scripts/server/update-linbofs.sh` - Added Step 6.5 path validation, size guards, Step 12.5 CPIO verification
- `scripts/server/linbofs-module-diff.sh` - New script comparing module lists between Docker and LMN linbofs64
- `scripts/doctor.sh` - Added Category 7: APT Repository connectivity check
- `docs/linbo-upgrade-flow.md` - Appended Boot-Test Runbook section
- `Makefile` - Added module-diff target and help entry

## Decisions Made
- Pre-injection validation checks bin/ and etc/ only -- these are the critical directories that must exist in every linbofs64 template. lib/ and usr/ are not checked because they may legitimately be absent in minimal templates.
- Size thresholds set to 80MB (warning) and 200MB (hard reject) per requirements. Current production is ~55MB.
- Module-diff script designed to run inside Docker container with optional path argument for LMN reference file. Default path: /srv/linbo/linbofs64.lmn-reference.
- APT repo check uses curl with 5-second connect timeout to prevent doctor.sh from hanging on network issues.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Shell-side hardening complete, update-linbofs.sh now fails loudly on structure changes, oversized builds, corrupt archives, and missing modules
- Ready for 15-02 (test suite expansion for linbo-update.service.test.js)

---
*Phase: 15-update-regression-hardening*
*Completed: 2026-03-10*

## Self-Check: PASSED
