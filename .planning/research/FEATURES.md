# Feature Landscape

**Domain:** Docker-based network boot server (PXE/LINBO) -- fresh install flow and production readiness
**Researched:** 2026-03-08
**Scope:** v1.1 milestone -- what features are needed so a fresh VM reaches a working deployment

## Table Stakes

Features that any admin deploying LINBO Docker on a fresh VM expects to work. Missing = deployment fails or is unreasonably painful.

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|-------------|------------|------------|-------|
| **Setup script (`setup.sh`)** | Every serious self-hosted Docker app (Sentry, Coolify, Supabase) ships one. Admins expect `git clone` + `./setup.sh` + `docker compose up -d` to work. | Medium | Nothing | Generates `.env` from interactive prompts, checks prerequisites, validates network. Reference: Sentry's `install.sh` checks Docker version, RAM, disk, CPU. |
| **Prerequisites validation** | Init container currently fails silently or cryptically when Docker is misconfigured, ports are busy, or network is unreachable. Admins need clear pass/fail before investing time. | Low | Nothing | Check: Docker + Compose versions, port 69/873/2222/3000/8080 availability, disk space (>5GB), network connectivity to `deb.linuxmuster.net`, `/lib/firmware` exists on host. |
| **`.env` generation with validation** | Current `.env.example` has 240 lines of options -- overwhelming. Admin needs guided generation of the 4-5 required values, with sane defaults for the rest. | Medium | Nothing | Required: `LINBO_SERVER_IP`, `JWT_SECRET` (auto-generate), `INTERNAL_API_KEY` (auto-generate), `GITHUB_TOKEN` (prompt). Optional: sync mode settings, network config. |
| **Init container error reporting** | Current init container exits with `exit 1` and a bare `echo "ERROR:"`. No guidance on what went wrong or how to fix it. APT download failures, SHA256 mismatches, and permission errors need actionable messages. | Low | Nothing | Add structured error messages: "APT repo unreachable -- check DNS and firewall", "SHA256 mismatch -- try FORCE_UPDATE=true", "Permission denied -- check Docker socket permissions". |
| **Startup health gate** | After `docker compose up -d`, admin has no way to know when the system is actually ready (init downloads, API builds linbofs64, TFTP waits for marker). Need a single command that blocks until ready or reports what is stuck. | Medium | Nothing | `make wait-ready` or `./scripts/wait-ready.sh` -- polls container health, reports progress, timeout after 5 min with diagnostic output. |
| **LINBO_SERVER_IP auto-detection** | The most common misconfiguration. Admin must manually figure out which IP their Docker host uses on the PXE network. If wrong, PXE clients download from the wrong server. | Low | Nothing | Detect primary non-loopback IP on the interface facing the client subnet. Suggest in setup.sh, allow override. |
| **Port conflict detection** | TFTP (69/udp) and sometimes rsync (873) conflict with existing services on LMN servers. Current failure mode: container crashes with unhelpful Docker error. | Low | Prerequisites validation | Check ports before starting containers. Clear message: "Port 69/udp in use by tftpd-hpa -- run `systemctl stop tftpd-hpa` or skip TFTP container." |
| **Install guide (admin docs)** | No admin-facing documentation exists. The TROUBLESHOOTING.md is developer-facing. An admin needs: prerequisites, step-by-step install, first-boot verification, network requirements diagram. | Medium | Setup script (to document) | Markdown in `docs/INSTALL.md`. Structure: Requirements, Quick Start, Configuration, Network Diagram, Verification, Troubleshooting. |
| **Architecture overview (admin docs)** | Admins managing network boot infra need to understand what containers do what, what ports are exposed, and how data flows. Current `docs/ARCHITECTURE.md` is developer-internal. | Low | Nothing | Simplified version of the codebase ARCHITECTURE.md. Focus on: container roles, network diagram, volume purposes, startup order. Target audience: sysadmin, not developer. |
| **GITHUB_TOKEN build dependency resolution** | `@edulution-io/ui-kit` requires a private GitHub token at web container build time. Fresh installs fail with `401 Unauthorized` on `npm ci`. This is the single biggest barrier to third-party adoption. | High | Nothing | Three options: (1) Vendor the package into the repo, (2) Replace with open-source equivalent, (3) Make the web container build work without it. Option 2 is recommended -- extract the few components used and inline them. This blocks open-source adoption entirely. |

## Differentiators

