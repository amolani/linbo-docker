# Phase 12: Admin Documentation - Research

**Researched:** 2026-03-10
**Domain:** Technical documentation for sysadmin audience (German, Markdown, Mermaid)
**Confidence:** HIGH

## Summary

Phase 12 is a pure documentation phase -- no code changes, no new dependencies. The deliverables are three files: `docs/INSTALL.md` (install guide), `docs/ADMIN-GUIDE.md` (architecture + network diagram + firewall table), and a trimmed `README.md` (overview only, links to INSTALL.md). All content is German with English technical terms.

The project already has extensive source material: setup.sh (561 lines, 7 prerequisite checks), docker-compose.yml (full port/volume/dependency truth), doctor.sh (24 checks, 6 categories), wait-ready.sh (health gate), ARCHITECTURE.md (Mermaid diagrams), TROUBLESHOOTING.md (25 entries), hooks.md, and UNTERSCHIEDE-ZU-LINBO.md. The documentation task is primarily synthesis and ordering of existing knowledge, not discovery.

**Primary recommendation:** Write documentation by extracting facts directly from source files (docker-compose.yml, setup.sh, doctor.sh, Makefile) rather than from memory or README.md summaries. Cross-reference every port number, volume mount, and dependency claim against docker-compose.yml as single source of truth.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
1. **Document Structure:** README becomes overview only (strip Quick Start). INSTALL.md is THE install guide. New `docs/ADMIN-GUIDE.md` for admin-focused content. Existing `docs/ARCHITECTURE.md` stays untouched.
2. **Network diagram placement:** Inside ADMIN-GUIDE.md as a section, not a standalone file.
3. **Verification depth:** INSTALL.md ends with full PXE verification walkthrough: containers healthy -> `make doctor` passes -> test client PXE boots -> linbo_gui appears.
4. **Baseline knowledge:** Linux admin basics (apt, ssh, systemctl, networking). Include Docker install steps if not present.
5. **Troubleshooting:** Inline 3-5 most common issues in INSTALL.md, link to docs/TROUBLESHOOTING.md for the rest.
6. **Mode coverage:** Sync mode only. Standalone not walked through.
7. **Explanation depth:** Deep explanations -- detailed reasoning for architecture choices (why read-only, why hooks, why Docker).
8. **Network diagram coverage:** Full deployment: LMN Server + Docker host + PXE clients + network segments.
9. **Diagram format:** Mermaid (consistent with existing ARCHITECTURE.md, renders on GitHub).
10. **Firewall rules:** Mermaid diagram + markdown table listing every port/protocol/direction/purpose.
11. **DHCP container:** Full section on when/how to use the DHCP container, including proxy-DHCP config with dnsmasq.
12. **Language:** German prose with English technical vocabulary.
13. **File mapping:** docs/INSTALL.md -> DOC-01, docs/ADMIN-GUIDE.md -> DOC-02 + DOC-03, README.md -> update.

### Claude's Discretion
None explicitly listed -- all major decisions were locked in CONTEXT.md.

### Deferred Ideas (OUT OF SCOPE)
- Standalone mode walkthrough (sync mode only)
- Developer documentation (ARCHITECTURE.md stays as-is)
- API reference documentation
- Frontend user guide
- Internationalization
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DOC-01 | Install Guide (`docs/INSTALL.md`) fuehrt Admin von Prerequisites bis zum ersten PXE-Boot | Source material fully available: setup.sh flow, docker-compose.yml dependencies, doctor.sh checks, wait-ready.sh health gate. Verified installation checklist exists in TROUBLESHOOTING.md section 25. |
| DOC-02 | Architektur-Uebersicht erklaert Container-Rollen, Ports, Volumes und Startup-Reihenfolge fuer Admins | docker-compose.yml is the single source of truth for all ports, volumes, dependencies, resource limits. ARCHITECTURE.md has existing Mermaid patterns to follow. |
| DOC-03 | Netzwerk-Diagramm zeigt alle Verbindungen (Client <-> TFTP/HTTP/rsync/SSH) mit Ports und Firewall-Regeln | All network information extractable from docker-compose.yml (network_mode, ports), DHCP container entrypoint, and README DHCP section. |
</phase_requirements>

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| Markdown | GFM | Document format | GitHub renders natively, universal tooling |
| Mermaid | 10.x (GitHub native) | Network/architecture diagrams | Already used in ARCHITECTURE.md, renders on GitHub without plugins |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| GFM Tables | Port/volume/firewall reference tables | Every reference section |
| Fenced code blocks | Shell commands, config snippets | Installation steps, verification commands |
| Anchor links | Cross-referencing between sections | INSTALL.md -> ADMIN-GUIDE.md |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mermaid | ASCII art (already in README.md) | ASCII doesn't render as cleanly on GitHub, but works everywhere including terminals. Keep ASCII in README.md for quick reference, Mermaid in ADMIN-GUIDE.md for detail. |
| Single doc | Multiple docs | Split is locked: INSTALL.md for procedure, ADMIN-GUIDE.md for reference. |

