---
phase: 13
slug: pipeline-diff-documentation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Smoke tests (bash) + manual inspection |
| **Config file** | none — no test framework needed for this phase |
| **Quick run command** | `test -f scripts/server/update-linbofs-lmn-original.sh && grep -q "LINBOFS64 ARCHIVE FORMAT" scripts/server/update-linbofs.sh` |
| **Full suite command** | `make linbofs-audit 2>&1 \| head -20 && make linbofs-diff 2>&1 \| head -20` |
| **Estimated runtime** | ~5 seconds (smoke), ~30 seconds (full with container) |

---

## Sampling Rate

- **After every task commit:** Run quick smoke checks (`test -f`, `grep -q`)
- **After every plan wave:** Run `make linbofs-audit` and `make linbofs-diff` on running Docker environment
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | DIFF-01 | smoke | `test -f scripts/server/update-linbofs-lmn-original.sh` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | DIFF-05 | smoke | `grep -q "LINBOFS64 ARCHIVE FORMAT" scripts/server/update-linbofs.sh` | ❌ W0 | ⬜ pending |
| 13-01-03 | 01 | 1 | DIFF-04 | manual | Visual inspection of 3-column table in docs/UNTERSCHIEDE-ZU-LINBO.md | N/A | ⬜ pending |
| 13-02-01 | 02 | 1 | DIFF-02 | smoke | `make linbofs-audit 2>&1 \| grep -q "Kernel"` | ❌ W0 | ⬜ pending |
| 13-02-02 | 02 | 1 | DIFF-03 | smoke | `make linbofs-diff 2>&1 \| grep -q "ADDED\|REMOVED\|files"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/server/update-linbofs-lmn-original.sh` — extracted from LMN zip (DIFF-01)
- [ ] `scripts/server/linbofs-audit.sh` — new audit script (DIFF-02)
- [ ] `scripts/server/linbofs-diff.sh` — new diff script (DIFF-03)
- [ ] Makefile targets `linbofs-audit` and `linbofs-diff` — Makefile update

*Existing infrastructure covers Jest tests — this phase uses smoke tests and manual inspection only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 3-column divergence table completeness | DIFF-04 | Content accuracy requires human review | Open `docs/UNTERSCHIEDE-ZU-LINBO.md`, verify every section of update-linbofs.sh that differs has a table row with LMN/Docker/Justification columns |
| CPIO format header comment accuracy | DIFF-05 | Documentation correctness requires human review | Read update-linbofs.sh header, verify it explains the concatenated CPIO+XZ two-segment format accurately |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
