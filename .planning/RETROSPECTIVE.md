# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.1 — Fresh Install & Production Readiness

**Shipped:** 2026-03-10
**Phases:** 4 | **Plans:** 6

### What Was Built
- Init container hardened with structured error reporting, checkpoint-based idempotent recovery, persistent .deb caching
- setup.sh configuration wizard (prerequisites, IP auto-detect, secure secrets, port conflict detection)
- wait-ready.sh health gate and doctor.sh diagnostics (24 checks, 6 categories)
- Docker Compose resource limits on all 8 services
- Complete install guide (INSTALL.md) and admin guide (ADMIN-GUIDE.md) with Mermaid diagrams

### What Worked
- Zero new npm dependencies — all features built with existing stack (POSIX shell, Docker Compose)
- Research-first approach: each phase started with domain research, preventing scope creep
- Shell-based tooling (setup.sh, doctor.sh, wait-ready.sh) proved the right abstraction level for admin workflows
- Checkpoint/idempotent pattern in init container enables safe re-runs after partial failures

### What Was Inefficient
- Phase 12 ROADMAP plan checkboxes not updated (marked `[ ]` despite summaries existing)
- v1.0 audit revealed Phase 3 missing VERIFICATION.md — retroactive verification gap

### Patterns Established
- Structured error blocks for shell scripts: title/details/cause/diagnostics/fix
- Checkpoint markers in well-known directories for idempotent operations
- German prose with English technical terms for admin documentation
- Mermaid diagrams (GitHub-native rendering) for architecture and network topology

### Key Lessons
1. Shell scripts > web wizards for one-time admin setup tasks — lower complexity, easier debugging
2. Prerequisite checks with clear PASS/FAIL output reduce support burden significantly
3. Separating install guide (procedural) from admin guide (reference) serves different admin needs

---

## Milestone: v1.0 — Hardening

**Shipped:** 2026-03-08
**Phases:** 8 | **Plans:** 13

### What Was Built
- Pinned Docker images, .dockerignore, secrets hardening, startup validation
- WebSocket JWT verification, login rate limiting, CORS restriction
- system.js split into 8 sub-routers
- All 48 silent catches categorized, Prisma-optional worker guard, Redis SCAN migration
- Unit tests (image-sync, terminal), integration tests (WebSocket), frontend store tests

### What Worked
- Systematic requirement-per-phase mapping ensured complete coverage
- Sub-router split (Phase 4) enabled parallel work on subsequent phases
- Test phases at end validated all prior changes without rework

### What Was Inefficient
- Phase 3 VERIFICATION.md gap only caught by milestone audit — should have been caught during execution
- Nyquist validation partial across most phases

### Patterns Established
- Prisma-optional pattern: `let prisma = null; try { ... } catch {}` for sync mode
- Categorized error handling: debug (optional), warn (degraded), rethrow (critical)
- Redis SCAN with cursor iteration instead of KEYS for production safety

### Key Lessons
1. Security phases early (2-3) prevent accumulating security debt across later work
2. Router decomposition (Phase 4) should happen before feature work, not after
3. Verification should be automated, not depend on manual VERIFICATION.md generation

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 8 | 13 | Established research-first, requirement-mapped phases |
| v1.1 | 4 | 6 | Zero dependencies, shell-first tooling, admin-focused |

### Top Lessons (Verified Across Milestones)

1. Research before planning prevents scope creep and unnecessary dependencies
2. Shell scripts are the right tool for admin-facing operations tooling
3. Verification gaps caught late are expensive — build verification into execution
