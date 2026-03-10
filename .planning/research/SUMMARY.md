# Project Research Summary

**Project:** LINBO Docker v1.2 — linbofs Boot-Pipeline Transparency
**Domain:** Boot artifact pipeline hardening, diff analysis, hook system governance
**Researched:** 2026-03-10
**Confidence:** HIGH

## Executive Summary

LINBO Docker v1.2 is a maintenance and transparency milestone — not a new feature milestone. The task is to systematically document every intentional divergence between Docker's `update-linbofs.sh` and the upstream LMN original, make the hook system observable and auditable, and harden the system against silent regressions during future `linuxmuster-linbo7` package updates. No new stack components are required. All work is analysis, documentation, targeted hardening, and test coverage within the existing Node.js/Bash/Docker architecture.

The recommended approach follows the sequence: document first, then test, then harden, then extend. The research identified 15 concrete divergences between the Docker and LMN scripts, each with explicit rationale for preservation. The most dangerous divergences (device node cpio concatenation, `--owner 0:0` cpio flag, atomic write pattern, `flock`-based locking) are irreversible and must be explicitly protected against future maintainers treating them as "unnecessary" differences. The hook system (added in Session 33) needs a build manifest, API surface, and criticality model before new hooks are added.

The primary risk is silent regression: a `linuxmuster-linbo7` package update produces a linbofs64 that passes all current checks (size > 10MB, MD5 written) but fails to boot clients because injection paths changed or the module selection diverged. This was the root cause of the Session 32 "Remote Control Mode" incident. Mitigation requires both automated verification (module count, injection path existence checks) and a documented manual boot test runbook that must be executed after every package update.

---

## Key Findings

### Recommended Stack

No new stack components are needed for v1.2. The existing Bash + Node.js + Docker infrastructure covers all requirements. The only new tooling candidates are pure-shell scripts (`validate-hook.sh`, `make linbofs-audit`, `make linbofs-diff`) that have no dependencies beyond the tools already present in the API container.

**Core technologies (all existing):**
- **Bash 5.x** — `update-linbofs.sh`, hook scripts, audit/diff tooling — no alternatives needed
- **xz-utils + cpio** — initramfs pack/unpack; the concatenated two-segment XZ format must be preserved exactly
- **argon2** — password hash injection; parameters must match LMN's in future package updates
- **flock (util-linux)** — crash-safe build locking; superior to LMN's `touch`-based lockfile
- **Node.js 20 / Express.js** — API container; hook status endpoint to be added as new route in existing system router
- **ioredis** — Redis for update orchestration state (linbo-update.service); build state remains file-based (do not mix these two state mechanisms)

See `STACK.md` for the complete diff of Docker vs LMN script with rationale for every divergence.

### Expected Features

**Must have (table stakes for v1.2):**
- **Hook content manifest** — structured JSON written to `.linbofs-build-manifest.json` at Step 14.5; records hook names, exit codes, file counts per injection step, build timestamp
- **Build log retention** — full `update-linbofs.sh` stdout written to `.linbofs-build.log` (rotate, keep last 3); accessible via API endpoint
- **Hook listing/status API** — `GET /system/hooks` returns installed hooks, last exit code from manifest, executable status; no API surface exists today
- **Hook validation script** — `validate-hook.sh`: checks shebang, executable bit, absolute path references; runs before hook is installed
- **linbofs content audit command** — `make linbofs-audit`: extracts linbofs64, reports kernel version, module count, SSH key fingerprints, firmware files, hook-modified files
- **linbofs diff (Docker vs vanilla)** — shell script comparing template `linbofs64.xz` vs built `linbofs64` cpio manifests; answers "what does Docker actually change?"
- **Update safety test coverage** — extend existing `linbo-update.service.test.js` to cover partial failure states (provision OK, rebuild fails), concurrent update attempt (409), version comparison edge cases

**Should have (strong differentiators for v1.2):**
- **Module diff (Docker vs LMN)** — compare `lib/modules/` between Docker linbofs64 and an LMN-generated linbofs64; directly addresses Session 32 root cause
- **Hook scaffold generator** — `make new-hook NAME=02_foo TYPE=pre` creates a hook skeleton with exported variable docs and error handling pattern
- **Hook idempotency testing** — test harness that runs pre-hooks twice on same extracted linbofs and verifies identical output; critical for any future init.sh patch hook
- **Size range check** — extend existing 10MB minimum to also warn if > 80MB, fail if > 200MB; add module count verification (`lib/modules/*.ko` count > 0 after module injection)

