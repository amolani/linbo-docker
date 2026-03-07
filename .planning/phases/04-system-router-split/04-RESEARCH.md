# Phase 4: System Router Split - Research

**Researched:** 2026-03-07
**Domain:** Express.js route decomposition / Node.js CommonJS module refactoring
**Confidence:** HIGH

## Summary

Phase 4 is a pure mechanical refactoring of a single 1483-line Express route file (`containers/api/src/routes/system.js`) into 8 focused sub-routers housed in a `routes/system/` directory with an `index.js` aggregator. There are no new libraries, no behavioral changes, and no architectural decisions beyond what was already locked in CONTEXT.md.

The existing codebase already uses the `express.Router()` + `module.exports` pattern consistently across 16 route files. The split is straightforward cut-and-paste with import adjustment. The key technical enabler is Node.js CommonJS module resolution: `require('./system')` transparently resolves to `./system/index.js` when `system.js` is replaced by a `system/` directory, so no changes are needed in the route aggregator (`routes/index.js`).

One existing test file (`tests/routes/system.linbo-update.test.js`) imports `routes/system` directly and will need its import path updated to `routes/system/linbo-update` (or kept as-is if its mocks still cover the aggregated router).

**Primary recommendation:** Mechanically split system.js into 8 sub-router files following the exact grouping in CONTEXT.md. Delete the old system.js. Update the one test file import. Verify all 46 endpoints respond identically.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Split into **8 sub-routers** (not 7 as roadmap listed -- linbofs added as 8th):
  - **linbofs.js** (~262 lines): update-linbofs, linbofs-status, linbofs-info, patch-status, key-status, initialize-keys, generate-ssh-key, generate-dropbear-key
  - **kernel.js** (~183 lines): kernel-variants, kernel-active, kernel-status, kernel-switch, kernel-repair
  - **firmware.js** (~340 lines): firmware-detect, firmware-entries (CRUD + bulk), firmware-status, firmware-available, firmware-catalog
  - **wlan.js** (~80 lines): wlan-config GET/PUT/DELETE -- separate from firmware despite using firmwareService (group by domain, not by shared service)
  - **grub-theme.js** (~294 lines): grub-theme GET/PUT/reset, icons CRUD, logo CRUD
  - **grub-config.js** (~109 lines): regenerate-grub-configs, grub-configs, cleanup-grub-configs, migrate-grub-configs
  - **worker.js** (~68 lines): worker-status, worker/pause, worker/resume
  - **linbo-update.js** (~86 lines): linbo-version, linbo-update POST/status/cancel
- Nested directory: `routes/system/` with 8 sub-router files + index.js aggregator
- `routes/system/index.js` creates a router and mounts all 8 sub-routers with `router.use('/', require('./xxx'))`
- Main `routes/index.js` keeps its single `router.use('/system', systemRoutes)` line unchanged
- Co-locate shared code with consumer -- no shared utils file
- multer config + cleanupTemp() move into grub-theme.js (only consumer)
- Zod schemas move into their respective sub-router files (each is used by exactly one consumer)

### Claude's Discretion
- Exact import ordering within each sub-router file
- Whether to add section comments within sub-routers (probably unnecessary given small file sizes)
- How to handle the old system.js file (delete vs keep as redirect/note)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEBT-02 | system.js (1483 lines) in Sub-Router splitten: kernel, firmware, grub-theme, grub-config, linbo-update, worker, wlan | Full dependency map, line counts, import analysis, and aggregator pattern documented below |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^4.18.2 | Route handling (Router) | Already in use, no changes |
| zod | ^3.22.4 | Request validation schemas | Already in use, schemas move with consumers |
| multer | ^2.0.2 | File upload handling | Already in use, only in grub-theme.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `fs` | built-in | `createReadStream` for file serving | Only in grub-theme.js (icon/logo serving) |
| Node.js `path` | built-in | Path joining for multer config | Only in grub-theme.js |
| Node.js `os` | built-in | `os.tmpdir()` for multer dest | Only in grub-theme.js |

