---
phase: 4
slug: system-router-split
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `containers/api/jest.config.js` |
| **Quick run command** | `cd containers/api && npx jest tests/routes/system.linbo-update.test.js --no-coverage` |
| **Full suite command** | `cd containers/api && npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd containers/api && npx jest tests/routes/system.linbo-update.test.js --no-coverage`
- **After every plan wave:** Run `cd containers/api && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | DEBT-02 | smoke | `cd containers/api && npx jest tests/routes/system.linbo-update.test.js --no-coverage` | Yes | pending |
| 04-01-02 | 01 | 1 | DEBT-02 | unit | `node -e "require('./containers/api/src/routes/system/kernel')"` | No — Wave 0 | pending |
| 04-01-03 | 01 | 1 | DEBT-02 | integration | `cd containers/api && npx jest tests/routes/system.linbo-update.test.js --no-coverage` | Yes | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- No new test files needed — existing test covers the critical path (aggregator import + endpoint identity)
- Test file requires no changes since `require('../../src/routes/system')` resolves to the new `system/index.js`
- Manual verification: `node -e "const r = require('./containers/api/src/routes/system/kernel'); console.log(r.stack.length)"` for each sub-router to confirm individual importability

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sub-router individual import | DEBT-02 | Node require() check, not Jest-testable without new fixtures | Run `node -e "require('./containers/api/src/routes/system/X')"` for each of 8 sub-routers |
| Line count per sub-router | DEBT-02 | Structural metric | Run `wc -l containers/api/src/routes/system/*.js` and verify each < 300 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
