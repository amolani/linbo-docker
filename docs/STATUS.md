# LINBO Docker - Projekt Status

**Stand:** 2026-02-05
**Version:** 0.9.3
**Functional Parity:** ~93%

## Implementierte Phasen

### Phase 1-6: Grundsystem ✅
- Docker Container Architektur (init, tftp, rsync, ssh, db, cache, api, web)
- PostgreSQL Datenbank mit Prisma ORM
- Redis Cache für Sessions und Job-Queue
- Express.js REST API mit JWT Authentication
- React Frontend mit Tailwind CSS

### Phase 7a: Remote Commands ✅
- SSH-basierte Befehlsausführung auf LINBO-Clients
- Unterstützte Befehle: sync, start, create, reboot, shutdown, wol
- Bulk-Operationen für mehrere Hosts
- WebSocket-basiertes Progress-Tracking
- **Tests:** 33

### Phase 7b: Device Import ✅
- CSV Import/Export im linuxmuster.net Format
- Validierung von MAC, IP, Hostname
- Automatische Room/Config-Erstellung
- Dry-Run Modus für Vorschau
- **Tests:** 42

### Phase 7c: Frontend ✅
- Raw Config Editor mit Syntax Highlighting
- DB-Synchronisation bei Änderungen
- Configs-Verwaltung (CRUD)
- Operations-Dashboard mit Live-Status

### Phase 8: Machine Account Management ✅
- Redis Streams für Job-Queue
- DC Worker für Active Directory Integration
- Automatischer macct-repair bei Image-Download
- Retry-Logik mit Dead Letter Queue
- **Tests:** 23

### Phase 9: Groups Removal ✅
- Vereinfachung: Groups-Konzept entfernt
- Host.configId statt Host.groupId
- Entspricht Production linuxmuster.net Logik
- **Tests:** 306 gesamt (301 passing, 98.4%)

## Test-Übersicht

| Test Suite | Tests | Status |
|------------|-------|--------|
| grub.service.test.js | 64 | ✅ |
| deviceImport.service.test.js | 42 | ✅ |
| remote.service.test.js | 33 | ✅ |
| host.service.test.js | 24 | ✅ |
| macct.service.test.js | 23 | ✅ |
| linbofs.service.test.js | 18 | ✅ |
| config.service.test.js | 18 | ✅ |
| api.test.js (Integration) | 34 | ⚠️ 5 Cascade-Fehler |
| **Gesamt** | **306** | **98.4%** |

## Container Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker Network                          │
├─────────────────────────────────────────────────────────────┤
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
│  ┌──────────┐   ┌──────────┐                                │
│  │   api    │   │   web    │                                │
│  │  (3000)  │   │  (8080)  │                                │
│  └──────────┘   └──────────┘                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Datenmodell (nach Phase 9)

```
Host ─────────────┬──────────────> Config
  │               │                  │
  │               │                  ├── linboSettings
  │               │                  ├── partitions[]
  └───> Room      │                  └── osEntries[]
                  │
                  └──────────────> Operation
                                      │
                                      └── Sessions[]
```

## API Endpoints

### Authentifizierung
- `POST /api/v1/auth/login` - Login
- `GET /api/v1/auth/me` - Current user

### Hosts
- `GET /api/v1/hosts` - Liste (mit Pagination, Filter)
- `POST /api/v1/hosts` - Erstellen
- `GET /api/v1/hosts/:id` - Details
- `PATCH /api/v1/hosts/:id` - Update
- `DELETE /api/v1/hosts/:id` - Löschen
- `GET /api/v1/hosts/by-mac/:mac` - Suche nach MAC

### Configs (ehemals Groups)
- `GET /api/v1/configs` - Liste
- `POST /api/v1/configs` - Erstellen
- `GET /api/v1/configs/:id` - Details
- `PATCH /api/v1/configs/:id` - Update
- `DELETE /api/v1/configs/:id` - Löschen
- `GET /api/v1/configs/:id/preview` - start.conf Vorschau
- `POST /api/v1/configs/:id/deploy` - Deployen
- `GET /api/v1/configs/:id/raw` - Raw start.conf
- `PUT /api/v1/configs/:id/raw` - Raw speichern

### Rooms
- CRUD: `GET/POST/PATCH/DELETE /api/v1/rooms`

### Images
- `GET /api/v1/images` - Liste
- `GET /api/v1/images/:name` - Details
- `DELETE /api/v1/images/:name` - Löschen

### Operations
- `POST /api/v1/operations/direct` - Sofort-Befehl
- `POST /api/v1/operations/schedule` - Geplanter Befehl
- `POST /api/v1/operations/wake` - Wake-on-LAN
- `GET /api/v1/operations` - Liste
- `GET /api/v1/operations/:id` - Status

### System
- `POST /api/v1/system/update-linbofs` - linbofs aktualisieren
- `POST /api/v1/system/regenerate-grub-configs` - GRUB neu generieren
- `GET /api/v1/system/linbofs-status` - linbofs Status

### Import/Export
- `POST /api/v1/import/devices` - CSV Import
- `GET /api/v1/export/devices` - CSV Export

## Bekannte Einschränkungen

1. **Kein DHCP-Server** - Muss extern konfiguriert werden
2. **Kein Multicast** - udpcast nicht implementiert
3. **Kein Torrent** - ctorrent nicht implementiert
4. **Keine Host-GRUB .img** - Nur Symlinks
5. **Kein Image Versioning** - Nur aktuelle Version

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

# Frontend öffnen
open http://localhost:8080
```

## Nächste Schritte

Siehe [TODO-DHCP.md](./TODO-DHCP.md) für DHCP-Integration.
