# Phase 5: Error Handling Cleanup - Research

**Researched:** 2026-03-08
**Domain:** Node.js error handling, console logging, catch block categorization
**Confidence:** HIGH

## Summary

Phase 5 addresses DEBT-01: replacing all 48 silent catch blocks across the API codebase with categorized logging. The codebase contains 31 `catch {}` blocks and 17 `.catch(() => {})` inline patterns spread across 20 files. These fall into well-defined categories: Prisma-optional requires (5), file cleanup operations (12), WebSocket broadcasts (7), Redis operations (4), service call fire-and-forget (6), startup/shutdown guards (6), and data-fetch fallbacks (8).

The project already uses `console.log/warn/error` with `[ServiceName]` tag prefixes throughout 200+ log lines. The `console.debug` method is not yet used anywhere in production code, making this phase the introduction point. Tests already suppress `console.debug` via `tests/setup.js`, so new debug logs will not pollute test output.

The changes are purely observability improvements -- no behavioral changes, no new dependencies, no refactoring of catch patterns. Inline `.catch(() => {})` stays inline; `catch {}` stays as try/catch. Only the body changes.

**Primary recommendation:** Work file-by-file through the 20 affected files, applying the categorization heuristic from CONTEXT.md decisions. Verify each file individually -- the scope is small enough for a single plan with 2-3 waves.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **File operations** (unlink, rmdir, mkdir): `console.debug` level -- failure is harmless, file may already be gone
- **Service call failures** (GRUB generation, WS broadcasts, Redis writes in `.catch(() => {})`): `console.warn` level -- indicates degraded functionality
- **Fire-and-forget background ops** (async IIFE like kernel rebuild): `console.warn` on failure -- the API returned success, log is the only signal
- **Prerequisite mkdir** with `{ recursive: true }`: `console.debug` -- subsequent operations will fail with a proper error if dir is missing
- **Keep inline `.catch()`** pattern -- change `.catch(() => {})` to `.catch(err => console.debug(...))`. No refactor to try/catch blocks. Minimal diff.
- **Include error reason** in debug logs: `console.debug('[Service] cleanup: unlink failed:', err.message)`
- **Prisma top-level `require` catches**: add `console.debug('[Module] Prisma not available, running in sync mode')`
- **Runtime Prisma guards**: use **per-module once-flag** pattern -- `let prismaWarnLogged = false; if (!prismaWarnLogged) { console.debug(...); prismaWarnLogged = true; }`
- **Startup health checks**: `console.debug` (expected in sync mode)
- **Migration failures**: `console.warn` (real problem in standalone mode)
- **Zero-client WS broadcasts**: no log at all -- broadcasting to nobody is normal operation. Keep `.catch(() => {})` with a comment: `// WS broadcast: no clients is normal`
- **Both modes clean**: neither sync mode nor standalone mode should produce warn/error during normal startup and idle operation
- **Log format**: `console.debug/warn('[ServiceName] context:', err.message)` -- match existing pattern
- **Use `console.debug`** (not `console.log` with `[DEBUG]` tag)
- **`err.message` preferred** over `err.code`
- **Route catch tags**: use route domain name matching sub-router files from Phase 4: `[Patchclass]`, `[Configs]`, `[GrubTheme]`, `[Kernel]`, etc.

### Claude's Discretion
- Exact categorization of each individual catch block (debug vs warn vs rethrow) within the guidelines above
- Whether WS broadcast catches need the explanatory comment or if the pattern is self-evident
- Ordering of changes across files (by service, by severity, or alphabetically)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEBT-01 | Alle 31 silent catch-blocks durch kategorisiertes Logging ersetzen (debug/warn/rethrow) | Full inventory of 48 silent catches (31 `catch {}` + 17 `.catch(() => {})`) across 20 files with categorization heuristic |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js console | built-in | Logging (debug/warn/error) | Already used throughout, no external logger needed |

### Supporting
No additional libraries needed. This phase uses only built-in `console.debug` and `console.warn`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| console.debug | winston/pino | Overkill for this phase; console.debug maps cleanly to a future logger. User decision: no format migration. |

**Installation:**
No new packages required.

## Architecture Patterns

### Categorization Heuristic (Decision Tree)

