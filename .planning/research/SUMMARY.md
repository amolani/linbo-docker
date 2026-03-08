# Project Research Summary

**Project:** LINBO Docker v1.1 -- Fresh Install & Production Readiness
**Domain:** Docker-based network boot server (PXE/LINBO) -- first-run experience and operational hardening
**Researched:** 2026-03-08
**Confidence:** HIGH

## Executive Summary

LINBO Docker v1.1 is a production readiness milestone for an existing, functional network boot system. The codebase is mature (33+ sessions, 7 containers, 23 API services, 14 React pages, verified on real hardware), but the fresh install experience is broken: there is no setup script, the init container fails silently, .env configuration is a 240-line guessing game with three conflicting sources of truth, LINBO_SERVER_IP defaults to the wrong value for every non-LMN network, and volume permissions break cross-container file access. The gap is not missing functionality -- it is missing operability. A competent sysadmin with no prior exposure to the codebase cannot go from `git clone` to working PXE boot without trial-and-error or developer assistance.

The recommended approach requires zero new npm dependencies and zero new containers. All improvements are surgical enhancements to existing components: a setup script (bash), structured error reporting in the init container (bash), Zod-based .env validation at API startup (already-installed library), and plain Markdown admin documentation. The architecture research confirms that the init container, install script, and API startup sequence are the three integration points. A new setup.service.js aggregates system readiness into a checklist, and an optional SetupWizardPage provides guided first-run configuration through the existing web frontend. The critical ordering insight is: init container error reporting must come first (because it makes all subsequent debugging possible), followed by configuration management (.env consolidation, install script), then API setup detection, then frontend wizard, then documentation.

The top risks are: (1) .env drift between .env.example, docker-compose.yml defaults, and the actual .env file -- which causes silent misconfiguration on every fresh install; (2) init container failures leaving volumes in an unrecoverable partial state with no clear error messages; (3) LINBO_SERVER_IP defaulting to 10.0.0.1 which silently breaks PXE boot on every non-LMN network; and (4) Docker volume permissions breaking cross-container file access (EACCES errors). All four are preventable with validation, structured error reporting, and startup checks -- patterns already proven in the existing validateSecrets() implementation.

## Key Findings

### Recommended Stack

No new dependencies. The existing stack already contains everything needed. Zod (^3.22.4, already installed and used in validate.js middleware) handles .env validation. Shell scripts (bash + standard Unix tools) handle the setup flow. Plain Markdown handles documentation. This is a deliberate constraint: adding dependencies for a "make it easier to install" milestone would be counterproductive.

**Core technologies (existing, unchanged):**
- **Express.js ^4.18.2**: API framework -- no changes needed
- **Zod ^3.22.4**: Extend from request validation to .env validation at startup -- zero new code patterns
- **ioredis ^5.3.2**: Redis client for setup state storage (setup:complete key) -- uses existing settings service pattern
- **Node.js 20.20.0-alpine**: API runtime, LTS until April 2026 -- no version bump needed
- **Docker Compose v2**: Container orchestration -- improve health check timing and unify compose files

**Explicitly rejected:** envalid, dotenv-safe, t3-env (unnecessary wrappers around Zod), MkDocs/Docusaurus/VitePress (overkill for ~10 docs pages), Ansible (over-engineered for 1-3 server deployments), HashiCorp Vault (enterprise tool for school sysadmins), web-based setup wizard (shell script is correct for this audience).

### Expected Features

**Must have (table stakes -- fresh install fails without these):**
- Setup script (setup.sh) -- prerequisite checks, .env generation, secret auto-generation, IP detection
- Init container error reporting -- structured status JSON, actionable error codes, retry with backoff
- .env consolidation -- single authoritative .env.example matching docker-compose.yml, grouped into required/optional
- Startup health gate -- `make wait-ready` that blocks until system is operational or reports what is stuck
- LINBO_SERVER_IP auto-detection and validation -- the single most common misconfiguration
- Port conflict detection -- TFTP (69/udp) and rsync (873) conflict with existing services on LMN servers
- Install guide -- step-by-step admin documentation with prerequisites, verification, troubleshooting cross-references

