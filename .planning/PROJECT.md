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

### Active

<!-- Current scope. Building toward these. -->

- [ ] **PROD-01**: Pinned Docker Base-Images für reproduzierbare Builds
- [ ] **PROD-02**: Startup-Validierung (JWT-Secret, API-Key nicht Default)
- [ ] **PROD-03**: .dockerignore für saubere Builds (kein node_modules vom Host)
- [ ] **PROD-04**: Deploy-Script nutzt INTERNAL_API_KEY statt Default-Passwort
- [ ] **TEST-01**: Tests für Image-Sync Service (Resume, Verify, Atomic Swap)
- [ ] **TEST-02**: Tests für Terminal Service (Session-Lifecycle, Cleanup)
- [ ] **TEST-03**: Tests für WebSocket (Connection, Auth, Heartbeat)
- [ ] **TEST-04**: Frontend-Test Coverage erhöhen (Pages, Components, Stores)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Multicast (udpcast) — Hohe Komplexität, eigene Phase
- Torrent (ctorrent) — Eigene Phase, braucht P2P-Infrastruktur
- Image-Versioning — Eigene Phase
- Host-GRUB .img — Eigene Phase
- Sophomorix/LDAP — Nicht geplant, LMN-seitig
- LINBO-Kern modifizieren — Prinzip: nur Hooks, nie init.sh/linbo.sh ändern

## Context

- **Codebase:** 33+ Sessions Entwicklung, 7 Docker-Container, 23 API-Services, 14 React-Pages
- **Produktion:** Läuft auf Testserver 10.0.0.13, verifiziert auf echter Hardware (Lenovo L16, Intel Core Ultra 5)
- **Upstream:** linuxmuster-linbo7 4.3.31-0, LMN 7.3
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

---
*Last updated: 2026-03-06 after project initialization*
