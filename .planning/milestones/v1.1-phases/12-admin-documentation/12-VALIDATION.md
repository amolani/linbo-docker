---
phase: 12
slug: admin-documentation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-10
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification (documentation phase) |
| **Config file** | N/A |
| **Quick run command** | Verify Markdown renders correctly on GitHub |
| **Full suite command** | Follow INSTALL.md on a fresh VM and verify PXE boot |
| **Estimated runtime** | ~5 minutes (manual review) |

---

## Sampling Rate

- **After every task commit:** Verify Markdown renders (paste into GitHub preview or mermaid.live)
- **After every plan wave:** Read complete document end-to-end for coherence
- **Before `/gsd:verify-work`:** Full walkthrough of INSTALL.md on mental model of fresh VM
- **Max feedback latency:** N/A (manual)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | DOC-01 | manual-only | Read docs/INSTALL.md, verify no gaps | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | DOC-02 | manual-only | Read docs/ADMIN-GUIDE.md, verify accuracy vs docker-compose.yml | ❌ W0 | ⬜ pending |
| 12-01-03 | 01 | 1 | DOC-03 | manual-only | Verify Mermaid renders, cross-check ports vs docker-compose.yml | ❌ W0 | ⬜ pending |
| 12-01-04 | 01 | 1 | DOC-01 | manual-only | Verify README links to INSTALL.md, Quick Start stripped | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No test infrastructure needed for a documentation phase — verification is by review.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| INSTALL.md complete walkthrough | DOC-01 | Documentation accuracy requires human comprehension | Read end-to-end, verify no gaps from VM setup to PXE boot |
| ADMIN-GUIDE.md container details | DOC-02 | Architecture accuracy needs cross-referencing | Compare claimed ports/volumes against docker-compose.yml |
| Network diagram + firewall table | DOC-03 | Mermaid rendering + port accuracy | Render Mermaid, cross-check ports against docker-compose.yml |
| README updated | DOC-01 | Quick Start removal needs editorial review | Verify old Quick Start gone, link to INSTALL.md present |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < N/A (manual phase)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
