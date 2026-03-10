# LINBO Docker

## What This Is

Dockerisierte Version von LINBO (Linux Network Boot), entkoppelt von linuxmuster.net. Bietet ein modernes Web-Frontend, REST API und eigene Features (Patchclass-Pipeline, Kernel-Varianten, SSH-Terminal, Echtzeit-Monitoring) auf Basis des unveränderten LINBO-Kerns. Zielgruppe: Schulen und Schulträger die LINBO nutzen wollen — mit oder ohne linuxmuster.net.

## Core Value

LINBO als eigenständige, Docker-basierte Lösung mit modernem Web-Interface betreiben, ohne den LINBO-Kern zu verändern — damit Updates vom Upstream problemlos durchlaufen.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ **BOOT-01**: PXE Boot-Chain funktioniert (GRUB → Kernel → linbofs64 → linbo_gui) — Session 28
- ✓ **BOOT-02**: GRUB-Configs werden automatisch aus start.conf generiert — Session 30
- ✓ **BOOT-03**: Kernel-Varianten (stable/longterm/legacy) per API umschaltbar — Session 31
- ✓ **BOOT-04**: linbofs64 wird automatisch gebaut mit SSH-Keys, Modulen, Firmware — Session 33
- ✓ **BOOT-05**: Hook-System für linbofs64-Anpassungen (Pre/Post-Hooks) — Session 33
- ✓ **BOOT-06**: Init-Container zieht Pakete direkt vom LMN APT Repo — Session 34
- ✓ **API-01**: REST API mit JWT-Auth, Zod-Validation, Audit-Logging — Session 12
- ✓ **API-02**: WebSocket für Echtzeit-Updates (Host-Status, Operationen, Sync) — Session 15
- ✓ **API-03**: Dual-Mode (Standalone mit PostgreSQL / Sync mit Redis-only) — Session 20
- ✓ **API-04**: LINBO-Update per APT Repo mit Download, Verify, Rebuild — Session 27
- ✓ **SYNC-01**: Delta-Feed von LMN Authority API (Hosts, Configs, Rooms) — Session 22
- ✓ **SYNC-02**: Docker bleibt permanent read-only für LMN-Daten — Session 22
- ✓ **SYNC-03**: Image-Sync mit HTTP Range-Download und Resume — Session 25
- ✓ **UI-01**: React Frontend mit Dashboard, Host-Management, Config-Editor — Session 16
- ✓ **UI-02**: SSH-Terminal zu LINBO-Clients im Browser (xterm.js) — Session 18
- ✓ **UI-03**: Patchclass-Manager mit Treiber-Upload und DMI-Matching — Session 28
- ✓ **UI-04**: Firmware-Manager mit Hardware-Scan und Katalog — Session 26
- ✓ **OPS-01**: Remote-Operationen (Partition, Sync, Start, Reboot) per API — Session 15
- ✓ **OPS-02**: Host-Status Echtzeit-Monitoring via Port-Scanning + WebSocket — Session 19
- ✓ **DRV-01**: Patchclass-Pipeline E2E verifiziert auf realer Hardware — Session 28

### Validated (v1.0 Hardening)

- ✓ **PROD-01**: Pinned Docker Base-Images für reproduzierbare Builds — v1.0 Phase 1
- ✓ **PROD-02**: Startup-Validierung (JWT-Secret, API-Key nicht Default) — v1.0 Phase 2
- ✓ **PROD-03**: .dockerignore für saubere Builds (kein node_modules vom Host) — v1.0 Phase 1
- ✓ **PROD-04**: Deploy-Script nutzt INTERNAL_API_KEY statt Default-Passwort — v1.0 Phase 2
- ✓ **PROD-05**: rsyncd.secrets aus Git-Tracking entfernt — v1.0 Phase 2
- ✓ **PROD-06**: WebSocket JWT-Verification bei Connection-Upgrade — v1.0 Phase 3
- ✓ **PROD-07**: Rate-Limiting auf POST /auth/login (5/min/IP) — v1.0 Phase 3
- ✓ **PROD-08**: CORS Default auf Web-Container Origin — v1.0 Phase 3
- ✓ **DEBT-01**: Alle 48 silent catch-blocks kategorisiert — v1.0 Phase 5
- ✓ **DEBT-02**: system.js in 8 Sub-Router gesplittet — v1.0 Phase 4
- ✓ **DEBT-03**: Worker Prisma-optional Guard — v1.0 Phase 6
- ✓ **DEBT-04**: Redis KEYS→SCAN Migration — v1.0 Phase 6
- ✓ **TEST-01**: Tests für Image-Sync Service — v1.0 Phase 7
- ✓ **TEST-02**: Tests für Terminal Service — v1.0 Phase 7
- ✓ **TEST-03**: Tests für WebSocket — v1.0 Phase 8
- ✓ **TEST-04**: Frontend Store Tests — v1.0 Phase 8

