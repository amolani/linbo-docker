---
phase: 6
slug: isolated-debt-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `containers/api/jest.config.js` |
| **Quick run command** | `cd containers/api && npx jest --testPathPattern="(operation.worker|redis)" --no-coverage` |
| **Full suite command** | `cd containers/api && npx jest --no-coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd containers/api && npx jest --testPathPattern="(operation.worker|redis)" --no-coverage`
- **After every plan wave:** Run `cd containers/api && npx jest --no-coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | DEBT-03 | unit | `cd containers/api && npx jest tests/workers/operation.worker.test.js -x --no-coverage` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | DEBT-04 | unit | `cd containers/api && npx jest tests/lib/redis.test.js -x --no-coverage` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `containers/api/tests/workers/operation.worker.test.js` — stubs for DEBT-03 (sync-mode disabled worker state)
- [ ] `containers/api/tests/lib/redis.test.js` — stubs for DEBT-04 (SCAN-based delPattern)

*These test files must be created before or during task execution.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| All 18 callers of delPattern unchanged | DEBT-04 | Visual inspection — all use identical `await redis.delPattern('prefix:*')` signature | `grep -rn 'delPattern' containers/api/src/` confirms no caller changes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
