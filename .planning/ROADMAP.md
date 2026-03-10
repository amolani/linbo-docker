# Roadmap: LINBO Docker

## Milestones

- ✅ **v1.0 Hardening** — Phases 1-8 (shipped 2026-03-08)
- ✅ **v1.1 Fresh Install & Production Readiness** — Phases 9-12 (shipped 2026-03-10)
- [ ] **v1.2 linbofs Boot-Pipeline Transparency** — Phases 13-15 (in progress)

## Phases

<details>
<summary>v1.0 Hardening (Phases 1-8) — SHIPPED 2026-03-08</summary>

- [x] Phase 1: Build Hygiene (1/1 plan) — completed 2026-03-06
- [x] Phase 2: Secrets Hardening (2/2 plans) — completed 2026-03-07
- [x] Phase 3: API Security (2/2 plans) — completed 2026-03-07
- [x] Phase 4: System Router Split (1/1 plan) — completed 2026-03-07
- [x] Phase 5: Error Handling Cleanup (2/2 plans) — completed 2026-03-08
- [x] Phase 6: Isolated Debt Fixes (1/1 plan) — completed 2026-03-08
- [x] Phase 7: Backend Test Suites (2/2 plans) — completed 2026-03-08
- [x] Phase 8: Integration and Frontend Tests (2/2 plans) — completed 2026-03-08

</details>

<details>
<summary>v1.1 Fresh Install & Production Readiness (Phases 9-12) — SHIPPED 2026-03-10</summary>

- [x] Phase 9: Init Container Hardening (2/2 plans) — completed 2026-03-08
- [x] Phase 10: Configuration & Install Script (1/1 plan) — completed 2026-03-08
- [x] Phase 11: Production Hardening & Observability (1/1 plan) — completed 2026-03-08
- [x] Phase 12: Admin Documentation (2/2 plans) — completed 2026-03-10

</details>

### v1.2 linbofs Boot-Pipeline Transparency (In Progress)

**Milestone Goal:** Full transparency and control over the linbofs64 build pipeline — know exactly what Docker changes vs vanilla LMN, ensure package updates pass cleanly, and make hooks observable and auditable.

- [x] **Phase 13: Pipeline Diff Documentation** - Catalogue every Docker divergence from upstream LMN and build audit/diff tooling (completed 2026-03-10)
- [x] **Phase 14: Hook Observability** - Make the hook system visible, auditable, and safely extensible via manifest, API, and validation (completed 2026-03-10)
- [ ] **Phase 15: Update Regression Hardening** - Automated verification layer that catches silent regressions after linbo7 package updates

## Phase Details

### Phase 13: Pipeline Diff Documentation
**Goal**: An admin (or future maintainer) can see exactly what Docker's update-linbofs.sh does differently from the LMN original, why each divergence exists, and inspect the contents of any built linbofs64
**Depends on**: Nothing (first phase of v1.2; builds on shipped v1.1)
**Requirements**: DIFF-01, DIFF-02, DIFF-03, DIFF-04, DIFF-05
**Success Criteria** (what must be TRUE):
  1. Running `make linbofs-audit` on a built linbofs64 prints kernel version, module count, SSH key fingerprints, firmware file list, and hook-modified files
  2. Running `make linbofs-diff` shows a clear before/after comparison of what Docker's build pipeline added or changed relative to the upstream template linbofs64.xz
  3. `docs/UNTERSCHIEDE-ZU-LINBO.md` contains every intentional divergence in a three-column table (LMN behavior / Docker behavior / justification) that a new maintainer can consult before modifying update-linbofs.sh
  4. The LMN original script is pinned in the repo at `scripts/server/update-linbofs-lmn-original.sh` so future drift can be detected with a simple diff
  5. The concatenated CPIO+XZ format is documented in update-linbofs.sh header comments so no one accidentally breaks the two-segment structure
**Plans**: 2 plans

Plans:
- [x] 13-01-PLAN.md — Pin LMN original, create linbofs-audit.sh and linbofs-diff.sh, add Makefile targets
- [x] 13-02-PLAN.md — Document CPIO+XZ format in update-linbofs.sh header, add 3-column divergence table to UNTERSCHIEDE-ZU-LINBO.md

