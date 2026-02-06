# LINBO Docker - Projekt Status

**Stand:** 2026-02-06
**Version:** 0.10.0
**Functional Parity:** ~97%

## Implementierte Phasen

### Phase 1-6: Grundsystem

- Docker Container Architektur (init, tftp, rsync, ssh, db, cache, api, web)
- PostgreSQL Datenbank mit Prisma ORM
- Redis Cache für Sessions und Job-Queue
- Express.js REST API mit JWT Authentication
- React Frontend mit Tailwind CSS

### Phase 7a: Remote Commands

- SSH-basierte Befehlsausführung auf LINBO-Clients
- Unterstützte Befehle: sync, start, create, reboot, shutdown, wol
- Bulk-Operationen für mehrere Hosts
- WebSocket-basiertes Progress-Tracking
- **Tests:** 33

### Phase 7b: Device Import

- CSV Import/Export im linuxmuster.net Format
- Validierung von MAC, IP, Hostname
- Automatische Room/Config-Erstellung
- Dry-Run Modus für Vorschau
- **Tests:** 42

### Phase 7c: Frontend

- Raw Config Editor mit Syntax Highlighting
- DB-Synchronisation bei Änderungen
- Configs-Verwaltung (CRUD)
- Operations-Dashboard mit Live-Status

### Phase 8: Machine Account Management

- Redis Streams für Job-Queue (`linbo:jobs` Stream, `dc-workers` Consumer Group)
- DC Worker (`dc-worker/macct-worker.py`) für Active Directory Integration
- Automatischer macct-repair bei Image-Download (rsync-pre-download Hook)
- Retry-Logik mit Dead Letter Queue (max 3 Versuche)
- **Tests:** 23

### Phase 9: Groups Removal

- Vereinfachung: Groups-Konzept entfernt
- Host.configId statt Host.groupId
- Entspricht Production linuxmuster.net Logik

### Phase 10: DHCP Integration

- **Service:** `dhcp.service.js` - Generierung von DHCP-Konfigurationen
- **Formate:** ISC DHCP, dnsmasq Full, dnsmasq Proxy
- **Network Settings:** Redis-basiert (`system:network-settings`) mit ENV-Defaults
- **Stale Detection:** Erkennt veraltete Exporte nach Host/Config-Änderungen
- **PXE-Boot:** Option 40 (NIS-Domain) für Config-Zuordnung, Architektur-Erkennung (BIOS/EFI)
- **Container:** `containers/dhcp/` - optionaler dnsmasq Proxy-DHCP (`--profile dhcp`)
- **Frontend:** DhcpPage mit NetworkSettingsForm, DhcpExportCard, DhcpPreviewModal
- **Tests:** 49

### Phase 11: Host Provisioning via DC Worker

- **Provisioning Service:** `provisioning.service.js` - Job-Erstellung, Deduplizierung, Status-Tracking
- **Opt-in:** `DC_PROVISIONING_ENABLED=true` (Default: false)
- **Dry-Run:** `DC_PROVISIONING_DRYRUN=true` (Default: true) - kein Schreibzugriff auf DC
- **Schema:** `Host.provisionStatus` + `Host.provisionOpId` Felder
- **Validation:** Hostname max 15 Zeichen (NetBIOS-Limit)
- **Host CRUD Hooks:** POST/PATCH/DELETE + Import loesen automatisch Provisioning-Jobs aus
- **DC Worker:** `ProvisionProcessor` Klasse in `macct-worker.py`
  - Delta/Merge: `linbo-docker.devices.csv` + `devices.csv` → Patch-Merge
  - Batch Import: Bis zu 50 Jobs gebatcht, EIN `linuxmuster-import-devices` pro Batch
  - Verify: AD + DNS-A (Pflicht), DNS-PTR + DHCP (optional/konfigurierbar)
  - Dry-Run: Loggt Merge-Ergebnis, schreibt aber nichts
  - Crash-Safety: XACK erst nach vollstaendigem Batch, PEL-Recovery beim Neustart
- **Frontend:** ProvisionBadge Komponente (pending/running/synced/failed)
- **Internal Routes:** Generalisierter Dispatch nach Operation-Type
- **Tests:** 29

## Test-Uebersicht