**No new dependencies.** This is a pure structural refactoring.

## Architecture Patterns

### Target Project Structure
```
containers/api/src/routes/
├── system/
│   ├── index.js        # Aggregator: creates Router, mounts 8 sub-routers
│   ├── linbofs.js      # ~268 lines (8 endpoints)
│   ├── kernel.js       # ~183 lines (5 endpoints)
│   ├── firmware.js     # ~340 lines (8 endpoints)
│   ├── wlan.js         # ~81 lines  (3 endpoints)
│   ├── grub-theme.js   # ~294 lines (10 endpoints)
│   ├── grub-config.js  # ~109 lines (4 endpoints)
│   ├── worker.js       # ~68 lines  (3 endpoints)
│   └── linbo-update.js # ~88 lines  (4 endpoints)
├── auth.js             # (unchanged)
├── index.js            # (unchanged - require('./system') resolves to system/index.js)
└── ...                 # (all other route files unchanged)
```

### Pattern 1: Sub-Router File Template
**What:** Each sub-router follows the existing Express.Router pattern used in all 16 route files.
**When to use:** Every sub-router file.
**Example:**
```javascript
// Source: Existing codebase pattern (e.g., settings.js, terminal.js)
const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const someService = require('../../services/some.service');

// [Zod schemas, if any, defined here]

// [Route handlers]

module.exports = router;
```

**CRITICAL:** Import paths change from `../middleware/auth` to `../../middleware/auth` (one level deeper).

### Pattern 2: Aggregator (index.js)
**What:** The aggregator file creates a router and mounts all sub-routers at root (`/`).
**When to use:** The single `routes/system/index.js` file.
**Example:**
```javascript
const express = require('express');
const router = express.Router();

router.use('/', require('./linbofs'));
router.use('/', require('./kernel'));
router.use('/', require('./firmware'));
router.use('/', require('./wlan'));
router.use('/', require('./grub-theme'));
router.use('/', require('./grub-config'));
router.use('/', require('./worker'));
router.use('/', require('./linbo-update'));

module.exports = router;
```

**Why `router.use('/', ...)` not `router.use('/kernel', ...)`:** The sub-routers already define full path segments (e.g., `/kernel-variants`, `/kernel-switch`). The parent `routes/index.js` already prefixes with `/system`. No additional path nesting is needed.

### Pattern 3: Node.js CommonJS Directory Resolution
**What:** `require('./system')` resolves to `./system/index.js` when `system.js` is replaced by a `system/` directory.
**When to use:** Transparent -- no code changes needed in `routes/index.js`.
**Confidence:** HIGH -- this is the core CommonJS module resolution algorithm, documented in Node.js official docs.

**IMPORTANT:** The old `routes/system.js` file MUST be deleted before creating `routes/system/` directory. Node.js tries `system.js` before `system/index.js`. If both exist, the file wins.

