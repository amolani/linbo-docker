---
phase: 9
slug: init-container-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Shell-based integration testing (no framework — POSIX sh validation) |
| **Config file** | none — manual verification protocol |
| **Quick run command** | `docker compose build init && docker compose run --rm init` |
| **Full suite command** | `docker compose run --rm init && docker compose run --rm -e FORCE_UPDATE=true init` |
| **Estimated runtime** | ~60 seconds (includes Docker build + APT fetch) |

---

## Sampling Rate

- **After every task commit:** `docker compose build init && docker compose run --rm init` (verify no regressions)
- **After every plan wave:** Full cycle: clean run + forced re-run + simulated failure + resume
- **Before `/gsd:verify-work`:** All 4 success criteria verified manually with observed output
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 1 | ERR-01a | manual+smoke | Disconnect DNS, run `docker compose run --rm init` — verify structured error block | N/A - manual | ⬜ pending |
| 9-01-02 | 01 | 1 | ERR-01b | manual+smoke | Corrupt cached .deb, run init — verify hash error with expected vs actual | N/A - manual | ⬜ pending |
| 9-01-03 | 01 | 1 | ERR-01c | manual+smoke | Set volume to root:root, run init — verify permission error with chown suggestion | N/A - manual | ⬜ pending |
| 9-02-01 | 02 | 1 | ERR-01d | manual+smoke | Run init (success), corrupt one step, re-run — verify skip messages | N/A - manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

No automated test framework needed — shell script validation is inherently integration-level (requires Docker, volumes, network). Manual verification protocol with specific commands is more practical than bats-core/shunit2 for 6 checkpoint markers and 4 error types.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| APT fetch structured error | ERR-01a | Requires DNS failure simulation | 1. `docker compose run --rm -e DEB_BASE_URL=https://nonexistent.example.com init` 2. Verify ERROR/Cause/Diagnostics/Fix block on stderr |
| SHA256 mismatch error | ERR-01b | Requires corrupted .deb file | 1. Run init successfully 2. Corrupt `/srv/linbo/.cache/*.deb` 3. Remove boot-files checkpoint 4. Re-run init 5. Verify expected vs actual hash display |
| Permission error (EACCES) | ERR-01c | Requires volume permission manipulation | 1. `docker compose run --rm -u 1001:1001 init` with root-owned volume 2. Verify path + current ownership + chown suggestion |
| Checkpoint resume | ERR-01d | Requires partial failure simulation | 1. Run init to completion 2. Remove `.checkpoint-boot-files` 3. Re-run init 4. Verify "Resuming" banner + skip messages for completed steps |

---

## Validation Sign-Off

- [ ] All tasks have manual verification protocol defined
- [ ] Sampling continuity: every task commit gets smoke test
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
