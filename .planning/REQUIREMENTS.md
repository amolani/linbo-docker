# Requirements: LINBO Docker

**Defined:** 2026-03-06
**Core Value:** LINBO als eigenständige Docker-Lösung mit modernem Web-Interface, ohne den LINBO-Kern zu verändern

## v1.0 Requirements (Complete)

### Production-Readiness

- [x] **PROD-01**: Docker Base-Images mit festen Version-Tags gepinnt (reproduzierbare Builds)
- [x] **PROD-02**: API verweigert Start wenn JWT_SECRET oder INTERNAL_API_KEY Default-Werte haben (NODE_ENV=production)
- [x] **PROD-03**: .dockerignore in allen Container-Verzeichnissen vorhanden (kein node_modules/Host-Artefakte)
- [x] **PROD-04**: Deploy-Script nutzt INTERNAL_API_KEY statt Default-Admin-Passwort für Rebuilds
- [x] **PROD-05**: rsyncd.secrets aus Git-Tracking entfernt, rsyncd.secrets.example bereitgestellt
- [x] **PROD-06**: WebSocket `/ws` Endpoint verifiziert JWT-Token bei Connection-Upgrade
- [x] **PROD-07**: Rate-Limiting auf POST /auth/login (5 Versuche/Minute/IP)
- [x] **PROD-08**: CORS Default auf Web-Container Origin statt Wildcard `*`

### Test Coverage

- [x] **TEST-01**: Unit-Tests für Image-Sync Service (Resume-Download, SHA256-Verify, Atomic Directory Swap, Queue)
- [x] **TEST-02**: Unit-Tests für Terminal Service (Session-Create/Destroy, PTY/Exec-Fallback, Idle-Timeout, Cleanup)
- [x] **TEST-03**: Integration-Tests für WebSocket (Connection mit/ohne Auth, Heartbeat, Channel-Subscription, Broadcast)
- [x] **TEST-04**: Frontend-Tests für kritische Zustand-Stores (wsStore Reconnect, hostStore Merge, configStore Cache)

### Tech-Debt

- [x] **DEBT-01**: Alle 31 silent catch-blocks durch kategorisiertes Logging ersetzen (debug/warn/rethrow)
- [x] **DEBT-02**: system.js (1483 Zeilen) in Sub-Router splitten: kernel, firmware, grub-theme, grub-config, linbo-update, worker, wlan
- [x] **DEBT-03**: operation.worker.js Prisma-optional Pattern anwenden (try/catch Guard statt top-level require)
- [x] **DEBT-04**: Redis KEYS-Command durch SCAN-basierte Iteration in delPattern() ersetzen

## v1.1 Requirements

Requirements for Fresh Install & Production Readiness. Each maps to roadmap phases.

### Bootstrap Flow

- [x] **BOOT-01**: Admin kann `./setup.sh` ausführen und bekommt eine funktionierende `.env` mit validierten Werten
- [x] **BOOT-02**: Setup-Script prüft Prerequisites (Docker-Version, Ports, Disk, Netzwerk) und zeigt klare Pass/Fail-Meldungen
- [x] **BOOT-03**: Setup-Script erkennt automatisch die LINBO_SERVER_IP auf dem PXE-Netzwerk-Interface
- [x] **BOOT-04**: `.env`-Generierung erstellt sichere Secrets (JWT_SECRET, INTERNAL_API_KEY) automatisch

### Error Handling

- [x] **ERR-01**: Init Container zeigt actionable Fehlermeldungen bei APT-Fehlern, SHA256-Mismatches und Permission-Problemen
- [x] **ERR-02**: `make wait-ready` blockiert bis alle Container bereit sind oder zeigt an was hängt
- [x] **ERR-03**: Port-Konflikte (TFTP 69/udp, rsync 873) werden vor dem Start erkannt mit klarer Lösung

### Documentation

- [ ] **DOC-01**: Install Guide (`docs/INSTALL.md`) führt Admin von Prerequisites bis zum ersten PXE-Boot
- [x] **DOC-02**: Architektur-Übersicht erklärt Container-Rollen, Ports, Volumes und Startup-Reihenfolge für Admins
- [x] **DOC-03**: Netzwerk-Diagramm zeigt alle Verbindungen (Client <-> TFTP/HTTP/rsync/SSH) mit Ports und Firewall-Regeln

### Production Hardening

- [x] **HARD-01**: Docker Compose definiert Memory/CPU Limits für alle Container
- [x] **HARD-02**: `make doctor` prüft Container-Health, Volume-Permissions, SSH-Keys, linbofs64-Status, Redis und PXE-Erreichbarkeit

## v2 Requirements

### Security Hardening

