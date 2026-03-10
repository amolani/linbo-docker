---
phase: 15
slug: update-regression-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `containers/api/jest.config.js` |
| **Quick run command** | `cd containers/api && npx jest tests/services/linbo-update.service.test.js --runInBand` |
| **Full suite command** | `cd containers/api && npx jest --runInBand` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd containers/api && npx jest tests/services/linbo-update.service.test.js --runInBand`
- **After every plan wave:** Run `cd containers/api && npx jest --runInBand`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | UPD-02 | manual | `docker exec linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh` | N/A (shell) | pending |
| 15-01-02 | 01 | 1 | UPD-03, UPD-04 | manual | `docker exec linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh` | N/A (shell) | pending |
| 15-01-03 | 01 | 1 | UPD-05 | manual | `docker exec linbo-api bash /usr/share/linuxmuster/linbo/linbofs-module-diff.sh` | Wave 0 (NEW) | pending |
| 15-01-04 | 01 | 1 | UPD-07 | manual | `make doctor` | N/A (shell) | pending |
| 15-02-01 | 02 | 2 | UPD-01 | unit | `cd containers/api && npx jest tests/services/linbo-update.service.test.js --runInBand` | Exists (extending) | pending |
| 15-02-02 | 02 | 2 | UPD-06 | manual-only | Review `docs/linbo-upgrade-flow.md` | Exists (extending) | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `scripts/server/linbofs-module-diff.sh` — new script for UPD-05

*Existing infrastructure covers all other phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pre-injection path check | UPD-02 | Shell script guard; requires tampered linbofs64 template | Remove a directory from extracted linbofs, run update-linbofs.sh, verify error message |
| Size range check | UPD-03 | Build output inspection | Run update-linbofs.sh, check output for size warning/error messages |
| CPIO verification | UPD-04 | Build output inspection | Run update-linbofs.sh, check output for CPIO verification step |
| Module-diff script | UPD-05 | Requires two linbofs64 files for comparison | Run linbofs-module-diff.sh with both Docker and LMN linbofs64 |
| APT repo check | UPD-07 | Network-dependent | Run `make doctor`, check APT Repository category output |
| Boot-test runbook | UPD-06 | Documentation review | Read docs/linbo-upgrade-flow.md for runbook completeness |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
