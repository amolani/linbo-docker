---
phase: 2
slug: secrets-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 |
| **Config file** | `containers/api/jest.config.js` |
| **Quick run command** | `cd containers/api && npx jest tests/startup-validation.test.js --runInBand -x` |
| **Full suite command** | `cd containers/api && npx jest --runInBand` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd containers/api && npx jest tests/startup-validation.test.js --runInBand -x`
- **After every plan wave:** Run `cd containers/api && npx jest --runInBand`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PROD-02 | unit | `cd containers/api && npx jest tests/startup-validation.test.js --runInBand -x` | No — W0 | pending |
| 02-01-02 | 01 | 1 | PROD-02 | unit | `cd containers/api && npx jest tests/startup-validation.test.js --runInBand -x` | No — W0 | pending |
| 02-01-03 | 01 | 1 | PROD-05 | manual | `git ls-files config/rsyncd.secrets` returns empty | N/A | pending |
| 02-02-01 | 02 | 1 | PROD-04 | manual | Manual: deploy to test server with --rebuild | N/A | pending |
| 02-02-02 | 02 | 1 | PROD-04 | manual | `grep -c 'Muster' scripts/deploy.sh` returns 0 | N/A | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [ ] `containers/api/tests/startup-validation.test.js` — covers PROD-02 (validateSecrets function: production exit, development warning)
- [ ] No additional framework install needed — Jest is already configured

*Existing infrastructure covers most phase requirements. Only PROD-02 needs new test file.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deploy script reads INTERNAL_API_KEY from remote .env | PROD-04 | Requires SSH to remote server | Run `scripts/deploy.sh <target> --rebuild`, verify API call uses Bearer auth |
| Deploy script has no hardcoded admin/Muster! | PROD-04 | Code review | `grep -c 'Muster' scripts/deploy.sh` should return 0 |
| rsyncd.secrets not tracked in git | PROD-05 | Git state check | `git ls-files config/rsyncd.secrets` should return empty |
| rsyncd.secrets.example exists with placeholder | PROD-05 | File existence check | `test -f config/rsyncd.secrets.example && cat config/rsyncd.secrets.example` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