```
Is the catch around a Prisma require()?
  YES → console.debug('[Module] Prisma not available, running in sync mode')

Is it a runtime Prisma call in a hot path?
  YES → once-flag pattern: log debug ONCE per module, then silent

Is it a file cleanup (unlink/rmdir/mkdir)?
  YES → console.debug('[Service] cleanup: operation failed:', err.message)

Is it a WS broadcast?
  YES → comment only: // WS broadcast: no clients is normal
  (Exception: if the broadcast MECHANISM throws, that is a warn)

Is it a mkdir { recursive: true } prerequisite?
  YES → console.debug (next op will fail properly if dir missing)

Is it a Redis write in a .catch(() => {})?
  YES → console.warn('[Service] Redis write failed:', err.message)

Is it a fire-and-forget background op (async IIFE)?
  YES → console.warn('[Service] background op failed:', err.message)

Is it a service call (GRUB generation, etc.)?
  YES → console.warn('[Service] call failed:', err.message)

Is it a startup health check?
  YES → console.debug (expected to fail in some modes)

Is it a data-fetch fallback (Redis then Prisma)?
  YES → console.debug (fallback will handle it)
```

### Pattern 1: Simple debug replacement (file cleanup)
**What:** Replace empty catch body with debug log
**When to use:** File operations where failure is expected/harmless

```javascript
// BEFORE
await fs.unlink(filePath).catch(() => {});

// AFTER
await fs.unlink(filePath).catch(err => console.debug('[Patchclass] cleanup: unlink failed:', err.message));
```

### Pattern 2: Simple debug replacement (try/catch block)
**What:** Add debug log to empty catch block
**When to use:** Operations where failure is expected

```javascript
// BEFORE
try { await fs.unlink(link); } catch {}

// AFTER
try { await fs.unlink(link); } catch (err) { console.debug('[LinboUpdate] cleanup: unlink failed:', err.message); }
```

### Pattern 3: Prisma-optional require
**What:** Debug log for Prisma module load failure
**When to use:** Top-level `try { prisma = require(...) } catch {}` patterns

```javascript
// BEFORE
try {
  prisma = require('../lib/prisma').prisma;
} catch {}

// AFTER
try {
  prisma = require('../lib/prisma').prisma;
} catch {
  console.debug('[Images] Prisma not available, running in sync mode');
}
```

### Pattern 4: Prisma runtime once-flag
**What:** Log Prisma unavailability once per module, not per call
**When to use:** Runtime Prisma calls in hot paths (e.g., findHostByIp in internal.js)

```javascript
// BEFORE
try {
  // Redis lookup
} catch {}
// Fallback to Prisma
if (prisma) {
  try { ... } catch {}
}

// AFTER
let _redisWarnLogged = false;
try {
  // Redis lookup
} catch (err) {
  if (!_redisWarnLogged) { console.debug('[Internal] Redis host lookup failed, using Prisma fallback:', err.message); _redisWarnLogged = true; }
}
```

### Pattern 5: WS broadcast (comment-only)
**What:** Keep `.catch(() => {})` but add explanatory comment
**When to use:** WebSocket broadcast calls where no connected clients is normal

```javascript
// BEFORE
try { ws.broadcast('sync.started', { timestamp: new Date().toISOString() }); } catch {}

// AFTER
try { ws.broadcast('sync.started', { timestamp: new Date().toISOString() }); } catch {} // WS broadcast: no clients is normal
```

### Pattern 6: Service call warn
**What:** Upgrade to console.warn for degraded functionality
**When to use:** GRUB generation, Redis writes, background ops

```javascript
// BEFORE
await grubService.generateConfigGrubConfig(config.name).catch(() => {});

// AFTER
await grubService.generateConfigGrubConfig(config.name).catch(err => console.warn('[DeviceImport] GRUB config generation failed:', err.message));
```

### Pattern 7: Fire-and-forget background op
**What:** Add warn logging to async IIFE catch
**When to use:** Background operations where API already returned success

```javascript
// BEFORE
(async () => {
  // kernel rebuild
})().catch(() => {});

// AFTER
(async () => {
  // kernel rebuild
})().catch(err => console.warn('[Kernel] background rebuild failed:', err.message));
```

### Anti-Patterns to Avoid
- **Over-logging WS broadcasts:** Do NOT add console.warn to WS broadcast catches -- zero clients is normal, not an error
- **console.log for debug-level:** Use console.debug, not console.log with `[DEBUG]` prefix
- **err.stack in debug logs:** Use err.message only -- stack traces are noise for expected failures
- **Refactoring inline to try/catch:** Keep `.catch()` inline, do not convert to try/catch blocks

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Log level filtering | Custom log filtering | console.debug (native) | Node.js respects --no-debug flag; future logger migration trivial |
| Once-flag per module | Global singleton tracker | Module-scoped `let warnLogged = false` | Simple, no abstraction needed for 2-3 uses |

