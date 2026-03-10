# Phase 14: Hook Observability - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the hook system visible, auditable, and safely extensible. Deliverables: build manifest JSON recording hook execution results, build log retention, API endpoint for hook status, hook validation script, hook scaffold generator, and patch-status extension with hook warnings.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
User explicitly delegated all design decisions to Claude. The following areas are open:

- **Build manifest format** — JSON structure for `.linbofs-build-manifest.json` (hook names, exit codes, file counts, timestamps)
- **Build log retention** — How `linbofs.service.js` manages `.linbofs-build.log` rotation (last 3 builds)
- **API response format** — `GET /system/hooks` response schema (installed hooks, exit codes, executable status)
- **Validation rules** — What `validate-hook.sh` checks (shebang, executable bit, path validation) and how it reports
- **Scaffold template** — What `make new-hook NAME=... TYPE=...` generates (boilerplate, exported variable docs, error handling)
- **Patch-status extension** — How hook warning summary integrates into `.linbofs-patch-status`

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `exec_hooks()` in `update-linbofs.sh` (lines 106-121): Current hook executor — prints name + WARNING on failure, needs manifest recording
- `.linbofs-patch-status`: Already read by `linbofs.service.js:337` via `getPatchStatus()` — extending this is natural
- `docs/hooks.md`: Comprehensive hook documentation (98 lines) — describes directories, variables, execution rules
- `scripts/server/linbofs-audit.sh` and `linbofs-diff.sh` from Phase 13: Pattern for new shell scripts
- `Makefile`: Phase 13 added `linbofs-audit` and `linbofs-diff` targets — `new-hook` follows same pattern

### Established Patterns
- Phase 13 established BusyBox-compatible shell patterns: `{ grep || true; } | wc -l`, sed instead of grep -P, awk instead of numfmt
- API routes: Express.js in `containers/api/src/routes/`, grouped by domain (system, settings, images, etc.)
- No existing `system.js` route file — `GET /system/hooks` would be a new route or added to internal routes
- `linbofs.service.js` handles rebuild orchestration — build log retention fits here
- `scripts/doctor.sh` runs diagnostics — `validate-hook.sh` follows similar diagnostic pattern

### Integration Points
- `update-linbofs.sh` `exec_hooks()` must write manifest JSON after hook execution
- `linbofs.service.js` triggers rebuild → needs to capture build log and rotate old logs
- New `GET /system/hooks` route reads manifest + scans hook directories
- `.linbofs-patch-status` written at end of update-linbofs.sh → needs hook warning summary appended
- `make new-hook` writes to `/etc/linuxmuster/linbo/hooks/update-linbofs.{pre,post}.d/`

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User wants hooks to be observable and safely extensible for admins.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-hook-observability*
*Context gathered: 2026-03-10 via Claude's Discretion*
