---
phase: 5
slug: error-handling-cleanup
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-08
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `containers/api/jest.config.js` |
| **Quick run command** | `grep -rn 'catch\s*{}\|\.catch(() => {})' containers/api/src/ \| grep -v '// WS broadcast' \| wc -l` |
| **Full suite command** | `cd containers/api && npx jest --runInBand` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run grep check — silent catch count should approach 0
- **After every plan wave:** Run `cd containers/api && npx jest --runInBand`
- **Before `/gsd:verify-work`:** Full suite must be green + grep returns 0
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | DEBT-01 | smoke (grep) | `grep -rn 'catch\s*{}\|\.catch(() => {})' containers/api/src/ \| grep -v '// WS broadcast' \| wc -l` returns 0 | N/A (grep check) | pending |
| 05-01-02 | 01 | 1 | DEBT-01 | unit | `cd containers/api && npx jest --runInBand` | Existing suite | pending |
| 05-01-03 | 01 | 1 | DEBT-01 | manual | Start API in sync + standalone mode, verify no spurious warnings | manual-only | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files needed. The verification is primarily grep-based (zero remaining silent catches) and manual smoke test (no spurious warnings).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| No spurious warnings during startup | DEBT-01 | Requires running API server in both modes | 1. Start API in standalone mode, check for unexpected warn/error. 2. Start API in sync mode, check for unexpected warn/error. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
