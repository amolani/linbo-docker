# LINBO Docker - Troubleshooting & Fehlerdokumentation

**Stand:** 2026-02-05

---

## Zusammenfassung der Session

Diese Dokumentation beschreibt alle Fehler, die während der Entwicklung und des Deployments von LINBO Docker aufgetreten sind, sowie deren Lösungen.

---

## 1. Raw Config Editor - Permission Denied (500 Error)

### Problem
Beim Speichern im Raw Config Editor erscheint ein HTTP 500 Fehler:
```
EACCES: permission denied, open '/srv/linbo/start.conf.testgruppe'
```

### Ursache
- Der API-Container läuft als User `linbo` (UID 1001)
- Die Dateien in `/srv/linbo/` gehörten `root:root`
- Der linbo-User hat keine Schreibrechte

### Lösung
```bash
# Berechtigungen auf dem Docker Volume korrigieren
chown -R 1001:1001 /var/lib/docker/volumes/linbo_srv_data/_data/
```

### Permanente Lösung
Das `init` Container Script (`containers/init/entrypoint.sh`) wurde angepasst:
```bash
# Set permissions - linbo user (uid 1001) needs write access
chmod -R 755 "${LINBO_DIR}"
chown -R 1001:1001 "${LINBO_DIR}"
```

---

## 2. Raw Config Editor - Dateninkonsistenz

### Problem
Änderungen im Raw Editor wurden nicht in der Datenbank reflektiert:
- Partitionen erscheinen nicht im strukturierten Editor
- Zwei separate Datenquellen (Filesystem vs. Database)

### Ursache
Der Raw Editor speicherte nur ins Filesystem, ohne die Datenbank zu aktualisieren.

### Lösung
Parser implementiert in `containers/api/src/services/config.service.js`:

```javascript
/**
 * Parse start.conf content into structured data
 */
function parseStartConf(content) {
  // Parst [LINBO], [Partition], [OS] Sektionen
  // Konvertiert zu strukturierten Daten für die DB
}

/**
 * Save raw config and sync to database
 */
async function saveRawConfig(configName, content, configId = null) {
  // 1. Datei speichern
  // 2. Inhalt parsen
  // 3. Datenbank in Transaktion aktualisieren
}
```

---

## 3. Modal Title TypeScript Error

### Problem
```
Type 'Element' is not assignable to type 'string'
```

### Ursache
Die `Modal` Komponente akzeptierte nur `string` als `title` Prop, aber der Raw Editor wollte ein JSX Element übergeben.

### Lösung
`containers/web/frontend/src/components/ui/Modal.tsx`:
```typescript
// Vorher
title?: string;

// Nachher
title?: ReactNode;
```

---

## 4. GitHub Release URL 404

### Problem
```
curl: (22) The requested URL returned error: 404
https://github.com/amolani/linbo-docker/releases/latest/download/linbo-boot-files.tar.gz
```

### Ursache
Der Release-Tag war `latest`, was mit GitHubs speziellem `/latest/` Redirect-Pfad kollidiert.

### Lösung
Release-Tag umbenannt:
```bash
gh release edit latest --tag boot-files-v1.0.0
```

**Hinweis:** Die URL `/releases/download/boot-files-v1.0.0/linbo-boot-files.tar.gz` funktioniert.

---

## 5. Database Authentication Failed (nach Container-Neustart)

### Problem
```
Authentication failed against database server at `linbo-db`,
the provided database credentials for `linbo` are not valid.
```

### Ursache
- `docker compose down` wurde ausgeführt
- Neuer DB-Container wurde erstellt
- POSTGRES_PASSWORD in `.env` stimmte nicht mit dem Passwort im persistenten Volume überein

### Lösung
Variante A - Volume löschen (Datenverlust):
```bash
docker compose down -v
docker compose up -d
```

Variante B - Passwort im Volume anpassen:
```bash
docker exec linbo-db psql -U linbo -c "ALTER USER linbo WITH PASSWORD 'neues_passwort';"
```

---

## 6. Port 69/udp Already in Use (TFTP)

### Problem
```
failed to bind host port 0.0.0.0:69/udp: address already in use
```

### Ursache
Auf dem Produktionsserver läuft bereits ein TFTP-Dienst (dnsmasq oder tftpd-hpa).

### Lösung
Entweder:
1. Produktions-TFTP stoppen: `systemctl stop tftpd-hpa`
2. Oder TFTP-Container Port ändern in `docker-compose.yml`
3. Oder TFTP-Container nicht starten (wenn Produktion genutzt wird)

---

## 7. Init Container Exit 1 (Boot Files Download)

### Problem
```
ERROR: Failed to download boot files after 3 attempts
```

### Ursache
- GitHub Release URL nicht erreichbar
- Oder Release-Assets nicht vorhanden