**Key insight:** This phase is explicitly NOT a logging infrastructure phase. It is a catch-block cleanup. No logging library, no log format migration, no abstraction layers.

## Common Pitfalls

### Pitfall 1: Creating noise in sync mode startup
**What goes wrong:** Adding console.warn to Prisma-optional catches triggers warnings every time sync mode starts
**Why it happens:** Prisma not being available IS the expected state in sync mode
**How to avoid:** Use console.debug for Prisma-optional catches, never console.warn
**Warning signs:** Startup output showing "[Module] Prisma not available" at warn level

### Pitfall 2: WS broadcast logging flooding
**What goes wrong:** Adding console.debug to every WS broadcast catch generates a log line per broadcast per operation
**Why it happens:** Broadcasts fire frequently (sync progress, download progress) and having zero WS clients is the common idle state
**How to avoid:** User decision: keep `.catch(() => {})` with comment for WS broadcasts. Only log if broadcast mechanism itself throws.
**Warning signs:** Logs full of "[Sync] broadcast failed" lines during normal sync operations

### Pitfall 3: Missing the catch parameter
**What goes wrong:** Writing `} catch { console.debug(...) }` without the `(err)` parameter
**Why it happens:** The existing `catch {}` syntax omits the parameter, easy to add logging but forget to capture err
**How to avoid:** Every catch that logs `err.message` must have `catch (err)` or `.catch(err => ...)`
**Warning signs:** `ReferenceError: err is not defined` at runtime

### Pitfall 4: Breaking test output
**What goes wrong:** New console.warn calls appear in test output
**Why it happens:** tests/setup.js suppresses log/debug/info but NOT warn/error
**How to avoid:** Only categorize as warn when it truly indicates degraded state, not expected failures. Most catches should be debug.
**Warning signs:** Test output suddenly showing warn lines from services being tested

### Pitfall 5: Startup/shutdown catch blocks used for flow control
**What goes wrong:** Adding warn logging to catches that are used for conditional flow (e.g., check-if-exists via try/catch)
**Why it happens:** Some catches intentionally suppress errors as part of "check-then-act" logic
**How to avoid:** Understand the control flow -- index.js line 593 catches settings service failure to determine sync mode (debug, not warn). index.js line 737 catches terminal service destroyAll during shutdown (debug -- service may not be loaded).
**Warning signs:** Startup or shutdown logs showing warnings for normal conditions

## Code Examples

### Complete inventory of all 48 silent catch blocks by category

#### Category A: Prisma-optional requires (5 blocks) -- console.debug, static message
| File | Line | Context |
|------|------|---------|
| routes/images.js | 19 | `try { prisma = require(...) } catch {}` |
| routes/auth.js | 17 | `try { prisma = require(...) } catch {}` |
| middleware/auth.js | 15 | `try { prisma = require(...) } catch {}` |
| middleware/audit.js | 10 | `try { prisma = require(...) } catch {}` |
| index.js | 593 | `try { settingsService.get('sync_enabled') } catch {}` (settings service may not connect) |

#### Category B: File cleanup operations (12 blocks) -- console.debug
| File | Line | Context |
|------|------|---------|
| linbo-update.service.js | 375 | `fs.unlink(debPath).catch(() => {})` (cleanup after SHA mismatch) |
| linbo-update.service.js | 379 | `fs.unlink(debPath).catch(() => {})` (cleanup after size mismatch) |
| linbo-update.service.js | 480 | `try { await fs.unlink(link); } catch {}` (remove symlink before recreate) |
| linbo-update.service.js | 488 | `try { await fs.unlink(iconsLink); } catch {}` (remove symlink before recreate) |
| linbo-update.service.js | 602 | `} catch {}` (unlink/rm currentLink before symlink) |
| configs.js | 408 | `fsPromises.unlink(startConfPath).catch(() => {})` |
| configs.js | 409 | `fsPromises.unlink(md5Path).catch(() => {})` |
| configs.js | 424 | `fsPromises.unlink(ipLink).catch(() => {})` |
| image-sync.service.js | 451 | `fsp.unlink(partPath).catch(() => {})` (restart download) |
| patchclass.js | 37 | `fs.unlink(filePath).catch(() => {})` (cleanupTemp) |
| grub-theme.js | 28 | `fs.unlink(filePath).catch(() => {})` (cleanupTemp) |
| index.js | 678 | `sanityFs.unlinkSync(runningMarker) catch {}` |