- **SEC-01**: Token-Revocation (Server-side JWT Blacklist in Redis)
- **SEC-02**: execFile statt exec für dpkg/dpkg-deb Aufrufe (Shell-Injection Prevention)
- **SEC-03**: API-Key Authentifizierung optimieren (Prefix-Lookup statt O(N) bcrypt)

### Missing Features

- **FEAT-01**: Multicast Image Distribution (udpcast)
- **FEAT-02**: Torrent Image Distribution (ctorrent)
- **FEAT-03**: Image Versioning
- **FEAT-04**: Host-GRUB .img Generation

### Open-Source Readiness (v1.2+)

- **OSS-01**: GITHUB_TOKEN-Abhängigkeit für @edulution-io/ui-kit aufgelöst (vendoring oder replacement)
- **OSS-02**: deploy/docker-compose.yml konsolidiert oder entfernt

### User Experience (v1.2+)

- **UX-01**: Guided First-Login Experience (Checklist/Banner nach erstem Login)
- **UX-02**: Configuration Drift Detection (.env vs running container)

### Operations (v1.2+)

- **OPS-01**: Backup/Restore Script (`make backup` / `make restore`)
- **OPS-02**: Upgrade-Dokumentation (git pull -> rebuild -> rollback)
- **OPS-03**: Sync Mode Setup Guide (Authority API Anbindung)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web-based Setup Wizard | Over-engineering -- Setup laeuft einmal, Shell-Script reicht |
| Auto-Update Mechanism | Gefaehrlich bei Netzwerk-Boot-Infrastruktur -- manuelles Update sicherer |
| Multi-Site Management | Enorme Komplexitaet (Auth-Federation, Cross-Site Networking) -- v3+ |
| Custom DHCP als Default | Konflikte mit existierenden DHCP-Servern in Schulnetzen |
| Helm Chart / Kubernetes | Zielgruppe ist Bare-Metal/Single-VM, TFTP braucht host network |
| CLI Config Editor | Web-UI existiert bereits fuer Config-Editing |
| Internationalisierung | Deutsche Zielgruppe, i18n erst bei Bedarf |
| LINBO-Kern modifizieren | Prinzip: nur Hooks, nie init.sh/linbo.sh aendern |
| Sophomorix/LDAP Integration | LMN-seitig, nicht Docker-Scope |

## Traceability

### v1.0 (Complete)

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROD-01 | Phase 1: Build Hygiene | Complete |
| PROD-02 | Phase 2: Secrets Hardening | Complete |
| PROD-03 | Phase 1: Build Hygiene | Complete |
| PROD-04 | Phase 2: Secrets Hardening | Complete |
| PROD-05 | Phase 2: Secrets Hardening | Complete |
| PROD-06 | Phase 3: API Security | Complete |
| PROD-07 | Phase 3: API Security | Complete |
| PROD-08 | Phase 3: API Security | Complete |
| TEST-01 | Phase 7: Backend Test Suites | Complete |
| TEST-02 | Phase 7: Backend Test Suites | Complete |
| TEST-03 | Phase 8: Integration and Frontend Tests | Complete |
| TEST-04 | Phase 8: Integration and Frontend Tests | Complete |
| DEBT-01 | Phase 5: Error Handling Cleanup | Complete |
| DEBT-02 | Phase 4: System Router Split | Complete |
| DEBT-03 | Phase 6: Isolated Debt Fixes | Complete |
| DEBT-04 | Phase 6: Isolated Debt Fixes | Complete |

### v1.1 (Current)

| Requirement | Phase | Status |
|-------------|-------|--------|
| ERR-01 | Phase 9: Init Container Hardening | Complete |
| BOOT-01 | Phase 10: Configuration & Install Script | Complete |
| BOOT-02 | Phase 10: Configuration & Install Script | Complete |
| BOOT-03 | Phase 10: Configuration & Install Script | Complete |
| BOOT-04 | Phase 10: Configuration & Install Script | Complete |
| ERR-03 | Phase 10: Configuration & Install Script | Complete |
| ERR-02 | Phase 11: Production Hardening & Observability | Complete |
| HARD-01 | Phase 11: Production Hardening & Observability | Complete |
| HARD-02 | Phase 11: Production Hardening & Observability | Complete |
| DOC-01 | Phase 12: Admin Documentation | Pending |
| DOC-02 | Phase 12: Admin Documentation | Complete |
| DOC-03 | Phase 12: Admin Documentation | Complete |

**Coverage:**
- v1.0 requirements: 16 total -- 16 complete
- v1.1 requirements: 12 total
- Mapped to phases: 12/12
- Unmapped: 0

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-08 after v1.1 roadmap creation*
