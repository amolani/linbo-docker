---
phase: 14
slug: hook-observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.x (existing) + smoke tests (bash) |
| **Config file** | `containers/api/jest.config.js` |
| **Quick run command** | `docker exec linbo-api npx jest --testPathPattern=hook --runInBand` |
| **Full suite command** | `docker exec linbo-api npm test` |
| **Estimated runtime** | ~10 seconds (quick), ~30 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `docker exec linbo-api npx jest --testPathPattern=hook --runInBand`
- **After every plan wave:** Run `docker exec linbo-api npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | HOOK-01 | smoke | `grep -q '"hooks"' /srv/linbo/.linbofs-build-manifest.json` | No (W0) | pending |
| 14-01-02 | 01 | 1 | HOOK-06 | smoke | `grep -q 'hooks|' /srv/linbo/.linbofs-patch-status` | No (W0) | pending |
| 14-01-03 | 01 | 1 | HOOK-04 | smoke | `docker exec linbo-api bash /usr/share/linuxmuster/linbo/validate-hook.sh --all` | No (W0) | pending |
| 14-02-01 | 02 | 2 | HOOK-02 | unit | `docker exec linbo-api npx jest tests/services/linbofs.service.test.js` | Yes (extend) | pending |
| 14-02-02 | 02 | 2 | HOOK-03 | unit | `docker exec linbo-api npx jest tests/routes/system.hooks.test.js` | Created by 14-02 Task 2 | pending |
| 14-02-03 | 02 | 2 | HOOK-05 | smoke | `make new-hook NAME=test TYPE=pre` | No (W0) | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `containers/api/tests/services/hook.service.test.js` — covers HOOK-01, HOOK-03, HOOK-06 (created by Plan 14-02 Task 1)
- [ ] `containers/api/tests/routes/system.hooks.test.js` — covers HOOK-03 route-level (created by Plan 14-02 Task 2)
- [ ] No framework install needed — Jest already configured

*Both test files are created by Plan 14-02 tasks, not Wave 0 prerequisites. Existing `linbofs.service.test.js` will be extended for HOOK-02 (build log rotation).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scaffold generates usable hook | HOOK-05 | Template quality requires human review | Run `make new-hook NAME=test TYPE=pre`, inspect generated file for exported variable docs and error handling boilerplate |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
