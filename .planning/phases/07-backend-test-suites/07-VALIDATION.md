---
phase: 7
slug: backend-test-suites
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `containers/api/jest.config.js` |
| **Quick run command** | `cd containers/api && npx jest tests/services/image-sync.service.test.js tests/services/terminal.service.test.js --runInBand --verbose` |
| **Full suite command** | `cd containers/api && npx jest --runInBand` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd containers/api && npx jest tests/services/image-sync.service.test.js tests/services/terminal.service.test.js --runInBand --verbose`
- **After every plan wave:** Run `cd containers/api && npx jest --runInBand`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | TEST-01 | unit | `npx jest tests/mocks/redis.js --runInBand` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | TEST-01 | unit | `npx jest tests/services/image-sync.service.test.js -t "resume" --runInBand -x` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | TEST-01 | unit | `npx jest tests/services/image-sync.service.test.js -t "md5\|hash\|verify" --runInBand -x` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | TEST-01 | unit | `npx jest tests/services/image-sync.service.test.js -t "atomic\|swap" --runInBand -x` | ❌ W0 | ⬜ pending |
| 07-01-05 | 01 | 1 | TEST-01 | unit | `npx jest tests/services/image-sync.service.test.js -t "queue" --runInBand -x` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 1 | TEST-02 | unit | `npx jest tests/services/terminal.service.test.js -t "create\|destroy" --runInBand -x` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 1 | TEST-02 | unit | `npx jest tests/services/terminal.service.test.js -t "fallback\|exec" --runInBand -x` | ❌ W0 | ⬜ pending |
| 07-02-03 | 02 | 1 | TEST-02 | unit | `npx jest tests/services/terminal.service.test.js -t "idle\|timeout" --runInBand -x` | ❌ W0 | ⬜ pending |
| 07-02-04 | 02 | 1 | TEST-02 | unit | `npx jest tests/services/terminal.service.test.js -t "orphan\|destroyAll\|cleanup" --runInBand -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/mocks/redis.js` — shared Redis mock module with list operations (rpush/lpop/lrange/lrem)
- [ ] `tests/services/image-sync.service.test.js` — stubs for TEST-01
- [ ] `tests/services/terminal.service.test.js` — stubs for TEST-02

*Existing infrastructure (jest.config.js, setup.js, globalSetup.js) covers framework needs.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
