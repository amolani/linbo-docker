---
phase: 10
slug: configuration-install-script
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual shell testing + `docker compose config --quiet` |
| **Config file** | none — setup.sh is tested by running it |
| **Quick run command** | `bash setup.sh` (interactive run) |
| **Full suite command** | `bash setup.sh && docker compose config --quiet` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bash setup.sh` on development server, verify .env output
- **After every plan wave:** Full cycle: fresh run + re-run (backup detection) + port conflict simulation
- **Before `/gsd:verify-work`:** All 5 success criteria verified manually
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | BOOT-01 | smoke | `bash setup.sh && docker compose config --quiet` | N/A - new | ⬜ pending |
| 10-01-02 | 01 | 1 | BOOT-02 | smoke | `bash setup.sh` — verify PASS/FAIL output | N/A - new | ⬜ pending |
| 10-01-03 | 01 | 1 | BOOT-03 | smoke | `bash setup.sh` — verify IP matches `ip route get 1.1.1.1` | N/A - new | ⬜ pending |
| 10-01-04 | 01 | 1 | BOOT-04 | smoke | `grep JWT_SECRET .env | wc -c` — verify >= 60 chars | N/A - new | ⬜ pending |
| 10-02-01 | 02 | 2 | ERR-03 | smoke | Start dummy port 69 listener, run `bash setup.sh` — verify FAIL | N/A - new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `setup.sh` does not exist yet — must be created
- [ ] `.env.example` needs consolidation to match setup.sh output
- [ ] `config/rsyncd.secrets` generation/sync with .env RSYNC_PASSWORD

*Shell script testing via direct execution. No complex test framework warranted for a one-time deployment script.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| .env produced without editing | BOOT-01 | Interactive prompts | Run `setup.sh` on fresh VM, verify .env has all vars |
| Prerequisites PASS/FAIL | BOOT-02 | Requires system without Docker for FAIL case | Test on both Docker and non-Docker hosts |
| IP auto-detected | BOOT-03 | Requires network interface inspection | Run `setup.sh`, compare detected IP to `ip route` |
| Secrets cryptographically random | BOOT-04 | Requires inspecting generated values | Check JWT_SECRET length, verify not in defaults list |
| Port conflict detection | ERR-03 | Requires dummy listener on port 69 | `socat UDP-LISTEN:69,fork /dev/null &` then run `setup.sh` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