**Should have (differentiators):**
- `make doctor` diagnostic command -- checks container health, volume permissions, SSH keys, linbofs64 status
- Configuration drift detection -- warn when running .env differs from container environment
- Backup/restore script -- `make backup` for Docker volumes before upgrades
- Network requirements diagram -- visual port/flow diagram preventing 80% of "PXE does not work" issues
- Container resource limits -- memory/CPU caps in docker-compose.yml

**Defer (v1.2+):**
- GITHUB_TOKEN / @edulution-io/ui-kit resolution -- important for open-source adoption but requires significant refactoring
- Guided first-login experience -- nice-to-have banner/checklist in dashboard
- Sync mode setup guide -- advanced usage, not blocking fresh standalone installs
- Auto-update mechanism -- dangerous for network boot infrastructure
- Multi-site management -- v3+ concern
- Web-based setup wizard -- shell script is appropriate for sysadmin audience

### Architecture Approach

No new containers. All changes integrate into existing components through four modification points and two new files. The init container gains structured status reporting (.init-status.json) as a write-once file read by the API. A new setup.service.js aggregates readiness checks (init complete, keys present, linbofs built, config valid) into a queryable checklist backed by Redis. The install script gains preflight validation and .env generation. An optional SetupWizardPage in the frontend provides guided verification. The critical anti-pattern to avoid: never make the API block on setup completion, because the API must be running for the setup wizard to work.