| Test Suite | Tests | Status |
|------------|-------|--------|
| dhcp.service.test.js | 49 | Passing |
| grub.service.test.js | 64 | Passing |
| deviceImport.service.test.js | 42 | Passing |
| remote.service.test.js | 33 | Passing |
| provisioning.service.test.js | 29 | Passing |
| host.service.test.js | 24 | Passing |
| macct.service.test.js | 23 | Passing |
| linbofs.service.test.js | 18 | Passing |
| config.service.test.js | 18 | Passing |
| api.test.js (Integration) | 34 | 5 pre-existing failures |
| import.test.js | 50 | Passing |
| **Gesamt** | **384** | **379 passing (98.7%)** |

## Container Architektur

```
┌──────────────────────────────────────────────────────────────┐
│                      Docker Network                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│  │   init   │   │   tftp   │   │  rsync   │                │
│  │ (setup)  │   │  (69/udp)│   │  (873)   │                │
│  └──────────┘   └──────────┘   └──────────┘                │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│  │   ssh    │   │    db    │   │  cache   │                │
│  │  (2222)  │   │  (5432)  │   │  (6379)  │                │
│  └──────────┘   └──────────┘   └──────────┘                │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│  │   api    │   │   web    │   │   dhcp   │                │
│  │  (3000)  │   │  (8080)  │   │ (67/udp) │ optional       │
│  └──────────┘   └──────────┘   └──────────┘                │
│                                                              │
└──────────────────────────────────────────────────────────────┘

External (auf dem AD DC):
┌──────────────────┐
│   DC Worker      │  macct-worker.py + systemd
│ (macct + prov.)  │  Liest von Redis Stream linbo:jobs
└──────────────────┘
```

## Datenmodell

```
Host ─────────────┬──────────────> Config
  │               │                  │
  │               │                  ├── linboSettings
  │               │                  ├── partitions[]
  │  provStatus   │                  └── osEntries[]
  │  provOpId     │
  └───> Room      └──────────────> Operation
                                      │
                                      ├── type: 'provision_host' | 'macct_repair' | ...
                                      ├── options: { action, hostname, mac, ... }
                                      └── Sessions[]
```

## API Endpoints

### Authentifizierung
- `POST /api/v1/auth/login` - Login
- `GET /api/v1/auth/me` - Current user

### Hosts
- `GET /api/v1/hosts` - Liste (mit Pagination, Filter)
- `POST /api/v1/hosts` - Erstellen (+ auto Provisioning-Job)
- `GET /api/v1/hosts/:id` - Details
- `PATCH /api/v1/hosts/:id` - Update (+ auto Provisioning-Job)
- `DELETE /api/v1/hosts/:id` - Loeschen (+ auto Provisioning-Job mit Frozen Snapshot)
- `GET /api/v1/hosts/by-mac/:mac` - Suche nach MAC

### Configs
- `GET /api/v1/configs` - Liste
- `POST /api/v1/configs` - Erstellen
- `GET /api/v1/configs/:id` - Details
- `PATCH /api/v1/configs/:id` - Update
- `DELETE /api/v1/configs/:id` - Loeschen
- `GET /api/v1/configs/:id/preview` - start.conf Vorschau
- `POST /api/v1/configs/:id/deploy` - Deployen
- `GET /api/v1/configs/:id/raw` - Raw start.conf
- `PUT /api/v1/configs/:id/raw` - Raw speichern

### Rooms
- CRUD: `GET/POST/PATCH/DELETE /api/v1/rooms`

### Images
- `GET /api/v1/images` - Liste
- `GET /api/v1/images/:name` - Details
- `DELETE /api/v1/images/:name` - Loeschen

### Operations
- `POST /api/v1/operations/direct` - Sofort-Befehl
- `POST /api/v1/operations/schedule` - Geplanter Befehl
- `POST /api/v1/operations/wake` - Wake-on-LAN
- `GET /api/v1/operations` - Liste
- `GET /api/v1/operations/:id` - Status
- `POST /api/v1/operations/macct-repair` - Machine Account reparieren
- `GET /api/v1/operations/provision` - Provisioning-Jobs auflisten
- `POST /api/v1/operations/provision` - Provisioning manuell ausloesen
- `GET /api/v1/operations/provision/:id` - Provisioning-Job Details
- `POST /api/v1/operations/provision/:id/retry` - Fehlgeschlagenen Job wiederholen

### DHCP
- `GET /api/v1/dhcp/network-settings` - Netzwerk-Einstellungen lesen
- `PUT /api/v1/dhcp/network-settings` - Netzwerk-Einstellungen speichern
- `GET /api/v1/dhcp/summary` - DHCP-Zusammenfassung
- `GET /api/v1/dhcp/export/isc-dhcp` - ISC DHCP Config generieren
- `GET /api/v1/dhcp/export/dnsmasq` - dnsmasq Full Config generieren
- `GET /api/v1/dhcp/export/dnsmasq-proxy` - dnsmasq Proxy Config generieren

