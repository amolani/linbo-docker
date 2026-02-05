# Claude Context - LINBO Docker Projekt

**Kopiere diesen Text am Anfang einer neuen Chat-Session:**

---

## Server-Umgebung

Du arbeitest auf einem **linuxmuster.net 7.3 Produktionsserver** mit folgender Konfiguration:

| Eigenschaft | Wert |
|-------------|------|
| **Server IP** | 10.0.0.11 |
| **Hostname** | server.linuxmuster.lan |
| **OS** | Ubuntu 22.04 |
| **Rolle** | linuxmuster.net Server (Produktion) |
| **LINBO Version** | 4.3.29-0 |

### Wichtige Pfade auf dem Server
- `/srv/linbo/` - LINBO Boot-Dateien, Images, Konfigurationen
- `/etc/linuxmuster/linbo/` - SSH-Keys, start.conf Templates
- `/root/linbo-docker/` - **LINBO Docker Projekt (Git Repository)**

---

## LINBO Docker Projekt

Wir entwickeln **LINBO Docker** - eine standalone Docker-Lösung für LINBO, unabhängig vom vollen linuxmuster.net Stack.

### Repository
- **Pfad:** `/root/linbo-docker/`
- **GitHub:** `https://github.com/amolani/linbo-docker`
- **Dokumentation:** `/root/linbo-docker/docs/TROUBLESHOOTING.md`

### Aktueller Stand
- **Functional Parity:** ~90% mit Produktion
- **Phases 1-7:** Complete (Remote Commands, Device Import, Frontend)
- **Tests:** 250 (239 passing)

### Container-Architektur
```
init → tftp (69/udp) → rsync (873) → ssh (2222)
         ↓
      db (5432) + cache (6379)
         ↓
      api (3000) → web (8080)
```

### Technologie-Stack
- **Backend:** Node.js/Express, Prisma ORM, PostgreSQL, Redis
- **Frontend:** React 18, TypeScript, Vite, Zustand, TailwindCSS
- **Container:** Docker Compose

---

## Wichtige Befehle

```bash
# Zum Projekt wechseln
cd /root/linbo-docker

# Container starten
docker compose up -d

# Container Status
docker compose ps

# API Health Check
docker exec linbo-api curl -s http://localhost:3000/health

# API Logs
docker logs linbo-api --tail 50

# Berechtigungen korrigieren (häufiges Problem!)
chown -R 1001:1001 /var/lib/docker/volumes/linbo_srv_data/_data/
```

---

## Bekannte Probleme & Lösungen

| Problem | Lösung |
|---------|--------|
| EACCES permission denied | `chown -R 1001:1001` auf Docker Volume |
| DB auth failed nach restart | `docker compose down -v && docker compose up -d` |
| Port 69 in use | Host-TFTP stoppen: `systemctl stop tftpd-hpa` |
| Container "unhealthy" | Manuell starten: `docker start linbo-web` |

---

## Nächste Schritte (Offene Phasen)

| Phase | Feature | Status |
|-------|---------|--------|
| 8 | Multicast/Torrent Distribution | Offen |
| 9 | Image Backup/Versioning | Offen |
| 10 | Host-GRUB Images, ISO Creation | Offen |

---

## SSH-Zugang zu Testserver

Falls ein Testserver (10.0.10.1) existiert:
```bash
ssh root@10.0.10.1
```

---

## Hinweise

1. **Alle Änderungen** werden auf dem Hauptserver (10.0.0.11) gemacht und zu GitHub gepusht
2. **Testserver** ist nur zum Testen (kein Git, Dateien werden kopiert)
3. **Produktion LINBO** läuft parallel - Vorsicht bei Port-Konflikten (69/udp, 873)
4. **API Container** läuft als User `linbo` (UID 1001) - Dateiberechtigungen beachten!

---

**Lies die Dokumentation:** `/root/linbo-docker/docs/TROUBLESHOOTING.md`
