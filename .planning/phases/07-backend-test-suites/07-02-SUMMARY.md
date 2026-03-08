---
phase: 07-backend-test-suites
plan: 02
subsystem: testing
tags: [jest, ssh2, terminal, pty, fake-timers, unit-tests]

# Dependency graph
requires:
  - phase: 07-backend-test-suites
    provides: test infrastructure and ssh.service mock patterns
provides:
  - terminal.service.js unit test coverage (17 tests)
  - PTY-to-exec fallback verification
  - idle timeout behavior verification
  - session lifecycle verification
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "mock-prefixed variables for Jest hoisting compatibility"
    - "EventEmitter-based ssh2 Client mock with configurable behavior"
    - "jest.useFakeTimers for idle timeout verification"

key-files:
  created:
    - containers/api/tests/services/terminal.service.test.js
  modified: []

key-decisions:
  - "process.env.TERMINAL_MAX_SESSIONS='2' set before module load for manageable max-sessions test"
  - "Mock variables prefixed with 'mock' to comply with Jest Babel hoisting rules"
  - "Configurable shell/connect behavior via module-scoped mock flags instead of per-test jest.mock"

patterns-established:
  - "mock-prefixed module variables: Jest requires mock factory variables to be prefixed with 'mock' (case insensitive)"
  - "Behavior flags pattern: mockShellBehavior/mockConnectBehavior for reconfigurable ssh2 mock per test"

requirements-completed: [TEST-02]

# Metrics
duration: 4min
completed: 2026-03-08
---

# Phase 07 Plan 02: Terminal Service Tests Summary

**17 unit tests covering SSH terminal session lifecycle, PTY-to-exec fallback, idle timeout cleanup, and destroyAll with no orphaned sessions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-08T13:26:41Z
- **Completed:** 2026-03-08T13:30:49Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- 17 tests covering all 4 TEST-02 critical behaviors: session create/destroy, PTY fallback, idle timeout, destroyAll
- Edge cases covered: max sessions rejection, resize on exec-mode, empty destroyAll, connection failure, both PTY+exec failure
- EventEmitter-based ssh2 mock with configurable behavior per test (shell success, PTY fail, connect error)
- Fake timers for deterministic idle timeout verification without real 30-minute waits

## Task Commits

Each task was committed atomically:

1. **Task 1: Create terminal service unit tests** - `4d17c7f` (test)

## Files Created/Modified
- `containers/api/tests/services/terminal.service.test.js` - 17 unit tests for terminal.service.js covering session lifecycle, PTY fallback, idle timeout, destroyAll, max sessions, resize, writeToSession

## Decisions Made
- Set `process.env.TERMINAL_MAX_SESSIONS = '2'` before module require to avoid creating 10 sessions in max-sessions test
- Used `mock`-prefixed variable names (mockShellBehavior, mockConnectBehavior, mockLastClient, mockUuidCounter) to comply with Jest's Babel transform hoisting rules that only allow `mock`-prefixed variables in jest.mock factories
- Used configurable behavior flags instead of multiple jest.mock calls -- single ssh2 mock with mockShellBehavior/mockConnectBehavior flags reset in beforeEach

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Jest mock variable naming for Babel hoisting**
- **Found during:** Task 1 (test creation)
- **Issue:** Jest's Babel transform rejects module-scoped variables inside jest.mock() factories unless prefixed with 'mock' (case insensitive). Variables `uuidCounter`, `lastMockClient`, `shellBehavior`, `connectBehavior` caused "Invalid variable access" error.
- **Fix:** Renamed all module-scoped variables used in mock factories to `mockUuidCounter`, `mockLastClient`, `mockShellBehavior`, `mockConnectBehavior`.
- **Files modified:** containers/api/tests/services/terminal.service.test.js
- **Verification:** All 17 tests pass
- **Committed in:** 4d17c7f (part of task commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Variable naming fix was necessary for Jest compatibility. No scope creep.

## Issues Encountered
None beyond the mock variable naming fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Terminal service fully tested with 17 passing tests
- Test patterns (mock-prefixed variables, configurable behavior flags) available for similar ssh2-based service tests
- No blockers for subsequent plans

---
*Phase: 07-backend-test-suites*
*Completed: 2026-03-08*

## Self-Check: PASSED
- [x] containers/api/tests/services/terminal.service.test.js exists (306 lines)
- [x] Commit 4d17c7f verified in git log
- [x] 17 tests pass (npx jest --runInBand --verbose)
- [x] No regressions in full test suite
