# Kapitel 10: Standard-Funktionen reparieren (Session 20)

**Datum:** 2026-03-02
**Problem:** Nach intensivem Debugging (Sessions 12-19) waren Standard-LINBO-Funktionen defekt:
1. SSH zu Clients funktioniert nicht
2. Qt-GUI Buttons nicht klickbar (Maus reagiert nicht)
3. Debug-Output in der Konsole

---

## 10.1 SSH Service — Falscher Port + Key als Pfad

### Symptom
```
ssh.service.js: Connection refused
```
Remote-Befehle über API (sync, start, reboot) schlagen fehl.

### Root Cause
Zwei Fehler in `containers/api/src/services/ssh.service.js`:

1. **Port 22 statt 2222:** LINBO-Clients laufen mit Dropbear auf Port 2222, aber der SSH-Service versuchte Port 22.
2. **Key-Pfad statt Key-Inhalt:** `ssh2` (Node.js Library) benötigt den SSH-Key als Buffer/String, nicht als Dateipfad. `process.env.SSH_PRIVATE_KEY` enthält `/etc/linuxmuster/linbo/ssh_host_rsa_key` (Pfad), nicht den Key-Inhalt.

### Fix
**`containers/api/src/services/ssh.service.js`:**
```javascript
const fs = require('fs');

// Key-Datei einlesen (ssh2 braucht Inhalt, nicht Pfad)
let loadedPrivateKey = null;
const keyPath = process.env.SSH_PRIVATE_KEY;
if (keyPath) {
  try {
    loadedPrivateKey = fs.readFileSync(keyPath);
  } catch (err) {
    console.error(`[SSH] Failed to read private key from ${keyPath}:`, err.message);
  }
}

const defaultConfig = {
  port: parseInt(process.env.SSH_PORT, 10) || 2222,  // LINBO = 2222
  username: process.env.SSH_USERNAME || 'root',
  privateKey: loadedPrivateKey,  // Buffer, nicht Pfad!
  // ...
};
```

**`docker-compose.yml`:**
```yaml
- SSH_PORT=2222   # war: SSH_PORT=22
```

### Verifikation
```bash
docker exec linbo-api node -e "
  const ssh = require('./src/services/ssh.service');
  ssh.testConnection('10.0.150.2').then(console.log);
"
# { success: true, connected: true }
```

---

## 10.2 Qt-GUI Buttons nicht klickbar — udevd + libinput

### Symptom
- LINBO-GUI wird angezeigt (Buttons sichtbar)
- Maus-Cursor bewegt sich NICHT (bei VNC/SPICE)
- Tastatur funktioniert ebenfalls nicht
- Keine Fehlermeldung in Logs

### Root Cause (detailliert)

Die LINBO Qt-GUI verwendet:
```
Qt 5.x → -platform linuxfb → libinput (Input-Backend)
```

**libinput** benötigt die **udev-Datenbank** (`/run/udev/data/`) um Input-Geräte zu erkennen. Ohne udev-Einträge wie `ID_INPUT=1` und `ID_INPUT_MOUSE=1` ignoriert libinput alle Geräte.

#### Warum udevd fehlt:

1. `init.sh` → `hwsetup()` (Zeile ~575) startet `udevd --daemon`
2. `udevadm trigger` + `udevadm settle` laufen (Zeile ~578-581)
3. **BusyBox init** wechselt zum nächsten Schritt → `linbo.sh`
4. Zwischen init.sh-Ende und linbo.sh-Start **stirbt udevd**
5. `/run/udev/` Datenbank wird gelöscht
6. `linbo_gui -platform linuxfb` startet → libinput findet keine Input-Geräte

#### Beweis:
```bash
# Auf dem Client (via SSH):
ls /run/udev/
# LEER — keine Datenbank!

udevadm info --query=property --name=/dev/input/event3
# Zeigt KEINE ID_INPUT* Properties

# Nach manuellem Fix:
udevd --daemon
udevadm trigger --type=all --action=add
udevadm settle

udevadm info --query=property --name=/dev/input/event3
# ID_INPUT=1
# ID_INPUT_MOUSE=1
# ID_INPUT_TABLET=1   (QEMU USB Tablet für VNC/SPICE)
```

### Hinweis

Seit Session 30 werden keine Docker-Boot-Patches mehr angewendet. Vanilla LINBO bootet korrekt ohne Modifikationen.

### Manueller Fix (falls udevd dennoch fehlt)
```bash
# Auf dem Client (via SSH):
udevd --daemon
udevadm trigger --type=all --action=add
udevadm settle
# Danach GUI-Prozess killen (BusyBox respawnt ihn)
```

---

## 10.3 Deploy-Workflow (Code → Test-Server)

