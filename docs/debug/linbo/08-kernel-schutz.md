# 08 — Dreischicht-Kernelschutz (Update-sichere Architektur)

## Das Problem

Wenn das linuxmuster-linbo7 Paket aktualisiert wird, bringt es einen eigenen
Mini-Kernel mit (~4.5 MB, ~720 Module). Dieser ueberschreibt den Host-Kernel
in `/srv/linbo/linbo64`. Danach verlieren PXE-Clients das Netzwerk, weil der
Mini-Kernel nicht genug Treiber hat.

**Dieses Problem hat uns mehrere Debug-Sessions gekostet und muss dauerhaft
verhindert werden.**

---

## Loesung: Drei Schutzschichten

```
┌────────────────────────────────────────────────────────────────────┐
│ Schicht 1: Container-Start (entrypoint.sh)                        │
│                                                                    │
│ restore_host_kernel() wird bei JEDEM Container-Start ausgefuehrt  │
│ Prueft 4 Bedingungen und repariert automatisch                    │
│                                                                    │
│ Wann: docker compose up, docker restart, Server-Reboot            │
├────────────────────────────────────────────────────────────────────┤
│ Schicht 2: linbofs64 Rebuild (update-linbofs.sh)                  │
│                                                                    │
│ USE_HOST_KERNEL=true → Host-Module statt Package-Module           │
│ SKIP_KERNEL_COPY=true → linbo64 wird NICHT ueberschrieben        │
│ + SERVERID-Guard wird in init.sh gepatcht                         │
│                                                                    │
│ Wann: Manueller Rebuild, API-Aufruf                               │
├────────────────────────────────────────────────────────────────────┤
│ Schicht 3: Update-Service (linbo-update.service.js)               │
│                                                                    │
│ Nach LINBO-Paket-Update:                                          │
│ - Package-Kernel als .pkg speichern (nicht als linbo64)           │
│ - Host-Kernel zurueck nach /srv/linbo/linbo64 kopieren            │
│ - linbofs64 mit Host-Modulen neu bauen                            │
│ - .host-kernel-version Marker aktualisieren                       │
│                                                                    │
│ Wann: Automatisch bei LINBO-Paket-Update via Frontend/API         │
└────────────────────────────────────────────────────────────────────┘
```

---

## Schicht 1: entrypoint.sh — restore_host_kernel()

**Datei:** `containers/init/entrypoint.sh` (Zeilen ~236-296)

### Voraussetzungen

docker-compose.yml muss diese Bind-Mounts haben:
```yaml
services:
  init:
    volumes:
      - /boot:/boot:ro               # Host-Kernel lesen
      - /lib/modules:/lib/modules:ro # Host-Module lesen
  api:
    volumes:
      - /boot:/boot:ro               # Host-Kernel lesen
      - /lib/modules:/lib/modules:ro # Host-Module lesen
```

### 4 Pruefungen

```bash
restore_host_kernel() {
    HOST_KVER=$(uname -r)
    HOST_KERNEL="/boot/vmlinuz-${HOST_KVER}"

    # Check 1: Kein Marker → erster Start, Kernel provisionieren
    if [ ! -f ".host-kernel-version" ]; then
        NEED_RESTORE=true
    fi

    # Check 2: Kernel-Drift → Host-Kernel wurde aktualisiert
    if [ "$(cat .host-kernel-version)" != "$HOST_KVER" ]; then
        NEED_RESTORE=true
    fi

    # Check 3: linbo64 zu klein (<8 MB) → Package-Kernel erkannt
    if [ $(stat -c%s linbo64) -lt 8000000 ]; then
        NEED_RESTORE=true
    fi

    # Check 4: Version-Mismatch → linbo64 hat andere Version als Host
    if [ "$(file linbo64 | grep -o 'version ...')" != "$HOST_KVER" ]; then
        NEED_RESTORE=true
    fi

    if [ "$NEED_RESTORE" = "true" ]; then
        cp "$HOST_KERNEL" linbo64
        md5sum linbo64 > linbo64.md5
        echo "$HOST_KVER" > .host-kernel-version
    fi
}
```

### Diagnose

```bash
# Marker pruefen
docker exec linbo-api cat /srv/linbo/.host-kernel-version
# Muss mit uname -r uebereinstimmen

# Kernel-Groesse pruefen
docker exec linbo-api stat -c%s /srv/linbo/linbo64
# Muss >10 MB sein (Host-Kernel ~15 MB)

# Host-Kernel verfuegbar?
ls -la /boot/vmlinuz-$(uname -r)
```

---

## Schicht 2: update-linbofs.sh — Env-Variablen

**Datei:** `scripts/server/update-linbofs.sh`

### Steuerung via Umgebungsvariablen

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `USE_HOST_KERNEL` | `false` | Wenn `true`: Host-Module statt Package-Module |
| `HOST_MODULES_PATH` | `/lib/modules/$(uname -r)` | Pfad zu Host-Modulen |
| `SKIP_KERNEL_COPY` | `false` | Wenn `true`: linbo64 wird NICHT ueberschrieben |

### Was passiert bei USE_HOST_KERNEL=true

Step 7b in update-linbofs.sh:
1. Bestehende Module in Workdir loeschen
2. Host-Module via rsync kopieren (--copy-links --safe-links, ohne build/source)
3. depmod ausfuehren fuer Host-Kernel-Version
4. Package-Module-Injektion wird uebersprungen

### Was passiert bei SKIP_KERNEL_COPY=true

Step 15: Normalerweise kopiert update-linbofs.sh den Kernel aus dem
Package nach `/srv/linbo/linbo64`. Mit SKIP_KERNEL_COPY wird das uebersprungen,
sodass der Host-Kernel erhalten bleibt.

