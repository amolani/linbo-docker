# Roadmap: LINBO Docker Hardening

## Overview

This milestone hardens the existing LINBO Docker codebase for production use. All 16 requirements address build hygiene, secret management, API security, tech-debt reduction, and test coverage -- in that order. The dependency chain flows from safe infrastructure changes (build files, secrets) through behavioral changes (API security, refactoring) to verification (tests). Tests come last because they must test the final behavior, not behavior that will change mid-milestone.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Build Hygiene** - Pin Docker base images and add .dockerignore files for reproducible, clean builds (completed 2026-03-06)
- [ ] **Phase 2: Secrets Hardening** - Remove tracked secrets, enforce non-default credentials, fix deploy script auth
- [x] **Phase 3: API Security** - Add WebSocket JWT verification, login rate-limiting, and CORS restriction (completed 2026-03-07)
- [ ] **Phase 4: System Router Split** - Break system.js (1483 lines) into focused sub-routers
- [ ] **Phase 5: Error Handling Cleanup** - Replace all 31 silent catch blocks with categorized logging
- [ ] **Phase 6: Isolated Debt Fixes** - Apply Prisma-optional guard to worker and replace Redis KEYS with SCAN
- [ ] **Phase 7: Backend Test Suites** - Unit tests for image-sync and terminal services
- [ ] **Phase 8: Integration and Frontend Tests** - WebSocket integration tests and frontend store tests

## Phase Details

### Phase 1: Build Hygiene
**Goal**: Docker builds are reproducible and free of host contamination
**Depends on**: Nothing (first phase)
**Requirements**: PROD-01, PROD-03
**Success Criteria** (what must be TRUE):
  1. Every Dockerfile uses a version-pinned base image (no `latest` tags)
  2. Running `docker build` from a directory with `node_modules/` produces the same image as without -- host artifacts are excluded by .dockerignore
  3. All container directories that have a Dockerfile also have a .dockerignore file
**Plans**: 1 plan

Plans:
- [ ] 01-01-PLAN.md -- Pin base images to exact versions and add .dockerignore files

### Phase 2: Secrets Hardening
**Goal**: No default credentials or tracked secrets can reach production
**Depends on**: Phase 1
**Requirements**: PROD-02, PROD-04, PROD-05
**Success Criteria** (what must be TRUE):
  1. API refuses to start with default JWT_SECRET or INTERNAL_API_KEY when NODE_ENV=production (exits with clear error message)
  2. Deploy script authenticates to the API using INTERNAL_API_KEY from environment, not a hardcoded default password
  3. `rsyncd.secrets` is in .gitignore, removed from tracking, and `rsyncd.secrets.example` exists with placeholder values
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md -- Startup validation for secrets (validateSecrets in index.js + tests) and rsyncd.secrets git cleanup
- [ ] 02-02-PLAN.md -- Deploy script auth migration (INTERNAL_API_KEY from remote .env, multi-target support)

### Phase 3: API Security
**Goal**: API endpoints are protected against unauthenticated WebSocket access, brute-force login, and cross-origin abuse
**Depends on**: Phase 2
**Requirements**: PROD-06, PROD-07, PROD-08
**Success Criteria** (what must be TRUE):
  1. WebSocket connections to `/ws` without a valid JWT token are rejected at the upgrade handshake (HTTP 401)
  2. After 5 failed login attempts from the same IP within one minute, further attempts return HTTP 429
  3. CORS is restricted to the web container origin by default; wildcard `*` is no longer the default
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md -- WebSocket JWT/API-key verification at upgrade handshake with tests
- [ ] 03-02-PLAN.md -- Login rate limiting (express-rate-limit + Redis), CORS default change, trust proxy config

### Phase 4: System Router Split
**Goal**: The monolithic system.js route file is decomposed into focused, maintainable sub-routers
**Depends on**: Phase 3
**Requirements**: DEBT-02
**Success Criteria** (what must be TRUE):
  1. system.js no longer exists as a monolithic 1483-line file; each sub-router is under 300 lines
  2. All existing API endpoints under `/system/*` continue to work identically (no behavioral change)
  3. Sub-routers are individually importable: kernel, firmware, grub-theme, grub-config, linbo-update, worker, wlan
**Plans**: TBD

Plans:
- [ ] 04-01: Extract sub-routers from system.js

### Phase 5: Error Handling Cleanup
**Goal**: Every catch block in the codebase either logs meaningfully or rethrows -- no silent swallowing
**Depends on**: Phase 4
**Requirements**: DEBT-01
**Success Criteria** (what must be TRUE):
  1. Zero silent catch blocks remain in the codebase (grep for empty catch bodies returns nothing)
  2. Each former silent catch now uses categorized logging: debug (expected/harmless), warn (degraded but functional), or rethrow (caller must handle)
  3. Log output during normal API startup and operation does not produce spurious warnings (only actual issues trigger warn-level)
**Plans**: TBD

Plans:
- [ ] 05-01: Audit and categorize all silent catch blocks

### Phase 6: Isolated Debt Fixes
**Goal**: Worker resilience in sync mode and Redis performance at scale are resolved
**Depends on**: Phase 4
**Requirements**: DEBT-03, DEBT-04
**Success Criteria** (what must be TRUE):
  1. operation.worker.js runs without error in sync mode (no Prisma, Redis-only) -- the try/catch guard prevents crash on missing Prisma
  2. Redis key cleanup uses SCAN-based iteration instead of KEYS command; `delPattern()` no longer blocks Redis during large key sets
**Plans**: TBD

Plans:
- [ ] 06-01: Worker Prisma guard and Redis SCAN migration

### Phase 7: Backend Test Suites
**Goal**: Critical backend services have comprehensive unit test coverage
**Depends on**: Phase 5, Phase 6
**Requirements**: TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. Image-sync service tests cover: resume download from byte offset, SHA256 verification pass/fail, atomic directory swap, and queue ordering
  2. Terminal service tests cover: session create/destroy lifecycle, PTY-to-exec fallback, idle timeout triggers cleanup, and no orphaned sessions after cleanup
  3. All tests pass in CI without network access or running containers (mocked dependencies)
**Plans**: TBD

Plans:
- [ ] 07-01: Image-sync service tests
- [ ] 07-02: Terminal service tests

### Phase 8: Integration and Frontend Tests
**Goal**: WebSocket behavior and frontend state management are verified by automated tests
**Depends on**: Phase 3, Phase 7
**Requirements**: TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. WebSocket tests verify: connection with valid JWT succeeds, connection without JWT is rejected, heartbeat keeps connection alive, channel subscription delivers broadcasts
  2. Frontend store tests verify: wsStore reconnect logic, hostStore merge behavior on partial updates, configStore cache invalidation
  3. All frontend tests run headlessly without a running API (mocked network layer)
**Plans**: TBD

Plans:
- [ ] 08-01: WebSocket integration tests
- [ ] 08-02: Frontend store tests

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

Note: Phase 5 and Phase 6 both depend on Phase 4 and can execute in either order. Phase 7 depends on both Phase 5 and Phase 6. Phase 8 depends on Phase 3 and Phase 7.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Build Hygiene | 0/1 | Complete    | 2026-03-06 |
| 2. Secrets Hardening | 0/2 | Not started | - |
| 3. API Security | 2/2 | Complete   | 2026-03-07 |
| 4. System Router Split | 0/1 | Not started | - |
| 5. Error Handling Cleanup | 0/1 | Not started | - |
| 6. Isolated Debt Fixes | 0/1 | Not started | - |
| 7. Backend Test Suites | 0/2 | Not started | - |
| 8. Integration and Frontend Tests | 0/2 | Not started | - |
