---
phase: 03-api-security
plan: 01
subsystem: api
tags: [websocket, jwt, authentication, security, upgrade-handler]

# Dependency graph
requires:
  - phase: 02-secrets-hardening
    provides: "_testing export pattern, validateSecrets, INTERNAL_API_KEY validation"
provides:
  - "verifyWsToken() helper for WebSocket token verification (JWT + INTERNAL_API_KEY)"
  - "Authenticated /ws upgrade handler rejecting unauthenticated connections with HTTP 401"
  - "ws.user populated on authenticated WebSocket connections"
affects: [03-api-security, testing]

# Tech tracking
tech-stack:
  added: []
  patterns: ["pre-upgrade authentication pattern for noServer WebSocket", "module-scope helper exported via _testing for unit test access"]

key-files:
  created:
    - "containers/api/tests/middleware/ws-auth.test.js"
  modified:
    - "containers/api/src/index.js"

key-decisions:
  - "verifyWsToken defined at module scope (not inside startServer) for testability without server startup side effects"
  - "verifyToken import moved to module scope to support verifyWsToken at module level"
  - "INTERNAL_API_KEY checked before JWT (plain string comparison is faster, matches authenticateToken pattern)"

patterns-established:
  - "Pre-upgrade WebSocket auth: verify token via URL ?token= param BEFORE calling handleUpgrade, reject with socket.write 401 + socket.destroy"
  - "Module-scope helper functions exported via _testing for unit testing without requiring full server startup"

requirements-completed: [PROD-06]

# Metrics
duration: 4min
completed: 2026-03-07
---

# Phase 3 Plan 01: WebSocket Auth Summary

**JWT and INTERNAL_API_KEY verification on /ws upgrade handler, rejecting unauthenticated connections with HTTP 401 before WebSocket handshake**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-07T19:01:38Z
- **Completed:** 2026-03-07T19:05:38Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- WebSocket /ws endpoint now verifies JWT token or INTERNAL_API_KEY at upgrade time
- Unauthenticated connections receive HTTP 401 and socket is destroyed before handshake
- 13 unit tests covering all auth scenarios (no token, invalid/expired JWT, valid JWT, INTERNAL_API_KEY)
- Terminal WebSocket /ws/terminal remains completely unaffected

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1 RED: WebSocket auth tests** - `7aaabed` (test)
2. **Task 1 GREEN: Implement verifyWsToken + upgrade handler auth** - `70919c6` (feat)

## Files Created/Modified
- `containers/api/tests/middleware/ws-auth.test.js` - 13 unit tests for verifyWsToken and upgrade handler auth logic
- `containers/api/src/index.js` - Added verifyWsToken() helper, modified upgrade handler for /ws to require auth

## Decisions Made
- Defined verifyWsToken at module scope rather than inside startServer() -- this avoids test infrastructure needing to start the full server (Redis, DB connections) just to test token verification logic
- Moved verifyToken import from inside startServer() to module scope -- terminal WS handler and verifyWsToken both need it, module scope makes both accessible
- INTERNAL_API_KEY is checked before JWT verification (consistent with authenticateToken middleware pattern in auth.js)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WebSocket /ws endpoint is now secured (PROD-06 complete)
- Ready for plan 03-02 (rate limiting + CORS hardening)
- Frontend already sends ?token= via wsStore.ts, so no frontend changes needed

---
*Phase: 03-api-security*
*Completed: 2026-03-07*
