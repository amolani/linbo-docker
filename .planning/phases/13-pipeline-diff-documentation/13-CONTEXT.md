# Phase 13: Pipeline Diff Documentation - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Catalogue every Docker divergence from upstream LMN's update-linbofs and build audit/diff tooling. Deliverables: `make linbofs-audit`, `make linbofs-diff`, divergence documentation, LMN original script pinning, and CPIO format documentation in header comments.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
User explicitly delegated all format and presentation decisions to Claude. The following areas are open:

- **Audit output format** — How `make linbofs-audit` presents linbofs64 contents (sections, verbosity, formatting)
- **Diff presentation** — How `make linbofs-diff` shows before/after comparison (plain diff, categorized, summary)
- **Divergence doc structure** — Whether to restructure the existing `UNTERSCHIEDE-ZU-LINBO.md` narrative or add the 3-column table alongside it
- **LMN original selection** — Which version of the LMN update-linbofs script to pin, how to source it
- **CPIO format documentation** — How to document the concatenated CPIO+XZ format in update-linbofs.sh header comments

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/server/update-linbofs.sh`: Docker's build script, already well-structured with sections and comments
- `docs/UNTERSCHIEDE-ZU-LINBO.md`: 597-line narrative doc covering all Docker-exclusive features — needs 3-column table per DIFF-04
- `Makefile`: Existing targets (health, deploy, test, doctor) — new `linbofs-audit` and `linbofs-diff` targets fit naturally here

### Established Patterns
- Makefile uses `.PHONY` declarations, grouped sections with comment headers, and `@echo` for output
- Shell scripts in `scripts/server/` follow pattern: set -e, configuration block, section headers with `===`
- `make doctor` runs `scripts/doctor.sh` — audit/diff scripts could follow same delegation pattern

### Integration Points
- `make linbofs-audit` needs access to built linbofs64 at `/srv/linbo/linbofs64` (Docker volume)
- `make linbofs-diff` needs template linbofs64.xz at `/var/lib/linuxmuster/linbo/current/linbofs64.xz`
- Both tools likely run inside the API container (`docker exec linbo-api ...`) like `make test` does
- LMN original script available on production server 10.0.0.11 at `/usr/share/linuxmuster/linbo/update-linbofs.sh`

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User wants this phase to "just work" for admins and future maintainers.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-pipeline-diff-documentation*
*Context gathered: 2026-03-10 via Claude's Discretion*
