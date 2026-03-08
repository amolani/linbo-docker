# Phase 6: Isolated Debt Fixes - Research

**Researched:** 2026-03-08
**Domain:** Node.js worker sync-mode guard + Redis SCAN migration (ioredis)
**Confidence:** HIGH

## Summary

Phase 6 addresses two isolated, well-scoped debt fixes: (1) making `operation.worker.js` safe in sync mode by fully disabling it when Prisma is unavailable, and (2) replacing the blocking `KEYS` command in `redis.js:delPattern()` with SCAN-based iteration.

Both fixes are internal-only changes with no API surface modifications. The worker fix follows the Prisma-optional pattern already established in Phase 5 across 5 files (auth.js, audit.js, images.js, internal.js, index.js). The Redis SCAN migration uses ioredis 5.9.2's built-in `scanStream()` method, which handles cursor management internally. All 18 callers of `delPattern()` continue working identically -- the migration is purely internal to `redis.js`.

**Primary recommendation:** Implement as two independent tasks: (1) worker sync-mode guard with full disable + status enrichment, (2) delPattern SCAN migration using ioredis scanStream with pipeline-delete batches.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Worker is **fully disabled** in sync mode -- no polling loop runs
- startWorker() logs once at startup: `[OperationWorker] Disabled -- sync mode (no database)`
- stopWorker/pauseWorker/resumeWorker become silent no-ops
- getStatus() returns `{ running: false, disabled: true, reason: 'sync-mode' }`
- cancelOperation/retryOperation **throw** descriptive error: 'Operations not available in sync mode'
- All functions remain exported -- module interface stays stable for callers
- delPattern() signature stays identical -- migration is purely internal to redis.js
- All 15+ callers (hosts, images, configs, rooms routes + host.service) are unchanged
- SCAN with COUNT hint of 100, pipeline-delete each batch immediately (not collect-all-then-delete)
- No logging added -- return count of deleted keys (current behavior preserved)
- Brief header comment at top of worker: `// Prisma-optional: worker is disabled in sync mode (Redis-only)`

### Claude's Discretion
- Guard implementation location and detection mechanism (require result vs env var)
- SCAN iterator implementation details (node-redis scanIterator vs manual cursor loop)
- Pipeline batch size tuning if 100 proves suboptimal

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEBT-03 | operation.worker.js Prisma-optional Pattern anwenden (try/catch Guard statt top-level require) | Worker sync-mode guard pattern documented below; prisma.js always loads without error (confirmed), but all DB operations crash at runtime. Guard must intercept at module scope before any Prisma call. Five existing examples of Prisma-optional pattern in codebase (auth.js, audit.js, images.js, internal.js, index.js). |
| DEBT-04 | Redis KEYS-Command durch SCAN-basierte Iteration in delPattern() ersetzen | ioredis 5.9.2 provides `scanStream({ match, count })` returning a Node.js Readable. Pipeline-delete per batch. 18 callers all use simple namespace patterns (e.g., `hosts:*`). Drop-in replacement preserving return value (deleted count). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ioredis | 5.9.2 | Redis client (SCAN, pipeline, streams) | Already installed; provides scanStream() and pipeline() natively |
| @prisma/client | (existing) | Database ORM (sync-mode target) | Already used throughout; Prisma-optional pattern established |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jest | 29.7.0 | Unit testing | Test both worker disabled state and delPattern SCAN behavior |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| scanStream() | Manual SCAN cursor loop | scanStream handles cursor internally, less code, no bugs. Manual loop only needed for very custom iteration logic. Use scanStream. |
| pipeline() per batch | Individual DEL per key | Pipeline batches all DELs in one round-trip. Individual DELs = N round-trips. Use pipeline. |

## Architecture Patterns

### Pattern 1: Prisma-Optional Module Guard (Established)

**What:** Try/catch at module scope to optionally load Prisma, falling back to null when unavailable.
**When to use:** Any module that should work without a database in sync mode.
**Existing codebase examples:** 5 files already use this exact pattern.

```javascript
// Source: containers/api/src/middleware/auth.js (lines 11-17)
// Prisma is optional (not available in sync/DB-free mode)
let prisma = null;
try {
  prisma = require('../lib/prisma').prisma;
} catch {
  console.debug('[Auth] Prisma not available, running in sync mode');
}
```

