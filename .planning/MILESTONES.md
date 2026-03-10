# Project Milestones: LINBO Docker

## v1.2 linbofs Boot-Pipeline Transparency (Shipped: 2026-03-10)

**Delivered:** Full transparency and control over the linbofs64 build pipeline — admins can see exactly what Docker changes, hooks are observable via API, and package updates either pass integrity checks or fail loudly.

**Phases completed:** 13-15 (6 plans total)

**Key accomplishments:**
- LMN original update-linbofs.sh pinned as reference; `make linbofs-audit` and `make linbofs-diff` for linbofs64 introspection
- 16-row divergence catalog (docs/UNTERSCHIEDE-ZU-LINBO.md) documenting every Docker vs LMN difference with justification
- Build manifest JSON + `GET /system/hooks` API for hook observability; validate-hook.sh and new-hook.sh for hook lifecycle
- Build log retention (last 3 builds) and hook warning summary in .linbofs-patch-status
- Pre-injection path validation, size guards (80MB warn/200MB reject), and post-rebuild CPIO verification in update-linbofs.sh
- Module-diff script, APT repo check in doctor.sh, and 12 new tests (partial failure, concurrent 409, version edge cases)

**Stats:**
- 18 requirements, all complete
- 38 files created/modified, +6,300 / -204 lines
- 3 phases, 6 plans, 27 commits
- 1 day (2026-03-10)

**Git range:** `feat(13-01)` → `test(15-02)`

**What's next:** v2.0 — Security hardening (token revocation, execFile, API-key optimization), missing features (multicast, torrent, image versioning)

---

## v1.1 Fresh Install & Production Readiness (Shipped: 2026-03-10)

**Delivered:** A competent sysadmin can go from `git clone` to a working LINBO Docker deployment on a fresh VM — with reliable bootstrap, clear configuration, production-grade observability, and complete documentation.

**Phases completed:** 9-12 (6 plans total)

**Key accomplishments:**
- Init container hardened with structured error reporting, checkpoint-based recovery, and persistent .deb caching
- setup.sh configuration wizard with 7 prerequisite checks, IP auto-detection, cryptographic secrets, and port conflict detection
- wait-ready.sh health gate and doctor.sh diagnostics (24 checks across 6 categories)
- Docker Compose resource limits (memory + CPU) on all 8 services
- Complete German-language install guide (INSTALL.md) and admin guide (ADMIN-GUIDE.md) with Mermaid architecture diagrams
- README.md updated with correct DHCP boot filenames and install guide links

**Stats:**
- 36 files created/modified
- ~9.3k LOC JavaScript/TypeScript + ~6k LOC Shell
- 4 phases, 6 plans
- 3 days (2026-03-08 → 2026-03-10)

**Git range:** `feat(09-01)` → `feat(12-01)`

**What's next:** v2.0 — Security hardening (token revocation, execFile, API-key optimization), missing features (multicast, torrent, image versioning)

---

## v1.0 Hardening (Shipped: 2026-03-08)

**Delivered:** Production-ready security hardening, code quality improvements, and comprehensive test coverage for the existing LINBO Docker codebase.

**Phases completed:** 1-8 (13 plans total)

**Key accomplishments:**
- Pinned Docker base images and added .dockerignore for reproducible builds
- Secrets hardening: startup validation, rsyncd.secrets untracked, deploy script auth migration
- API security: WebSocket JWT verification, login rate limiting, CORS restriction
- system.js (1483 lines) split into 8 focused sub-routers
- All 48 silent catch blocks replaced with categorized logging
- Worker Prisma-optional guard and Redis KEYS→SCAN migration
- Unit tests for image-sync and terminal services
- Integration tests for WebSocket and frontend store tests

**Stats:**
- 16 requirements, all complete
- 8 phases, 13 plans
- 3 days (2026-03-06 → 2026-03-08)

**Git range:** `feat(01-01)` → `feat(08-02)`

**What's next:** v1.1 Fresh Install & Production Readiness

---