### Anti-Patterns to Avoid
- **Shared utils file:** Don't create `routes/system/utils.js` or `routes/system/shared.js`. multer config and cleanupTemp() are only used by grub-theme.js -- put them there.
- **Re-exporting schemas:** Don't create a central schemas file. Each schema is used by exactly one sub-router.
- **Path prefix in sub-routers:** Don't change route paths. Sub-routers keep `/update-linbofs`, `/kernel-variants`, etc. The `/system` prefix comes from `routes/index.js`.
- **Changing route registration order:** Mount sub-routers in the aggregator in the same order as the original file sections. Express evaluates routes in registration order -- changing order could affect middleware/route matching if any paths overlap (they don't in this case, but maintaining order is safe).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Route aggregation | Custom loader that scans directory | Explicit `require()` calls in index.js | 8 files is small enough for explicit requires; auto-loading adds complexity and hides the dependency graph |
| Import path rewriting | Manual find-replace | Editor multi-cursor or scripted `sed` | All imports shift by one `../` level; mechanical change |

## Common Pitfalls

### Pitfall 1: Forgetting to Delete system.js
**What goes wrong:** If `routes/system.js` and `routes/system/index.js` both exist, Node.js resolves `require('./system')` to the FILE `system.js`, not the directory.
**Why it happens:** Forgetting to remove the old file after creating the directory.
**How to avoid:** Delete `routes/system.js` as the first step, THEN create `routes/system/` directory and files.
**Warning signs:** Tests pass locally but behavior hasn't changed (still loading old monolithic file).

### Pitfall 2: Wrong Import Paths in Sub-Routers
**What goes wrong:** `require('../middleware/auth')` fails with MODULE_NOT_FOUND because files moved one directory deeper.
**Why it happens:** Copy-paste from system.js without updating relative paths.
**How to avoid:** All imports that were `../something` become `../../something`. Verify at file creation time.
**Warning signs:** `Cannot find module` errors on startup.

### Pitfall 3: Test File Import Path
**What goes wrong:** `tests/routes/system.linbo-update.test.js` imports `require('../../src/routes/system')` which now resolves to the aggregator (all 8 sub-routers), loading ALL mocks.
**Why it happens:** The test was written to test the monolithic file.
**How to avoid:** Either (a) update the import to `../../src/routes/system/linbo-update` to test just the sub-router, or (b) keep importing the aggregator since all services are already mocked.
**Warning signs:** Test failures due to unmocked services, or slow tests loading unnecessary code.

### Pitfall 4: wlanConfigSchema Location
**What goes wrong:** `wlanConfigSchema` is currently defined in the firmware schema block (line 520) but used only in the wlan section (line 878).
**Why it happens:** In the original monolith, schemas were grouped near related schemas, not near usage.
**How to avoid:** Move `wlanConfigSchema` into `wlan.js`, not `firmware.js`. The CONTEXT.md already specifies this: "Zod schemas move into their respective sub-router files."
**Warning signs:** wlan.js would need to import from firmware.js, creating unwanted coupling.

### Pitfall 5: multer and cleanupTemp Placement
**What goes wrong:** multer config (`themeUpload`) and `cleanupTemp()` are defined at file top (lines 26-36) but only used by grub-theme routes.
**Why it happens:** In the monolith, all shared utilities were at the top.
**How to avoid:** Move both into `grub-theme.js`. No other sub-router needs them.
**Warning signs:** Unused imports in the aggregator.

## Dependency Map Per Sub-Router

Verified by analyzing the actual source code:

| Sub-Router | Services | Middleware | Other Imports |
|------------|----------|------------|---------------|
| linbofs.js | linbofs.service | auth, audit, ws | -- |
| kernel.js | kernel.service | auth, audit, ws | zod (2 schemas) |
| firmware.js | firmware.service | auth, audit, ws | zod (4 schemas) |
| wlan.js | firmware.service | auth, audit | zod (1 schema: wlanConfigSchema) |
| grub-theme.js | grub-theme.service | auth, audit, ws | zod (1 schema), multer, path, os, fs (sync+promises) |
| grub-config.js | grub.service | auth, audit, ws | -- |
| worker.js | operation.worker | auth, audit | -- |
| linbo-update.js | linbo-update.service | auth, audit | -- |

**Key observations:**
- `wlan.js` uses `firmwareService` (not a firmware sub-router import) -- services are imported from `../../services/`, no cross-sub-router deps
- `grub-theme.js` is the only file needing `multer`, `path`, `os`, `fs`
- `worker.js` and `linbo-update.js` don't need `ws.broadcast()` -- worker doesn't broadcast, and linbo-update's POST handler doesn't broadcast (the update service handles progress internally)

**Correction on linbo-update.js:** Checking the source more carefully -- the POST /linbo-update handler does NOT call ws.broadcast. Only version check and status/cancel don't either. So linbo-update.js does NOT need the ws import.

**Correction on worker.js:** Worker endpoints also do NOT call ws.broadcast. So worker.js does NOT need the ws import.

## Endpoint Inventory (46 total)

| # | Method | Path | Sub-Router |
|---|--------|------|------------|
| 1 | POST | /update-linbofs | linbofs.js |
| 2 | GET | /linbofs-status | linbofs.js |
| 3 | GET | /linbofs-info | linbofs.js |
| 4 | GET | /patch-status | linbofs.js |
| 5 | GET | /key-status | linbofs.js |
| 6 | POST | /initialize-keys | linbofs.js |
| 7 | POST | /generate-ssh-key | linbofs.js |
| 8 | POST | /generate-dropbear-key | linbofs.js |
| 9 | GET | /kernel-variants | kernel.js |
| 10 | GET | /kernel-active | kernel.js |
| 11 | GET | /kernel-status | kernel.js |
| 12 | POST | /kernel-switch | kernel.js |
| 13 | POST | /kernel-repair | kernel.js |
| 14 | POST | /firmware-detect | firmware.js |
| 15 | GET | /firmware-entries | firmware.js |
| 16 | GET | /firmware-status | firmware.js |
| 17 | POST | /firmware-entries | firmware.js |
| 18 | POST | /firmware-entries/remove | firmware.js |
| 19 | DELETE | /firmware-entries | firmware.js |
| 20 | GET | /firmware-available | firmware.js |
| 21 | GET | /firmware-catalog | firmware.js |
| 22 | POST | /firmware-entries/bulk | firmware.js |
| 23 | GET | /wlan-config | wlan.js |
| 24 | PUT | /wlan-config | wlan.js |
| 25 | DELETE | /wlan-config | wlan.js |
| 26 | GET | /grub-theme | grub-theme.js |
| 27 | PUT | /grub-theme | grub-theme.js |
| 28 | POST | /grub-theme/reset | grub-theme.js |
| 29 | GET | /grub-theme/icons | grub-theme.js |
| 30 | GET | /grub-theme/icons/:filename | grub-theme.js |
| 31 | POST | /grub-theme/icons | grub-theme.js |
| 32 | DELETE | /grub-theme/icons/:baseName | grub-theme.js |
| 33 | GET | /grub-theme/logo | grub-theme.js |
| 34 | POST | /grub-theme/logo | grub-theme.js |
| 35 | POST | /grub-theme/logo/reset | grub-theme.js |
| 36 | POST | /regenerate-grub-configs | grub-config.js |
| 37 | GET | /grub-configs | grub-config.js |
| 38 | POST | /cleanup-grub-configs | grub-config.js |
| 39 | POST | /migrate-grub-configs | grub-config.js |
| 40 | GET | /worker-status | worker.js |
| 41 | POST | /worker/pause | worker.js |
| 42 | POST | /worker/resume | worker.js |
| 43 | GET | /linbo-version | linbo-update.js |
| 44 | POST | /linbo-update | linbo-update.js |
| 45 | GET | /linbo-update/status | linbo-update.js |
| 46 | POST | /linbo-update/cancel | linbo-update.js |

## Code Examples

### Sub-Router File (kernel.js -- representative example)
```javascript
// Source: Derived from system.js lines 315-497 + boilerplate
const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { auditAction } = require('../../middleware/audit');
const ws = require('../../lib/websocket');
const { z } = require('zod');
const kernelService = require('../../services/kernel.service');

const kernelSwitchSchema = z.object({
  variant: z.enum(['stable', 'longterm', 'legacy']),
});

const kernelRepairSchema = z.object({
  rebuild: z.boolean().optional().default(false),
});

// ... handlers copied from system.js lines 323-497 ...

module.exports = router;
```

### Aggregator File (system/index.js)
```javascript
// Source: New file, following Node.js CommonJS directory pattern
const express = require('express');
const router = express.Router();

router.use('/', require('./linbofs'));
router.use('/', require('./kernel'));
router.use('/', require('./firmware'));
router.use('/', require('./wlan'));
router.use('/', require('./grub-theme'));
router.use('/', require('./grub-config'));
router.use('/', require('./worker'));
router.use('/', require('./linbo-update'));

module.exports = router;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single monolithic route file | Sub-router directory with aggregator | This phase | Maintainability: 1483-line file becomes 8 files each under 340 lines |

**No deprecated/outdated concerns.** Express 4.x Router is stable and well-understood. This pattern is used extensively in the Express ecosystem.

## Open Questions

1. **Test file strategy**
   - What we know: `tests/routes/system.linbo-update.test.js` imports `../../src/routes/system` and mocks ALL system services (not just linbo-update). It tests 4 endpoints (linbo-version, linbo-update, linbo-update/status, linbo-update/cancel).
   - What's unclear: Should the test import the sub-router directly (`../../src/routes/system/linbo-update`) to avoid loading all 8 sub-routers? Or keep importing the aggregator since all services are already mocked?
   - Recommendation: **Keep importing the aggregator.** The test already mocks all services. Importing the aggregator also validates that the aggregation itself works. Update the `buildApp()` to still mount at `/system` prefix. No test changes should be needed since `require('../../src/routes/system')` will now resolve to `system/index.js` which still exports a single Router.

2. **Old system.js deletion timing**
   - What we know: Node.js resolves files before directories. If both `system.js` and `system/index.js` exist, the file wins.
   - Recommendation: Delete `system.js` first, then create the directory. Or: rename to `system.js.bak`, create directory, verify, then delete backup. In practice, git handles this atomically in a single commit.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `containers/api/jest.config.js` |
| Quick run command | `cd containers/api && npx jest tests/routes/system.linbo-update.test.js --no-coverage` |
| Full suite command | `cd containers/api && npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEBT-02a | All 46 endpoints respond identically after split | smoke | `cd containers/api && npx jest tests/routes/system.linbo-update.test.js --no-coverage` | Yes (covers 11 tests for linbo-update endpoints) |
| DEBT-02b | Sub-routers are individually importable | unit | `node -e "require('./containers/api/src/routes/system/kernel')"` (per sub-router) | No -- Wave 0 |
| DEBT-02c | Aggregator correctly mounts all sub-routers | integration | `cd containers/api && npx jest tests/routes/system.linbo-update.test.js --no-coverage` | Yes (test imports aggregator) |

### Sampling Rate
- **Per task commit:** `cd containers/api && npx jest tests/routes/system.linbo-update.test.js --no-coverage`
- **Per wave merge:** `cd containers/api && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] No new test files needed -- existing test covers the critical path (aggregator import + endpoint identity). The test file itself requires no changes since `require('../../src/routes/system')` resolves to the new `system/index.js`.
- [ ] Manual verification: `node -e "const r = require('./containers/api/src/routes/system/kernel'); console.log(r.stack.length)"` for each sub-router to confirm individual importability.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- `containers/api/src/routes/system.js` (1483 lines, 46 endpoints, read in full)
- **Codebase analysis** -- `containers/api/src/routes/index.js` (route aggregator, line 38: `require('./system')`)
- **Codebase analysis** -- `containers/api/tests/routes/system.linbo-update.test.js` (only test importing system routes)
- **Node.js CommonJS resolution** -- `require(X)` where X is a directory resolves to `X/index.js` (core Node.js behavior, stable since v0.x)

### Secondary (MEDIUM confidence)
- None needed -- this is a pure internal refactoring with no external dependencies

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, pure refactoring of existing Express patterns
- Architecture: HIGH -- aggregator pattern is standard Node.js/Express, verified against codebase conventions
- Pitfalls: HIGH -- identified from actual code analysis (import paths, file deletion order, schema placement)

**Research date:** 2026-03-07
**Valid until:** Indefinite -- this is a mechanical refactoring of stable Express.js patterns
