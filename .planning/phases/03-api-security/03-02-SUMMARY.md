---
phase: 03-api-security
plan: 02
subsystem: api
tags: [rate-limiting, cors, express-rate-limit, redis, security, brute-force]

# Dependency graph
requires:
  - phase: 03-api-security
    provides: "03-01 WebSocket auth, _testing export pattern, validateSecrets function"
  - phase: 02-secrets-hardening
    provides: "validateSecrets with _testing export, INTERNAL_API_KEY validation"
provides:
  - "Login rate limiting middleware (5 attempts/min/IP) with Redis-backed store"
  - "CORS default changed from wildcard to http://localhost:8080"
  - "Express trust proxy for correct client IP detection behind nginx"
  - "CORS_ORIGIN=* production warning in validateSecrets"
  - "createLoginLimiter factory for testable rate limiting instances"
affects: [api, testing, deployment]

# Tech tracking
tech-stack:
  added: [express-rate-limit@8, rate-limit-redis@4, supertest]
  patterns: ["Factory function with store injection for testable rate limiting", "Trust proxy with private-range restriction for Docker deployments"]

key-files:
  created:
    - "containers/api/src/middleware/rate-limit.js"
    - "containers/api/tests/middleware/rate-limit.test.js"
  modified:
    - "containers/api/src/index.js"
    - "containers/api/src/routes/auth.js"
    - "containers/api/tests/startup-validation.test.js"
    - "containers/api/package.json"

key-decisions:
  - "Removed custom keyGenerator in favor of express-rate-limit v8 default (handles IPv6 normalization automatically)"
  - "Used 'loopback, linklocal, uniquelocal' for trust proxy (not 'true') to prevent X-Forwarded-For spoofing from external clients"
  - "Rate limiting only on POST /login, not /register or /password (those already require authenticateToken)"
  - "Factory pattern createLoginLimiter(options) with optional store override for test isolation"

patterns-established:
  - "Rate limit middleware with factory function: createLoginLimiter({store}) for production Redis / test in-memory switching"
  - "Trust proxy private-range config: app.set('trust proxy', 'loopback, linklocal, uniquelocal') placed before all middleware"
  - "CORS default restrictive: specific origin instead of wildcard, with warning for explicit wildcard override"

requirements-completed: [PROD-07, PROD-08]

# Metrics
duration: 7min
completed: 2026-03-07
---

# Phase 3 Plan 02: Rate Limiting & CORS Hardening Summary

**Login rate limiting at 5 attempts/min/IP via express-rate-limit with Redis store, CORS default changed from wildcard to localhost:8080, trust proxy for correct Docker IP detection**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-07T19:38:35Z
- **Completed:** 2026-03-07T19:46:09Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Login endpoint rate-limited to 5 attempts per minute per IP with HTTP 429 + RATE_LIMITED error code + Retry-After header
- CORS default changed from wildcard `*` to `http://localhost:8080` preventing cross-origin credentialed requests
- Express trust proxy configured for Docker internal network (loopback, linklocal, uniquelocal) ensuring req.ip returns real client IP
- CORS_ORIGIN=* warning in validateSecrets (non-fatal, fires in all modes)
- 14 new tests passing (9 startup validation + 5 rate-limit middleware)

## Task Commits

Each task was committed atomically (Task 2 uses TDD: RED then GREEN):

1. **Task 1: Install packages, trust proxy, CORS default, CORS warning** - `763ea34` (feat)
2. **Task 2 RED: Rate-limit failing tests** - `3abb60f` (test)
3. **Task 2 GREEN: Rate-limit middleware + auth.js integration** - `9f35777` (feat)

## Files Created/Modified
- `containers/api/src/middleware/rate-limit.js` - Rate limiting middleware with createLoginLimiter factory, Redis store in production, in-memory for tests
- `containers/api/tests/middleware/rate-limit.test.js` - 5 tests: type check, 5-request passthrough, 6th-request 429, Retry-After header, independent IP counting
- `containers/api/src/index.js` - Added trust proxy setting, changed CORS default to localhost:8080, added CORS_ORIGIN=* warning
- `containers/api/src/routes/auth.js` - Applied loginLimiter as first middleware on POST /login
- `containers/api/tests/startup-validation.test.js` - Added 2 CORS tests (CORS_ORIGIN=* warning, specific origin no warning)
- `containers/api/package.json` - Added express-rate-limit, rate-limit-redis, supertest dependencies

## Decisions Made
- **Removed custom keyGenerator:** express-rate-limit v8 default keyGenerator already uses req.ip with proper IPv6 normalization via ipKeyGenerator helper. Custom `(req) => req.ip` triggered validation warnings without adding value.
- **Trust proxy private ranges only:** Using `'loopback, linklocal, uniquelocal'` instead of `true` prevents external clients from spoofing X-Forwarded-For to bypass rate limiting.
- **Rate limit POST /login only:** /register and /password routes require authenticateToken middleware (valid JWT needed), so brute-force is not a concern there.
- **Factory pattern for testability:** `createLoginLimiter({store})` allows tests to use in-memory store without Redis, while production uses RedisStore automatically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed custom keyGenerator causing IPv6 validation warnings**
- **Found during:** Task 2 (rate-limit middleware implementation)
- **Issue:** Custom `keyGenerator: (req) => req.ip` triggered ERR_ERL_KEY_GEN_IPV6 validation error in express-rate-limit v8 because it bypasses the built-in ipKeyGenerator helper for IPv6 normalization
- **Fix:** Removed custom keyGenerator, relying on the default which already uses req.ip with proper IPv6 handling
- **Files modified:** `containers/api/src/middleware/rate-limit.js`
- **Verification:** All 5 rate-limit tests pass without validation warnings
- **Committed in:** `9f35777` (Task 2 GREEN commit)

**2. [Rule 1 - Bug] Fixed test using trust proxy true causing permissive proxy warning**
- **Found during:** Task 2 (rate-limit tests)
- **Issue:** Test 5 used `trust proxy = true` which triggered ERR_ERL_PERMISSIVE_TRUST_PROXY warning
- **Fix:** Changed to `'loopback, linklocal, uniquelocal'` matching production config
- **Files modified:** `containers/api/tests/middleware/rate-limit.test.js`
- **Verification:** Test passes without validation warnings
- **Committed in:** `9f35777` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (2 bugs from express-rate-limit v8 validation)
**Impact on plan:** Both fixes align with security best practices. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 03 (API Security) is now complete: WebSocket auth (PROD-06), rate limiting (PROD-07), CORS hardening (PROD-08)
- Ready for Phase 04 (system.js refactor) or any subsequent phase
- Rate limiting will work with Redis in Docker environment, falls back to in-memory if Redis unavailable

## Self-Check: PASSED

All files verified present, all commits found in git history.

---
*Phase: 03-api-security*
*Completed: 2026-03-07*
