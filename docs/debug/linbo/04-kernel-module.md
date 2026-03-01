# 04 — Kernel & Module

## Das Kernel-Problem

LINBO verwendet zwei Boot-Dateien:
- **linbo64**: Linux-Kernel (~15 MB)
- **linbofs64**: Initrd mit Modulen, init.sh, Busybox (~165 MB, XZ-komprimiert)

**Kritisch:** Kernel-Version und Modul-Version in linbofs64 MUESSEN uebereinstimmen!

---

## 1. Host-Kernel vs. Package-Kernel

| Eigenschaft | Host-Kernel | Package-Kernel (linbo7) |
|-------------|-------------|------------------------|
| Herkunft | `/boot/vmlinuz-$(uname -r)` | linuxmuster-linbo7 .deb |
| Groesse | ~15 MB | ~4.5 MB |
| Module | ~6000-6500 | ~720 |
| Hardware-Support | Voll (Ubuntu-Standard) | Minimal |
| Netzwerk-Treiber | Alle gaengigen | Nur wenige |

**Regel:** Docker-Standalone MUSS den Host-Kernel verwenden. Der Package-Kernel hat
zu wenige Treiber (besonders Netzwerk), wodurch Clients nach dem GRUB-Handoff
das Netzwerk verlieren.

**Auch die Produktion (linuxmuster.net 7.3) nutzt den Host-Kernel**, nicht den
Package-Kernel. Das `update-linbofs`-Script kopiert immer `/boot/vmlinuz-$(uname -r)`.

---

## 2. Modul-Version-Mismatch

### Symptom

Client bootet PXE, laedt Kernel + Initrd, aber:
- Kein `udhcp 1.37.0` im dnsmasq-Log (Kernel erreicht network() nie)
- ODER: Boot dauert extrem lange (Minuten statt Sekunden)
- ODER: Boot ist verdaechtig schnell aber Netzwerk fehlt

### Diagnose

```bash
# Kernel-Version in linbo64
docker exec linbo-api sh -c "strings /srv/linbo/linbo64 | grep -oP '(\d+\.\d+\.\d+-\d+-\w+)' | head -1"

# Alternativ (wenn file-Command verfuegbar)
docker exec linbo-api file /srv/linbo/linbo64

# Modul-Version in linbofs64
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep 'lib/modules/' | head -1"
# Erwartet: lib/modules/6.8.0-64-generic/...

# Host-Kernel-Version
uname -r
# MUSS mit der Modul-Version uebereinstimmen!

# Marker-Datei pruefen
docker exec linbo-api cat /srv/linbo/.host-kernel-version
# MUSS mit uname -r uebereinstimmen!

# Anzahl Module zaehlen
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep -c '\.ko'"
```

### Version-Mismatch-Szenarien

| Szenario | Kernel (linbo64) | Module (linbofs64) | Effekt |
|----------|-----------------|-------------------|--------|
| Korrekt | 6.8.0-64-generic | 6.8.0-64-generic | Alle Module laden |
| Mismatch (schnell) | 6.8.0-64-generic | 6.8.0-83-generic | Keine Module laden → schneller Boot, aber ggf. fehlende Treiber |
| Mismatch (langsam) | 6.8.0-83-generic | 6.8.0-64-generic | Kommt nicht vor (linbo64 bestimmt) |

**Paradox entdeckt (Session 18):**
Ein Modul-Mismatch kann dazu fuehren, dass der Boot SCHNELLER ist,
weil udev KEINE Module laden kann. Wenn die Module dann korrigiert werden,
laedt udev ALLE ~6000 Module → `udevadm settle` haengt!

---

## 3. udevadm settle Haenger

### Problem

init.sh ruft in `hwsetup()` auf:
```bash
udevd --daemon
udevadm trigger --type=all --action=add
udevadm settle || true
```

Bei ~6000 passenden Modulen kann `udevadm settle` **Minuten** dauern,
besonders wenn ein GPU-Treiber oder anderes Modul haengt.

### Symptome
- Kein externes Anzeichen (kein Log vom Client)
- dnsmasq zeigt `PXEClient` aber kein `udhcp` (Kernel steckt vor network() fest)
- Boot dauert >2 Minuten nach GRUB Download

### Diagnose
1. **Verbose Boot aktivieren** (loglevel=7 statt quiet splash):
   ```bash
   docker exec linbo-rsync sed -i 's/quiet splash/loglevel=7/g' \
     /srv/linbo/boot/grub/win11_pro.cfg
   ```
2. Auf Client-Bildschirm beobachten wo der Boot haengt
3. Typische Haenger-Stellen:
   - `udevadm settle` — wartet auf Modul-Events
   - GPU-Treiber (nouveau, i915, amdgpu) — Modesetting blockiert
   - Plymouth — haengt bei `plymouthd --mode=boot`

