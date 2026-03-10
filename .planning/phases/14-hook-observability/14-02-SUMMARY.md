---
phase: 14-hook-observability
plan: 02
subsystem: api
tags: [hooks, observability, express, rest-api, build-logs, json-manifest]

# Dependency graph
requires:
  - phase: 14-hook-observability
    plan: 01
    provides: Build manifest JSON, patch-status hooks| line, hook directories
provides:
  - hook.service.js with getHooks() and readManifest() for hook directory scanning
  - GET /system/hooks endpoint returning hook list with observability data
  - Build log rotation in linbofs.service.js (keeps last 3 logs)
  - getPatchStatus() extended with hookWarnings, hookCount, hookWarningDetails
affects: [frontend-hook-dashboard, 15-update-regression-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hook service scans filesystem directories and merges with JSON manifest data"
    - "Build log rotation pattern: scan, sort by mtime, keep N most recent"
    - "Patch-status line parsing with regex for backward-compatible field extension"

key-files:
  created:
    - containers/api/src/services/hook.service.js
    - containers/api/src/routes/system/hooks.js
    - containers/api/tests/services/hook.service.test.js
    - containers/api/tests/routes/system.hooks.test.js
  modified:
    - containers/api/src/services/linbofs.service.js
    - containers/api/src/routes/system/index.js

key-decisions:
  - "No requireRole on GET /hooks - read-only endpoint, consistent with GET /system/linbofs-status"
  - "Build log rotation before rebuild, log save after rebuild (both success and failure)"
  - "getPatchStatus() backward-compatible: defaults hookWarnings/hookCount to 0 when hooks| line absent"

patterns-established:
  - "Hook service pattern: scan directories + merge JSON manifest for rich observability"
  - "Build log retention: timestamped .linbofs-build.*.log files with automatic rotation"

requirements-completed: [HOOK-02, HOOK-03]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 14 Plan 02: Hook Observability API Summary

**API hook service with GET /system/hooks endpoint, build log rotation, and getPatchStatus() hook warning parsing for linbofs-status**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T12:34:32Z
- **Completed:** 2026-03-10T12:37:52Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created hook.service.js with getHooks() that scans pre.d/post.d directories and merges build manifest data
- Added GET /system/hooks endpoint returning hook list with type, executable status, exit codes, and file deltas
- Implemented build log rotation in linbofs.service.js keeping last 3 logs with timestamped filenames
- Extended getPatchStatus() to parse hooks| line from .linbofs-patch-status for hookWarnings, hookCount, hookWarningDetails

## Task Commits

Each task was committed atomically:

1. **Task 1: Create hook.service.js with tests** - `6db4e17` (feat, TDD)
2. **Task 2: Add GET /system/hooks route, build log retention, getPatchStatus() hook parsing, and route test** - `426c35e` (feat)

## Files Created/Modified
- `containers/api/src/services/hook.service.js` - Hook scanning + manifest reading service (getHooks, readManifest)
- `containers/api/src/routes/system/hooks.js` - GET /system/hooks route with authenticateToken
- `containers/api/src/routes/system/index.js` - Mounted hooks sub-router
- `containers/api/src/services/linbofs.service.js` - Added rotateBuildLogs(), build log save, getPatchStatus() hook parsing
- `containers/api/tests/services/hook.service.test.js` - 7 unit tests for hook service
- `containers/api/tests/routes/system.hooks.test.js` - 2 route tests with supertest

## Decisions Made
- No requireRole on GET /hooks -- read-only endpoint, consistent with GET /system/linbofs-status which also uses only authenticateToken
- Build log rotation runs before rebuild to keep directory clean; log save happens after rebuild (both success and failure paths)
- getPatchStatus() backward-compatible: when hooks| line is absent (older patch-status files), defaults hookWarnings/hookCount to 0 and hookWarningDetails to null

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Full hook observability API available: GET /system/hooks returns rich hook data
- GET /system/linbofs-status now includes hookWarnings and hookCount via getPatchStatus()
- Build logs retained for post-mortem debugging (last 3 logs)
- Phase 14 (Hook Observability) complete -- ready for Phase 15 (Update Regression Hardening)

## Self-Check: PASSED

All artifacts verified: 4 files created, 2 modified, 2 commits found, getHooks/readManifest/rotateBuildLogs exports confirmed, 9 tests passing.

---
*Phase: 14-hook-observability*
*Completed: 2026-03-10*
