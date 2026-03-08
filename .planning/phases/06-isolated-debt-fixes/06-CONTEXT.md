# Phase 6: Isolated Debt Fixes - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Apply Prisma-optional guard to operation.worker.js so it runs without error in sync mode (Redis-only), and replace the blocking Redis KEYS command with SCAN-based iteration in delPattern(). Two isolated debt fixes — no new features, no behavioral changes for standalone mode.

</domain>

<decisions>
## Implementation Decisions

### Worker sync-mode behavior
- Worker is **fully disabled** in sync mode — no polling loop runs
- startWorker() logs once at startup: `[OperationWorker] Disabled — sync mode (no database)`
- stopWorker/pauseWorker/resumeWorker become silent no-ops
- getStatus() returns `{ running: false, disabled: true, reason: 'sync-mode' }`
- cancelOperation/retryOperation **throw** descriptive error: 'Operations not available in sync mode'
- All functions remain exported — module interface stays stable for callers

### Redis SCAN migration
- delPattern() signature stays identical — migration is purely internal to redis.js
- All 15+ callers (hosts, images, configs, rooms routes + host.service) are unchanged
- SCAN with COUNT hint of 100, pipeline-delete each batch immediately (not collect-all-then-delete)
- No logging added — return count of deleted keys (current behavior preserved)

### Guard pattern consistency
- Brief header comment at top of worker: `// Prisma-optional: worker is disabled in sync mode (Redis-only)`
- Claude's Discretion: guard location (top of worker file vs prisma.js) and sync-mode detection mechanism (require result vs env var) — Claude picks based on existing codebase patterns

### Claude's Discretion
- Guard implementation location and detection mechanism
- SCAN iterator implementation details (node-redis scanIterator vs manual cursor loop)
- Pipeline batch size tuning if 100 proves suboptimal

</decisions>

<specifics>
## Specific Ideas

- Worker disabled state should be distinguishable from "stopped" in getStatus() — callers need to know it's sync-mode, not just off
- Phase 5 established `console.debug` for Prisma-optional catches — follow same log level pattern for worker startup message

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `containers/api/src/lib/prisma.js`: Shared Prisma client singleton — always creates PrismaClient, no sync-mode awareness
- `containers/api/src/lib/redis.js`: delPattern() at line 138 — the single function to migrate from KEYS to SCAN
- Prisma-optional pattern in `routes/images.js` line 40-44: `let prisma = null; try { prisma = require(...); } catch {}`

### Established Patterns
- Phase 5 Prisma-optional catches: `console.debug` with static sync-mode message
- `_testing` export pattern (Phase 2) for unit test access to internal functions
- Worker route in `routes/system/worker.js` calls startWorker/stopWorker/getStatus — must handle disabled state gracefully

### Integration Points
- `routes/system/worker.js` — consumes worker exports, needs to handle disabled status in responses
- `index.js` startup — calls `startWorker()` during server boot
- 15+ route/service files call `redis.delPattern()` — all must continue working identically

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-isolated-debt-fixes*
*Context gathered: 2026-03-08*