**Defer (post-v1.2):**
- **init.sh SERVERID patch as pre-hook** — MEDIUM confidence feasibility; requires verification against current init.sh version and a decision between hook-based patch vs GRUB cmdline approach (see Pitfall 3 in PITFALLS.md). Do not implement until the transparency phase is complete and exact init.sh structure is confirmed.
- **Firmware audit** — cross-reference `$CONFIG_DIR/firmware` against `linux-firmware` package; useful but not blocking
- **Hook criticality model** — `HOOK_REQUIRED=true` header convention; design this after observing real hook failure patterns in the wild
- **APT repo connectivity in `make doctor`** — minor resilience improvement; not blocking v1.2

See `FEATURES.md` for full feature landscape with dependency graph.

### Architecture Approach

The build pipeline is architecturally sound and requires no structural changes for v1.2. The pipeline has three distinct phases (Bootstrap via init container, Build via `update-linbofs.sh`, Update via `linbo-update.service.js`) and five established patterns that must be preserved: atomic template extraction, atomic kernel set symlink swap, build marker state machine, non-root build safety (uid 1001 + pre-built cpio device node fragment), and idempotent update orchestration via Redis lock + heartbeat.

**Major components:**
1. **`containers/init/entrypoint.sh`** — one-shot APT provisioning; writes `.needs-rebuild` to signal API; uses checkpoint files for idempotency
2. **`scripts/server/update-linbofs.sh`** — core build pipeline; 15 steps from template extraction to kernel binary copy; the ONLY file that writes `linbofs64`; all Docker vs LMN divergences live here
3. **`containers/api/src/services/linbo-update.service.js`** — full package update orchestration; the integration seam where the most dangerous partial-failure states exist (provision succeeds, rebuild fails)
4. **`containers/api/src/services/linbofs.service.js`** — shell-out wrapper for `update-linbofs.sh`; handles key provisioning; candidate for adding build log capture
5. **Hook scripts (`update-linbofs.pre.d/`, `update-linbofs.post.d/`)** — extensibility point; currently one active hook (Plymouth theme); needs governance model before expansion

The critical invariant to protect: `linbo64` (kernel binary) is copied to `$LINBO_DIR` at Step 15, AFTER `linbofs64` is fully built and verified. This ensures kernel binary and module set are always synchronized. Any refactoring that separates these steps creates a race window during updates.

See `ARCHITECTURE.md` for the full pipeline diagram, volume map, and integration point risk analysis.

### Critical Pitfalls

1. **Misclassifying intentional differences as bugs** — Every diff against the LMN original must use a three-column format: LMN behavior / Docker behavior / Justification. Never remove a Docker-specific behavior without tracing which feature it enables. The 15 catalogued divergences in `STACK.md` are the authoritative reference.

2. **Module selection divergence is non-deterministic at identical kernel versions** — Session 32 proved same version + same nominal count != same module set. Same kernel binary, different supporting module selection → boot failure on specific hardware. The fix is ensuring `modules.tar.xz` originates from the LMN .deb's pre-built linbofs64, not a separately compiled set. After any package update, compare module NAME lists (not just counts) against an LMN reference.

3. **LMN package update silently invalidates injection paths** — LMN can change internal linbofs64 paths (`etc/linbo_pwhash`, `etc/dropbear/`, `.ssh/authorized_keys`) in any release without announcing it. Docker's `update-linbofs.sh` writes to hardcoded paths with no pre-injection existence check. After any linbo7 update, run: `xzcat linbofs64.xz | cpio -t 2>/dev/null | grep -E 'linbo_pwhash|dropbear|authorized_keys'` before rebuilding.

4. **CPIO concatenation format is fragile and undocumented** — linbofs64 is a two-segment concatenated XZ file (main archive + device nodes). Any tool that recompresses or decompresses the "full file" as a single XZ drops the device node segment silently. Client kernel panics immediately. This format MUST be explicitly documented in `update-linbofs.sh` and verified after every rebuild: `xzcat linbofs64 | cpio -t 2>/dev/null | grep dev/console`.

5. **Hook errors are swallowed by design — build status reports OK even on hook failure** — The current `.linbofs-patch-status` file contains only `build|OK` regardless of hook exit codes. An admin who monitors only this file has no visibility into hook failures. The build manifest (table stakes feature) must extend this file to include hook warning summaries.

---

## Implications for Roadmap

Based on research, the v1.2 milestone maps cleanly to 3 phases with a strict dependency order: documentation before testing, testing before hardening/extension.

### Phase 1: Pipeline Diff Documentation and Transparency

**Rationale:** All subsequent work (testing, hardening, hook extension) depends on a precise catalogue of what Docker's pipeline does and why. Without this foundation, any "improvement" risks removing intentional divergences. This phase is pure documentation and lightweight tooling with no architectural risk. It directly addresses Pitfall 1 (misclassifying differences as bugs) by creating the authoritative reference that all future maintainers can consult.