### Fix

```bash
# Option A: splash entfernen (verhindert Plymouth-Haenger)
# In GRUB-Config: "quiet splash" → "loglevel=7"
docker exec linbo-rsync sed -i 's/quiet splash/loglevel=7/g' \
  /srv/linbo/boot/grub/win11_pro.cfg

# Option B: Problematische Module blacklisten
# In linbofs64 unter /etc/modprobe.d/:
# blacklist nouveau
# blacklist amdgpu

# Option C: udevadm settle Timeout setzen
# udevadm settle --timeout=30 (Standard: 120)
```

---

## 4. Plymouth-Haenger

### Problem

Wenn `splash` auf der Kernel-Cmdline steht, startet init.sh Plymouth:
```bash
if grep -qiw splash /proc/cmdline; then
    plymouthd --mode=boot
    plymouth --show-splash
fi
```

Plymouth kann haengen wenn:
- GPU-Treiber nicht korrekt geladen
- Framebuffer nicht verfuegbar
- Module-Loading noch nicht abgeschlossen

### Fix

`quiet splash` → `loglevel=7` in der GRUB-Config. Dies:
1. Zeigt Kernel-Meldungen auf dem Client-Bildschirm
2. Deaktiviert Plymouth (kein `splash` auf Cmdline)
3. Hilft bei der Diagnose von Boot-Problemen

---

## 5. linbofs64 Format & Manipulation

### Format

linbofs64 ist ein **XZ-komprimiertes CPIO-Archiv**:
```
Magic Bytes: fd 37 7a 58 5a 00 (XZ)
Komprimiert: ~165 MB
Unkomprimiert: ~250 MB
Dateien: ~9000 (mit Host-Kernel-Modulen)
```

### Inhalt auflisten

```bash
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | head -50"
```

### Datei extrahieren

```bash
# init.sh extrahieren
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout init.sh 2>/dev/null" > /tmp/init.sh

# inittab pruefen
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout etc/inittab 2>/dev/null"
```

### Komplettes Entpacken

```bash
mkdir -p /tmp/linbofs && cd /tmp/linbofs
docker exec linbo-api sh -c "xz -dc /srv/linbo/linbofs64" | cpio -idm 2>/dev/null
```

### Neu Packen

```bash
cd /tmp/linbofs
find . -print | cpio --quiet -o -H newc | xz -e --check=none -z -f -T 0 -c > /srv/linbo/linbofs64
```

---

## 6. linbofs64 neu bauen

### Via Shell (mit Host-Kernel)

```bash
docker exec -e USE_HOST_KERNEL=true -e SKIP_KERNEL_COPY=true \
  -e RSYNC_SECRETS=/etc/rsyncd.secrets \
  linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh
```

Danach Host-Kernel zurueckkopieren (wenn SKIP_KERNEL_COPY):
```bash
docker exec linbo-api cp /boot/vmlinuz-$(uname -r) /srv/linbo/linbo64
```

### Via API

```bash
docker exec linbo-api curl -s -X POST http://localhost:3000/api/v1/system/update-linbofs
```

Die API erkennt automatisch den Host-Kernel und setzt die passenden Env-Variablen.

### Verifizierung nach Rebuild

```bash
# 1. Kernel-Version pruefen
docker exec linbo-api file /srv/linbo/linbo64 2>/dev/null || \
  docker exec linbo-api sh -c "strings /srv/linbo/linbo64 | grep -oP '(\d+\.\d+\.\d+-\d+-\w+)' | head -1"

# 2. Module pruefen
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep 'lib/modules/' | head -3"

# 3. SERVERID-Guard pruefen
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout init.sh 2>/dev/null | grep -n SERVERID"
# MUSS 2 Zeilen mit "grep -q" zeigen!

# 4. Groesse pruefen (Host-Kernel >10MB)
docker exec linbo-api stat -c%s /srv/linbo/linbo64
```

---

## 7. Vergleich mit Produktion

```bash
# Produktions-linbofs64 Module zaehlen
ssh root@10.0.0.13 'ssh root@10.0.0.11 \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep -c .ko"'

# Produktions-Kernel-Version
ssh root@10.0.0.13 'ssh root@10.0.0.11 "file /srv/linbo/linbo64"'

# Groessen vergleichen
ssh root@10.0.0.13 'ssh root@10.0.0.11 "stat -c%s /srv/linbo/linbo64; stat -c%s /srv/linbo/linbofs64"'
```

| Eigenschaft | Docker (Ziel) | Produktion (Referenz) |
|-------------|--------------|----------------------|
| linbo64 Groesse | ~15 MB | ~15 MB |
| linbofs64 Groesse | ~165 MB | ~168 MB |
| Module | ~6400 | ~6400 |
| Kernel-Version | Host $(uname -r) | Host $(uname -r) |
