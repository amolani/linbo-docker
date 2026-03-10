---
phase: 13-pipeline-diff-documentation
plan: 01
subsystem: tooling
tags: [bash, shell, cpio, xz, linbofs64, makefile, audit, diff]

# Dependency graph
requires: []
provides:
  - "LMN original update-linbofs script pinned as reference (v4.3.31-0)"
  - "make linbofs-audit: inspects built linbofs64 contents"
  - "make linbofs-diff: compares template vs built linbofs64"
affects: [13-pipeline-diff-documentation]

# Tech tracking
tech-stack:
  added: []
  patterns: ["docker exec delegation for container-internal scripts", "BusyBox-compatible shell (no grep -P, no numfmt, pipefail-safe grep counts)"]

key-files:
  created:
    - scripts/server/update-linbofs-lmn-original.sh
    - scripts/server/linbofs-audit.sh
    - scripts/server/linbofs-diff.sh
  modified:
    - Makefile

key-decisions:
  - "Use grep|wc -l wrapped in { || true; } instead of grep -c for BusyBox pipefail compatibility"
  - "Use awk fallback for human-readable file sizes since Alpine BusyBox lacks numfmt"
  - "Use sed-based kernel version extraction instead of grep -P (Perl regex not available in BusyBox)"

patterns-established:
  - "BusyBox-safe counting: $({ grep PATTERN FILE || true; } | wc -l) for pipefail-safe zero-match handling"
  - "Makefile docker exec delegation: @docker exec linbo-api bash /usr/share/linuxmuster/linbo/SCRIPT for container-internal tools"

requirements-completed: [DIFF-01, DIFF-02, DIFF-03]

# Metrics
duration: 6min
completed: 2026-03-10
---

# Phase 13 Plan 01: Pipeline Diff Documentation Summary

**linbofs64 inspection tooling: pinned LMN original (v4.3.31-0), linbofs-audit.sh (kernel/modules/SSH/firmware/hooks), linbofs-diff.sh (categorized added/removed), wired via make linbofs-audit and make linbofs-diff**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-10T11:39:05Z
- **Completed:** 2026-03-10T11:45:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Pinned LMN original update-linbofs script (412 lines, v4.3.31-0) with comprehensive reference header including variable mappings from constants.py
- Created linbofs-audit.sh (204 lines) that inspects built linbofs64: archive info, kernel version, 720 module count, SSH key fingerprints, firmware files, hook-modified files, device nodes, summary
- Created linbofs-diff.sh (195 lines) that compares template vs built linbofs64: file sizes, categorized added files (modules/firmware/SSH/themes/other), removed files, summary counts
- Both scripts verified end-to-end inside the Alpine-based API container with real linbofs64 data

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin LMN original and create audit/diff scripts** - `3516f70` (feat)
2. **Task 2: Add Makefile targets and fix BusyBox compatibility** - `a61015b` (feat)

## Files Created/Modified
- `scripts/server/update-linbofs-lmn-original.sh` - Pinned LMN original (non-executable, 438 lines with header)
- `scripts/server/linbofs-audit.sh` - linbofs64 content inspection tool (executable, 204 lines)
- `scripts/server/linbofs-diff.sh` - Template vs built linbofs64 comparison tool (executable, 195 lines)
- `Makefile` - Added linbofs-audit and linbofs-diff targets with .PHONY and help text

## Decisions Made
- Used `{ grep ... || true; } | wc -l` pattern instead of `grep -c` for BusyBox compatibility under pipefail (grep -c exits 1 on 0 matches, which pipefail propagates)
- Used awk one-liner as fallback for numfmt (not available in Alpine BusyBox) for human-readable file sizes
- Used sed-based kernel version extraction from module paths instead of grep -P (Perl regex not available in BusyBox grep)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed BusyBox grep -P incompatibility in linbofs-audit.sh**
- **Found during:** Task 2 (end-to-end verification)
- **Issue:** Alpine BusyBox grep does not support -P (Perl regex) flag used for kernel version extraction
- **Fix:** Replaced `grep -oP '^lib/modules/\K[0-9][^/]+'` with `grep '^lib/modules/[0-9]' | head -1 | sed 's|^lib/modules/||; s|/.*||'`
- **Files modified:** scripts/server/linbofs-audit.sh
- **Verification:** `make linbofs-audit` correctly shows "Version: 6.18.4"
- **Committed in:** a61015b (Task 2 commit)

**2. [Rule 1 - Bug] Fixed numfmt unavailable in Alpine BusyBox**
- **Found during:** Task 2 (end-to-end verification)
- **Issue:** Alpine BusyBox lacks `numfmt` command used for human-readable file sizes
- **Fix:** Added awk fallback that converts bytes to KiB/MiB/GiB
- **Files modified:** scripts/server/linbofs-audit.sh, scripts/server/linbofs-diff.sh
- **Verification:** Both scripts show "52.3MiB" instead of raw byte count
- **Committed in:** a61015b (Task 2 commit)

**3. [Rule 1 - Bug] Fixed pipefail + grep -c zero-match crash**
- **Found during:** Task 2 (end-to-end verification)
- **Issue:** Under `set -euo pipefail`, `grep -c PATTERN | ...` or `grep PATTERN | wc -l` fails when grep finds 0 matches (exit code 1 propagated by pipefail)
- **Fix:** Wrapped all counting greps in `{ grep ... || true; } | wc -l` to absorb the exit code
- **Files modified:** scripts/server/linbofs-audit.sh, scripts/server/linbofs-diff.sh
- **Verification:** Both scripts complete successfully with 0-count categories
- **Committed in:** a61015b (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs, all BusyBox compatibility)
**Impact on plan:** All fixes necessary for correct execution in the Alpine BusyBox container environment. No scope creep.

## Issues Encountered
- BusyBox grep in Alpine container has significant differences from GNU grep: no -P flag, different -c exit behavior. All resolved with POSIX-compatible alternatives.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- linbofs-audit and linbofs-diff tooling ready for use by admins
- Phase 13 Plan 02 (divergence documentation, CPIO format docs) can reference these tools
- Scripts establish BusyBox-compatible shell patterns for future container scripts

---
*Phase: 13-pipeline-diff-documentation*
*Completed: 2026-03-10*