### Setup
- **Code-Entwicklung:** 10.0.0.1 (oder lokale Maschine)
- **Test-Server:** 10.0.0.13 (Docker-Host + PXE-Boot-Server)
- **Test-Client:** 10.0.150.2 (hostname=vier, Hostgruppe=win11_pro)

### Deploy-Schritte

```bash
# 1. Code synchronisieren
rsync -avz --delete \
  --exclude '.env' --exclude 'node_modules' --exclude '.git' \
  -e ssh /root/linbo-docker/ root@10.0.0.13:/root/linbo-docker/

# 2. Container neu bauen (COMPOSE_FILE nötig weil SSH in /root landet)
ssh root@10.0.0.13 "COMPOSE_FILE=/root/linbo-docker/docker-compose.yml \
  docker compose up -d --build api web"

# 3. linbofs64 neu bauen (optional, bei Änderungen an update-linbofs.sh)
ssh root@10.0.0.13 "docker exec linbo-api \
  bash /usr/share/linuxmuster/linbo/update-linbofs.sh"

# 4. TFTP neu starten (damit neues linbofs64 ausgeliefert wird)
ssh root@10.0.0.13 "COMPOSE_FILE=/root/linbo-docker/docker-compose.yml \
  docker compose restart tftp"

# 5. Client per PXE booten und testen
```

### Häufige Fehler beim Deploy

| Fehler | Ursache | Lösung |
|--------|---------|--------|
| `no configuration file provided` | SSH landet in /root, nicht /root/linbo-docker | `COMPOSE_FILE=/root/linbo-docker/docker-compose.yml` setzen |
| `401 Unauthorized` bei npm ci | @edulution-io/ui-kit ist privates npm-Paket | `GITHUB_TOKEN=ghp_... docker compose up -d --build web` |
| linbofs nicht aktualisiert | TFTP cached altes linbofs64 | `docker compose restart tftp` |

### Automatisiert: `scripts/deploy.sh`
```bash
./scripts/deploy.sh root@10.0.0.13           # Nur Code + Container
./scripts/deploy.sh root@10.0.0.13 --rebuild  # + linbofs64 + GRUB
```

---

## 10.4 PTY Allocation Failure (SSH ohne Kommando)

### Symptom
```bash
ssh -p 2222 root@10.0.150.2
# PTY allocation request failed on channel 0
```

### Ursache
LINBO-Clients (BusyBox + Dropbear) haben kein `/dev/pts` Dateisystem. Interaktive SSH-Sessions benötigen ein PTY (Pseudo-Terminal), das unter `/dev/pts` allokiert wird.

### Workaround
Immer ein explizites Kommando mitgeben:
```bash
ssh -p 2222 root@10.0.150.2 "echo connected"    # OK
ssh -p 2222 root@10.0.150.2 "lsmod | grep evdev" # OK
ssh -p 2222 root@10.0.150.2                       # FEHLT PTY → Fehler
```

Alternativ von der Produktionsmaschine (10.0.0.11) mit `linbo-ssh`:
```bash
linbo-ssh 10.0.150.2 echo connected
```

---

## 10.5 Debug-Methodik (fuer zukuenftige Probleme)

### Wie wir den udev-Bug gefunden haben:

1. **Hypothese testen:** `lsmod | grep evdev` → Module geladen ✓
2. **Prozess prüfen:** `pidof udevd` → **Nicht laufend** ✗
3. **Dateisystem prüfen:** `ls /run/udev/` → **Leer** ✗
4. **udev-Properties prüfen:** `udevadm info --query=property --name=/dev/input/event3` → **Keine ID_INPUT** ✗
5. **Manuell fixen:** `udevd --daemon && udevadm trigger && udevadm settle`
6. **Verifizieren:** Properties jetzt vorhanden → GUI neu starten → **Buttons funktionieren** ✓
7. **Permanent fixen:** Seit Session 30 nicht mehr noetig — vanilla LINBO behandelt dies korrekt

### Nützliche Debug-Befehle auf LINBO-Clients

```bash
# Input-Geräte
cat /proc/bus/input/devices           # Alle registrierten Input-Geräte
ls /dev/input/                        # Event-Device-Nodes
udevadm info --query=property --name=/dev/input/event3  # udev-Properties

# udev Status
pidof udevd                           # Läuft udevd?
ls /run/udev/data/                    # udev-Datenbank (muss Dateien haben!)
udevadm info --export-db | wc -l     # Anzahl Datenbank-Einträge

# Module
lsmod                                 # Geladene Module
modprobe -D usbhid                    # Dependency-Chain für ein Modul

# Netzwerk
ip addr show                          # IP-Adressen
ip link show                          # Interface-Status
cat /proc/cmdline                     # Kernel-Kommandozeile (server=, group=)

# Prozesse
ps aux                                # Alle Prozesse
pidof linbo_gui                       # GUI läuft?
pidof dropbear                        # SSH-Server läuft?
```
