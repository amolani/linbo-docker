---
phase: 8
slug: integration-and-frontend-tests
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (backend)** | Jest 29.7.0 |
| **Framework (frontend)** | Vitest 1.6.1 |
| **Config file (backend)** | `containers/api/jest.config.js` |
| **Config file (frontend)** | `containers/web/frontend/vitest.config.ts` |
| **Quick run command (backend)** | `cd containers/api && npx jest tests/integration/websocket.test.js --verbose` |
| **Quick run command (frontend)** | `cd containers/web/frontend && npx vitest run src/__tests__/stores/ --reporter=verbose` |
| **Full suite command (backend)** | `cd containers/api && npx jest --runInBand` |
| **Full suite command (frontend)** | `cd containers/web/frontend && npx vitest run` |
| **Estimated runtime** | ~15 seconds (backend WS ~5s, frontend stores ~3s) |

---

## Sampling Rate

- **After every task commit:** Run the specific test file for the task
- **After every plan wave:** Full suite for that side (backend or frontend)
- **Before `/gsd:verify-work`:** Both full suites must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | TEST-03 | integration | `cd containers/api && npx jest tests/integration/websocket.test.js -t "valid JWT" --verbose -x` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | TEST-03 | integration | `cd containers/api && npx jest tests/integration/websocket.test.js -t "without JWT" --verbose -x` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | TEST-03 | integration | `cd containers/api && npx jest tests/integration/websocket.test.js -t "heartbeat" --verbose -x` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 1 | TEST-03 | integration | `cd containers/api && npx jest tests/integration/websocket.test.js -t "channel" --verbose -x` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | TEST-04 | unit | `cd containers/web/frontend && npx vitest run src/__tests__/stores/wsStore.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 1 | TEST-04 | unit | `cd containers/web/frontend && npx vitest run src/__tests__/stores/hostStore.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-03 | 02 | 1 | TEST-04 | unit | `cd containers/web/frontend && npx vitest run src/__tests__/stores/serverConfigStore.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `containers/api/tests/integration/` directory — new directory for integration tests
- [ ] `containers/api/tests/integration/websocket.test.js` — covers TEST-03
- [ ] `containers/web/frontend/src/__tests__/stores/wsStore.test.ts` — covers TEST-04a
- [ ] `containers/web/frontend/src/__tests__/stores/hostStore.test.ts` — covers TEST-04b
- [ ] `containers/web/frontend/src/__tests__/stores/serverConfigStore.test.ts` — covers TEST-04c

*Existing infrastructure (Jest, Vitest, setup files) covers framework needs. No new dependencies.*

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
