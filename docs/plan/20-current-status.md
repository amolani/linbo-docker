# LINBO Docker - Aktueller Projektstand

**Stand:** 2026-02-05
**Version:** Phase 7a/7b abgeschlossen

---

## Implementierungsfortschritt

### Abgeschlossene Phasen

| Phase | Beschreibung | Status | Tests |
|-------|--------------|--------|-------|
| Phase 1 | Config Deployment (start.conf) | ✅ | 100% |
| Phase 2 | Update-Linbofs Integration | ✅ | 100% |
| Phase 3 | Operation Worker | ✅ | 100% |
| Phase 4 | GRUB Configs | ✅ | 100% |
| Phase 5 | RSYNC Hooks + Frontend | ✅ | 100% |
| Phase 6 | Server Components | ✅ | 100% |
| Phase 7a | Remote Commands | ✅ | 33 Tests |
| Phase 7b | Device Import | ✅ | 42 Tests |

**Gesamt: 250 Tests, 235 bestanden**

---

## Phase 7 - Implementierte Features

### Remote Commands (ersetzt linbo-remote)

```
POST   /api/v1/operations/direct          # SSH-Befehle direkt ausführen
POST   /api/v1/operations/schedule        # Onboot-Commands (.cmd Dateien)
GET    /api/v1/operations/scheduled       # Geplante Commands auflisten
DELETE /api/v1/operations/scheduled/:host # Command abbrechen
POST   /api/v1/operations/wake            # WoL mit optionalen Commands
POST   /api/v1/operations/validate-commands
```

**Unterstützte Befehle:**
- `partition`, `label`, `format` - Partitionierung
- `initcache:rsync|multicast|torrent` - Cache aktualisieren
- `sync:N`, `new:N`, `start:N` - OS-Operationen
- `reboot`, `halt` - System-Befehle
- `create_image:N`, `upload_image:N` - Image-Erstellung
- `noauto`, `disablegui` - Spezial-Flags

### Device Import (ersetzt linuxmuster-import-devices)

```
POST   /api/v1/hosts/import              # CSV importieren
POST   /api/v1/hosts/import/validate     # CSV validieren (dry-run)
GET    /api/v1/hosts/export              # Als CSV exportieren
POST   /api/v1/hosts/sync-filesystem     # Symlinks/GRUB regenerieren
```

**CSV-Format (linuxmuster-kompatibel):**
```
room;hostname;group;mac;ip;...;role;;pxe
```

---

## Architektur-Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
│  - Dashboard, Hosts, Groups, Configs, Images, Operations        │
└─────────────────────────────────────────────────────────────────┘
                              │ REST/WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                      API Container (Node.js)                     │
│  ├── Routes: auth, hosts, groups, configs, images, operations   │
│  ├── Services: config, grub, ssh, wol, remote, deviceImport     │
│  ├── Workers: operationWorker                                    │
│  └── Middleware: auth (JWT), validation (Zod), audit            │
└─────────────────────────────────────────────────────────────────┘
        │              │                │              │