## Architecture Patterns

### Document Structure
```
docs/
  INSTALL.md           # DOC-01: Step-by-step install guide
  ADMIN-GUIDE.md       # DOC-02 + DOC-03: Architecture + network diagram
  ARCHITECTURE.md      # EXISTING - developer reference, DO NOT MODIFY
  TROUBLESHOOTING.md   # EXISTING - linked from INSTALL.md
  hooks.md             # EXISTING - linked from ADMIN-GUIDE.md
  UNTERSCHIEDE-ZU-LINBO.md  # EXISTING - linked from ADMIN-GUIDE.md
README.md              # Update: strip Quick Start, link to INSTALL.md
```

### Pattern 1: INSTALL.md Structure
**What:** Linear, step-by-step guide from bare VM to verified PXE boot
**When to use:** This is the primary onboarding document

Recommended section flow (derived from existing setup.sh flow + TROUBLESHOOTING.md checklist):
```
1. Voraussetzungen (Prerequisites)
   - Hardware: 4GB RAM, 50GB disk, network interface on PXE subnet
   - Software: Ubuntu 22.04/24.04 or Debian 12
   - Docker install instructions (if not present)
   - Docker Compose v2 plugin
   - Network: access to deb.linuxmuster.net

2. Installation
   - git clone
   - ./setup.sh (explain what it does: 7 checks, IP detection, secret generation)
   - Review .env (explain key variables)
   - GITHUB_TOKEN setup (for web container npm packages)

3. Erster Start
   - docker compose up -d
   - make wait-ready (explain what happens during first start)
   - Init container: downloads linbo7 .deb, extracts boot files, kernels
   - SSH container: auto-generates SSH/Dropbear keys
   - API container: builds linbofs64 (injects keys + modules)
   - TFTP container: waits for .linbofs-patch-status marker

4. Verifikation
   - make doctor (6 categories, 24 checks)
   - Web UI: http://<server-ip>:8080, login admin/Muster!
   - Health endpoint: curl http://localhost:3000/health

5. DHCP-Konfiguration
   - Option A: Existing DHCP server (ISC/dnsmasq config snippets)
   - Option B: Built-in proxy-DHCP container
   - UEFI vs BIOS boot files

6. Erster PXE-Boot (Verification Walkthrough)
   - Configure a test client for PXE
   - Expected boot sequence: GRUB -> kernel -> linbofs64 -> init.sh -> linbo_gui
   - What to check at each stage

7. Sync-Modus einrichten
   - Authority API on LMN server
   - SYNC_ENABLED, LMN_API_URL, LMN_API_KEY in .env
   - Verify sync: curl /api/v1/sync/status

8. Haeufige Probleme (Top 3-5, link to TROUBLESHOOTING.md)
   - Port 69/udp conflict with existing TFTP
   - Permission errors (chown 1001:1001)
   - .env changes not active (use up -d, not restart)
```

### Pattern 2: ADMIN-GUIDE.md Structure
**What:** Reference document for ongoing administration
**When to use:** After initial install, when admin needs to understand the system

Recommended section flow:
```
1. Ueberblick (what LINBO Docker is, why Docker, read-only principle)

2. Container-Architektur
   - Table: container, port, network mode, role, resource limits
   - Startup dependency order diagram
   - Health check details

3. Volumes
   - Table: volume name, mount path, content, backup-relevant?

4. Netzwerk-Diagramm (DOC-03)
   - Mermaid: Full deployment diagram
   - Firewall rules table

5. DHCP-Konfiguration (detailed)
   - When to use proxy-DHCP vs existing DHCP
   - ISC DHCP snippet (BIOS + UEFI)
   - dnsmasq snippet
   - Proxy-DHCP container details

6. Design-Entscheidungen
   - Why read-only for LMN data
   - Why hooks instead of patching linbofs64
   - Why Docker (isolation, reproducibility)
   - Why package kernel (not host kernel)

7. Betrieb & Wartung
   - make targets reference table
   - Log access (make logs, docker logs)
   - Update procedure (git pull, rebuild)
   - Customization via hooks (link to hooks.md)

8. Weiterfuehrende Dokumentation (links)
```