**Delivers:**
- Pinned copy of LMN `update-linbofs` original at `scripts/server/update-linbofs-lmn-original.sh` for ongoing drift tracking
- `make linbofs-audit` shell command: extract and report linbofs64 composition (kernel version, module count, SSH key fingerprints, firmware files)
- `make linbofs-diff` shell script: compare template `linbofs64.xz` vs built `linbofs64` cpio manifests
- Updated `docs/UNTERSCHIEDE-ZU-LINBO.md` with full 15-divergence catalogue (three-column format: LMN behavior / Docker behavior / Justification)
- Documentation of the concatenated XZ format in `update-linbofs.sh` header comments

**Addresses features:** linbofs content audit command, linbofs diff (Docker vs vanilla)
**Avoids:** Pitfall 1 (intentional-difference misclassification), Pitfall 5 (undocumented CPIO format)

### Phase 2: Hook System Observability and Governance

**Rationale:** The hook system (introduced Session 33) has no API surface, no build manifest, and no criticality model. Before any new hooks are written — especially the high-risk init.sh SERVERID patch — the governance model must exist. This phase makes hooks visible and auditable, which is a prerequisite for safely expanding the hook ecosystem. It also surfaces the hook warning information that is currently swallowed.

**Delivers:**
- Build manifest JSON at `.linbofs-build-manifest.json` (extend Step 14.5 in `update-linbofs.sh`)
- Build log retention: full stdout to `.linbofs-build.log` (rotate, keep 3); written by `linbofs.service.js`
- `GET /system/hooks` API endpoint in existing system router
- `validate-hook.sh` script: shebang, executable bit, path validation
- Hook scaffold generator: `make new-hook NAME=... TYPE=...`
- Extension of `.linbofs-patch-status` to include hook warning summary
- Example hook in `docs/hooks.md` updated to use `$CONFIG_DIR` instead of hardcoded `/root/linbo-docker/`

**Addresses features:** Hook content manifest, hook listing/status API, hook validation, hook scaffold generator, build log retention
**Avoids:** Pitfall 6 (silent hook failures), Pitfall 12 (hardcoded paths in examples)

### Phase 3: Update Regression Hardening and Test Coverage

**Rationale:** The highest-risk scenario is a silent regression after a `linuxmuster-linbo7` package update: build succeeds, all checks pass, clients fail to boot. This phase adds the verification layer that makes package updates safe. It depends on Phase 1 (audit tools become verification primitives) and Phase 2 (hook manifest provides build evidence for test assertions). The automated checks address what can be scripted; the boot test runbook addresses what cannot.

**Delivers:**
- Extended `linbo-update.service.test.js`: partial failure states (provision OK, rebuild fails), concurrent update attempt (409), version comparison edge cases
- Pre-injection path existence check in `update-linbofs.sh` (Steps 8/9): verify target directories exist in extracted linbofs before writing, fail loudly if not
- Size range check: warn if linbofs64 > 80MB, fail if > 200MB; module count verification (`.ko` files > 0)
- Post-rebuild verification: assert both XZ segments decode to valid cpio, confirm `dev/console` present
- Module diff script: compare `lib/modules/` contents between Docker and LMN linbofs64
- Written runbook in `docs/linbo-upgrade-flow.md`: boot test procedure required after every linbo7 update
- `make doctor` addition: APT repo connectivity check (`deb.linuxmuster.net` reachable)

**Addresses features:** Update safety test coverage, module diff, size range check, linbofs64 format verification
**Avoids:** Pitfall 2 (module divergence), Pitfall 4 (injection path staleness), Pitfall 5 (CPIO format verification), Pitfall 7 (inadequate size check), Pitfall 8 (kernel/module race window documentation), Pitfall 13 (build-only testing is not sufficient)

### Phase Ordering Rationale

- **Documentation before everything:** The diff catalogue (Phase 1) is the source of truth for what the pipeline does. Without it, both test coverage (Phase 3) and hook extension (Phase 2 examples) risk operating on incorrect assumptions.
- **Hook governance before hook expansion:** The init.sh SERVERID patch (deferred) is a high-risk hook. The governance model (Phase 2) must exist before it can be safely designed and implemented.
- **Hardening after observability:** Phase 3 builds on the audit tools from Phase 1 and the build manifest from Phase 2. The regression tests assert on the same evidence operators will use to verify production builds.
- **No phase requires the others to be 100% complete before starting,** but each phase's deliverables improve the quality of subsequent phases' work.

### Research Flags

