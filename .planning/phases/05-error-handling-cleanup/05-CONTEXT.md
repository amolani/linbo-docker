# Phase 5: Error Handling Cleanup - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace all ~31 silent catch blocks in the API codebase with categorized logging (debug/warn/rethrow). Zero silent catches remain after this phase. No behavioral changes — only observability improvements.

</domain>

<decisions>
## Implementation Decisions

### Cleanup-op catch policy
- **File operations** (unlink, rmdir, mkdir): `console.debug` level — failure is harmless, file may already be gone
- **Service call failures** (GRUB generation, WS broadcasts, Redis writes in `.catch(() => {})`): `console.warn` level — indicates degraded functionality
- **Fire-and-forget background ops** (async IIFE like kernel rebuild): `console.warn` on failure — the API returned success, log is the only signal
- **Prerequisite mkdir** with `{ recursive: true }`: `console.debug` — subsequent operations will fail with a proper error if dir is missing
- **Keep inline `.catch()`** pattern — change `.catch(() => {})` to `.catch(err => console.debug(...))`. No refactor to try/catch blocks. Minimal diff.
- **Include error reason** in debug logs: `console.debug('[Service] cleanup: unlink failed:', err.message)`

### Prisma-optional catches
- **Top-level `require` catches**: add `console.debug('[Module] Prisma not available, running in sync mode')`
- **Runtime Prisma guards** (e.g., `try { await prisma.auditLog.create() } catch {}`): use **per-module once-flag** pattern — `let prismaWarnLogged = false; if (!prismaWarnLogged) { console.debug(...); prismaWarnLogged = true; }`
- **Startup health checks**: `console.debug` (expected in sync mode)
- **Migration failures**: `console.warn` (real problem in standalone mode)

### Startup noise threshold
- **Both modes clean**: neither sync mode nor standalone mode should produce warn/error during normal startup and idle operation
- **Zero-client WS broadcasts**: no log at all — broadcasting to nobody is normal operation, not an error. Only log if the broadcast mechanism itself throws. Keep `.catch(() => {})` with a comment: `// WS broadcast: no clients is normal`
- **'No spurious warnings' means no FALSE warnings**, not no warnings ever. Real degraded state (Redis hiccup, failed migration) correctly triggers warn.
- **Verification**: manual smoke test in both modes during implementation

### Log format consistency
- **Match existing pattern**: `console.debug/warn('[ServiceName] context:', err.message)` — no format migration
- **Use `console.debug`** (not `console.log` with `[DEBUG]` tag) — semantically correct, maps cleanly if a logging library is added later
- **`err.message` preferred** over `err.code` — human-readable, includes code context for system errors (e.g., `ENOENT: no such file or directory, unlink '/tmp/foo'`)
- **Route catch tags**: use route domain name matching sub-router files from Phase 4: `[Patchclass]`, `[Configs]`, `[GrubTheme]`, `[Kernel]`, etc.

### Claude's Discretion
- Exact categorization of each individual catch block (debug vs warn vs rethrow) within the guidelines above
- Whether WS broadcast catches need the explanatory comment or if the pattern is self-evident
- Ordering of changes across files (by service, by severity, or alphabetically)

</decisions>

<specifics>
## Specific Ideas

- The categorization heuristic: file cleanup = debug, service/infra failures = warn, background ops = warn, Prisma-optional = debug with once-flag
- Redis transient errors during sync are correctly warn — they indicate real degraded state
- WS broadcast to zero clients is explicitly exempted from logging (not an error condition)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- No logging library — uses `console.log/warn/error/debug` throughout
- `[ServiceName]` tagging convention already established across 200+ log lines
- Phase 4 sub-routers provide clean domain boundaries for tag names

### Established Patterns
- Route error pattern: `try/catch` with `next(error)` fallback, statusCode checks
- Service error pattern: throw with `statusCode` property
- Prisma-optional: `let prisma = null; try { prisma = require(...) } catch {}`
- Fire-and-forget: `(async () => { ... })().catch(() => {})`

### Integration Points
- **11 files with silent catches** (from CONCERNS.md): linbo-update.service.js (8), sync.service.js (6), index.js (5), terminal.service.js (3), settings.service.js (2), auth.js (1), images.js (1), audit.js (1), auth.js route (1), sync.js route (1), internal.js (2)
- **17 inline `.catch(() => {})` patterns** found across services and routes
- Phase 4 split means system.js catches are now in `routes/system/*.js` files
- Tests suppress console.log/debug/info via `tests/setup.js` — new debug logs won't affect test output

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-error-handling-cleanup*
*Context gathered: 2026-03-08*
