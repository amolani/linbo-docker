---
phase: 11
slug: production-hardening-observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 (existing, for API unit tests) + shell smoke tests |
| **Config file** | `containers/api/jest.config.js` |
| **Quick run command** | `docker compose config --quiet` |
| **Full suite command** | `docker exec linbo-api npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `docker compose config --quiet` (validates compose syntax)
- **After every plan wave:** Run `./scripts/doctor.sh` + `./scripts/wait-ready.sh`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | ERR-02 | smoke | `./scripts/wait-ready.sh && echo PASS` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | HARD-01 | smoke | `docker compose config \| grep -c "memory:"` | ✅ | ⬜ pending |
| 11-01-03 | 01 | 1 | HARD-02 | smoke | `./scripts/doctor.sh` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/wait-ready.sh` — new script for ERR-02
- [ ] `scripts/doctor.sh` — new script for HARD-02
- [ ] Compose syntax validation after adding resource limits

*Shell scripts validated via smoke testing on running deployment, not unit tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| wait-ready blocks until healthy | ERR-02 | Requires running containers | Run `make wait-ready` after `make up`, verify it blocks and then returns |
| doctor checks all 6 categories | HARD-02 | Requires running containers with volumes | Run `make doctor`, verify PASS/FAIL for each check |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