Phases with standard patterns (skip research-phase):
- **Phase 1 (Pipeline Diff Documentation):** Pure shell scripting against a fully-read known codebase. All 15 divergences are already catalogued in `STACK.md`. No ambiguity about scope.
- **Phase 2 (Hook Observability):** Adding a new Express route and extending a shell script. The patterns are established by the existing system routes and the existing `linbofs.service.js` implementation.
- **Phase 3 (Regression Hardening):** Extending an existing test suite and adding shell verification steps. The test infrastructure already exists in `containers/api/tests/`.

Items needing investigation before implementation (not a full research-phase, but an explicit pre-implementation check):
- **init.sh SERVERID patch (deferred):** Before scheduling, verify the exact `do_env()` function structure in the current linuxmuster-linbo7 4.3.31-0 `init.sh`. Also evaluate the GRUB cmdline alternative (passes `serverid=` in cmdline to override DHCP value before `do_env()` runs — avoids vanilla file modification entirely). This decision requires reading the current init.sh directly. See Pitfall 3 for the full risk analysis.
- **Module diff implementation:** Requires access to an LMN-generated linbofs64 as comparison target. Available on the main LMN server (10.0.0.11) but the comparison procedure needs to be documented before the script is written.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | LMN original read verbatim from GitHub raw URL (2026-03-10); Docker version read directly from working tree; all 15 divergences verified against actual code |
| Features | HIGH | Based on direct codebase analysis of all relevant services and scripts; session memory confirms operational history behind each feature gap |
| Architecture | HIGH | All findings derived from current codebase files read directly; integration points traced end-to-end with explicit risk analysis per seam |
| Pitfalls | HIGH | Based on 33+ sessions of operational history; Pitfalls 2 and 5 are confirmed incidents (Session 32 Remote Control Mode, Session 33 DEVNODES_CPIO bug), not hypothetical scenarios |

**Overall confidence:** HIGH

### Gaps to Address

- **init.sh SERVERID fix approach undecided:** Two viable approaches exist — hook-based patch vs GRUB cmdline override. Neither has been prototyped. The GRUB cmdline approach should be evaluated first as it avoids vanilla file modification entirely. Resolve during Phase 2/3 planning, not as part of the current phases.

- **Module diff requires LMN reference linbofs64:** The module diff script (Phase 3 deliverable) needs an LMN-generated linbofs64 as input. The LMN server at 10.0.0.11 has one, but the comparison procedure needs to be documented before the script is written. This is a process gap, not a technical gap.

- **Hook criticality model design is open:** Whether to use a `HOOK_REQUIRED=true` convention, a separate config file, or a different mechanism is undecided. Phase 2 should design this based on the first real failure case: Plymouth hook (advisory) vs a future init.sh patch hook (potentially critical) are at opposite ends of the spectrum.

- **Size regression thresholds need calibration:** The proposed 80MB warn / 200MB fail thresholds are estimates based on the current 55MB clean build. The actual historical range (pre-Session 33 was 172MB due to double-XZ bug) should be surveyed before setting final thresholds. Add this as a first step of Phase 3.

---

## Sources

### Primary (HIGH confidence — direct code read)

- `scripts/server/update-linbofs.sh` — complete Docker build pipeline, all 15 steps
- `containers/init/entrypoint.sh` — bootstrap flow, checkpoint system, kernel set provisioning
- `containers/api/src/services/linbo-update.service.js` — update orchestration, dual provisioning logic
- `containers/api/src/services/linbofs.service.js` — shell-out wrapper, key management
- `containers/api/src/routes/system/linbofs.js` — existing linbofs API surface
- `docs/hooks.md` — hook system specification and LMN compatibility table
- `docs/linbo-upgrade-flow.md` — complete upgrade flow with risk table
- `.planning/PROJECT.md` — v1.2 milestone definition and constraints
- LMN Original: [github.com/linuxmuster/linuxmuster-linbo7 serverfs/usr/sbin/update-linbofs](https://raw.githubusercontent.com/linuxmuster/linuxmuster-linbo7/main/serverfs/usr/sbin/update-linbofs) — retrieved 2026-03-10

### Session History (HIGH confidence — verified incidents)

- MEMORY.md Session 32 — module selection divergence root cause (Remote Control Mode on client)
- MEMORY.md Session 33 — DEVNODES_CPIO bug and double-XZ template bug, hook system creation
- MEMORY.md Session 30 — vanilla LINBO works without patches proof
- MEMORY.md Session 31 — HOST_KERNEL architecture removal

### Debug Documentation (HIGH confidence — incident records)

- `docs/debug/linbo/08-kernel-schutz.md` — kernel architecture history
- `docs/debug/linbo/09-kernel-version-bug.md` — atomic deployment lesson (Session 19)
- `.planning/codebase/CONCERNS.md` — fragile areas analysis

---
*Research completed: 2026-03-10*
*Ready for roadmap: yes*
