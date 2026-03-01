# 07 — Haeufige Fehlerbilder

## 1. "This LINBO client is in remote control mode"

Dies ist das haeufigste Fehlerbild. Der Client zeigt keine OS-Auswahl (Qt GUI)
sondern nur eine Text-Meldung.

### Ursache

"Remote Control Mode" erscheint wenn:
- `/usr/bin/linbo_gui` nicht vorhanden (GUI nicht heruntergeladen/entpackt)
- UND `/conf/menu` nicht vorhanden (keine geparste start.conf mit [OS])
- UND kein `DEBUG` Kernel-Parameter

### Diagnose-Reihenfolge

```
1. GRUB-Phase OK?
   → docker logs linbo-web --tail 50 | grep "Client-IP"
   → Erwartet: GET /linbo64 200, GET /linbofs64 200
   → WENN FEHLT: GRUB Config / TFTP / dnsmasq pruefen

2. Kernel bootet?
   → docker logs linbo-dhcp 2>&1 | grep "udhcp"
   → Erwartet: "vendor class: udhcp 1.37.0" (ca. 30-60s nach PXE)
   → WENN FEHLT: Kernel-Modul-Problem → Siehe Abschnitt 2

3. DHCP funktioniert?
   → Produktions-DHCP-Log pruefen (10.0.0.11)
   → Erwartet: DHCPDISCOVER → DHCPOFFER → DHCPREQUEST → DHCPACK
   → WENN FEHLT: Host nicht in DHCP konfiguriert

4. rsync erreichbar?
   → docker logs linbo-rsync --tail 30
   → Erwartet: Client-Zugriff auf start.conf
   → WENN FEHLT: LINBOSERVER falsch (SERVERID-Guard?) oder Firewall

5. start.conf vorhanden?
   → docker exec linbo-web ls -la /srv/linbo/start.conf.win11_pro
   → MUSS existieren und >0 Bytes sein

6. GUI downloadbar?
   → docker exec linbo-web ls -la /srv/linbo/linbo_gui64_7.tar.lz
   → docker exec linbo-web ls -la /srv/linbo/linbo_gui64_7.tar.lz.md5
   → MUSS existieren
```

---

## 2. Kernel bootet nicht (kein udhcpc im Log)

### Symptom

- dnsmasq-Log zeigt `PXEClient` (GRUB-Phase OK)
- dnsmasq-Log zeigt KEIN `udhcp 1.37.0` (Kernel erreicht network() nie)
- Client-Bildschirm: schwarz oder Plymouth-Logo "haengt"

### Moegliche Ursachen

#### A: Kernel/Modul-Mismatch

```bash
# Kernel-Version pruefen
uname -r                    # Host-Kernel
docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep 'lib/modules/' | head -1"
# Modul-Version MUSS mit linbo64-Kernel uebereinstimmen!
```

→ Fix: linbofs64 mit korrekten Modulen neu bauen (Siehe [04-kernel-module.md](./04-kernel-module.md))

#### B: udevadm settle haengt

Bei ~6000 passenden Modulen kann `udevadm settle` Minuten dauern.

→ Fix: Verbose Boot (`loglevel=7`), dann problematische Module identifizieren und blacklisten

#### C: Plymouth haengt

Wenn `splash` auf der Kernel-Cmdline steht, startet Plymouth.
GPU-Treiberprobleme koennen Plymouth blockieren.

→ Fix: `quiet splash` → `loglevel=7` in GRUB-Config

#### D: Kernel Panic

Fehlende kritische Module (Storage, Block Layer).

→ Fix: Host-Kernel verwenden (mehr Module), GRUB-Config auf `loglevel=7` setzen um Panic zu sehen

---

## 3. Client bekommt falsche Konfiguration

### Symptom

Client bootet, GUI erscheint, aber falsche OS-Auswahl oder leere Ansicht.

### Ursache

- GRUB-Config zeigt auf falsche Gruppe
- MAC-Fallback in grub.cfg hat alte Gruppe
- hostcfg Symlink zeigt auf falsche Gruppen-Config

### Diagnose

```bash
# 1. hostcfg pruefen
docker exec linbo-web ls -la /srv/linbo/boot/grub/hostcfg/vier.cfg
# → ../win11_pro.cfg (korrekt?)

# 2. MAC-Fallback pruefen
docker exec linbo-web grep -A3 "bc:24:11:5c:25:09" /srv/linbo/boot/grub/grub.cfg | grep group

# 3. start.conf der Gruppe pruefen
docker exec linbo-web cat /srv/linbo/start.conf.win11_pro | head -20
```

---

## 4. rsync-Fehler

### Symptom

Client erreicht network()-Phase (udhcpc OK), aber rsync schlaegt fehl.
Keine GUI, "Remote Control Mode".

### Diagnose

```bash
# rsync-Container laeuft?
docker compose ps linbo-rsync

# rsync-Logs pruefen
docker logs linbo-rsync --tail 30

# rsync manuell testen
docker exec linbo-rsync rsync --list-only rsync://localhost/linbo/
```

