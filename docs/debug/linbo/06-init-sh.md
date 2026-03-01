# 06 — init.sh Analyse

## Ueberblick

`init.sh` ist das Hauptskript im Initrd (linbofs64). Es wird von Busybox init
als `::sysinit:/init.sh` gestartet und fuehrt alle Schritte von Hardware-Erkennung
bis Netzwerk-Konfiguration durch.

```
/etc/inittab:
  ::sysinit:/init.sh        ← Hardware, Netzwerk, start.conf
  ::respawn:/linbo.sh       ← GUI-Loop
  ::wait:/usr/bin/linbo_vnc onboot
```

---

## 1. Ausfuehrungsreihenfolge

```
init.sh startet
    │
    ├── init_setup()
    │     ├── mount /proc, /sys, /dev
    │     ├── Lade Module aus /etc/modules (fan, thermal, nbd, ntfs3, uinput)
    │     └── Keyboard-Layout laden
    │
    ├── hwsetup()                          ← KANN HAENGEN (udevadm settle)
    │     ├── udevd --daemon
    │     ├── udevadm trigger --type=all --action=add
    │     ├── udevadm settle || true       ← WARTET auf alle udev-Events
    │     └── linbo_link_blkdev
    │
    ├── Plymouth (wenn "splash" auf Cmdline)  ← KANN HAENGEN
    │     ├── plymouthd --mode=boot
    │     └── plymouth --show-splash
    │
    └── network()
          ├── Iteriert alle Interfaces aus /proc/net/dev
          ├── ip link set dev "$dev" up
          ├── udhcpc -O nisdomain -n -i "$dev" -t $dhcpretry
          ├── do_env()
          │     ├── Parsed /proc/cmdline
          │     ├── Parsed /tmp/dhcp.log
          │     ├── server= → LINBOSERVER (wenn SERVERID-Guard OK)
          │     ├── nisdomain= → HOSTGROUP
          │     └── hostname= → HOSTNAME
          ├── rsync $LINBOSERVER::linbo/start.conf.$HOSTGROUP /start.conf
          └── linbo_update_gui (download linbo_gui64_7.tar.lz)
```

---

## 2. init.sh extrahieren und pruefen

```bash
# init.sh aus linbofs64 extrahieren
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout init.sh 2>/dev/null" > /tmp/init.sh

# Ansehen
cat /tmp/init.sh

# Bestimmte Funktion suchen
grep -n "^network()" /tmp/init.sh
grep -n "^do_env()" /tmp/init.sh
grep -n "^hwsetup()" /tmp/init.sh
```

---

## 3. SERVERID-Guard (Kritisch fuer Docker-Standalone)

### Problem

Im Original-init.sh ueberschreibt diese Zeile LINBOSERVER:
```bash
export LINBOSERVER="${SERVERID}"
```

`SERVERID` kommt aus dem DHCP-Feld `server-identifier` und zeigt auf den
DHCP-Server (10.0.0.11 = Produktionsserver). In Standard-linuxmuster ist
DHCP-Server = LINBO-Server, daher kein Problem. In Docker-Standalone sind
es verschiedene Server!

### Patch (wird von update-linbofs.sh Step 10.4 automatisch angewendet)

```bash
# Vorher:
export LINBOSERVER="${SERVERID}"

# Nachher:
grep -q "server=" /proc/cmdline || export LINBOSERVER="${SERVERID}"
```

**Logik:**
- `server=` auf Cmdline (Docker-Standalone) → SERVERID-Override wird UEBERSPRUNGEN
- Kein `server=` auf Cmdline (Standard-linuxmuster) → SERVERID-Override wie bisher

### Pruefen ob Guard aktiv

```bash
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout init.sh 2>/dev/null | grep -n SERVERID"

# MUSS zeigen (2 Zeilen mit "grep -q"):
#   128:    grep -q "server=" /proc/cmdline || export LINBOSERVER="${SERVERID}"
# oder aehnlich. OHNE "grep -q" = NICHT gepatcht!
```

### Symptome bei fehlendem Guard

1. LINBOSERVER wird auf 10.0.0.11 (Produktionsserver) gesetzt
2. rsync versucht start.conf von 10.0.0.11 zu holen
3. Schlaegt fehl oder holt falsche Config
4. → Keine GUI, "Remote Control Mode"

---

## 4. do_env() — Umgebungsvariablen parsen

`do_env()` ist die zentrale Funktion die LINBOSERVER, HOSTGROUP und HOSTNAME setzt.

### Quellen

1. **`/proc/cmdline`** — Von GRUB gesetzte Parameter:
   ```
   server=10.0.0.13 group=win11_pro hostgroup=win11_pro dhcpretry=9 quiet splash
   ```

