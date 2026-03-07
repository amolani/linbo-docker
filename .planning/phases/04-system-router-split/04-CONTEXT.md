# Phase 4: System Router Split - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Decompose the monolithic system.js (1483 lines) into focused, maintainable sub-routers. Pure refactor — no behavioral changes. All existing API endpoints under `/system/*` continue to work identically.

</domain>

<decisions>
## Implementation Decisions

### Sub-router grouping
- Split into **8 sub-routers** (not 7 as roadmap listed — linbofs added as 8th):
  - **linbofs.js** (~262 lines): update-linbofs, linbofs-status, linbofs-info, patch-status, key-status, initialize-keys, generate-ssh-key, generate-dropbear-key
  - **kernel.js** (~183 lines): kernel-variants, kernel-active, kernel-status, kernel-switch, kernel-repair
  - **firmware.js** (~340 lines): firmware-detect, firmware-entries (CRUD + bulk), firmware-status, firmware-available, firmware-catalog
  - **wlan.js** (~80 lines): wlan-config GET/PUT/DELETE — separate from firmware despite using firmwareService (group by domain, not by shared service)
  - **grub-theme.js** (~294 lines): grub-theme GET/PUT/reset, icons CRUD, logo CRUD
  - **grub-config.js** (~109 lines): regenerate-grub-configs, grub-configs, cleanup-grub-configs, migrate-grub-configs
  - **worker.js** (~68 lines): worker-status, worker/pause, worker/resume
  - **linbo-update.js** (~86 lines): linbo-version, linbo-update POST/status/cancel

### File organization
- Nested directory: `routes/system/` with 8 sub-router files + index.js aggregator
- routes/ directory stays clean — one entry per top-level prefix
- Structure:
  ```
  routes/system/
  ├── index.js        (aggregator)
  ├── linbofs.js
  ├── kernel.js
  ├── firmware.js
  ├── wlan.js
  ├── grub-theme.js
  ├── grub-config.js
  ├── worker.js
  └── linbo-update.js
  ```

### Aggregator pattern
- `routes/system/index.js` creates a router and mounts all 8 sub-routers with `router.use('/', require('./xxx'))`
- Main `routes/index.js` keeps its single `router.use('/system', systemRoutes)` line unchanged
- The `require('./system')` resolves to `routes/system/index.js` automatically (Node.js convention)

### Shared code placement
- Co-locate with consumer — no shared utils file
- multer config + cleanupTemp() move into grub-theme.js (only consumer)
- Zod schemas move into their respective sub-router files (each is used by exactly one consumer)
- Each sub-router imports its own dependencies (express, auth middleware, audit, ws, zod, services)

### Claude's Discretion
- Exact import ordering within each sub-router file
- Whether to add section comments within sub-routers (probably unnecessary given small file sizes)
- How to handle the old system.js file (delete vs keep as redirect/note)

</decisions>

<specifics>
## Specific Ideas

- User wanted detailed explanations of each option — prefers recommended best practices in software engineering
- The split is mechanical: cut sections from system.js, paste into sub-router files, add boilerplate imports
- firmware.js at ~340 lines exceeds the 300-line target slightly — acceptable since it's a natural grouping with 8 tightly related endpoints

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- Express Router pattern used consistently across all 16 existing route files
- `authenticateToken`, `requireRole` middleware from `../middleware/auth`
- `auditAction` middleware from `../middleware/audit`
- `ws.broadcast()` for WebSocket events from `../lib/websocket`

### Established Patterns
- Each route file: `const router = express.Router()` + handlers + `module.exports = router`
- Zod schemas defined at file top, validated inline with `safeParse()`
- Error handling: `try/catch` with `next(error)` fallback, statusCode checks for known errors
- Service delegation: routes are thin wrappers calling service methods

### Integration Points
- `routes/index.js:38` — `const systemRoutes = require('./system')` — will now resolve to `routes/system/index.js`
- `routes/index.js:44` — `router.use('/system', systemRoutes)` — unchanged
- API info endpoint in `routes/index.js:129-142` — system endpoint listing stays unchanged
- Old `routes/system.js` file — will be deleted (replaced by `routes/system/` directory)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-system-router-split*
*Context gathered: 2026-03-07*