### Anti-Patterns to Avoid
- **Mixing procedure with reference:** INSTALL.md is procedural (do this, then that). ADMIN-GUIDE.md is reference (here's how the system works). Don't mix them.
- **Duplicating docker-compose.yml:** Don't copy-paste the entire compose file into docs. Reference specific sections with explanations.
- **Stale port numbers:** Every port number in docs MUST be verified against docker-compose.yml. Hardcoding "port 8080" when the compose file says `${WEB_PORT:-8080}` needs a note about configurability.
- **Assuming host network everywhere:** Only TFTP (69/udp) and SSH (2222, via port mapping) and DHCP (67/udp) use host network mode. Other containers use bridge network with port mapping. This distinction matters for firewall rules.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Network diagrams | ASCII art in ADMIN-GUIDE | Mermaid (GitHub-native rendering) | Existing ARCHITECTURE.md uses Mermaid; consistency + maintainability |
| Firewall rule generation | Script to auto-generate | Static markdown table | Rules are stable; table is more readable than generated output |
| Duplicate Quick Start | Maintain in both README + INSTALL | Keep only in INSTALL.md, README links to it | Avoids drift between two copies |

## Common Pitfalls

### Pitfall 1: Port/Network Mode Confusion
**What goes wrong:** Documentation states wrong network modes for containers, leading admins to configure firewall rules incorrectly.
**Why it happens:** Some containers use `network_mode: host` (tftp, dhcp) while others use bridge network with port mapping (api, web, rsync, cache). The SSH container uses bridge with port mapping (`2222:2222`).
**How to avoid:** Verify every network claim against docker-compose.yml. Create a definitive table:

| Container | Network Mode | External Port | Internal Port | Protocol |
|-----------|-------------|---------------|---------------|----------|
| tftp | host | 69 | 69 | UDP |
| rsync | bridge | 873 | 873 | TCP |
| ssh | bridge | 2222 | 2222 | TCP |
| api | bridge | 3000 (configurable) | 3000 | TCP |
| web | bridge | 8080 (configurable) | 80 | TCP |
| cache | bridge | 6379 (configurable) | 6379 | TCP |
| dhcp | host | 67 | 67 | UDP |

**Warning signs:** Firewall rules that reference wrong ports or protocols.

### Pitfall 2: Incomplete Startup Order Documentation
**What goes wrong:** Admin restarts containers individually in wrong order, causing cascading failures.
**Why it happens:** Containers have health-check dependencies (api depends on cache healthy, web depends on api healthy, tftp depends on init completed + api started).
**How to avoid:** Document the full dependency DAG:
```
init (one-shot, must complete first)
  -> cache (Redis, must be healthy)
      -> ssh (starts, generates keys)
          -> api (waits for cache healthy + ssh started + init completed)
              -> web (waits for api healthy)
              -> tftp (waits for init completed + api started, then waits for .linbofs-patch-status)
              -> dhcp (optional, waits for api healthy)
  -> rsync (waits for init completed only)
```

### Pitfall 3: GITHUB_TOKEN Omission
**What goes wrong:** `docker compose up -d` fails on web container build because npm can't access @edulution-io/ui-kit private package.
**Why it happens:** Admin skips GITHUB_TOKEN setup during installation.
**How to avoid:** INSTALL.md must explicitly document GITHUB_TOKEN requirement with clear instructions. This is tracked as OSS-01 for future resolution (vendoring/replacement), but currently mandatory.

### Pitfall 4: DHCP Complexity Underexplained
**What goes wrong:** Admin doesn't configure PXE boot options on existing DHCP server, or misconfigures BIOS vs UEFI boot files.
**Why it happens:** PXE boot requires specific DHCP options (next-server, filename) that vary by client architecture (BIOS vs EFI).
**How to avoid:** Provide both ISC DHCP and dnsmasq config snippets. Clearly document BIOS boot file (`boot/grub/i386-pc/core.0`) vs EFI boot file (`boot/grub/x86_64-efi/core.efi`). Explain when proxy-DHCP is the simpler choice.

### Pitfall 5: README Quick Start Drift
**What goes wrong:** After stripping README Quick Start, the remaining content still references old installation steps.
**Why it happens:** README has installation commands scattered throughout (lines 46-65).
**How to avoid:** After editing README, grep for any remaining `docker compose`, `make up`, `cp .env` etc. and replace with links to INSTALL.md.

## Code Examples

### Verified: Container Port/Volume/Network from docker-compose.yml
Source: `/root/linbo-docker/docker-compose.yml` (read 2026-03-10)

Definitive container inventory (for ADMIN-GUIDE.md table):

| Container | Port | Network | Volumes | Depends On | Resource Limits |
|-----------|------|---------|---------|------------|-----------------|
| init | none | bridge | srv_data, kernel_data, driver_data, themes | none | 2.0 CPU, 512M |
| tftp | 69/udp | host | srv_data (ro) | init completed, api started | 0.5 CPU, 64M |
| rsync | 873 | bridge | srv_data, driver_data (ro), rsyncd.conf, rsyncd.secrets | init completed | 2.0 CPU, 256M |
| ssh | 2222 | bridge | srv_data, config, scripts, log, host ssh key, ssh_config | init completed | 0.5 CPU, 128M |
| cache | 6379 | bridge | redis_data | none | 1.0 CPU, 256M |
| api | 3000 | bridge | srv_data, config, log, kernel_data, driver_data, scripts, rsyncd.secrets, /lib/firmware | cache healthy, ssh started, init completed | 2.0 CPU, 512M |
| web | 8080->80 | bridge | srv_data (ro) | api healthy | 1.0 CPU, 128M |
| dhcp | 67/udp | host | srv_data (ro) | api healthy (profile: dhcp) | 0.5 CPU, 64M |

### Verified: setup.sh Prerequisite Checks
Source: `/root/linbo-docker/setup.sh` (read 2026-03-10)

The 7 checks in order:
1. `check_root` -- root or docker group membership
2. `check_docker` -- Docker installed and daemon running
3. `check_compose` -- Docker Compose v2 plugin installed
4. `check_disk` -- >= 2GB free on /srv or /
5. `check_dns` -- deb.linuxmuster.net resolves
6. `check_network` -- deb.linuxmuster.net HTTPS reachable
7. `check_openssl` -- openssl for secret generation

After prereqs: port conflict check (69/udp, 873/tcp), IP auto-detection, secret generation (JWT, API key, DB password, rsync password), GITHUB_TOKEN prompt, .env write (mode 600), rsyncd.secrets write.

### Verified: doctor.sh Diagnostic Categories
Source: `/root/linbo-docker/scripts/doctor.sh` (read 2026-03-10)

6 categories:
1. **Container Health** -- checks cache, api, web, tftp, rsync, ssh healthy; dhcp if exists; init exit code
2. **Volume Permissions** -- /srv/linbo writable by API container (UID 1001)
3. **SSH Keys** -- ssh_host_rsa_key, .pub, linbo_client_key, .pub present in linbo-ssh
4. **linbofs64 Build Status** -- .linbofs-patch-status marker + linbofs64 file present
5. **Redis Connectivity** -- redis-cli PING -> PONG
6. **PXE Port Reachability** -- 69/udp, 873/tcp, 3000/tcp, 2222/tcp listening

### Verified: Firewall Rules (for DOC-03 table)
Source: docker-compose.yml network modes + DHCP entrypoint + README DHCP section

Required inbound ports on Docker host (from PXE clients):

| Port | Protocol | Direction | Service | Notes |
|------|----------|-----------|---------|-------|
| 69 | UDP | Client -> Docker | TFTP | PXE boot files (GRUB). Host network mode. |
| 873 | TCP | Client -> Docker | rsync | Image + config sync. |
| 2222 | TCP | Client -> Docker | SSH | Dropbear (remote commands from server to client via API). Also server->client. |
| 8080 | TCP | Browser -> Docker | Web UI | Nginx + React SPA. Configurable via WEB_PORT. |
| 3000 | TCP | Internal/Web -> Docker | API | REST API + WebSocket. Usually only from web container, not exposed to clients. |
| 6379 | TCP | Internal | Redis | Only needed externally if DC Worker runs on separate host. Configurable via REDIS_EXTERNAL_PORT. |
| 67 | UDP | Client -> Docker | DHCP | Only with `--profile dhcp`. Host network mode. |

Required outbound from Docker host:

| Port | Protocol | Direction | Service | Notes |
|------|----------|-----------|---------|-------|
| 443 | TCP | Docker -> Internet | HTTPS | deb.linuxmuster.net (init container), GitHub (npm packages) |
| 8400 | TCP | Docker -> LMN | Authority API | Only in sync mode (LMN_API_URL). |
| 8001 | TCP | Docker -> LMN | linuxmuster-api | Alternative sync endpoint. |

### Verified: DHCP Configuration Snippets
Source: README.md lines 176-198, containers/dhcp/entrypoint.sh

ISC DHCP (BIOS + UEFI):
```
# In dhcpd.conf or custom.conf
option architecture-type code 93 = unsigned integer 16;

if option architecture-type = 00:07 {
    filename "boot/grub/x86_64-efi/core.efi";
} elsif option architecture-type = 00:09 {
    filename "boot/grub/x86_64-efi/core.efi";
} else {
    filename "boot/grub/i386-pc/core.0";
}

next-server <LINBO_SERVER_IP>;
```

Proxy-DHCP dnsmasq (from entrypoint.sh fallback):
```
port=0
dhcp-range=<subnet>,proxy
interface=<interface>
bind-interfaces
log-dhcp
dhcp-match=set:bios,option:client-arch,0
dhcp-match=set:efi32,option:client-arch,6
dhcp-match=set:efi64,option:client-arch,7
dhcp-match=set:efi64,option:client-arch,9
dhcp-boot=tag:bios,boot/grub/i386-pc/core.0,<LINBO_SERVER_IP>
dhcp-boot=tag:efi32,boot/grub/i386-efi/core.efi,<LINBO_SERVER_IP>
dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,<LINBO_SERVER_IP>
```

### Verified: Mermaid Diagram Style
Source: `docs/ARCHITECTURE.md` (read 2026-03-10)

Existing patterns to follow:
- `graph TB` for top-down architecture diagrams
- `sequenceDiagram` for data flow
- `subgraph` with labels for logical groupings (LMN-Server, Docker, Clients)
- Color scheme: blue (#2563eb) for API/auth, red (#dc2626) for Redis, green (#16a34a) for web/frontend, amber (#f59e0b) for data sources
- German labels in diagrams

### Verified: Makefile Targets
Source: `/root/linbo-docker/Makefile` (read 2026-03-10)

Admin-relevant targets:

| Target | Command | Purpose |
|--------|---------|---------|
| `make up` | `docker compose up -d` | Start all containers |
| `make down` | `docker compose down` | Stop all containers |
| `make rebuild` | `docker compose up -d --build api web` | Rebuild API + Web |
| `make rebuild-all` | `docker compose up -d --build` | Rebuild everything |
| `make logs` | `docker logs linbo-api --tail 50 -f` | Tail API logs |
| `make logs-all` | `docker compose logs --tail 20 -f` | Tail all logs |
| `make health` | curl health endpoints | Check API + Web health |
| `make wait-ready` | `./scripts/wait-ready.sh` | Block until all healthy |
| `make doctor` | `./scripts/doctor.sh` | Run 24 diagnostic checks |
| `make test` | `docker exec linbo-api npm test` | Run test suite |
| `make status` | git status + docker ps | Show system status |
| `make clean` | Docker builder + image prune | Free disk space |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual .env creation | setup.sh wizard with auto-detection | Phase 10 (2026-03-07) | Admin runs one command instead of manually editing |
| No health gate | wait-ready.sh + doctor.sh | Phase 11 (2026-03-08) | Admin has clear pass/fail for system readiness |
| Host kernel dependency | Package kernel from linbo7 .deb | Session 31 (2026-03-05) | No /boot bind-mounts needed, simpler setup |
| 9 boot patches | Zero patches | Session 30 (2026-03-05) | Vanilla LINBO works, much simpler to explain |
| Quick Start in README | Separate INSTALL.md (this phase) | Phase 12 (current) | Proper depth for admin audience |

## Existing Assets Inventory

Critical existing assets that documentation MUST reference (from CONTEXT.md):

| Asset | Location | Accuracy Status |
|-------|----------|----------------|
| README.md Quick Start | README.md lines 36-66 | OUTDATED: still shows `cp .env.example .env` instead of `./setup.sh` |
| ARCHITECTURE.md | docs/ARCHITECTURE.md | CURRENT: Mermaid diagrams match actual architecture |
| setup.sh | setup.sh | CURRENT: 561 lines, 7 prereq checks, IP auto-detect |
| Makefile | Makefile | CURRENT: 14 targets |
| docker-compose.yml | docker-compose.yml | CURRENT: 8 services, resource limits |
| TROUBLESHOOTING.md | docs/TROUBLESHOOTING.md | CURRENT: 25 issues documented |
| hooks.md | docs/hooks.md | CURRENT: Hook system documentation |
| UNTERSCHIEDE-ZU-LINBO.md | docs/UNTERSCHIEDE-ZU-LINBO.md | CURRENT: Docker vs vanilla comparison |
| doctor.sh | scripts/doctor.sh | CURRENT: 24 checks, 6 categories |
| wait-ready.sh | scripts/wait-ready.sh | CURRENT: Health gate script |
| .env.example | .env.example | CURRENT: 33-line template |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual verification (documentation phase) |
| Config file | N/A |
| Quick run command | Verify Markdown renders correctly on GitHub |
| Full suite command | Follow INSTALL.md on a fresh VM and verify PXE boot |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DOC-01 | INSTALL.md complete from prereqs to PXE boot | manual-only | Read docs/INSTALL.md, verify no gaps | Wave 0 (file to be created) |
| DOC-02 | ADMIN-GUIDE.md explains containers, ports, volumes, startup | manual-only | Read docs/ADMIN-GUIDE.md, verify accuracy against docker-compose.yml | Wave 0 (file to be created) |
| DOC-03 | Network diagram + firewall table in ADMIN-GUIDE.md | manual-only | Verify Mermaid renders, cross-check ports against docker-compose.yml | Wave 0 (file to be created) |

**Justification for manual-only:** Documentation accuracy cannot be validated by automated tests. Verification requires human reading comprehension and cross-referencing against source files. The planner should include explicit verification steps that diff claimed ports/volumes against docker-compose.yml.

### Sampling Rate
- **Per task commit:** Manually verify Mermaid renders (paste into GitHub preview or mermaid.live)
- **Per wave merge:** Read complete document end-to-end for coherence
- **Phase gate:** Full walkthrough of INSTALL.md on mental model of fresh VM

### Wave 0 Gaps
None -- no test infrastructure needed for a documentation phase. Verification is by review.

## Open Questions

1. **GITHUB_TOKEN long-term**
   - What we know: Currently required for web container build (OSS-01 tracks removal)
   - What's unclear: Whether to document workaround for admins without GitHub accounts
   - Recommendation: Document it as required, note it will be removed in future version (OSS-01)

2. **Standalone mode mention**
   - What we know: CONTEXT.md says sync mode only, standalone not walked through
   - What's unclear: Should ADMIN-GUIDE.md mention standalone exists (without walkthrough)?
   - Recommendation: Brief mention that standalone mode exists, but INSTALL.md covers sync mode only. One sentence, no details.

3. **Version pinning in examples**
   - What we know: docker-compose.yml pins Redis to 7.4.7-alpine. Other containers build from source.
   - What's unclear: Should documentation mention specific version numbers that will go stale?
   - Recommendation: Reference "current" versions from docker-compose.yml without hardcoding version numbers in prose. The compose file IS the version truth.

## Sources

### Primary (HIGH confidence)
- `/root/linbo-docker/docker-compose.yml` -- definitive source for all ports, volumes, dependencies, resource limits
- `/root/linbo-docker/setup.sh` -- definitive source for prerequisite checks and .env generation
- `/root/linbo-docker/scripts/doctor.sh` -- definitive source for diagnostic categories
- `/root/linbo-docker/scripts/wait-ready.sh` -- definitive source for health gate behavior
- `/root/linbo-docker/Makefile` -- definitive source for admin-facing make targets
- `/root/linbo-docker/.env.example` -- definitive source for configuration variables
- `/root/linbo-docker/containers/dhcp/entrypoint.sh` -- definitive source for proxy-DHCP config

### Secondary (MEDIUM confidence)
- `/root/linbo-docker/docs/ARCHITECTURE.md` -- existing Mermaid diagram patterns and styling
- `/root/linbo-docker/docs/TROUBLESHOOTING.md` -- existing problem/solution pairs
- `/root/linbo-docker/docs/hooks.md` -- hook system documentation
- `/root/linbo-docker/docs/UNTERSCHIEDE-ZU-LINBO.md` -- Docker vs vanilla comparison

### Tertiary (LOW confidence)
- None -- all findings sourced from project files

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no libraries needed, pure Markdown/Mermaid
- Architecture: HIGH -- all information extracted from source files
- Pitfalls: HIGH -- based on verified TROUBLESHOOTING.md entries and docker-compose.yml analysis

**Research date:** 2026-03-10
**Valid until:** Indefinite (documentation of stable v1.1 codebase; re-research only if architecture changes)
