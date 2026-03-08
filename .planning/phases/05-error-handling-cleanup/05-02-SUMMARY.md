---
phase: 05-error-handling-cleanup
plan: 02
subsystem: api
tags: [error-handling, logging, catch-blocks, console.debug, console.warn]

# Dependency graph
requires:
  - phase: 04-system-router-split
    provides: Split sub-routers for catch block audit
provides:
  - Zero silent catch blocks in entire API codebase (DEBT-01 complete)
  - Categorized logging for all Prisma-optional, file cleanup, and startup catches
  - Once-flag pattern for internal.js Redis fallback logging
affects: [testing, debugging]

# Tech tracking
tech-stack:
  added: []
  patterns: [once-flag suppression for high-frequency debug logs, categorized catch logging]

key-files:
  created: []
  modified:
    - containers/api/src/routes/images.js
    - containers/api/src/routes/auth.js
    - containers/api/src/routes/configs.js
    - containers/api/src/routes/sync.js
    - containers/api/src/routes/patchclass.js
    - containers/api/src/routes/system/kernel.js
    - containers/api/src/routes/system/grub-theme.js
    - containers/api/src/routes/internal.js
    - containers/api/src/middleware/auth.js
    - containers/api/src/middleware/audit.js
    - containers/api/src/index.js

key-decisions:
  - "Prisma-optional catches use console.debug with static sync-mode message (no err parameter needed)"
  - "File cleanup catches use console.debug (ENOENT during cleanup is normal, not warn-worthy)"
  - "GRUB host config deletion uses console.warn (service call failure is actionable)"
  - "Kernel background rebuild uses console.warn (fire-and-forget failure is notable)"
  - "internal.js Redis lookup uses once-flag _redisWarnLogged to prevent log spam"
  - "index.js startup/shutdown catches all use console.debug (expected-failure paths)"

patterns-established:
  - "Once-flag pattern: module-scoped let _xyzWarnLogged = false for suppressing repeated debug messages"
  - "Catch categorization: debug for expected failures, warn for notable but non-fatal, error for unexpected"

requirements-completed: [DEBT-01]

# Metrics
duration: 5min
completed: 2026-03-08
---

# Phase 05 Plan 02: Route/Middleware/Index Catch Block Cleanup Summary

**Categorized all 21 silent catch blocks in routes, middleware, and index.js with console.debug/warn logging, completing DEBT-01 zero-silent-catches goal**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T11:24:35Z
- **Completed:** 2026-03-08T11:30:02Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Replaced all silent catch blocks in routes/ (9 files), middleware/ (2 files), and index.js with categorized logging
- Prisma-optional requires (6 files) consistently use console.debug with "[Module] Prisma not available, running in sync mode"
- Implemented once-flag pattern (_redisWarnLogged) in internal.js to prevent log spam from repeated Redis fallback warnings
- Zero uncommented silent catches remain across the entire containers/api/src/ codebase

## Task Commits

Each task was committed atomically:

1. **Task 1: Categorize catches in Prisma-optional modules and route files** - `0dab889` (fix)
2. **Task 2: Categorize catches in index.js and internal.js with once-flag pattern** - `7ae6468` (fix)

## Files Created/Modified
- `containers/api/src/routes/images.js` - Prisma-optional debug catch
- `containers/api/src/routes/auth.js` - Prisma-optional debug catch
- `containers/api/src/routes/configs.js` - 4 catches: file cleanup debug, GRUB deletion warn
- `containers/api/src/routes/sync.js` - Settings check debug catch
- `containers/api/src/routes/patchclass.js` - Temp file cleanup debug catch
- `containers/api/src/routes/system/kernel.js` - Background rebuild warn catch
- `containers/api/src/routes/system/grub-theme.js` - Temp file cleanup debug catch
- `containers/api/src/routes/internal.js` - Once-flag Redis fallback + Prisma fallback debug catches
- `containers/api/src/middleware/auth.js` - Prisma-optional debug catch
- `containers/api/src/middleware/audit.js` - Prisma-optional debug catch
- `containers/api/src/index.js` - 6 catches: Prisma-optional debug, startup debug, shutdown debug

## Decisions Made
- Prisma-optional catches keep `catch {` without `(err)` parameter since they log static messages
- File cleanup catches use console.debug (ENOENT during cleanup is expected, not actionable)
- GRUB host config deletion elevated to console.warn (service call failure is actionable)
- Kernel background rebuild elevated to console.warn (fire-and-forget op failure needs attention)
- Once-flag pattern chosen for internal.js Redis lookup (can fire hundreds of times during boot storm)
- Prisma fallback catch in internal.js does NOT use once-flag (fires only when both Redis AND Prisma fail -- genuinely notable)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added Prisma-optional catch logging in index.js top-level require**
- **Found during:** Task 2
- **Issue:** index.js line 25 had a Prisma-optional `try { ... } catch {}` not listed in the plan's 5 catches
- **Fix:** Added `console.debug('[Startup] Prisma not available, running in sync mode')` to match pattern
- **Files modified:** containers/api/src/index.js
- **Verification:** grep confirms zero remaining silent catches
- **Committed in:** 7ae6468 (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added Prisma-optional catch logging in internal.js top-level require**
- **Found during:** Task 2
- **Issue:** internal.js line 9 had an inline Prisma-optional `catch { prisma = null; }` not explicitly listed
- **Fix:** Added `console.debug('[Internal] Prisma not available, running in sync mode')` to match pattern
- **Files modified:** containers/api/src/routes/internal.js
- **Verification:** grep confirms zero remaining silent catches
- **Committed in:** 7ae6468 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both auto-fixes necessary to achieve the stated goal of zero silent catches. The plan's count of 19 was slightly under-counted; actual total was 21. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DEBT-01 is complete: every catch block in the API codebase either logs meaningfully, rethrows, or has a WS broadcast comment
- Ready for Phase 06 (testing) which can now verify that error paths produce appropriate log output

---
*Phase: 05-error-handling-cleanup*
*Completed: 2026-03-08*

## Self-Check: PASSED

- All 11 modified files exist on disk
- Both task commits (0dab889, 7ae6468) found in git log
- Zero silent catches remain in containers/api/src/ (excluding commented WS broadcast catches)
