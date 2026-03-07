---
phase: 02-secrets-hardening
plan: 02
subsystem: auth
tags: [internal-api-key, x-internal-key, deploy-script, multi-target, middleware]

# Dependency graph
requires:
  - phase: 01-build-hygiene
    provides: clean Docker build with pinned images
provides:
  - X-Internal-Key header support in authenticateToken middleware
  - Secure deploy script using INTERNAL_API_KEY from remote .env
  - Multi-target deploy capability (comma-separated hosts)
  - rsync container restart in rebuild flow
affects: [deploy, api-auth, system-routes]

# Tech tracking
tech-stack:
  added: []
  patterns: [X-Internal-Key header auth for system routes, multi-target deploy with per-target error handling]

key-files:
  created:
    - containers/api/tests/middleware/auth-internal-key.test.js
  modified:
    - containers/api/src/middleware/auth.js
    - scripts/deploy.sh

key-decisions:
  - "X-Internal-Key checked only when no Authorization Bearer token present (Bearer takes precedence)"
  - "Deploy script falls back to docker exec if INTERNAL_API_KEY missing from remote .env"
  - "Multi-target continues on failure and prints per-target summary"

patterns-established:
  - "X-Internal-Key header: system routes accept both Bearer and X-Internal-Key for INTERNAL_API_KEY auth"
  - "Deploy auth: read secrets from remote .env via SSH, never hardcode credentials"

requirements-completed: [PROD-04]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 2 Plan 2: Deploy Credentials Removal Summary

**X-Internal-Key header support in authenticateToken middleware + deploy.sh rewrite with INTERNAL_API_KEY auth and multi-target support**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T18:12:54Z
- **Completed:** 2026-03-07T18:16:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- authenticateToken middleware now accepts X-Internal-Key header as alternative to Authorization: Bearer for INTERNAL_API_KEY auth
- deploy.sh reads INTERNAL_API_KEY from remote .env via SSH instead of hardcoding admin/Muster! credentials
- deploy.sh supports comma-separated multi-target hosts with per-target pass/fail summary
- rsync container added to restart alongside tftp in --rebuild flow
- 6 unit tests cover all X-Internal-Key auth scenarios

## Task Commits

Each task was committed atomically:

1. **Task 1: Add X-Internal-Key header support to authenticateToken** (TDD)
   - `66bcf99` (test: add failing test for X-Internal-Key header support)
   - `115c553` (feat: add X-Internal-Key header support to authenticateToken)
2. **Task 2: Rewrite deploy.sh with X-Internal-Key auth and multi-target** - `8f1e428` (feat)

_Note: Task 1 used TDD with RED/GREEN commits._

## Files Created/Modified
- `containers/api/tests/middleware/auth-internal-key.test.js` - 6 tests for X-Internal-Key header acceptance in authenticateToken
- `containers/api/src/middleware/auth.js` - authenticateToken checks X-Internal-Key when no Bearer token present
- `scripts/deploy.sh` - Secure deploy with INTERNAL_API_KEY auth, multi-target support, rsync restart

## Decisions Made
- X-Internal-Key is checked only when no Authorization Bearer token is present, so Bearer always takes precedence (preserves existing behavior)
- Deploy script falls back to `docker exec` for rebuild if INTERNAL_API_KEY is not found in remote .env (graceful degradation)
- Multi-target deploy continues on failure for resilience, prints per-target pass/fail summary at end
- Used `sed 's/^INTERNAL_API_KEY=//'` instead of `cut -d= -f2` to handle base64 keys containing `=`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Auth middleware fully supports X-Internal-Key for system routes
- Deploy script ready for use with any server that has INTERNAL_API_KEY in .env
- Ready for remaining security hardening work

## Self-Check: PASSED

- All 3 source files exist on disk
- All 3 commits (66bcf99, 115c553, 8f1e428) found in git log
- 6/6 auth middleware tests pass
- deploy.sh passes bash -n syntax check
- No hardcoded credentials remain in deploy.sh

---
*Phase: 02-secrets-hardening*
*Completed: 2026-03-07*