### Lösung für Produktionsserver
Boot-Dateien manuell vom Host kopieren:
```bash
VOLUME_PATH="/var/lib/docker/volumes/linbo_srv_data/_data"
cp -a /srv/linbo/linbo64 /srv/linbo/linbofs64 /srv/linbo/boot "$VOLUME_PATH/"
echo "manual-copy" > "$VOLUME_PATH/.boot-files-installed"
chown -R 1001:1001 "$VOLUME_PATH/"
```

---

## 8. EFI Boot Failure auf Test-Client

### Problem
```
BdsDXE: failed to load boot0002 UEFI PXEv4
```

### Ursache
DHCP lieferte BIOS-Bootdatei (`i386-pc/core.0`) statt EFI-Bootdatei.

### Lösung
DHCP-Konfiguration anpassen (`/etc/dhcp/custom.conf`):
```
host testpc01 {
    hardware ethernet BC:24:11:D1:7B:4D;
    fixed-address 10.0.11.10;
    option host-name "testpc01";
    next-server 10.0.10.1;
    filename "boot/grub/x86_64-efi/core.efi";  # EFI statt BIOS
}
```

Zusätzlich in `start.conf`:
```ini
[LINBO]
SystemType = efi64
```

---

## 9. Client verbindet sich mit falschem Server

### Problem
Test-Client (10.0.11.10) verbindet sich mit Produktionsserver (10.0.0.11) statt Testserver (10.0.10.1).

### Ursache
Produktions-DHCP antwortet schneller als Test-DHCP.

### Lösung
Host-Eintrag im Produktions-DHCP hinzufügen, der auf Testserver verweist:
```
host testpc01 {
    hardware ethernet BC:24:11:D1:7B:4D;
    next-server 10.0.10.1;
    ...
}
```

---

## 10. Container "unhealthy" aber funktioniert

### Problem
```
Container linbo-api is unhealthy
dependency failed to start: container linbo-api is unhealthy
```

### Ursache
Health-Check Interval ist zu kurz oder Start-Period zu kurz konfiguriert.

### Lösung
Manuell prüfen ob Service wirklich läuft:
```bash
docker exec linbo-api curl -s http://localhost:3000/health
# Sollte {"status":"healthy",...} zurückgeben
```

Wenn healthy, Container manuell starten:
```bash
docker start linbo-web
```

---

## Aktueller Stand (2026-02-05)

### Hauptserver (10.0.0.11)
| Service | Status | Port | Notizen |
|---------|--------|------|---------|
| linbo-web | Running | 8080 | Frontend |
| linbo-api | Running | 3000 | REST API |
| linbo-ssh | Healthy | 2222 | LINBO SSH |
| linbo-rsync | Healthy | 873 | Image Sync |
| linbo-tftp | Healthy | 69/udp | PXE Boot |
| linbo-db | Healthy | - | PostgreSQL |
| linbo-cache | Healthy | - | Redis |

### Zugangsdaten
- **URL:** `http://10.0.0.11:8080/`
- **Username:** `admin`
- **Passwort:** `admin123`

### Implementierte Features
- [x] Raw Config Editor mit Datenbank-Synchronisation
- [x] start.conf Parser (LINBO, Partition, OS Sektionen)
- [x] Backup bei Dateiänderungen
- [x] GitHub Release mit Boot-Dateien

### Bekannte Einschränkungen
- TFTP-Container kann mit Produktions-TFTP kollidieren
- GitHub "latest" Tag funktioniert nicht für Downloads
- Bei DB-Neustart müssen User/Configs neu erstellt werden

---

## Checkliste für neue Installation

1. **Docker & Docker Compose installieren**
2. **Repository klonen:** `git clone https://github.com/amolani/linbo-docker.git`
3. **.env erstellen:** `cp .env.example .env` und anpassen
4. **Boot-Dateien:** Entweder automatisch (GitHub Release) oder manuell kopieren
5. **Container starten:** `docker compose up -d`
6. **Admin erstellen:** Über API oder Seed-Script
7. **Port-Konflikte prüfen:** Besonders TFTP (69/udp)

---

## Nützliche Befehle

```bash
# Alle Container Status
docker compose ps

# API Logs
docker logs linbo-api --tail 50

# In Container einloggen
docker exec -it linbo-api sh

# Datenbank direkt abfragen
docker exec linbo-db psql -U linbo -d linbo -c "SELECT * FROM users;"

# Volume Pfad finden
docker volume inspect linbo_srv_data --format '{{.Mountpoint}}'

# Berechtigungen korrigieren
chown -R 1001:1001 /var/lib/docker/volumes/linbo_srv_data/_data/

# Health Check manuell
docker exec linbo-api curl -s http://localhost:3000/health
```