┌───────┴───┐  ┌───────┴────┐  ┌────────┴────┐  ┌─────┴─────┐
│ PostgreSQL │  │   Redis    │  │   TFTP/SSH  │  │   RSYNC   │
│  (Prisma)  │  │  (Cache)   │  │  Container  │  │ Container │
└────────────┘  └────────────┘  └─────────────┘  └───────────┘
```

---

## Vergleich mit Produktionsserver

### Funktionale Parität: ~85%

| Bereich | linuxmuster 7.3 | LINBO Docker | Status |
|---------|-----------------|--------------|--------|
| **Boot** |
| TFTP/PXE Boot | ✅ | ✅ | Vollständig |
| GRUB Config Generation | ✅ | ✅ | Vollständig |
| Host-spezifische GRUB .img | ✅ | ❌ | Ausstehend |
| **Konfiguration** |
| start.conf Generierung | Datei-basiert | DB-basiert | ✅ Besser |
| Approval Workflow | ❌ | ✅ | ✅ Besser |
| Versionierung | ❌ | ✅ | ✅ Besser |
| **Distribution** |
| RSYNC | ✅ | ✅ | Vollständig |
| Multicast (udpcast) | ✅ | ❌ | **Phase 8** |
| Torrent (ctorrent) | ✅ | ❌ | **Phase 8** |
| **Remote** |
| SSH Commands | ✅ linbo-remote | ✅ API | Vollständig |
| Onboot Commands | ✅ .cmd Dateien | ✅ API | Vollständig |
| Wake-on-LAN | ✅ | ✅ | Vollständig |
| **Images** |
| Upload/Download | ✅ | ✅ | Vollständig |
| Metadaten (.info, .desc) | ✅ Auto | ⚠️ DB | Teilweise |
| Backup/Versioning | ✅ Auto | ❌ | **Phase 8** |
| Torrent-Generierung | ✅ Auto | ❌ | **Phase 8** |
| **Integration** |
| Sophomorix/AD | ✅ LDAP | ❌ | Nicht geplant |
| REST API | ❌ | ✅ | ✅ Besser |
| WebSocket Events | ❌ | ✅ | ✅ Besser |
| Web-UI | ❌ | ✅ | ✅ Besser |

---

## Vorteile der Docker-Lösung

1. **Moderne Architektur**
   - REST API für Automatisierung
   - WebSocket für Echtzeit-Updates
   - React-basiertes Frontend

2. **Bessere Governance**
   - Datenbank-gestützte Konfiguration
   - Vollständiges Audit-Logging
   - Approval-Workflows für Configs

3. **Einfachere Deployment**
   - Docker Compose Setup
   - Infrastructure as Code
   - Portable und reproduzierbar

4. **Keine Sophomorix-Abhängigkeit**
   - Eigenständige PostgreSQL-Datenbank
   - CSV Import/Export kompatibel
   - Kein Active Directory benötigt

---

## Offene Punkte (Gaps)

### Hohe Priorität (für Produktion)

| Feature | Impact | Aufwand |
|---------|--------|---------|
| Multicast Distribution | Große Deployments | 2-3 Tage |
| Torrent Distribution | P2P Effizienz | 2-3 Tage |
| Image Backup/Versioning | Datensicherheit | 2 Tage |

### Mittlere Priorität

| Feature | Impact | Aufwand |
|---------|--------|---------|
| Host-GRUB Images (.img) | Legacy Hardware | 2 Tage |
| Windows Registry Patches | Windows Config | 2 Tage |
| ISO Boot-Medium | USB Boot | 1-2 Tage |

### Niedrige Priorität

| Feature | Impact | Aufwand |
|---------|--------|---------|
| Raum-basierte Batch-Ops | Convenience | 1 Tag |
| Application Harvesting | Packaging | 2 Tage |

---

## Dateistruktur

```
/srv/linbo/
├── boot/grub/
│   ├── grub.cfg                 # Haupt-GRUB-Config
│   ├── hostcfg/{hostname}.cfg   # Host-spezifisch
│   └── {groupname}.cfg          # Gruppen-spezifisch
├── images/
│   └── {imagename}/
│       ├── {image}.qcow2        # Basis-Image
│       └── {image}.qdiff        # Differential
├── linbocmd/
│   └── {hostname}.cmd           # Onboot-Commands
├── start.conf.{groupname}       # Gruppen-Configs
├── start.conf-{ip}              # IP-Symlinks
├── linbo64                      # LINBO Kernel
└── linbofs64                    # LINBO Filesystem
```

---

## Test-Ergebnisse

```
Phase 7 Services:
  remote.service.test.js     - 33 Tests ✅
  deviceImport.service.test.js - 42 Tests ✅

Gesamt: 250 Tests
  ✅ Bestanden: 235
  ❌ Fehlgeschlagen: 15 (vorbestehende API-Test-Issues)
```

---

## Environment Variables

```env
# API
LINBO_DIR=/srv/linbo
CONFIG_DIR=/etc/linuxmuster/linbo
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...
INTERNAL_API_KEY=...

# Worker
ENABLE_OPERATION_WORKER=true
OPERATION_POLL_INTERVAL=5000
MAX_CONCURRENT_SESSIONS=5
```