### SERVERID-Guard (Step 10.4)

Automatisch bei jedem Rebuild:
```bash
sed -i '/LINBOSERVER.*SERVERID/{/grep -q/!s#^\([[:space:]]*\)#\1grep -q "server=" /proc/cmdline || #}' \
    init.sh
```

### Aufruf-Beispiel

```bash
# Manuell mit Host-Kernel:
docker exec -e USE_HOST_KERNEL=true -e SKIP_KERNEL_COPY=true \
  -e RSYNC_SECRETS=/etc/rsyncd.secrets \
  linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh

# Danach Host-Kernel sicherstellen:
docker exec linbo-api cp /boot/vmlinuz-$(uname -r) /srv/linbo/linbo64
```

---

## Schicht 3: linbo-update.service.js — Automatische Reparatur

**Datei:** `containers/api/src/services/linbo-update.service.js`

### Schluessel-Funktionen

#### isHostKernelAvailable()
```javascript
// Prueft ob Host-Kernel ueber Bind-Mount erreichbar ist
const kernelPath = `/boot/vmlinuz-${hostKver}`;
const modulesPath = `/lib/modules/${hostKver}`;
return fs.existsSync(kernelPath) && fs.existsSync(modulesPath);
```

#### provisionKernels()
```javascript
// Package-Kernel als .pkg speichern (NICHT als linbo64!)
// linbo64 wird NICHT angefasst
await fs.rename(extractedKernel, `${kernelPath}.pkg`);
```

#### rebuildLinbofs()
```javascript
// Host-Kernel automatisch erkennen und verwenden
if (isHostKernelAvailable()) {
    env.USE_HOST_KERNEL = 'true';
    env.HOST_MODULES_PATH = `/lib/modules/${hostKver}`;
    env.SKIP_KERNEL_COPY = 'true';
}

// linbofs64 neu bauen
await linbofsService.updateLinbofs(env);

// Host-Kernel zurueck nach linbo64 kopieren
await fs.copyFile(`/boot/vmlinuz-${hostKver}`, '/srv/linbo/linbo64');

// Marker schreiben
await fs.writeFile('/srv/linbo/.host-kernel-version', hostKver);
```

---

## Marker-Datei: .host-kernel-version

| Pfad | Inhalt | Beispiel |
|------|--------|---------|
| `/srv/linbo/.host-kernel-version` | Kernel-Version | `6.8.0-64-generic` |

### Verwendung

- **Schicht 1** (entrypoint.sh): Vergleicht mit `uname -r` → Drift erkennen
- **Schicht 3** (update-service): Schreibt nach erfolgreichem Rebuild
- **Diagnose**: Schneller Check ob Kernel aktuell

```bash
# Marker lesen
docker exec linbo-api cat /srv/linbo/.host-kernel-version

# Mit Host vergleichen
echo "Host: $(uname -r)"
echo "Marker: $(docker exec linbo-api cat /srv/linbo/.host-kernel-version)"
```

---

## Verifizierung

### Schnell-Check (alle 3 Schichten)

```bash
# 1. Schicht 1: Marker vorhanden und aktuell?
echo "=== Schicht 1: Marker ==="
docker exec linbo-api cat /srv/linbo/.host-kernel-version
echo "Host: $(uname -r)"

# 2. Schicht 2: linbo64 Groesse OK?
echo "=== Schicht 2: Kernel-Groesse ==="
docker exec linbo-api stat -c%s /srv/linbo/linbo64
echo "(Muss >10MB sein)"

# 3. Schicht 2: Module passen zum Kernel?
echo "=== Schicht 2: Module ==="
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep 'lib/modules/' | head -1"

# 4. Schicht 2: SERVERID-Guard aktiv?
echo "=== Schicht 2: SERVERID-Guard ==="
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout init.sh 2>/dev/null | grep SERVERID"

# 5. Schicht 3: Bind-Mounts vorhanden?
echo "=== Schicht 3: Bind-Mounts ==="
docker exec linbo-api ls -la /boot/vmlinuz-$(uname -r) 2>/dev/null && echo "OK" || echo "FEHLT!"
docker exec linbo-api ls -d /lib/modules/$(uname -r) 2>/dev/null && echo "OK" || echo "FEHLT!"
```

### Simulierter Update-Test

```bash
# 1. Container neu starten → Schicht 1 repariert automatisch
docker compose restart init api

# 2. Marker und Kernel pruefen
docker exec linbo-api cat /srv/linbo/.host-kernel-version
docker exec linbo-api stat -c%s /srv/linbo/linbo64
```

---

## Zusammenfassung: Wann greift welche Schicht?

| Ereignis | Schicht 1 | Schicht 2 | Schicht 3 |
|----------|-----------|-----------|-----------|
| Container-Start/Restart | **Aktiv** | - | - |
| Server-Reboot | **Aktiv** | - | - |
| Manueller linbofs64 Rebuild | - | **Aktiv** | - |
| API-Aufruf /update-linbofs | - | **Aktiv** | - |
| LINBO-Paket-Update via Frontend | - | - | **Aktiv** |
| Host-Kernel-Update (apt upgrade) | **Aktiv** (beim naechsten Containerstart) | Manueller Rebuild noetig! | - |

### Bei Host-Kernel-Update

Wenn der Host-Kernel via `apt upgrade` aktualisiert wird:
1. **Schicht 1** erkennt automatisch beim naechsten Container-Start den Drift und kopiert den neuen Kernel
2. **ABER:** linbofs64 hat noch die alten Module! → Manueller Rebuild noetig:
   ```bash
   docker exec -e USE_HOST_KERNEL=true -e SKIP_KERNEL_COPY=true \
     linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh
   docker compose restart init
   ```
