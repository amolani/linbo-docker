---
phase: 06-isolated-debt-fixes
plan: 01
subsystem: api
tags: [redis, prisma, worker, scan, sync-mode]

# Dependency graph
requires:
  - phase: 05-error-handling
    provides: "Categorized silent catches and established logging patterns"
provides:
  - "Prisma-optional operation worker safe for sync mode"
  - "SCAN-based delPattern eliminating blocking KEYS command"
affects: [07-testing, 08-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: ["if-else Prisma-optional guard with sync-mode early-export", "scanStream pipeline-delete with backpressure"]

key-files:
  created:
    - containers/api/tests/workers/operation.worker.test.js
    - containers/api/tests/lib/redis.test.js
  modified:
    - containers/api/src/workers/operation.worker.js
    - containers/api/src/lib/redis.js

key-decisions:
  - "Used if-else guard pattern instead of module-level return (Babel compatibility with Jest)"
  - "scanStream COUNT hint of 100 for balanced batch sizes"
  - "Pipeline-delete per batch with pause/resume for backpressure control"

patterns-established:
  - "Prisma-optional if-else guard: sync-mode stubs in if-block, full implementation in else-block"
  - "scanStream pipeline pattern: pause stream, exec pipeline, resume stream"

requirements-completed: [DEBT-03, DEBT-04]

# Metrics
duration: 4min
completed: 2026-03-08
---

# Phase 06 Plan 01: Worker & Redis Debt Fixes Summary

**Prisma-optional sync-mode guard for operation worker and SCAN-based delPattern replacing blocking Redis KEYS command**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-08T12:30:18Z
- **Completed:** 2026-03-08T12:34:50Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Operation worker is crash-safe in sync mode: exports disabled stubs instead of crashing on null Prisma
- Redis KEYS command eliminated from delPattern: scanStream with pipeline-delete handles scale
- 16 new unit tests (9 worker + 7 redis) covering all new behaviors via TDD

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1: Worker Prisma-optional sync-mode guard**
   - `55869d5` (test: add failing tests for worker sync-mode guard)
   - `bb1421b` (feat: add Prisma-optional sync-mode guard to operation worker)
2. **Task 2: Redis SCAN migration for delPattern**
   - `832a5bd` (test: add failing tests for SCAN-based delPattern)
   - `cba1c35` (feat: replace Redis KEYS with SCAN-based delPattern)

## Files Created/Modified
- `containers/api/src/workers/operation.worker.js` - Added if-else Prisma-optional guard with sync-mode stubs
- `containers/api/src/lib/redis.js` - Replaced KEYS-based delPattern with scanStream pipeline-delete
- `containers/api/tests/workers/operation.worker.test.js` - 9 tests for sync-mode disabled worker state
- `containers/api/tests/lib/redis.test.js` - 7 tests for SCAN-based delPattern

## Decisions Made
- Used if-else guard pattern instead of module-level `return` because Babel (used by Jest) does not support `return` at module scope, even though Node.js CommonJS does
- scanStream COUNT hint of 100 balances scan granularity vs round-trip overhead
- Pipeline-delete per batch with stream pause/resume prevents backpressure issues at scale

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Changed from module-level return to if-else pattern**
- **Found during:** Task 1 (Worker implementation)
- **Issue:** Plan specified `return` at module scope for early exit, but Babel parser (Jest transform) throws `'return' outside of function` SyntaxError
- **Fix:** Restructured to if-else pattern: sync-mode stubs in if-block, full worker implementation in else-block
- **Files modified:** containers/api/src/workers/operation.worker.js
- **Verification:** All 9 tests pass, module exports identical in both modes
- **Committed in:** bb1421b (Task 1 GREEN commit)

**2. [Rule 1 - Bug] Added `on` method to ioredis mock client**
- **Found during:** Task 2 (Redis test GREEN phase)
- **Issue:** First test failed because `getClient()` calls `client.on('connect', ...)` during initialization, but mock client lacked `on` method
- **Fix:** Added `on: jest.fn().mockReturnThis()` to mock client
- **Files modified:** containers/api/tests/lib/redis.test.js
- **Verification:** All 7 redis tests pass
- **Committed in:** cba1c35 (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for test compatibility. No scope creep. Behavioral contract identical to plan spec.

## Issues Encountered
- Pre-existing test failures in 6 test suites (driver-path, config.service, sync.service, ssh.service, patchclass.service, api) are not caused by this plan's changes -- out of scope per deviation rules

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Worker and Redis debt fixes complete, ready for remaining isolated debt fixes
- All 18+ delPattern callers continue working identically (verified via grep)
- Worker route (system/worker.js) continues working with disabled status in sync mode

## Self-Check: PASSED

All 4 source/test files exist. All 4 commits verified (55869d5, bb1421b, 832a5bd, cba1c35).

---
*Phase: 06-isolated-debt-fixes*
*Completed: 2026-03-08*
