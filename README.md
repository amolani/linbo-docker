# LINBO Docker

**Docker-basierter LINBO Network Boot Server**

[![Update Boot Files](https://github.com/amolani/linbo-docker/actions/workflows/update-boot-files.yml/badge.svg)](https://github.com/amolani/linbo-docker/actions/workflows/update-boot-files.yml)

LINBO Docker ist eine containerisierte Version von [LINBO](https://github.com/linuxmuster/linuxmuster-linbo7) (Linux Network Boot). Es kann als **Sync-Client** an einen bestehenden linuxmuster.net-Server angebunden werden oder als **Standalone-System** ohne linuxmuster.net betrieben werden.

> **Architektur-Diagramme:** Siehe [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) für Mermaid-Diagramme (IST/SOLL).
>
> **Unterschiede zu Vanilla-LINBO:** Siehe [docs/UNTERSCHIEDE-ZU-LINBO.md](docs/UNTERSCHIEDE-ZU-LINBO.md) — was LINBO ist, was Docker anders macht, und warum.

## Features

### Boot & Imaging
- **PXE Network Boot** — Clients booten über TFTP + HTTP (GRUB)
- **HTTP Boot** — Kernel/Initrd via HTTP für 5-10x schnellere Transfers als TFTP
- **Image Management** — qcow2-Images erstellen, synchronisieren und deployen
- **Remote Control** — SSH-Befehle an Clients (sync, start, reboot, shutdown, WoL)

### Docker-exklusive Features
- **Patchclass** — Windows-Treiber via DMI-Matching automatisch installieren (Postsync)
- **Firmware Auto-Detection** — Firmware von Clients per SSH scannen und in linbofs64 injizieren
- **Kernel Switching** — Zwischen stable/longterm/legacy Kernel-Varianten wechseln
- **Web Terminal** — Interaktive SSH-Sessions zu LINBO-Clients (xterm.js + WebSocket)
- **GRUB Theme** — Logo, Icons und Farben anpassen
- **React Frontend** — Moderne Web-Oberfläche mit Dark Theme

### Integration
- **Sync-Modus** — Read-Only Delta-Feed von linuxmuster.net Authority API
- **REST API** — Express.js mit JWT-Authentifizierung und API-Key-Support
- **WebSocket** — Echtzeit-Updates für Host-Status, Operations, Sync-Fortschritt
- **DHCP** — Export für ISC DHCP / dnsmasq, optionaler Proxy-DHCP-Container

## Quick Start

### Voraussetzungen

- Docker Engine 24.0+
- Docker Compose v2.20+
- 4 GB RAM (Minimum)
- 50 GB Festplatte (mehr für Images)

### Installation

```bash
git clone https://github.com/amolani/linbo-docker.git
cd linbo-docker

cp .env.example .env
nano .env  # LINBO_SERVER_IP, Passwörter etc. setzen

docker compose up -d
```

Beim ersten Start lädt der Init-Container automatisch die LINBO Boot-Dateien (~70 MB) von GitHub Releases herunter. SSH-Keys werden automatisch generiert.

### Sync-Modus (mit linuxmuster.net)

```bash
# In .env:
SYNC_ENABLED=true
LMN_API_URL=http://10.0.0.11:8400
LMN_API_KEY=your_api_key
```

Im Sync-Modus ist Docker **permanent read-only** für LMN-Daten. Hosts, Configs und Rooms werden ausschließlich auf dem LMN-Server verwaltet. Docker konsumiert diese Daten via Cursor-basiertem Delta-Feed.

### Web-Interface

Öffne **http://localhost:8080** im Browser.

Login: `admin` / `Muster!` (Standard-Passwort, änderbar in Settings)

## Architektur

```
                     LMN-Server (optional)
                    ┌──────────────────┐
                    │ Authority API    │
                    │ :8400            │
                    │ (Delta-Feed)     │
                    └────────┬─────────┘
                             │ Read-Only
                             ▼
┌─────────────────────────────────────────────────────────┐
│                   LINBO Docker                          │
│                                                         │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────────┐ │
│  │ TFTP │  │RSYNC │  │ SSH  │  │ API  │  │   Web    │ │
│  │:69   │  │:873  │  │:2222 │  │:3000 │  │  :8080   │ │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └────┬─────┘ │
│     └─────────┴─────────┴─────────┴────────────┘       │
│                         │                               │
│              ┌──────────┴──────────┐                    │
│              │   Redis    :6379    │                    │
│              │ (Cache, Status,     │                    │
│              │  Operations,        │                    │
│              │  Settings)          │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
         ▲           ▲           ▲
         │           │           │
    ┌────┴───┐  ┌────┴───┐  ┌───┴────┐
    │ Client │  │ Client │  │ Client │
    │  PXE   │  │  PXE   │  │  PXE   │
    └────────┘  └────────┘  └────────┘
```

> Detaillierte Mermaid-Diagramme: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Container

| Container | Port | Beschreibung |
|-----------|------|-------------|
| `init` | — | Boot-Dateien herunterladen (einmalig) |
| `tftp` | 69/udp | PXE-Boot (GRUB-Configs) |
| `rsync` | 873 | Images + Treiber verteilen |
| `ssh` | 2222 | Remote Commands + Terminal |
| `api` | 3000 | REST API + WebSocket |
| `web` | 8080 | React SPA + HTTP Boot (Nginx) |
| `cache` | 6379 | Redis |
| `dhcp` | 67/udp | dnsmasq Proxy (optional, `--profile dhcp`) |

## Web-Interface Seiten

| Seite | Beschreibung |
|-------|-------------|
| Dashboard | Host-Übersicht, Speicher, letzte Operations |
| Hosts | Host-Liste mit Filter (Read-Only im Sync-Modus) |
| Rooms | Raum-Übersicht |
| Configs | start.conf-Editor mit Vorschau |
| Images | Image-Inventar (qcow2) |
| Operations | Echtzeit-Tracking aller Befehle |
| Drivers | Patchclass-Verwaltung (DMI-Rules, Treiber-Sets) |
| Firmware | Auto-Detection + Injection |
| Kernel | Varianten-Wechsel + Status |
| Terminal | SSH-Sessions mit xterm.js |
| GRUB Theme | Logo, Icons, Farben |
| Sync | Sync-Status, Cursor, API-Health |
| Settings | Authority API, Passwort, Modus-Toggle |

## API-Endpoints

### Immer verfügbar

| Endpoint | Beschreibung |
|----------|-------------|
| `GET /health` | Health Check |
| `POST /api/v1/auth/login` | Authentifizierung |
| `GET /api/v1/sync/status` | Sync-Status |
| `POST /api/v1/sync/trigger` | Sync auslösen |
| `GET /api/v1/images` | Image-Liste |
| `POST /api/v1/operations/direct` | Remote-Befehl (sync, start, reboot...) |
| `POST /api/v1/operations/wake` | Wake-on-LAN |
| `GET /api/v1/patchclass` | Patchclass-Liste |
| `POST /api/v1/patchclass` | Patchclass erstellen |
| `GET /api/v1/settings` | Runtime-Einstellungen |
| `POST /api/v1/system/update-linbofs` | linbofs64 neu bauen |
| `POST /api/v1/system/kernel/switch` | Kernel-Variante wechseln |
| `GET /api/v1/terminal/sessions` | Terminal-Sessions |

### Nur Standalone-Modus

Im Sync-Modus geben diese Endpoints `409 SYNC_MODE_ACTIVE` zurück:

| Endpoint | Beschreibung |
|----------|-------------|
| `POST /api/v1/hosts` | Host erstellen |
| `PATCH /api/v1/hosts/:id` | Host bearbeiten |
| `DELETE /api/v1/hosts/:id` | Host löschen |
| `POST /api/v1/configs` | Config erstellen |
| `PUT /api/v1/dhcp/network-settings` | DHCP-Einstellungen |

## DHCP-Konfiguration

Bestehenden DHCP-Server für PXE konfigurieren:

```
# ISC DHCP
next-server 10.0.0.13;            # LINBO Docker Server IP
filename "boot/grub/grub.cfg";

# UEFI:
option architecture-type code 93 = unsigned integer 16;
if option architecture-type = 00:07 {
    filename "boot/grub/x86_64-efi/grub.efi";
} else {
    filename "boot/grub/i386-pc/grub.0";
}
```

Oder den eingebauten DHCP-Proxy-Container nutzen:

```bash
docker compose --profile dhcp up -d
```

## Development

```bash
# Container bauen
docker compose build

# Mit Logs starten
docker compose up

# Tests ausführen (1135 Tests)
docker exec linbo-api npm test

# Container-Shell
docker exec -it linbo-api sh

# Prisma-Schema anwenden
docker exec linbo-api npx prisma db push
```

### Makefile

```bash
make up              # Alle Container starten
make health          # Health-Check
make status          # Git + Docker Status
make deploy          # Deploy zum Testserver (rsync)
make deploy-full     # + linbofs + GRUB neu bauen
make test            # Tests ausführen
```

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| PXE kein Netzwerk | Falscher Kernel (linbo7 vs Host) → Host-Kernel verwenden |
| Control Mode | `linbo_gui64_7.tar.lz` fehlt auf dem Server |
| Buttons nicht klickbar | udevd tot → linbofs64 neu bauen |
| SSH refused | Port 22 vs 2222 prüfen |
| Keys fehlen nach Clone | Werden automatisch generiert (SSH-Container) |
| TFTP liefert ungepatches linbofs64 | TFTP wartet auf `.linbofs-patch-status` Marker |
| 500 im Sync-Modus | Route-Mounting in routes/index.js prüfen |
| EACCES | `chown -R 1001:1001` auf Docker Volume |
| .env-Änderungen nicht aktiv | `docker compose up -d` statt `restart` |

Ausführliche Fehlerdiagnose: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Vergleich mit Production linuxmuster.net

| Feature | Production | LINBO Docker |
|---------|-----------|-------------|
| PXE Network Boot | ✅ | ✅ |
| HTTP Boot (GRUB) | ❌ (nur TFTP) | ✅ |
| Image Sync (rsync) | ✅ | ✅ |
| Remote Commands | ✅ | ✅ |
| Config Deployment | ✅ | ✅ |
| GRUB Config Generation | ✅ | ✅ |
| DHCP Integration | ✅ | ✅ |
| Windows-Treiber (Patchclass) | ❌ | ✅ |
| Firmware Auto-Detection | ❌ | ✅ |
| Kernel Switching | ❌ | ✅ |
| Web Terminal (xterm.js) | ❌ | ✅ |
| React Frontend | ❌ | ✅ |
| Multicast (udpcast) | ✅ | Geplant |
| Torrent (ctorrent) | ✅ | Geplant |
| Sophomorix/LDAP | ✅ | N/A |

## Lizenz

GPL-3.0 — siehe [LICENSE](LICENSE).

Basiert auf [linuxmuster-linbo7](https://github.com/linuxmuster/linuxmuster-linbo7) vom linuxmuster.net-Team.