### Phase 14: Hook Observability
**Goal**: Every hook execution is recorded, inspectable via API, and new hooks can be validated and scaffolded safely before installation
**Depends on**: Phase 13
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04, HOOK-05, HOOK-06
**Success Criteria** (what must be TRUE):
  1. After a linbofs64 rebuild, `.linbofs-build-manifest.json` exists and contains each hook's name, exit code, file modification count, and build timestamp
  2. `GET /system/hooks` returns JSON listing all installed hooks with their type (pre/post), last exit code from most recent build, and whether the hook file is executable
  3. Running `validate-hook.sh` against a hook script reports missing shebang, missing executable bit, or use of absolute paths that should be relative — and exits non-zero on failures
  4. Running `make new-hook NAME=... TYPE=...` creates a valid hook skeleton with exported variable documentation and error handling boilerplate
  5. `.linbofs-patch-status` includes a hook warning summary so monitoring that file alone reveals whether any hooks failed or warned during the last build
**Plans**: 2 plans

Plans:
- [ ] 14-01-PLAN.md — Shell-side: manifest recording in exec_hooks(), validate-hook.sh, new-hook.sh, Makefile targets, patch-status extension
- [ ] 14-02-PLAN.md — API-side: hook.service.js, GET /system/hooks route, build log retention in linbofs.service.js

### Phase 15: Update Regression Hardening
**Goal**: A linbo7 package update either completes with verified integrity or fails loudly before clients attempt to boot a broken linbofs64
**Depends on**: Phase 13, Phase 14
**Requirements**: UPD-01, UPD-02, UPD-03, UPD-04, UPD-05, UPD-06, UPD-07
**Success Criteria** (what must be TRUE):
  1. `linbo-update.service.test.js` covers partial failure (provision OK but rebuild fails), concurrent update attempt (returns 409), and version comparison edge cases — all passing
  2. If a linbo7 update changes the internal linbofs64 directory structure, update-linbofs.sh fails with an explicit error naming the missing path instead of silently injecting into a non-existent directory
  3. A linbofs64 build that exceeds 200MB is rejected; one exceeding 80MB produces a warning; a build with zero kernel modules (`.ko` files) is rejected
  4. After every rebuild, both XZ segments of the concatenated linbofs64 are verified as valid cpio archives and `dev/console` is confirmed present — failure aborts with a clear message
  5. `make doctor` includes an APT repo connectivity check that reports whether `deb.linuxmuster.net` is reachable
**Plans**: TBD

Plans:
- [ ] 15-01: TBD
- [ ] 15-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 13 -> 14 -> 15

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Build Hygiene | v1.0 | 1/1 | Complete | 2026-03-06 |
| 2. Secrets Hardening | v1.0 | 2/2 | Complete | 2026-03-07 |
| 3. API Security | v1.0 | 2/2 | Complete | 2026-03-07 |
| 4. System Router Split | v1.0 | 1/1 | Complete | 2026-03-07 |
| 5. Error Handling Cleanup | v1.0 | 2/2 | Complete | 2026-03-08 |
| 6. Isolated Debt Fixes | v1.0 | 1/1 | Complete | 2026-03-08 |
| 7. Backend Test Suites | v1.0 | 2/2 | Complete | 2026-03-08 |
| 8. Integration and Frontend Tests | v1.0 | 2/2 | Complete | 2026-03-08 |
| 9. Init Container Hardening | v1.1 | 2/2 | Complete | 2026-03-08 |
| 10. Configuration & Install Script | v1.1 | 1/1 | Complete | 2026-03-08 |
| 11. Production Hardening & Observability | v1.1 | 1/1 | Complete | 2026-03-08 |
| 12. Admin Documentation | v1.1 | 2/2 | Complete | 2026-03-10 |
| 13. Pipeline Diff Documentation | v1.2 | 2/2 | Complete | 2026-03-10 |
| 14. Hook Observability | 2/2 | Complete   | 2026-03-10 | - |
| 15. Update Regression Hardening | v1.2 | 0/? | Not started | - |