**Major components (modified or new):**
1. **scripts/install.sh** (modified) -- preflight checks, .env generation from template, secret generation, IP detection
2. **containers/init/entrypoint.sh** (modified) -- structured .init-status.json output, error categorization, proxy support
3. **containers/api/src/lib/env-schema.js** (new) -- Zod schema replacing ad-hoc validateSecrets()
4. **containers/api/src/services/setup.service.js** (new) -- setup state machine and checklist aggregator
5. **containers/api/src/routes/system/** (modified) -- setup-status, setup-validate, setup-complete endpoints
6. **containers/web/frontend/src/pages/SetupWizardPage.tsx** (new) -- guided first-run verification UI
7. **docs/admin/** (new directory) -- INSTALL.md, CONFIGURATION.md, ARCHITECTURE.md, TROUBLESHOOTING.md, NETWORK.md

### Critical Pitfalls

1. **.env drift between three sources** -- .env.example (240 lines), docker-compose.yml defaults (~60 vars), and actual .env (116 lines) tell different stories. Variable naming is inconsistent (DB_PASSWORD vs POSTGRES_PASSWORD). GITHUB_TOKEN is required but not in .env.example. **Prevention:** Create ONE canonical .env.example matching docker-compose.yml exactly, grouped into required/optional with inline comments.

2. **Init container partial failure leaves unrecoverable state** -- restart: "no" + set -e means any failure exits with no retry. No checkpoint/resume mechanism. Partial volumes block all dependent containers. **Prevention:** Add idempotent checkpoints, HTTP_PROXY support, structured error status file, document `docker compose up -d --force-recreate init` recovery.

3. **LINBO_SERVER_IP defaults to 10.0.0.1** -- wrong for every non-LMN network. Written into GRUB configs, causes PXE clients to download from nonexistent server. Debugging takes hours because TFTP works fine (host network) but HTTP boot fails. **Prevention:** Startup validation comparing against local interfaces, prominent warning, auto-detection in install script.

4. **Docker volume permissions (EACCES)** -- init runs as root, API runs as UID 1001. If init fails before chown step, all API file operations fail with 500 errors. Recurs after any root-context operation (SSH container, LINBO update). **Prevention:** Startup write-permission check in API, shared GID approach, permission repair in init.

5. **Marker file state machine hangs after interrupted rebuild** -- .needs-rebuild -> .running -> .linbofs-patch-status chain breaks if rebuild crashes. TFTP busy-waits forever. **Prevention:** Add timeout to TFTP wait, write FAILED status on error, add manual recovery command.

## Implications for Roadmap

Based on research, suggested phase structure (4 phases):

### Phase 1: Init Container Hardening & Error Reporting

**Rationale:** The init container is the entry point for every fresh install and the source of the most common failure. Fixing error reporting first makes all subsequent phases debuggable. This phase has no dependencies on other v1.1 work.

**Delivers:** Structured .init-status.json with progress tracking and error categorization; retry with backoff for network failures; HTTP_PROXY/HTTPS_PROXY support; idempotent checkpoints so reruns skip completed steps; actionable error codes (APT_FETCH_FAILED, DOWNLOAD_FAILED, PERMISSION_DENIED, etc.)

**Addresses features:** Init container error reporting (table stakes), partial state recovery

**Avoids pitfalls:** #2 (partial failure), #9 (marker state machine -- add TFTP timeout), #15 (firmware mount check)

### Phase 2: Configuration Management & Install Script

**Rationale:** The install script is the user's entry point. It depends on understanding the init error format from Phase 1. This phase resolves the .env chaos that causes most fresh install failures and creates the canonical configuration surface.

**Delivers:** Consolidated .env.example (single source of truth, grouped required/optional); setup.sh with preflight validation (Docker, ports, disk, DNS); auto-generated secrets (JWT_SECRET, INTERNAL_API_KEY, RSYNC_PASSWORD); LINBO_SERVER_IP auto-detection; port conflict detection; env-schema.js (Zod-based .env validation replacing validateSecrets()); resolution of deploy/docker-compose.yml divergence

**Addresses features:** Setup script, prerequisites validation, .env generation, LINBO_SERVER_IP auto-detection, port conflict detection (all table stakes)

**Avoids pitfalls:** #1 (.env drift), #3 (LINBO_SERVER_IP), #4 (volume permissions -- startup check), #6 (port conflicts), #7 (over-strict validation -- use warn/fatal tiers), #10 (two compose files), #11 (GITHUB_TOKEN documentation), #12 (rsyncd default credentials)

### Phase 3: Setup Service, API Endpoints & Frontend Wizard

**Rationale:** The backend setup service and API endpoints must exist before the frontend wizard can be built. This phase depends on the init status format (Phase 1) and .env structure (Phase 2). It adds the "smart" layer that ties all checks together into a queryable system.

**Delivers:** setup.service.js (checklist aggregator reading init status, keys, linbofs, config validity); GET /system/setup-status, POST /system/setup/validate, POST /system/setup/complete API endpoints; SetupWizardPage.tsx with step-by-step verification flow; startup health gate (make wait-ready); make doctor diagnostic command; container resource limits in docker-compose.yml

**Addresses features:** Startup health gate (table stakes), make doctor (differentiator), guided first-login (differentiator), container resource limits (differentiator)

**Avoids pitfalls:** Anti-pattern #1 (setup-blocking API startup -- keep setup advisory, not enforced), anti-pattern #3 (storing setup config in files -- use Redis)

### Phase 4: Admin Documentation

**Rationale:** Documentation must reference final behavior. Writing it before Phases 1-3 stabilize would require rewriting. Writing it last also means the author can test the actual install flow end-to-end on a fresh VM.

**Delivers:** docs/admin/INSTALL.md (step-by-step from fresh VM to working deployment); docs/admin/CONFIGURATION.md (all .env variables explained); docs/admin/ARCHITECTURE.md (container roles, network diagram, volume purposes); docs/admin/NETWORK.md (PXE network requirements, firewall rules, port diagram); docs/admin/TROUBLESHOOTING.md (common problems with solutions, cross-referenced from install guide); docs/admin/UPGRADE.md (version upgrade procedures, backup/restore)

**Addresses features:** Install guide, architecture overview, network requirements diagram (table stakes + differentiators)

**Avoids pitfalls:** #5 (documentation that lies about prerequisites -- test on fresh VM), #8 (restart vs up -d confusion -- prominent callout), #13 (PostgreSQL password mismatch), #14 (container naming)

### Phase Ordering Rationale

- **Init first** because every subsequent phase needs a working init container to test, and structured errors make debugging everything else possible.
- **Configuration second** because the install script is the user's entry point and .env consolidation affects all container startup behavior. Must be settled before the API setup service can validate configuration.
- **Setup service and wizard third** because they aggregate status from init (Phase 1) and configuration (Phase 2). The frontend wizard depends on stable API endpoints.
- **Documentation last** because it must describe final, tested behavior. Writing docs against moving targets wastes effort and produces docs that lie.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Configuration):** The .env consolidation requires auditing every variable across three files (root .env, .env.example, docker-compose.yml). The install script needs to handle both fresh install and re-run without overwriting existing .env. The GITHUB_TOKEN situation needs a definitive decision (document vs vendor vs replace).
- **Phase 3 (Setup Service):** The setup wizard frontend scope should be tightly bounded. Risk of scope creep into a "full onboarding experience." Keep it to a verification checklist, not a configuration tool.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Init Hardening):** Well-understood patterns -- structured JSON status, retry with backoff, error categorization. Existing entrypoint.sh is the full scope.
- **Phase 4 (Documentation):** Straight Markdown writing. Template and structure are defined in FEATURES.md. No technical research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. All recommendations build on existing validated stack. Sources are the codebase itself. |
| Features | HIGH | Table stakes derived from codebase gap analysis + 33 sessions of operational history. Anti-features well-reasoned. |
| Architecture | HIGH | All changes are modifications to existing components. Patterns follow established codebase conventions. Sources are internal code analysis. |
| Pitfalls | HIGH | 15 pitfalls identified, 6 critical. Based on actual documented incidents in TROUBLESHOOTING.md (25 issues) and CONCERNS.md. |

**Overall confidence:** HIGH

Research confidence is high because this is a subsequent milestone on a mature codebase, not a greenfield project. All four research files draw primarily from internal codebase analysis and documented operational incidents rather than external speculation. The pitfalls are real -- most have occurred and been documented in TROUBLESHOOTING.md.

### Gaps to Address

- **GITHUB_TOKEN strategy:** Research identified the problem (blocks open-source adoption) but deferred the solution to v1.2+. Phase 2 should at minimum document the token requirement clearly in .env.example and install guide. A definitive resolution (vendor, replace, or make public) needs a separate decision.
- **Deploy compose file disposition:** Research flagged deploy/docker-compose.yml as divergent and confusing. Phase 2 must decide: delete it, merge it, or clearly mark it as deprecated. This decision was not made in research.
- **Proxy support scope:** Init container needs HTTP_PROXY/HTTPS_PROXY for school networks behind proxies. The scope of proxy support (just init? also web container build? also API for sync mode?) needs definition during Phase 1 planning.
- **Permission model long-term fix:** Research identifies EACCES as a recurring problem with a band-aid fix (chown). The shared GID approach was recommended but not fully designed. Phase 1 or 2 should define the target permission model.

## Sources

### Primary (HIGH confidence)
- Existing codebase: docker-compose.yml, containers/init/entrypoint.sh, containers/api/src/index.js, scripts/install.sh, .env.example, .env
- .planning/codebase/ analysis: ARCHITECTURE.md, CONCERNS.md, INTEGRATIONS.md, STACK.md, STRUCTURE.md
- docs/TROUBLESHOOTING.md -- 25 documented operational incidents
- 33+ development sessions -- accumulated domain knowledge in MEMORY.md

### Secondary (MEDIUM confidence)
- [Docker Compose production best practices](https://docs.docker.com/compose/how-tos/production/) -- resource limits, restart policies
- [Docker env var best practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/) -- .env management
- [Docker healthcheck startup order](https://docs.docker.com/compose/how-tos/startup-order/) -- service dependencies
- [Sentry Self-Hosted Install](https://develop.sentry.dev/self-hosted/) -- reference install script patterns
- [Zod env validation pattern](https://dev.to/roshan_ican/validating-environment-variables-in-nodejs-with-zod-2epn) -- confirms standard practice

### Tertiary (LOW confidence)
- [netboot.xyz Docker](https://hub.docker.com/r/linuxserver/netbootxyz) -- reference Docker PXE server (simpler scope, limited applicability)
- [PXE boot with Docker](https://jpetazzo.github.io/2013/12/07/pxe-netboot-docker/) -- foundational but dated (2013)

---
*Research completed: 2026-03-08*
*Ready for roadmap: yes*