### Validated (v1.1 Fresh Install & Production Readiness)

- ✓ **ERR-01**: Init Container strukturierte Fehlermeldungen — v1.1 Phase 9
- ✓ **BOOT-v1.1-01**: setup.sh mit funktionierender .env — v1.1 Phase 10
- ✓ **BOOT-v1.1-02**: Prerequisites Check (Docker, Ports, Disk, Netzwerk) — v1.1 Phase 10
- ✓ **BOOT-v1.1-03**: LINBO_SERVER_IP Auto-Detect — v1.1 Phase 10
- ✓ **BOOT-v1.1-04**: Sichere Secrets automatisch generiert — v1.1 Phase 10
- ✓ **ERR-02**: make wait-ready Health Gate — v1.1 Phase 11
- ✓ **ERR-03**: Port-Konflikt-Erkennung vor Start — v1.1 Phase 10
- ✓ **HARD-01**: Docker Compose Memory/CPU Limits — v1.1 Phase 11
- ✓ **HARD-02**: make doctor Diagnostik (24 Checks) — v1.1 Phase 11
- ✓ **DOC-01**: Install Guide (docs/INSTALL.md) — v1.1 Phase 12
- ✓ **DOC-02**: Architektur-Übersicht für Admins — v1.1 Phase 12
- ✓ **DOC-03**: Netzwerk-Diagramm mit Ports und Firewall-Regeln — v1.1 Phase 12

### Active

<!-- Current scope. Building toward these. -->

(No active milestone — run `/gsd:new-milestone` to define v2.0)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Multicast (udpcast) — Hohe Komplexität, eigene Phase
- Torrent (ctorrent) — Eigene Phase, braucht P2P-Infrastruktur
- Image-Versioning — Eigene Phase
- Host-GRUB .img — Eigene Phase
- Sophomorix/LDAP — Nicht geplant, LMN-seitig
- LINBO-Kern modifizieren — Prinzip: nur Hooks, nie init.sh/linbo.sh ändern

## Context

- **Codebase:** 33+ Sessions, ~9.3k LOC JS/TS, ~6k LOC Shell, 7 Docker-Container, 23 API-Services, 14 React-Pages
- **Produktion:** Läuft auf Testserver 10.0.0.13, verifiziert auf echter Hardware (Lenovo L16, Intel Core Ultra 5)
- **Upstream:** linuxmuster-linbo7 4.3.31-0, LMN 7.3
- **Shipped:** v1.0 Hardening (2026-03-08), v1.1 Fresh Install (2026-03-10)
- **Boot-Erkenntnis:** Vanilla LINBO funktioniert ohne Patches — alle 9 ursprünglichen Boot-Patches waren unnötig (Session 30)
- **Codebase Map:** `.planning/codebase/` mit 7 Dokumenten (Stack, Architecture, Structure, Conventions, Testing, Integrations, Concerns)

## Constraints

- **LINBO-Kern**: Vanilla — keine Änderungen an init.sh, linbo.sh, linbo_link_blkdev. Nur Hook-System.
- **Read-Only**: Docker schreibt nie Hosts/Configs/Rooms zurück zum LMN Server
- **Netzwerk**: TFTP + DHCP brauchen `network_mode: host` (PXE-Requirement)
- **Auth**: `@edulution-io/ui-kit` braucht GITHUB_TOKEN für npm Install
- **Multi-Schule**: Projekt soll für andere LMN-Nutzer als Open-Source funktionieren

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Docker statt bare-metal | Entkopplung von LMN, einfacheres Deployment | ✓ Good |
| APT Repo statt GitHub Release | Eine Quelle für Init + Updates, immer aktuell | ✓ Good |
| Vanilla LINBO (nur Hooks) | Updates laufen durch, kein Fork-Maintenance | ✓ Good |
| Redis als Sync-Cache | Schnell, kein Schema-Management, Pub/Sub built-in | ✓ Good |
| Dual-Mode (Standalone/Sync) | Flexibel: mit oder ohne LMN Server nutzbar | ✓ Good |
| Postsync für Patchclass | Standard-LINBO-Mechanismus, kein Upstream-PR nötig | ✓ Good |
| Checkpoint-Idempotenz im Init | Recovery ohne manuelle Cleanup nach Partial Failure | ✓ Good |
| setup.sh statt Web-Wizard | Setup läuft einmal, Shell reicht | ✓ Good |
| .env.example konsolidiert (33 Zeilen) | Nur user-facing Variablen, weniger Verwirrung | ✓ Good |
| doctor.sh statt integrierte Health-UI | CLI-Tool reicht für Admin-Diagnose, kein UI-Overhead | ✓ Good |
| INSTALL.md + ADMIN-GUIDE.md getrennt | Install-Guide = Schritt-für-Schritt, Admin-Guide = Referenz | ✓ Good |

---
*Last updated: 2026-03-10 after v1.1 milestone*
