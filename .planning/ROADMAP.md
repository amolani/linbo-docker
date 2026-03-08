# Roadmap: LINBO Docker

## Milestones

- Complete **v1.0 Hardening** - Phases 1-8 (shipped 2026-03-08)
- Current **v1.1 Fresh Install & Production Readiness** - Phases 9-12 (in progress)

## Phases

<details>
<summary>v1.0 Hardening (Phases 1-8) - SHIPPED 2026-03-08</summary>

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Build Hygiene** - Pin Docker base images and add .dockerignore files for reproducible, clean builds (completed 2026-03-06)
- [x] **Phase 2: Secrets Hardening** - Remove tracked secrets, enforce non-default credentials, fix deploy script auth
- [x] **Phase 3: API Security** - Add WebSocket JWT verification, login rate-limiting, and CORS restriction (completed 2026-03-07)
- [x] **Phase 4: System Router Split** - Break system.js (1483 lines) into focused sub-routers
- [x] **Phase 5: Error Handling Cleanup** - Replace all 48 silent catch blocks with categorized logging (completed 2026-03-08)
- [x] **Phase 6: Isolated Debt Fixes** - Apply Prisma-optional guard to worker and replace Redis KEYS with SCAN
- [x] **Phase 7: Backend Test Suites** - Unit tests for image-sync and terminal services
- [x] **Phase 8: Integration and Frontend Tests** - WebSocket integration tests and frontend store tests

### Phase 1: Build Hygiene
**Goal**: Docker builds are reproducible and free of host contamination
**Depends on**: Nothing (first phase)
**Requirements**: PROD-01, PROD-03
**Plans**: 1 plan

Plans:
- [x] 01-01: Pin base images to exact versions and add .dockerignore files

### Phase 2: Secrets Hardening
**Goal**: No default credentials or tracked secrets can reach production
**Depends on**: Phase 1
**Requirements**: PROD-02, PROD-04, PROD-05
**Plans**: 2 plans

Plans:
- [x] 02-01: Startup validation for secrets and rsyncd.secrets git cleanup
- [x] 02-02: Deploy script auth migration (INTERNAL_API_KEY from remote .env)

### Phase 3: API Security
**Goal**: API endpoints are protected against unauthenticated WebSocket access, brute-force login, and cross-origin abuse
**Depends on**: Phase 2
**Requirements**: PROD-06, PROD-07, PROD-08
**Plans**: 2 plans

Plans:
- [x] 03-01: WebSocket JWT/API-key verification at upgrade handshake
- [x] 03-02: Login rate limiting, CORS default change, trust proxy config

### Phase 4: System Router Split
**Goal**: The monolithic system.js route file is decomposed into focused, maintainable sub-routers
**Depends on**: Phase 3
**Requirements**: DEBT-02
**Plans**: 1 plan

Plans:
- [x] 04-01: Extract 8 sub-routers into routes/system/ directory

### Phase 5: Error Handling Cleanup
**Goal**: Every catch block in the codebase either logs meaningfully or rethrows
**Depends on**: Phase 4
**Requirements**: DEBT-01
**Plans**: 2 plans

Plans:
- [x] 05-01: Categorize 29 silent catches in service files
- [x] 05-02: Categorize 19 silent catches in routes, middleware, and index.js

### Phase 6: Isolated Debt Fixes
**Goal**: Worker resilience in sync mode and Redis performance at scale
**Depends on**: Phase 4
**Requirements**: DEBT-03, DEBT-04
**Plans**: 1 plan

Plans:
- [x] 06-01: Worker Prisma-optional guard and Redis SCAN migration

### Phase 7: Backend Test Suites
**Goal**: Critical backend services have comprehensive unit test coverage
**Depends on**: Phase 5, Phase 6
**Requirements**: TEST-01, TEST-02
**Plans**: 2 plans

Plans:
- [x] 07-01: Shared Redis mock and image-sync service unit tests
- [x] 07-02: Terminal service unit tests

### Phase 8: Integration and Frontend Tests
**Goal**: WebSocket behavior and frontend state management are verified by automated tests
**Depends on**: Phase 3, Phase 7
**Requirements**: TEST-03, TEST-04
**Plans**: 2 plans

Plans:
- [x] 08-01: WebSocket integration tests
- [x] 08-02: Frontend store tests

</details>

## v1.1 Fresh Install & Production Readiness (In Progress)

**Milestone Goal:** A competent sysadmin can go from `git clone` to a working LINBO Docker deployment on a fresh VM -- with reliable bootstrap, clear configuration, production-grade observability, and complete documentation.

**Phase Numbering:**
- Integer phases (9, 10, 11, 12): Planned milestone work
- Decimal phases (10.1, 10.2): Urgent insertions if needed

- [x] **Phase 9: Init Container Hardening** - Structured error reporting, idempotent checkpoints, retry logic for network failures (completed 2026-03-08)
- [x] **Phase 10: Configuration & Install Script** - setup.sh with prerequisites, .env generation, IP auto-detect, port conflict detection (completed 2026-03-08)
- [ ] **Phase 11: Production Hardening & Observability** - wait-ready health gate, resource limits, make doctor diagnostics
- [ ] **Phase 12: Admin Documentation** - Install guide, architecture overview, network diagram for sysadmins

## Phase Details

