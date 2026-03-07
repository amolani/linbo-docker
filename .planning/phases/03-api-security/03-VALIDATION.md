---
phase: 3
slug: api-security
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `containers/api/jest.config.js` |
| **Quick run command** | `cd containers/api && npx jest tests/middleware/ws-auth.test.js tests/middleware/rate-limit.test.js tests/startup-validation.test.js --runInBand` |
| **Full suite command** | `cd containers/api && npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd containers/api && npx jest tests/middleware/ws-auth.test.js tests/middleware/rate-limit.test.js tests/startup-validation.test.js --runInBand`
- **After every plan wave:** Run `cd containers/api && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | PROD-06 | unit | `npx jest tests/middleware/ws-auth.test.js --runInBand` | No -- Wave 0 | pending |
| 03-01-02 | 01 | 1 | PROD-06 | unit | `npx jest tests/middleware/ws-auth.test.js --runInBand` | No -- Wave 0 | pending |
| 03-01-03 | 01 | 1 | PROD-06 | unit | `npx jest tests/middleware/ws-auth.test.js --runInBand` | No -- Wave 0 | pending |
| 03-02-01 | 02 | 1 | PROD-07 | unit | `npx jest tests/middleware/rate-limit.test.js --runInBand` | No -- Wave 0 | pending |
| 03-02-02 | 02 | 1 | PROD-07 | unit | `npx jest tests/middleware/rate-limit.test.js --runInBand` | No -- Wave 0 | pending |
| 03-02-03 | 02 | 1 | PROD-08 | unit | `npx jest tests/startup-validation.test.js --runInBand` | Partial | pending |

---

## Wave 0 Requirements

- [ ] `tests/middleware/ws-auth.test.js` — stubs for PROD-06 (WS JWT verification at upgrade)
- [ ] `tests/middleware/rate-limit.test.js` — stubs for PROD-07 (login rate limiting)
- [ ] New test cases in existing `tests/startup-validation.test.js` — stubs for PROD-08 (CORS warning)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Frontend handles WS 401 gracefully | PROD-06 | UI behavior, reconnect loop | Open browser, clear token, verify WS doesn't crash |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
