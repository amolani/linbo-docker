# 02 — Diagnose-Befehle (Schnellreferenz)

Alle Befehle fuer SSH auf den Testserver (10.0.0.13).

---

## 1. Container-Status

```bash
# Alle Container anzeigen
docker compose ps

# Erwartetes Ergebnis: Alle "Up" und "(healthy)"
# linbo-api, linbo-cache, linbo-db, linbo-dhcp, linbo-rsync,
# linbo-ssh, linbo-tftp, linbo-web
```

## 2. GRUB-Phase pruefen (Web-Logs)

```bash
# Client-Downloads in Echtzeit (10.0.150.2 = Client-IP)
docker logs linbo-web --tail 50 2>&1 | grep "10.0.150.2"

# Erwartete Eintraege:
# GET /linbo64 HTTP/1.1 200 15006088 "GRUB 2.12-1ubuntu7.3"
# GET /linbofs64 HTTP/1.1 200 165304360 "GRUB 2.12-1ubuntu7.3"
```

## 3. DHCP-Phase pruefen

### a) Proxy-DHCP (dnsmasq auf 10.0.0.13)

```bash
# PXE-Requests pruefen (vendor class: PXEClient)
docker logs linbo-dhcp --tail 50 2>&1

# Kernel-DHCP pruefen (vendor class: udhcp 1.37.0)
docker logs linbo-dhcp 2>&1 | grep "udhcp" | tail -10

# WICHTIG: Wenn nur "PXEClient" aber kein "udhcp" erscheint,
# hat der Kernel die network()-Phase in init.sh NICHT erreicht!
```

### b) Produktions-DHCP (ISC DHCP auf 10.0.0.11)

```bash
# DHCP-Logs vom Produktionsserver (via SSH-Hop)
ssh root@10.0.0.11 "journalctl -u isc-dhcp-server --since '30 minutes ago' \
  --no-pager | grep 'bc:24:11:5c:25:09'"

# Erwartet: DHCPDISCOVER → DHCPOFFER → DHCPREQUEST → DHCPACK
# ACHTUNG: Produktionsserver ist CET (UTC+1)!

# Konfiguration fuer einen Host pruefen
ssh root@10.0.0.11 "grep -B2 -A10 'vier' /etc/dhcp/devices/default-school.conf"
```

### c) Live DHCP-Capture (tcpdump)

```bash
# Alle DHCP-Pakete auf dem Server-Interface
tcpdump -i enp6s18 -nn "udp port 67 or udp port 68" -c 20

# Nur fuer eine bestimmte MAC
tcpdump -i enp6s18 -nn "ether host bc:24:11:5c:25:09 and (udp port 67 or udp port 68)" -c 5

# ACHTUNG: DHCP-Responses sind oft Broadcast (ff:ff:ff:ff:ff:ff),
# daher MAC-Filter ggf. weglassen!
```

## 4. rsync pruefen

```bash
# rsync-Logs (leer = keine Client-Verbindungen)
docker logs linbo-rsync --tail 30

# rsync manuell testen (vom Server aus)
docker exec linbo-rsync rsync --list-only rsync://localhost/linbo/start.conf.win11_pro

# start.conf Existenz pruefen
docker exec linbo-web ls -la /srv/linbo/start.conf.*
```

## 5. Kernel & Initrd pruefen

```bash
# Kernel-Version in linbo64
docker exec linbo-api file /srv/linbo/linbo64

# Module im Initrd zaehlen
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep -c '\.ko'"

# Kernel-Version der Module pruefen
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep 'lib/modules/' | head -1"

# SERVERID-Guard verifizieren (MUSS 2 Zeilen mit "grep -q" zeigen)
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout init.sh 2>/dev/null | grep -n 'SERVERID'"

# init.sh komplett extrahieren
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout init.sh 2>/dev/null" > /tmp/init.sh
```

## 6. GRUB-Config pruefen

```bash
# Gruppen-Config anzeigen
docker exec linbo-web cat /srv/linbo/boot/grub/win11_pro.cfg

# hostcfg Symlinks pruefen
docker exec linbo-web ls -la /srv/linbo/boot/grub/hostcfg/

# MAC-Fallback in Haupt-grub.cfg pruefen
docker exec linbo-rsync grep -A5 "bc:24:11:5c:25:09" /srv/linbo/boot/grub/grub.cfg

# Server-IP und Gruppe verifizieren
docker exec linbo-web grep -E "server=|group=" /srv/linbo/boot/grub/win11_pro.cfg | head -3
```

## 7. GUI-Dateien pruefen

```bash
# GUI-Archiv vorhanden?
docker exec linbo-web ls -la /srv/linbo/linbo_gui64_7.tar.lz

# GUI-Symlink vorhanden?
docker exec linbo-web ls -la /srv/linbo/gui/linbo_gui64_7.tar.lz

# MD5 vorhanden?
docker exec linbo-web ls -la /srv/linbo/linbo_gui64_7.tar.lz.md5
```

## 8. Kernel-Schutz pruefen

```bash
# Host-Kernel-Marker
docker exec linbo-api cat /srv/linbo/.host-kernel-version

# Host-Kernel-Groesse (sollte >10MB sein)
docker exec linbo-api stat -c%s /srv/linbo/linbo64

# Host-Kernel-Version
uname -r
# Muss mit Modulen in linbofs64 uebereinstimmen!
```

## 9. Verbose Boot aktivieren

```bash
# quiet splash → loglevel=7 (zeigt Kernel-Meldungen auf Client-Bildschirm)
docker exec linbo-rsync sed -i 's/quiet splash/loglevel=7/g' \
  /srv/linbo/boot/grub/win11_pro.cfg

# MAC-Fallback in grub.cfg auch aendern
docker exec linbo-rsync sed -i \
  '/bc:24:11:5c:25:09/,/boot/s/quiet splash/loglevel=7/' \
  /srv/linbo/boot/grub/grub.cfg

# Zurueck auf normal:
docker exec linbo-rsync sed -i 's/loglevel=7/quiet splash/g' \
  /srv/linbo/boot/grub/win11_pro.cfg
```

## 10. linbofs64 neu bauen

```bash
# Manuell (mit Host-Kernel)
docker exec -e USE_HOST_KERNEL=true -e SKIP_KERNEL_COPY=true \
  -e RSYNC_SECRETS=/etc/rsyncd.secrets \
  linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh

# Via API
docker exec linbo-api curl -s -X POST http://localhost:3000/api/v1/system/update-linbofs

# Danach Host-Kernel zurueckkopieren (wenn SKIP_KERNEL_COPY)
docker exec linbo-api cp /boot/vmlinuz-$(uname -r) /srv/linbo/linbo64
```

## 11. Sync-Cache pruefen (Redis)

```bash
# Host-Daten in Redis
docker exec linbo-cache redis-cli HGETALL "host:vier"

# Alle bekannten Hosts
docker exec linbo-cache redis-cli KEYS "host:*"

# Server-Konfiguration
docker exec linbo-cache redis-cli GET "config:linbo_server_ip"
```