**Key observation:** `prisma.js` currently always creates a PrismaClient (even in sync mode) -- it never throws on `require()`. The try/catch guard in callers catches the error that would happen if `@prisma/client` itself wasn't installed. In practice, sync mode is detected by the index.js top-level try/catch (lines 18-30), which sets `prisma = null`. The worker at line 6 does `const { prisma } = require('../lib/prisma');` -- this succeeds but returns a PrismaClient that has no database to connect to. The actual crash happens at runtime when `prisma.operation.findFirst()` fails.

**Recommended guard for worker:** Since prisma.js loads without error, the guard mechanism should detect sync mode the same way index.js does: check if `require('../lib/prisma').prisma` succeeds, but also check if the app is in sync mode. Given the existing pattern, use the try/catch + additional env check:

```javascript
// Prisma-optional: worker is disabled in sync mode (Redis-only)
let prisma = null;
let syncModeDisabled = false;
try {
  prisma = require('../lib/prisma').prisma;
} catch {
  console.debug('[OperationWorker] Prisma not available, running in sync mode');
  syncModeDisabled = true;
}
```

However, since prisma.js never throws, the more reliable pattern for the worker is to check the env var that controls sync mode, matching how index.js determines it:

```javascript
// Prisma-optional: worker is disabled in sync mode (Redis-only)
const isSyncMode = process.env.SYNC_ENABLED === 'true';
let prisma = null;
if (!isSyncMode) {
  try {
    prisma = require('../lib/prisma').prisma;
  } catch {
    // Prisma not available
  }
}
const syncModeDisabled = !prisma || isSyncMode;
```