### System
- `POST /api/v1/system/update-linbofs` - linbofs aktualisieren
- `POST /api/v1/system/regenerate-grub-configs` - GRUB neu generieren
- `GET /api/v1/system/linbofs-status` - linbofs Status

### Import/Export
- `POST /api/v1/import/devices` - CSV Import (+ auto Provisioning-Jobs)
- `GET /api/v1/export/devices` - CSV Export

## Provisioning Architektur (Phase 11)

### Ablauf

```
Host CRUD in API ──> provisioning.service.js
                          │
                          ├── Operation erstellen (DB)
                          ├── Host.provisionStatus = 'pending'
                          └── XADD linbo:jobs (slim payload)
                                    │
                                    ▼
                          DC Worker (macct-worker.py)
                          ProvisionProcessor.process()
                                    │
                          ┌─────────┴──────────┐
                          │ 1. Lock erwerben    │
                          │ 2. Delta anwenden   │
                          │ 3. Drain (batch)    │
                          │ 4. Merge            │
                          │ 5. Conflict-Check   │
                          │ 6. Write + Import   │
                          │ 7. Verify per Host  │
                          │ 8. XACK             │
                          │ 9. Lock freigeben   │
                          └─────────┬──────────┘
                                    │
                          Status: synced / failed
                          (via PATCH /internal/operations/:id/status)
```

### Delta/Merge Strategie

Docker verwaltet eine eigene Delta-Datei:
```
/etc/linuxmuster/sophomorix/default-school/linbo-docker.devices.csv
```

**Merge-Regeln:**
- Delta patcht Master-Eintraege (Spalten 0-4 aus Delta, Spalten 5+ aus Master beibehalten)
- Master-Eintraege ohne Delta-Match bleiben unveraendert
- Neue Delta-Eintraege werden angehaengt
- Geloeschte Hosts werden aus dem Merge-Ergebnis entfernt
- Atomares Ersetzen: `os.rename(devices.csv.tmp, devices.csv)`

### Provision Status Lifecycle

```
null ──> pending ──> running ──> synced
                        │
                        └──────> failed
```

### Konfiguration

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `DC_PROVISIONING_ENABLED` | `false` | Provisioning aktivieren |
| `DC_PROVISIONING_DRYRUN` | `true` | Dry-Run (kein Schreibzugriff) |
| `CSV_COL0_SOURCE` | `room` | Quelle fuer CSV Spalte 0 (room/group) |
| `LINBO_DOMAIN` | `linuxmuster.lan` | DNS Domain (`auto` = Samba-Detect) |
| `PROVISION_BATCH_SIZE` | `50` | Max Jobs pro Import-Lauf |
| `PROVISION_DEBOUNCE_SEC` | `5` | Wartezeit vor Batch-Drain |
| `SAMBA_TOOL_AUTH` | *(leer)* | Auth fuer samba-tool Cleanup |
| `DHCP_VERIFY_FILE` | *(leer)* | DHCP-Datei fuer Verify |

## Bekannte Einschraenkungen

1. **Kein Multicast** - udpcast nicht implementiert
2. **Kein Torrent** - ctorrent nicht implementiert
3. **Keine Host-GRUB .img** - Nur Symlinks
4. **Kein Image Versioning** - Nur aktuelle Version

## Quick Start

```bash
# Container starten
cd /root/linbo-docker
docker compose up -d

# Admin-User erstellen
docker exec linbo-api node -e "
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
bcrypt.hash('admin', 10).then(hash => {
  prisma.user.create({
    data: { username: 'admin', passwordHash: hash, role: 'admin' }
  }).then(() => process.exit(0));
});
"

# Schema anwenden
docker exec linbo-api npx prisma db push

# Frontend oeffnen
open http://localhost:8080
```

### Provisioning aktivieren

```bash
# docker-compose.yml oder .env:
DC_PROVISIONING_ENABLED=true
DC_PROVISIONING_DRYRUN=true   # Zuerst mit Dry-Run testen!

docker compose up -d api

# DC Worker auf dem AD DC installieren:
# Siehe dc-worker/macct-worker.conf.example
```

## Naechste Schritte

| Feature | Phase |
|---------|-------|
| Multicast (udpcast) | 12 |
| Torrent (ctorrent) | 12 |
| Host-GRUB .img | 13 |
| Image Versioning | 14 |
