---
phase: 15-update-regression-hardening
plan: 02
subsystem: api
tags: [jest, testing, linbo-update, regression, version-parsing]

# Dependency graph
requires:
  - phase: 15-update-regression-hardening
    plan: 01
    provides: Shell-side hardening context
provides:
  - Partial failure test coverage for linbo-update service
  - Concurrent update 409 rejection test
  - Version comparison edge case tests
affects: [linbo-update.service.test.js]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Partial failure mock: mockResolvedValueOnce on linbofsService.updateLinbofs"
    - "Lock pre-set pattern: redisStore.set('linbo:update:lock', ...) before startUpdate"
    - "Epoch/tilde version parsing in parseInstalledVersion"

key-files:
  created: []
  modified:
    - containers/api/tests/services/linbo-update.service.test.js

key-decisions:
  - "Partial failure tests verify rebuild error wrapping and lock release using proven fetch mock pattern"
  - "Concurrent test pre-sets Redis lock key to simulate in-progress update"
  - "Version edge case tests gracefully skip dpkg-dependent tests if dpkg unavailable in test env"

patterns-established:
  - "Mock override with mockResolvedValueOnce for single-call failure injection"
  - "Redis lock pre-set for concurrent rejection testing"

requirements-completed: [UPD-01]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 15 Plan 02: Update Regression Tests Summary

**Partial failure, concurrent 409, and version edge case test groups for linbo-update.service**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T13:20:39Z
- **Completed:** 2026-03-10T13:23:57Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added 12 new tests across 3 describe blocks to linbo-update.service.test.js
- **Partial failure** (3 tests): rebuild error wrapping, lock release on error, error status set
- **Concurrent update** (2 tests): 409 rejection when lock pre-set, original lock preserved
- **Version edge cases** (7 tests): epoch versions, tilde pre-releases, multi-candidate selection, revision comparison, numeric-only format
- All 50 tests pass (38 existing + 12 new), zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add partial failure, concurrent update, and version edge case tests** - `a1d7815` (test)

## Files Created/Modified
- `containers/api/tests/services/linbo-update.service.test.js` - Added 3 new describe blocks with 12 tests

## Decisions Made
- Used proven fetch mock pattern from existing "lock is always released on error" test for partial failure tests
- Pre-set Redis lock key directly for concurrent update rejection test
- Gracefully skip dpkg-dependent isNewer tests when dpkg unavailable in test environment

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness
- All regression test coverage complete for update service
- Combined with 15-01 shell hardening, phase 15 requirements fully covered

---
*Phase: 15-update-regression-hardening*
*Completed: 2026-03-10*

## Self-Check: PASSED