### Moegliche Ursachen

1. **LINBOSERVER falsch** (SERVERID-Guard fehlt):
   ```bash
   docker exec linbo-api sh -c \
     "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout init.sh 2>/dev/null | grep -n SERVERID"
   ```

2. **rsync-Passwort falsch**:
   ```bash
   docker exec linbo-rsync cat /etc/rsyncd.secrets
   # Vergleichen mit:
   docker exec linbo-api sh -c \
     "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout etc/linbo_pwhash 2>/dev/null"
   ```

3. **start.conf nicht vorhanden**:
   ```bash
   docker exec linbo-rsync ls -la /srv/linbo/start.conf.*
   ```

---

## 5. GUI-Download schlaegt fehl

### Symptom

Client erreicht rsync (start.conf wird geholt), aber GUI-Download schlaegt fehl.
"Remote Control Mode" trotz korrekter start.conf.

### Diagnose

```bash
# GUI-Archiv vorhanden?
docker exec linbo-web ls -la /srv/linbo/linbo_gui64_7.tar.lz

# MD5 vorhanden?
docker exec linbo-web ls -la /srv/linbo/linbo_gui64_7.tar.lz.md5

# GUI-Symlink vorhanden?
docker exec linbo-web ls -la /srv/linbo/gui/linbo_gui64_7.tar.lz
```

### Fix

```bash
# GUI von Produktion kopieren (wenn nicht vorhanden)
ssh root@10.0.0.13 'scp root@10.0.0.11:/srv/linbo/linbo_gui64_7.tar.lz /srv/linbo/'
ssh root@10.0.0.13 'scp root@10.0.0.11:/srv/linbo/linbo_gui64_7.tar.lz.md5 /srv/linbo/'
```

---

## 6. Client-IP Probleme

### Symptom

Client bekommt keine IP-Adresse. udhcpc zeigt Timeout.

### Diagnose

```bash
# Produktions-DHCP laeuft?
ssh root@10.0.0.13 'ssh root@10.0.0.11 "systemctl status isc-dhcp-server"'

# Client in DHCP konfiguriert?
ssh root@10.0.0.13 'ssh root@10.0.0.11 "grep -r bc:24:11:5c:25:09 /etc/dhcp/"'

# Live-DHCP-Traffic
tcpdump -i enp6s18 -nn "udp port 67 or udp port 68" -c 20
```

---

## 7. Boot-Timing Referenz

Normale vs. problematische Boot-Zeiten:

| Phase | Normal | Langsam | Haenger |
|-------|--------|---------|---------|
| PXE DHCP | < 5s | < 10s | — |
| GRUB linbo64 | ~2s | ~10s | — |
| GRUB linbofs64 | ~10s | ~30s | — |
| init_setup | < 2s | < 5s | — |
| hwsetup (udevadm settle) | ~5s | ~30s | **Minuten!** |
| Plymouth | < 1s | — | **Haengt!** |
| udhcpc | ~3s | ~30s | — |
| rsync start.conf | ~1s | ~5s | — |
| GUI Download | ~3s | ~30s | — |
| **Gesamt** | **~30s** | **~2 min** | **Minuten+** |

### Wie messe ich die Zeiten?

```bash
# Zeitstempel der DHCP-Phasen vergleichen:

# 1. PXE-Zeitpunkt (dnsmasq-Log)
docker logs linbo-dhcp 2>&1 | grep "PXEClient" | grep "bc:24:11:5c:25:09" | tail -1

# 2. GRUB-Download (Web-Log)
docker logs linbo-web 2>&1 | grep "linbofs64" | grep "10.0.150.2" | tail -1

# 3. Kernel-DHCP (dnsmasq-Log)
docker logs linbo-dhcp 2>&1 | grep "udhcp" | tail -1

# Differenz 1→3 = gesamte Kernel-Boot-Zeit (inkl. hwsetup, Plymouth)
```

---

## 8. Checkliste: Nach LINBO-Update

Nach jedem LINBO-Update (linuxmuster-linbo7 Paket) diese Punkte pruefen:

- [ ] linbo64 Groesse >10 MB? (`stat -c%s /srv/linbo/linbo64`)
- [ ] `.host-kernel-version` Marker aktuell? (`cat /srv/linbo/.host-kernel-version`)
- [ ] Modul-Version = Kernel-Version? (linbofs64 Module vs. uname -r)
- [ ] SERVERID-Guard in init.sh? (`grep -n SERVERID` auf init.sh im Initrd)
- [ ] linbo_gui64_7.tar.lz vorhanden? (inkl. .md5)
- [ ] GRUB-Configs unveraendert? (server=, group= pruefen)
- [ ] start.conf Dateien unveraendert?

Wenn einer dieser Punkte fehlschlaegt: linbofs64 neu bauen!
```bash
docker exec -e USE_HOST_KERNEL=true -e SKIP_KERNEL_COPY=true \
  linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh
```
