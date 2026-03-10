# Phase 12: Admin Documentation — Context

**Created:** 2026-03-10
**Phase Goal:** A sysadmin with no prior exposure to the project can follow the documentation from VM setup to verified PXE boot without needing developer assistance
**Requirements:** DOC-01, DOC-02, DOC-03

## Decisions

### 1. Document Structure

| Decision | Choice |
|----------|--------|
| README vs INSTALL.md | README becomes overview only (strip Quick Start). INSTALL.md is THE install guide. |
| Architecture doc location | New `docs/ADMIN-GUIDE.md` for admin-focused content. Existing `docs/ARCHITECTURE.md` stays untouched (developer reference). |
| Network diagram placement | Inside ADMIN-GUIDE.md as a section, not a standalone file. |
| Verification depth | INSTALL.md ends with full PXE verification walkthrough: containers healthy → `make doctor` passes → test client PXE boots → linbo_gui appears. |

**File mapping:**
- `docs/INSTALL.md` → DOC-01 (Install Guide)
- `docs/ADMIN-GUIDE.md` → DOC-02 (Architecture Overview) + DOC-03 (Network Diagram + Firewall Table)
- `README.md` → Update: strip Quick Start, link to INSTALL.md

### 2. Audience & Depth

| Decision | Choice |
|----------|--------|
| Baseline knowledge | Linux admin basics (apt, ssh, systemctl, networking). Include Docker install steps if not present. |
| Troubleshooting | Inline 3-5 most common issues in INSTALL.md, link to `docs/TROUBLESHOOTING.md` for the rest. |
| Mode coverage | Sync mode only. Standalone not walked through. |
| Explanation depth | Deep explanations — detailed reasoning for architecture choices (why read-only, why hooks, why Docker). Helps admins make informed customization decisions. |

### 3. Network Diagram Scope

| Decision | Choice |
|----------|--------|
| Coverage | Full deployment: LMN Server + Docker host + PXE clients + network segments. Complete picture of who talks to whom. |
| Format | Mermaid (consistent with existing ARCHITECTURE.md, renders on GitHub). |
| Firewall rules | Mermaid diagram + markdown table listing every port/protocol/direction/purpose. |
| DHCP container | Full section on when/how to use the DHCP container, including proxy-DHCP config with dnsmasq. |

### 4. Language

| Decision | Choice |
|----------|--------|
| Language | German — matches target audience (German schools/Schulträger) and existing README/ARCHITECTURE.md. |
| Technical terms | English tech terms stay English (Docker, container, PXE, TFTP, GRUB, Image, etc.). German prose with English technical vocabulary — standard in deutscher IT-Doku. |

## Existing Assets to Leverage

| Asset | Location | Use |
|-------|----------|-----|
| README.md Quick Start | `README.md` lines 55-90 | Reference for flow, then strip and replace with link |
| ARCHITECTURE.md | `docs/ARCHITECTURE.md` | Reference for Mermaid style, do NOT modify |
| setup.sh | `setup.sh` (17KB) | Document its 7 prerequisite checks, .env generation, IP detection |
| Makefile targets | `Makefile` | Document: up, down, health, doctor, wait-ready, deploy, logs |
| TROUBLESHOOTING.md | `docs/TROUBLESHOOTING.md` | Link from INSTALL.md common issues section |
| docker-compose.yml | `docker-compose.yml` | Source of truth for ports, volumes, container names, resource limits |
| hooks.md | `docs/hooks.md` | Link from ADMIN-GUIDE.md customization section |
| UNTERSCHIEDE-ZU-LINBO.md | `docs/UNTERSCHIEDE-ZU-LINBO.md` | Link from ADMIN-GUIDE.md for context on Docker vs vanilla LINBO |
| .planning/codebase/ | 7 analysis docs | Internal reference for accuracy, not user-facing |

## Scope Boundaries

**In scope:**
- INSTALL.md: Prerequisites → setup.sh → docker compose up → full PXE verification
- ADMIN-GUIDE.md: Container roles, startup order, volumes, ports, network diagram, firewall table, DHCP section, design rationale
- README.md: Strip Quick Start, add link to INSTALL.md

**Out of scope:**
- Standalone mode walkthrough (sync mode only)
- Developer documentation (ARCHITECTURE.md stays as-is)
- API reference documentation
- Frontend user guide
- Internationalization