### Phase 9: Init Container Hardening
**Goal**: The init container reports exactly what failed, why, and what to do about it -- and can recover from partial failures without manual cleanup
**Depends on**: Nothing (first v1.1 phase, no dependency on v1.0 phases)
**Requirements**: ERR-01
**Success Criteria** (what must be TRUE):
  1. When an APT fetch fails, the admin sees a structured error message naming the package, the error type, and a concrete fix (e.g., "check DNS" or "set HTTP_PROXY")
  2. When SHA256 verification fails for a downloaded file, the error message shows expected vs actual hash and tells the admin to retry or check the APT mirror
  3. When a permission error occurs (EACCES), the error message identifies the path and suggests the chown command to fix it
  4. After a partial failure (e.g., network timeout mid-download), re-running `docker compose up init` resumes from the last completed checkpoint without repeating successful steps
**Plans**: 2 plans

Plans:
- [x] 09-01-PLAN.md -- Error reporting infrastructure, pre-flight checks, and checkpoint helper functions
- [x] 09-02-PLAN.md -- Rewire main flow with checkpoint guards, structured errors, and success summary

### Phase 10: Configuration & Install Script
**Goal**: An admin runs `./setup.sh` once and gets a complete, validated `.env` file with auto-detected network settings, secure secrets, and pre-checked system prerequisites
**Depends on**: Phase 9
**Requirements**: BOOT-01, BOOT-02, BOOT-03, BOOT-04, ERR-03
**Success Criteria** (what must be TRUE):
  1. Running `./setup.sh` on a fresh VM produces a `.env` file with all required variables populated -- no manual editing needed for standard deployments
  2. The script checks Docker version, available disk space, DNS resolution, and network connectivity, showing a clear PASS/FAIL for each prerequisite
  3. LINBO_SERVER_IP is auto-detected from the network interface on the PXE subnet; the admin confirms or overrides the detected value
  4. JWT_SECRET and INTERNAL_API_KEY are generated as cryptographically secure random strings (not default/placeholder values)
  5. Before starting containers, the script detects if TFTP (69/udp) or rsync (873) ports are already in use and names the conflicting process with a suggested resolution
**Plans**: 1 plan

Plans:
- [x] 10-01-PLAN.md -- setup.sh configuration wizard, .env generation, prerequisites, port detection, .env.example consolidation

### Phase 11: Production Hardening & Observability
**Goal**: Admins can verify system health after deployment and containers run within defined resource boundaries
**Depends on**: Phase 10
**Requirements**: ERR-02, HARD-01, HARD-02
**Success Criteria** (what must be TRUE):
  1. `make wait-ready` blocks until all containers report healthy, or prints which container is not ready and why (with last 5 log lines) after a configurable timeout
  2. Every container in docker-compose.yml has explicit memory and CPU limits that prevent a single container from consuming all host resources
  3. `make doctor` checks container health, volume permissions (write test), SSH key presence, linbofs64 build status, Redis connectivity, and PXE port reachability -- printing PASS/FAIL for each check with fix suggestions for failures
**Plans**: TBD

Plans:
- [ ] 11-01: TBD
- [ ] 11-02: TBD

### Phase 12: Admin Documentation
**Goal**: A sysadmin with no prior exposure to the project can follow the documentation from VM setup to verified PXE boot without needing developer assistance
**Depends on**: Phase 9, Phase 10, Phase 11
**Requirements**: DOC-01, DOC-02, DOC-03
**Success Criteria** (what must be TRUE):
  1. The install guide (`docs/INSTALL.md`) walks an admin from bare Ubuntu/Debian VM through prerequisites, setup.sh, container startup, and verification of the first PXE boot -- with no gaps requiring guesswork
  2. The architecture document explains each container's role, which ports it uses, which volumes it mounts, and the startup dependency order -- readable by an admin who has never seen the codebase
  3. The network diagram shows all connections between PXE client and LINBO Docker (TFTP, HTTP, rsync, SSH) with port numbers and required firewall rules -- usable as a reference when configuring network infrastructure
**Plans**: TBD

Plans:
- [ ] 12-01: TBD
- [ ] 12-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 9 -> 10 -> 11 -> 12

Note: Phase 12 (Documentation) depends on all three prior phases being stable, since docs must describe final behavior.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Build Hygiene | v1.0 | 1/1 | Complete | 2026-03-06 |
| 2. Secrets Hardening | v1.0 | 2/2 | Complete | 2026-03-07 |
| 3. API Security | v1.0 | 2/2 | Complete | 2026-03-07 |
| 4. System Router Split | v1.0 | 1/1 | Complete | 2026-03-07 |
| 5. Error Handling Cleanup | v1.0 | 2/2 | Complete | 2026-03-08 |
| 6. Isolated Debt Fixes | v1.0 | 1/1 | Complete | 2026-03-08 |
| 7. Backend Test Suites | v1.0 | 2/2 | Complete | 2026-03-08 |
| 8. Integration and Frontend Tests | v1.0 | 2/2 | Complete | 2026-03-08 |
| 9. Init Container Hardening | v1.1 | 2/2 | Complete | 2026-03-08 |
| 10. Configuration & Install Script | v1.1 | 1/1 | Complete | 2026-03-08 |
| 11. Production Hardening & Observability | v1.1 | 0/? | Not started | - |
| 12. Admin Documentation | v1.1 | 0/? | Not started | - |