#### Category C: File operation guards in index.js (3 blocks) -- console.debug
| File | Line | Context |
|------|------|---------|
| index.js | 681 | `sanityFs.renameSync(runningMarker, rebuildMarker) catch {}` (restore marker on failure) |
| index.js | 685 | `sanityFs.renameSync(runningMarker, rebuildMarker) catch {}` (restore marker on error) |
| index.js | 737 | `termService.destroyAll() catch {}` (shutdown cleanup) |

#### Category D: WebSocket broadcasts (7 blocks) -- comment only, keep silent
| File | Line | Context |
|------|------|---------|
| sync.service.js | 59 | `ws.broadcast('sync.started', ...)` |
| sync.service.js | 101 | `ws.broadcast('sync.progress', ...)` |
| sync.service.js | 168 | `ws.broadcast('sync.progress', ...)` |
| sync.service.js | 259 | `ws.broadcast('sync.completed', ...)` |
| sync.service.js | 266 | `ws.broadcast('sync.failed', ...)` |
| settings.service.js | 138 | `ws.broadcast('settings.changed', ...)` |
| settings.service.js | 158 | `ws.broadcast('settings.changed', ...)` |

#### Category E: Redis/infrastructure operations (4 blocks) -- console.debug (transient) or console.warn (persistent)
| File | Line | Context | Level |
|------|------|---------|-------|
| linbo-update.service.js | 72 | Redis heartbeat expire | debug (fire-and-forget heartbeat) |
| linbo-update.service.js | 86 | Redis lock release | debug (best-effort cleanup, lock has TTL) |
| sync.service.js | 481 | LMN API health check | debug (health check, expected to fail if LMN API down) |
| sync.js route | 42 | Settings service sync_enabled check | debug (settings may not be available) |

#### Category F: Service call fire-and-forget (6 blocks) -- console.warn
| File | Line | Context |
|------|------|---------|
| linbo-update.service.js | 362 | WS progress broadcast during download | debug (WS broadcast, same as Category D) |
| deviceImport.service.js | 567 | GRUB config generation | warn |
| deviceImport.service.js | 573 | Host GRUB config generation | warn |
| configs.js | 429 | GRUB host config deletion | warn |
| remote.service.js | 548 | SSH gui_ctl restore after command | warn |
| kernel.js | 129 | Async IIFE kernel rebuild background op | warn |

#### Category G: Data fetch fallbacks (3 blocks) -- console.debug
| File | Line | Context |
|------|------|---------|
| internal.js | 754 | Redis host lookup in findHostByIp | debug (Prisma fallback follows) |
| internal.js | 771 | Prisma host lookup fallback | debug (returns null on both failures) |
| linbo-update.service.js | 613 | Old set cleanup readdir | debug (non-critical cleanup) |

#### Category H: Network/data parsing (3 blocks) -- console.debug
| File | Line | Context |
|------|------|---------|
| linbo-update.service.js | 205 | Gzip body decompression (fallback to plain follows) |
| linbo-update.service.js | 250 | Read installed version file (continues with "unknown") |
| terminal.service.js | 29 | Fallback SSH key read (already logged warn on line 28) |

#### Category I: Stream/connection cleanup (2 blocks) -- console.debug
| File | Line | Context |
|------|------|---------|
| terminal.service.js | 197 | `session.stream.end()` during destroy |
| terminal.service.js | 198 | `session.client.end()` during destroy |

#### Category J: Progress broadcast via Redis (2 blocks) -- console.debug
| File | Line | Context |
|------|------|---------|
| image-sync.service.js | 496 | WS broadcast download progress | debug (same as Category D) |
| image-sync.service.js | 503 | Redis set download progress | debug (best-effort progress tracking) |

#### Category K: Mkdir prerequisite (1 block) -- console.debug
| File | Line | Context |
|------|------|---------|
| sync-operations.service.js | 537 | `fs.mkdir(LINBOCMD_DIR, { recursive: true }).catch(() => {})` |

### Summary by file (for planning task ordering)

| File | Silent catches | Category mix |
|------|---------------|--------------|
| linbo-update.service.js | 11 (8 catch{} + 3 .catch) | B, E, H, J |
| sync.service.js | 6 (all catch{}) | D, E |
| index.js | 5 (all catch{}) | A, B, C |
| configs.js | 4 (all .catch) | B, F |
| image-sync.service.js | 3 (all .catch) | B, D, J |
| terminal.service.js | 3 (all catch{}) | H, I |
| settings.service.js | 2 (all catch{}) | D |
| internal.js | 2 (all catch{}) | G |
| deviceImport.service.js | 2 (all .catch) | F |
| routes/images.js | 1 (catch{}) | A |
| routes/auth.js | 1 (catch{}) | A |
| middleware/auth.js | 1 (catch{}) | A |
| middleware/audit.js | 1 (catch{}) | A |
| routes/sync.js | 1 (catch{}) | E |
| sync-operations.service.js | 1 (.catch) | K |
| remote.service.js | 1 (.catch) | F |
| routes/system/kernel.js | 1 (.catch) | F |
| routes/system/grub-theme.js | 1 (.catch) | B |
| routes/patchclass.js | 1 (.catch) | B |