Features that set LINBO Docker apart from bare-metal LINBO installs. Not expected by admin on day one, but add significant value.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| **`make doctor` diagnostic command** | One command that checks everything: container health, volume permissions (1001:1001), Redis connectivity, linbofs64 build status, SSH key presence, PXE client reachability. Invaluable for support. | Medium | Nothing | Goes beyond `make health` (which just curls endpoints). Checks internal state: are SSH keys generated? Is linbofs64 actually built? Are volumes writable? Can init reach APT repo? |
| **Configuration drift detection** | `.env` can diverge from what containers are running (since `docker compose restart` does not reload env vars -- documented gotcha #12 in TROUBLESHOOTING.md). Detect and warn when `.env` differs from running container env. | Low | Nothing | Compare `.env` values against `docker inspect` env for each container. Warn if mismatch. Teach `docker compose up -d` instead of `restart`. |
| **Guided first-login experience** | After deployment, admin logs in and sees... the normal dashboard with zero hosts. No guidance on what to do next. A first-login wizard or checklist ("1. Add your first start.conf, 2. Add hosts, 3. Verify PXE boot") would reduce time-to-value. | Medium | Install guide | Could be a simple dismissable banner in the dashboard rather than a full wizard. Low-cost, high-impact. |
| **Backup/restore script** | Docker volumes hold all state (boot files, images, configs, Redis data, SSH keys). A `make backup` that creates a tarball of all volumes, and `make restore` to recover, prevents data loss during upgrades. | Medium | Nothing | `docker run --rm -v linbo_srv_data:/data -v $(pwd):/backup alpine tar czf /backup/linbo-backup-$(date +%Y%m%d).tar.gz /data`. Repeat for each volume. |
| **Upgrade documentation** | Current `make deploy` is developer-to-developer. Admins need: "How do I update LINBO Docker to a new version?" covering git pull, rebuild, data migration, rollback. | Low | Backup/restore | Simple: `git pull && docker compose up -d --build`. But needs documentation for edge cases (schema changes, volume migrations, breaking changes). |
| **Sync mode setup guide** | Sync mode (connecting to existing LMN server) has 4 env vars, requires Authority API on the LMN side, and needs TLS configuration. No documentation exists for setting this up as an admin. | Medium | Install guide | Separate doc: `docs/SYNC-MODE-SETUP.md`. Steps: install Authority API on LMN, configure credentials, enable sync, verify delta feed. |
| **Network requirements diagram** | PXE boot has strict network requirements (TFTP needs host network, DHCP relay configuration, client-to-server L2/L3 connectivity). A visual diagram of what talks to what on which port would prevent 80% of network issues. | Low | Nothing | ASCII or SVG diagram showing: DHCP server -> client -> TFTP (69) -> HTTP (8080) -> rsync (873) -> SSH (2222). Include firewall rules needed. |
| **Container resource limits** | Docker Compose production best practice. Currently no memory/CPU limits set. A misbehaving linbofs64 build could OOM the host. | Low | Nothing | Add `deploy.resources.limits` in docker-compose.yml for each service. API: 512MB, Web: 128MB, Redis: 256MB, TFTP: 64MB. |

## Anti-Features

Features to explicitly NOT build in v1.1. Either out of scope, wrong abstraction, or would cause maintenance burden.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Web-based setup wizard** | Over-engineering for v1.1. The setup flow runs once per deployment. A shell script is simpler, more debuggable, and works without a running web server. | Use `setup.sh` CLI script. Consider web wizard only if user research shows demand. |
| **Auto-update mechanism** | Unattended updates to network boot infrastructure are dangerous. A bad update bricks all PXE clients. | Document manual upgrade path. Provide `make check-update` to show available updates without applying them. |
| **Multi-site management** | Managing multiple LINBO Docker instances from one UI adds enormous complexity (auth federation, cross-site networking, data sync). | Each site runs independently. Central management is a v3+ concern. |
| **Custom DHCP server by default** | The DHCP container exists but is a profile. Making it default would conflict with existing DHCP servers in every school network. | Keep as optional profile (`--profile dhcp`). Document DHCP relay configuration for existing servers. |
| **Helm chart / Kubernetes support** | Target audience is school sysadmins deploying on bare metal or a single VM. K8s adds complexity without value for this use case. TFTP's `network_mode: host` requirement also complicates K8s deployment. | Docker Compose only. Acknowledge K8s is out of scope in docs. |
| **Interactive CLI config editor** | A TUI for editing `.env` or start.conf from the command line. The web UI already provides config editing. | The web UI handles config editing. CLI setup is one-time via `setup.sh`. |
| **Internationalization (i18n)** | The frontend is German-language for German school admins. Adding i18n framework for v1.1 is scope creep. | Keep German. Add i18n only when non-German-speaking users emerge. |

## Feature Dependencies

```
Prerequisites validation -----> Setup script (setup.sh)
                                      |
                                      v
                           .env generation + validation
                                      |
                                      v
                           Port conflict detection
                                      |
                                      v
                           LINBO_SERVER_IP auto-detection
                                      |
                                      v
                           Startup health gate (wait-ready)
                                      |
                                      v
                           Install guide (documents the above flow)
                                      |
                                      v
                           Architecture overview (referenced by install guide)

Init container error reporting -----> (independent, can be done anytime)

GITHUB_TOKEN resolution -----> (independent, blocks open-source adoption)

make doctor -----> (independent, can be done after install flow)

Configuration drift detection -----> (independent, low priority)

Guided first-login -----> Install guide (references "what to do next")

Backup/restore -----> Upgrade documentation (references backup before upgrade)
```

## MVP Recommendation

The critical path for "fresh VM to working deployment" is:

### Priority 1: Bootstrap Flow (blocks everything)

1. **Setup script (`setup.sh`)** -- the entry point. Checks prerequisites, generates `.env`, validates configuration. Without this, every install requires reading 200+ lines of `.env.example` and guessing.
2. **Prerequisites validation** -- embedded in setup.sh. Fail fast with clear messages before the admin waits 5 minutes for containers to fail.
3. **`.env` generation** -- embedded in setup.sh. Auto-generate secrets, prompt for `LINBO_SERVER_IP`, detect network configuration.
4. **LINBO_SERVER_IP auto-detection** -- embedded in setup.sh. The #1 misconfiguration.

### Priority 2: Error Handling & Observability (reduces support burden)

5. **Init container error reporting** -- clear, actionable error messages instead of bare `exit 1`.
6. **Startup health gate (`make wait-ready`)** -- admin needs to know when the system is ready.
7. **Port conflict detection** -- embedded in setup.sh and/or pre-start check.

### Priority 3: Documentation (enables self-service)

8. **Install guide (`docs/INSTALL.md`)** -- step-by-step for admins. References setup.sh.
9. **Architecture overview** -- simplified container/network diagram for admins.
10. **Network requirements diagram** -- prevents 80% of "PXE does not work" issues.

### Priority 4: Production Hardening

11. **Container resource limits** -- simple addition to docker-compose.yml.
12. **`make doctor`** -- diagnostic command for troubleshooting.

### Defer: v1.2 or later

- **GITHUB_TOKEN resolution** -- Important for open-source adoption but requires significant refactoring of the UI kit dependency. Track as a separate milestone.
- **Guided first-login experience** -- Nice to have, but not blocking deployments.
- **Backup/restore script** -- Important but not blocking fresh installs.
- **Upgrade documentation** -- Relevant after v1.1 ships (nothing to upgrade from yet).
- **Sync mode setup guide** -- Sync mode is advanced usage; fresh install works standalone.
- **Configuration drift detection** -- Nice diagnostic, not blocking.

## Complexity Budget

| Priority | Feature Count | Total Complexity | Estimated Effort |
|----------|---------------|------------------|------------------|
| P1: Bootstrap | 4 features | Medium (setup.sh bundles 3 sub-features) | 1-2 phases |
| P2: Error Handling | 3 features | Low-Medium | 1 phase |
| P3: Documentation | 3 features | Medium (writing, not coding) | 1 phase |
| P4: Hardening | 2 features | Low | 0.5 phase |
| **Total MVP** | **12 features** | | **3-4 phases** |

## Sources

- [Sentry Self-Hosted Install](https://develop.sentry.dev/self-hosted/) -- reference for install script structure, prerequisites checking
- [Sentry Minimum Requirements Script](https://github.com/getsentry/self-hosted/blob/master/install/check-minimum-requirements.sh) -- Docker/RAM/CPU/disk validation pattern
- [Docker Compose in Production](https://docs.docker.com/compose/how-tos/production/) -- resource limits, restart policies, health checks
- [Docker Env Best Practices](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/) -- .env file management, secrets handling
- [netboot.xyz Docker](https://hub.docker.com/r/linuxserver/netbootxyz) -- reference Docker PXE server with simpler setup
- [Docker Compose Environment Variables](https://cyberpanel.net/blog/docker-compose-environment-variables/) -- .env generation patterns
- [Docker Best Practices 2026](https://thinksys.com/devops/docker-best-practices/) -- production deployment checklist
- Existing codebase: `.planning/codebase/ARCHITECTURE.md`, `CONCERNS.md`, `INTEGRATIONS.md`, `STACK.md`
- Existing docs: `docs/TROUBLESHOOTING.md` (25 documented issues with solutions)
- Current `.env.example` (240 lines, 50+ variables)
- Current `containers/init/entrypoint.sh` (633 lines, error handling review)

---

*Feature landscape: 2026-03-08*
*Confidence: HIGH for table stakes and anti-features (based on codebase analysis + industry patterns), MEDIUM for differentiators (based on web research + extrapolation from similar projects)*