**Recommendation (Claude's Discretion):** Use the same try/catch pattern as all other files for consistency, but combine with the SYNC_ENABLED env check. If prisma loads but SYNC_ENABLED=true, treat as disabled. This handles both scenarios: (a) prisma module missing, (b) prisma available but no database.

### Pattern 2: Worker Full Disable Pattern (New, Derived from Context)

**What:** When sync mode is detected, all worker functions become no-ops or throw, with enriched getStatus().
**When to use:** The operation worker specifically.

```javascript
// At module scope, after sync-mode detection
if (syncModeDisabled) {
  module.exports = {
    startWorker: () => {
      console.debug('[OperationWorker] Disabled -- sync mode (no database)');
    },
    stopWorker: () => {},
    pauseWorker: () => {},
    resumeWorker: () => {},
    getStatus: () => ({
      running: false,
      disabled: true,
      reason: 'sync-mode',
    }),
    cancelOperation: () => {
      throw new Error('Operations not available in sync mode');
    },
    retryOperation: () => {
      throw new Error('Operations not available in sync mode');
    },
  };
  return; // Early exit -- rest of file is standalone-only
}
```

**Note:** `return` at module scope is valid in Node.js CommonJS modules. This is the cleanest pattern -- it avoids wrapping the entire file in an if-block.

### Pattern 3: ioredis scanStream + Pipeline Delete

**What:** Replace `KEYS` with `scanStream()` for non-blocking iteration, then batch-delete via `pipeline()`.
**When to use:** Any pattern-based key deletion in Redis.

```javascript
// Source: ioredis docs -- scanStream API
async function delPattern(pattern) {
  const client = getClient();
  let deleted = 0;

  return new Promise((resolve, reject) => {
    const stream = client.scanStream({ match: pattern, count: 100 });

    stream.on('data', (keys) => {
      if (keys.length === 0) return;

      const pipeline = client.pipeline();
      keys.forEach((key) => pipeline.del(key));
      pipeline.exec().then(() => {
        deleted += keys.length;
      }).catch(reject);
    });

    stream.on('end', () => resolve(deleted));
    stream.on('error', reject);
  });
}
```

**Important nuances:**
- `scanStream` emits `data` events with arrays of keys (batch size approximately `count`)
- `count` is a hint, not a guarantee -- Redis may return more or fewer keys per iteration
- Pipeline-delete per batch: each `data` event triggers an immediate pipeline DEL, not collect-all-then-delete
- Return value is total deleted count (matching current behavior)

### Anti-Patterns to Avoid
- **Wrapping entire worker file in if/else:** Use early `return` at module scope instead -- cleaner, avoids deep nesting
- **Checking `prisma` inside every function:** The user decision is "fully disabled" -- handle at module scope, not per-function
- **Using KEYS in any form:** The Redis `KEYS` command scans the entire keyspace in O(N) blocking fashion. Even `KEYS prefix:*` locks Redis for the duration. Always use SCAN.
- **Collecting all SCAN results then deleting:** Defeats the purpose of incremental iteration. Delete each batch as it arrives.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redis cursor iteration | Manual SCAN cursor loop with `while cursor !== '0'` | `ioredis.scanStream({ match, count })` | scanStream handles cursor state, backpressure, and error propagation internally |
| Batch Redis commands | Sequential `await client.del(key)` in a loop | `client.pipeline().del(k1).del(k2).exec()` | Pipeline sends all commands in one round-trip, vastly more efficient |

**Key insight:** ioredis 5.x has first-class SCAN support via scanStream. There is zero reason to manage cursors manually.

## Common Pitfalls

### Pitfall 1: prisma.js Never Throws on Require
**What goes wrong:** Developers assume the try/catch guard around `require('../lib/prisma')` will catch sync-mode scenarios. It won't -- prisma.js always creates a PrismaClient successfully, even without a database.
**Why it happens:** PrismaClient instantiation doesn't connect to the database -- it's lazy. The crash only happens at the first query.
**How to avoid:** Combine the try/catch with `SYNC_ENABLED` env var check, or check if prisma is null (set by index.js top-level guard).
**Warning signs:** Worker starts without error but crashes on first poll cycle with a database connection error.

### Pitfall 2: scanStream Data Events Can Be Empty
**What goes wrong:** Not checking for empty arrays in `data` event handler leads to creating empty pipelines.
**Why it happens:** Redis SCAN can return 0 keys in some iterations while still having more to scan.
**How to avoid:** Guard with `if (keys.length === 0) return;` in the data handler.
**Warning signs:** Empty pipeline executions (harmless but wasteful).

### Pitfall 3: scanStream Pipeline Race Condition
**What goes wrong:** If `pipeline.exec()` rejects, the `end` event may fire before the error is handled.
**Why it happens:** Stream events and promises are independent control flows.
**How to avoid:** Track in-flight pipeline promises. Use `stream.pause()` if needed, or accumulate errors. For this use case (cache invalidation), a simpler approach works: catch pipeline errors and continue, since partial deletion is acceptable for cache cleanup.
**Warning signs:** Unhandled promise rejections during bulk deletion.

### Pitfall 4: Worker Route Must Handle Disabled State
**What goes wrong:** `routes/system/worker.js` calls `pauseWorker()` and `resumeWorker()` -- these become no-ops, but the response should indicate the worker is disabled.
**Why it happens:** Route handlers call `getStatus()` after pause/resume to return current state. If getStatus returns `{ disabled: true }`, the route response naturally includes this.
**How to avoid:** The enriched `getStatus()` response handles this automatically -- no route changes needed.
**Warning signs:** Route returns `{ running: false, disabled: true }` which is correct behavior.

### Pitfall 5: Module-Level return in CommonJS
**What goes wrong:** Using `return` at module scope might look unusual and trigger linting warnings.
**Why it happens:** While valid in Node.js CommonJS (modules are wrapped in a function), not all linters know this.
**How to avoid:** Add an eslint-disable comment if needed, or use the alternative pattern of assigning to module.exports and skipping the rest via conditional.
**Warning signs:** ESLint `no-unreachable` or similar warnings.

## Code Examples

### Worker Sync-Mode Guard (Complete)

```javascript
// Source: Derived from established patterns in auth.js, audit.js, images.js, internal.js, index.js
// containers/api/src/workers/operation.worker.js

// Prisma-optional: worker is disabled in sync mode (Redis-only)
let prisma = null;
try {
  prisma = require('../lib/prisma').prisma;
} catch {
  // Prisma not available
}

// In sync mode (SYNC_ENABLED=true or no Prisma), disable the worker entirely
if (!prisma || process.env.SYNC_ENABLED === 'true') {
  module.exports = {
    startWorker() {
      console.debug('[OperationWorker] Disabled -- sync mode (no database)');
    },
    stopWorker() {},
    pauseWorker() {},
    resumeWorker() {},
    getStatus() {
      return { running: false, disabled: true, reason: 'sync-mode' };
    },
    cancelOperation() {
      throw new Error('Operations not available in sync mode');
    },
    retryOperation() {
      throw new Error('Operations not available in sync mode');
    },
  };
  return;
}

// ... rest of existing worker code (unchanged) ...
```

### delPattern SCAN Migration (Complete)

```javascript
// Source: ioredis 5.x scanStream API
// containers/api/src/lib/redis.js -- replace existing delPattern

/**
 * Delete all keys matching pattern using SCAN (non-blocking)
 * @param {string} pattern - Key pattern (e.g., "hosts:*")
 * @returns {Promise<number>} Number of deleted keys
 */
async function delPattern(pattern) {
  const client = getClient();
  let deleted = 0;

  return new Promise((resolve, reject) => {
    const stream = client.scanStream({ match: pattern, count: 100 });

    stream.on('data', (keys) => {
      if (keys.length === 0) return;

      // Pause stream while deleting to avoid backpressure issues
      stream.pause();
      const pipeline = client.pipeline();
      keys.forEach((key) => pipeline.del(key));
      pipeline.exec()
        .then((results) => {
          // Each result is [err, reply]; count successful deletions
          for (const [err, reply] of results) {
            if (!err) deleted += reply;
          }
          stream.resume();
        })
        .catch((err) => {
          stream.destroy();
          reject(err);
        });
    });

    stream.on('end', () => resolve(deleted));
    stream.on('error', reject);
  });
}
```

**Note on deleted count accuracy:** The current KEYS-based implementation returns `keys.length` (number of keys found), while the SCAN + pipeline approach above counts actual DEL replies (1 if key existed, 0 if it didn't). For cache invalidation, this difference is negligible. If exact parity with the old behavior is desired, sum `keys.length` instead of pipeline results. However, the pipeline result count is more accurate.

**Simpler alternative (counting keys found, matching old behavior):**

```javascript
async function delPattern(pattern) {
  const client = getClient();
  let deleted = 0;

  return new Promise((resolve, reject) => {
    const stream = client.scanStream({ match: pattern, count: 100 });

    stream.on('data', (keys) => {
      if (keys.length === 0) return;
      deleted += keys.length;
      stream.pause();
      client.pipeline(keys.map((k) => ['del', k])).exec()
        .then(() => stream.resume())
        .catch((err) => { stream.destroy(); reject(err); });
    });

    stream.on('end', () => resolve(deleted));
    stream.on('error', reject);
  });
}
```

### Test Pattern: Worker Disabled State

```javascript
// Test that worker is disabled in sync mode
describe('operation.worker (sync mode)', () => {
  beforeAll(() => {
    process.env.SYNC_ENABLED = 'true';
    // Re-require to get sync-mode module
    jest.resetModules();
  });

  afterAll(() => {
    delete process.env.SYNC_ENABLED;
    jest.resetModules();
  });

  test('startWorker logs disabled message', () => {
    const worker = require('../../src/workers/operation.worker');
    worker.startWorker();
    // console.debug is mocked in setup.js
  });

  test('getStatus returns disabled state', () => {
    const worker = require('../../src/workers/operation.worker');
    expect(worker.getStatus()).toEqual({
      running: false,
      disabled: true,
      reason: 'sync-mode',
    });
  });

  test('cancelOperation throws', () => {
    const worker = require('../../src/workers/operation.worker');
    expect(() => worker.cancelOperation('any-id'))
      .toThrow('Operations not available in sync mode');
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Redis KEYS command | SCAN/scanStream | Redis 2.8+ (2013) | KEYS blocks Redis server; SCAN is incremental and non-blocking |
| Top-level require crash | Prisma-optional try/catch guard | Phase 5 (2026-03-08) | Established pattern across 5 files; worker is the only remaining unguarded module |

**Deprecated/outdated:**
- `Redis KEYS` command: Should never be used in production. The Redis docs themselves warn: "Don't use KEYS in your regular application code."

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `containers/api/jest.config.js` |
| Quick run command | `cd containers/api && npx jest --testPathPattern="<pattern>" --no-coverage` |
| Full suite command | `cd containers/api && npx jest --no-coverage` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEBT-03a | startWorker logs disabled message in sync mode | unit | `cd containers/api && npx jest tests/workers/operation.worker.test.js -x --no-coverage` | Wave 0 |
| DEBT-03b | getStatus returns `{ disabled: true, reason: 'sync-mode' }` | unit | same file | Wave 0 |
| DEBT-03c | cancelOperation/retryOperation throw in sync mode | unit | same file | Wave 0 |
| DEBT-03d | stop/pause/resume are silent no-ops | unit | same file | Wave 0 |
| DEBT-04a | delPattern uses SCAN instead of KEYS | unit | `cd containers/api && npx jest tests/lib/redis.test.js -x --no-coverage` | Wave 0 |
| DEBT-04b | delPattern returns correct deleted count | unit | same file | Wave 0 |
| DEBT-04c | delPattern handles empty result sets | unit | same file | Wave 0 |
| DEBT-04d | All 18 callers unchanged (integration) | manual-only | Visual inspection -- all callers use identical `await redis.delPattern('prefix:*')` signature | N/A |

### Sampling Rate
- **Per task commit:** `cd containers/api && npx jest --testPathPattern="(operation.worker|redis)" --no-coverage`
- **Per wave merge:** `cd containers/api && npx jest --no-coverage`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `containers/api/tests/workers/operation.worker.test.js` -- covers DEBT-03 (sync-mode disabled state)
- [ ] `containers/api/tests/lib/redis.test.js` -- covers DEBT-04 (SCAN-based delPattern)

## Open Questions

1. **Pipeline error semantics for cache invalidation**
   - What we know: delPattern is used exclusively for cache invalidation (clearing prefixed keys after mutations). Partial failure is acceptable -- the next request repopulates cache.
   - What's unclear: Whether pipeline.exec() errors should be swallowed or propagated.
   - Recommendation: Propagate errors (reject the promise). Cache invalidation failure is unexpected and should surface as an error to the caller. The current KEYS-based approach also propagates errors.

2. **SYNC_ENABLED detection vs prisma null check**
   - What we know: prisma.js always creates a PrismaClient, so `require('../lib/prisma')` never throws. Sync mode is detected by `SYNC_ENABLED=true` env var or Redis `sync_enabled` setting.
   - What's unclear: Whether to check only env var, or also check if prisma can connect. Index.js uses a top-level try/catch that catches the `require('@prisma/client')` failure when the package is missing entirely.
   - Recommendation: Use both guards: try/catch for package-missing scenario + SYNC_ENABLED env check for configured sync mode. This matches the defensive pattern used in index.js and is future-proof.

## Sources

### Primary (HIGH confidence)
- `containers/api/src/workers/operation.worker.js` -- full source read, 437 lines, all Prisma calls identified
- `containers/api/src/lib/redis.js` -- full source read, delPattern at line 138, uses KEYS command
- `containers/api/src/lib/prisma.js` -- full source read, always creates PrismaClient (no sync-mode awareness)
- `containers/api/src/index.js` -- startup sequence, worker invocation at line 568-575
- `containers/api/src/routes/system/worker.js` -- route consumer, 3 endpoints, calls getStatus/pauseWorker/resumeWorker
- ioredis 5.9.2 installed -- `scanStream`, `scan`, `pipeline` methods confirmed available via runtime check
- 5 existing Prisma-optional patterns: auth.js, audit.js, images.js, internal.js, index.js
- 18 delPattern callers: all use `await redis.delPattern('prefix:*')` signature

### Secondary (MEDIUM confidence)
- ioredis scanStream API behavior: confirmed via runtime test that it returns ScanStream (Node.js Readable)
- CommonJS module-level `return` validity: standard Node.js behavior, modules wrapped in function

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- ioredis already installed, version confirmed, API methods verified at runtime
- Architecture: HIGH -- Prisma-optional pattern established in 5 files, worker structure fully understood
- Pitfalls: HIGH -- all identified through direct code analysis, not speculation

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable, no moving targets)