### Service name tags (matching Phase 4 sub-routers)

| File | Tag |
|------|-----|
| linbo-update.service.js | `[LinboUpdate]` |
| sync.service.js | `[Sync]` |
| index.js | `[Startup]` or `[AutoRebuild]` or `[Shutdown]` |
| configs.js | `[Configs]` |
| image-sync.service.js | `[ImageSync]` |
| terminal.service.js | `[Terminal]` |
| settings.service.js | `[Settings]` |
| internal.js | `[Internal]` |
| deviceImport.service.js | `[DeviceImport]` |
| routes/images.js | `[Images]` |
| routes/auth.js | `[Auth]` |
| middleware/auth.js | `[Auth]` |
| middleware/audit.js | `[Audit]` |
| routes/sync.js | `[Sync]` |
| sync-operations.service.js | `[SyncOps]` |
| remote.service.js | `[Remote]` |
| routes/system/kernel.js | `[Kernel]` |
| routes/system/grub-theme.js | `[GrubTheme]` |
| routes/patchclass.js | `[Patchclass]` |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Silent catches everywhere | Categorized debug/warn logging | This phase | Observability without noise |
| No console.debug usage | console.debug for expected failures | This phase | Clean semantic mapping if logger added later |

**Note:** `console.debug` is new to this codebase. It is currently not used anywhere in `containers/api/src/`. The tests/setup.js already suppresses it (`debug: jest.fn()`), so introduction is safe.

## Open Questions

1. **linbo-update.service.js line 362 -- WS or Redis progress?**
   - What we know: It calls `setStatus()` which writes to Redis and broadcasts via WS
   - What's unclear: Whether this is a pure WS broadcast (Category D, comment only) or a Redis write (Category E, debug)
   - Recommendation: Treat as debug -- it is a progress update during download, failure is transient

2. **image-sync.service.js line 503 -- Redis progress SET**
   - What we know: Writes download progress to Redis for the job tracker
   - What's unclear: Whether missing a single progress update matters
   - Recommendation: console.debug -- missing one progress point is harmless, next iteration writes again

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `containers/api/jest.config.js` |
| Quick run command | `cd containers/api && npx jest --runInBand --testPathPattern="<file>" --verbose` |
| Full suite command | `cd containers/api && npx jest --runInBand` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEBT-01a | Zero silent catch blocks remain | smoke (grep) | `grep -rn 'catch\s*{}' containers/api/src/ \| wc -l` returns 0 AND `grep -rn '.catch(() => {})' containers/api/src/ \| wc -l` returns 0 (7 WS broadcast exceptions allowed with comment) | N/A (grep check) |
| DEBT-01b | No spurious warnings in startup | manual | Start API in both sync and standalone mode, verify no unexpected warn-level output | manual-only: requires running API server |
| DEBT-01c | Existing tests still pass | unit | `cd containers/api && npx jest --runInBand` | Existing test suite |

### Sampling Rate
- **Per task commit:** `grep -rn 'catch\s*{}\|\.catch(() => {})' containers/api/src/ | grep -v '// WS broadcast' | wc -l` should approach 0
- **Per wave merge:** `cd containers/api && npx jest --runInBand`
- **Phase gate:** Full test suite green + grep verification returns 0 uncommented silent catches

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. No new test files needed. The verification is primarily grep-based (zero remaining silent catches) and manual smoke test (no spurious warnings).

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `containers/api/src/` -- full grep of all 48 silent catch blocks
- `containers/api/tests/setup.js` -- confirms console.debug/log/info suppressed in tests
- `containers/api/jest.config.js` -- test framework configuration
- CONTEXT.md -- all categorization decisions locked by user

### Secondary (MEDIUM confidence)
- Node.js console.debug documentation -- native method, semantically equivalent to console.log but distinct log level

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, uses built-in console methods
- Architecture: HIGH -- patterns are trivial string replacements, no structural changes
- Pitfalls: HIGH -- directly observed from codebase analysis (test setup suppression, WS broadcast frequency)
- Inventory: HIGH -- grep-verified, every catch block identified with line number

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable -- catch block locations only change if files are edited)