2. **`/tmp/dhcp.log`** — Von udhcpc default.script geschrieben:
   ```
   interface=eth0
   ip=10.0.150.2
   mask=255.255.0.0
   router=10.0.0.1
   dns=10.0.0.1
   hostname=vier
   nisdomain=win11_pro
   serverid=10.0.0.11
   ```

### Variablen-Zuordnung

| Variable | Quelle | Prioritaet |
|----------|--------|------------|
| LINBOSERVER | server= (cmdline) | Hoechste (wenn Guard aktiv) |
| LINBOSERVER | SERVERID (DHCP) | Fallback (wenn kein server= auf cmdline) |
| HOSTGROUP | nisdomain (DHCP) | Aus ISC DHCP `option nis-domain` |
| HOSTGROUP | hostgroup= (cmdline) | Fallback |
| HOSTNAME | hostname (DHCP) | Aus ISC DHCP `option host-name` |
| GROUP | group= (cmdline) | Von GRUB gesetzt |

---

## 5. network() — Netzwerk-Konfiguration

### Ablauf

```bash
network() {
    # 1. Interfaces aus /proc/net/dev lesen (lo wird uebersprungen)
    for dev in $(awk -F: '/eth|ens|enp/{print $1}' /proc/net/dev); do
        ip link set dev "$dev" up

        # 2. udhcpc ausfuehren
        udhcpc -O nisdomain -n -i "$dev" -t $dhcpretry

        # 3. Ergebnis auswerten
        do_env
    done

    # 4. start.conf herunterladen
    rsync "$LINBOSERVER::linbo/start.conf.$HOSTGROUP" /start.conf

    # 5. GUI herunterladen
    linbo_update_gui
}
```

### Diagnose

```bash
# Netzwerk-Interfaces auf dem Server pruefen
cat /proc/net/dev

# rsync manuell testen
docker exec linbo-rsync rsync --list-only rsync://localhost/linbo/start.conf.win11_pro

# start.conf Existenz pruefen
docker exec linbo-web ls -la /srv/linbo/start.conf.*
```

---

## 6. hwsetup() — Hardware-Erkennung

```bash
hwsetup() {
    udevd --daemon
    udevadm trigger --type=all --action=add
    udevadm settle || true
    linbo_link_blkdev
}
```

### Timing

| Szenario | Dauer |
|----------|-------|
| Wenige Module (Mismatch) | < 5s |
| Alle Module laden (Host-Kernel, ~6000) | 5-30s |
| GPU-Treiber haengt | Minuten! |

### Debugging

Verbose Boot aktivieren um zu sehen wo hwsetup stecken bleibt:
```bash
# In GRUB-Config: quiet splash → loglevel=7
docker exec linbo-rsync sed -i 's/quiet splash/loglevel=7/g' \
  /srv/linbo/boot/grub/win11_pro.cfg
```

---

## 7. Weitere wichtige Dateien im Initrd

### /etc/inittab

```
::sysinit:/init.sh
::respawn:/linbo.sh
::wait:/usr/bin/linbo_vnc onboot
```

### /etc/modules

```
fan
thermal
nbd
ntfs3
uinput
```

Diese 5 Module werden explizit geladen, unabhaengig von udev.

### /usr/share/udhcpc/default.script

Callback fuer udhcpc, schreibt DHCP-Antworten in `/tmp/dhcp.log`:
```bash
date >>/tmp/dhcp.log
set >>/tmp/dhcp.log
case "$1" in bound)
    ifconfig $interface $ip $NETMASK
    route add default gw $router
done
```

### /linbo.sh

LINBO-Hauptloop nach init.sh:
- Wenn `/usr/bin/linbo_gui` existiert → Qt GUI starten
- Wenn NICHT → "Remote Control Mode"

GUI-Binary kommt aus `linbo_gui64_7.tar.lz` (via rsync heruntergeladen).

---

## 8. init.sh Debugging-Workflow

### Schritt 1: Wo haengt es?

```
init_setup → OK (immer schnell, < 2s)
hwsetup    → Potentieller Haenger (udevadm settle, GPU)
Plymouth   → Potentieller Haenger (wenn splash auf cmdline)
network()  → Potentieller Haenger (udhcpc Timeout)
```

### Schritt 2: Externe Indikatoren

| Phase | Externer Indikator |
|-------|-------------------|
| init_setup | Keiner |
| hwsetup | Keiner |
| Plymouth | Keiner |
| network() | dnsmasq-Log zeigt "udhcp 1.37.0" |
| rsync | rsync-Container-Log zeigt Zugriff |
| GUI download | rsync-Container-Log zeigt Zugriff |

### Schritt 3: Verbose Boot

Einzige Moeglichkeit die fruehem Phasen zu debuggen:
`quiet splash` → `loglevel=7` in GRUB-Config.
Dann auf dem Client-Bildschirm beobachten.
