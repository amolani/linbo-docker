# 05 — GRUB Konfiguration

## Ueberblick

GRUB laedt die Boot-Konfiguration in dieser Reihenfolge:

```
1. grub.cfg (Hauptdatei)
   ├── Sucht hostcfg/<hostname>.cfg
   │     └── Symlink → ../win11_pro.cfg (Gruppen-Config)
   ├── Fallback: MAC-basierte Zuordnung direkt in grub.cfg
   └── Default: default_group= Variable
```

---

## 1. Dateien und Pfade

| Datei | Pfad im Container | Beschreibung |
|-------|-------------------|-------------|
| `grub.cfg` | `/srv/linbo/boot/grub/grub.cfg` | Haupt-GRUB-Config |
| `<gruppe>.cfg` | `/srv/linbo/boot/grub/<gruppe>.cfg` | Gruppen-Config (z.B. win11_pro.cfg) |
| `hostcfg/<host>.cfg` | `/srv/linbo/boot/grub/hostcfg/<host>.cfg` | Host-Symlink → Gruppen-Config |
| `core.efi` | `/srv/linbo/boot/grub/x86_64-efi/core.efi` | GRUB EFI Binary |

### Container-Zugriff

```bash
# Dateien auflisten
docker exec linbo-web ls -la /srv/linbo/boot/grub/
docker exec linbo-web ls -la /srv/linbo/boot/grub/hostcfg/

# GRUB Haupt-Config lesen
docker exec linbo-web cat /srv/linbo/boot/grub/grub.cfg

# Gruppen-Config lesen
docker exec linbo-web cat /srv/linbo/boot/grub/win11_pro.cfg
```

---

## 2. Gruppen-Config (z.B. win11_pro.cfg)

Wichtige Variablen die auf die Kernel-Cmdline gesetzt werden:

```grub
set server=10.0.0.13
set group=win11_pro
set hostgroup=win11_pro

menuentry 'Start Win11 Pro' {
    linux /linbo64 ... server=${server} group=${group} hostgroup=${hostgroup} dhcpretry=9 quiet splash
    initrd /linbofs64
}
```

### Cmdline-Parameter

| Parameter | Wert | Verwendet in init.sh |
|-----------|------|---------------------|
| `server=` | `10.0.0.13` | → LINBOSERVER (wenn SERVERID-Guard) |
| `group=` | `win11_pro` | → GROUP |
| `hostgroup=` | `win11_pro` | → HOSTGROUP |
| `dhcpretry=` | `9` | Anzahl udhcpc Retries |
| `quiet` | - | Unterdrueckt Kernel-Meldungen |
| `splash` | - | Aktiviert Plymouth Splash-Screen |

### Diagnose: Server-IP und Gruppe pruefen

```bash
# Alle server= und group= Eintraege
docker exec linbo-web grep -E "server=|group=" /srv/linbo/boot/grub/win11_pro.cfg | head -5

# MUSS zeigen:
# set server=10.0.0.13
# set group=win11_pro
# set hostgroup=win11_pro
```

**ACHTUNG:** Wenn `server=` auf die Produktions-IP (10.0.0.11) zeigt,
wird der Client dort LINBO-Daten suchen, nicht auf dem Docker-Server!

---

## 3. Host-Zuordnung (hostcfg/)

### Symlink-Struktur

```bash
docker exec linbo-web ls -la /srv/linbo/boot/grub/hostcfg/
# vier.cfg -> ../win11_pro.cfg
# fuenf.cfg -> ../win11_pro.cfg
```

Jeder Host bekommt einen Symlink der auf seine Gruppen-Config zeigt.
GRUB liest `hostcfg/<hostname>.cfg` und folgt dem Symlink.

### Hostname-Aufloesung

Der Hostname kommt aus dem DHCP-Lease:
1. Produktions-DHCP setzt `option host-name "vier"`
2. GRUB erhaelt Hostname via DHCP
3. GRUB sucht `hostcfg/vier.cfg`

### Diagnose: Symlink pruefen

```bash
# Existiert der Symlink?
docker exec linbo-web ls -la /srv/linbo/boot/grub/hostcfg/vier.cfg
# Erwartet: vier.cfg -> ../win11_pro.cfg

# Zeigt der Symlink auf die richtige Gruppe?
docker exec linbo-web readlink /srv/linbo/boot/grub/hostcfg/vier.cfg
# Erwartet: ../win11_pro.cfg
```

---

## 4. MAC-Fallback in grub.cfg

Wenn hostcfg-Lookup fehlschlaegt, hat grub.cfg einen MAC-basierten Fallback:

```bash
docker exec linbo-web grep -A5 "bc:24:11:5c:25:09" /srv/linbo/boot/grub/grub.cfg
```

Beispiel-Eintrag:
```grub
if [ "$net_default_mac" = "bc:24:11:5c:25:09" ]; then
    set server=10.0.0.13
    set group=win11_pro
    set hostgroup=win11_pro
    ...
fi
```

### Haeufiger Fehler: Falsche Gruppe im MAC-Fallback

In Session 18 war der MAC-Fallback auf eine alte Gruppe konfiguriert (`amodrei`),
obwohl der Client zu `win11_pro` gehoerte. Dadurch wurde eine falsche `start.conf`
heruntergeladen (oder gar keine, wenn sie nicht existiert).

### Diagnose

```bash
# Alle MAC-Eintraege in grub.cfg auflisten
docker exec linbo-web grep -B1 "net_default_mac" /srv/linbo/boot/grub/grub.cfg

# Gruppe fuer bestimmte MAC pruefen
docker exec linbo-web grep -A3 "bc:24:11:5c:25:09" /srv/linbo/boot/grub/grub.cfg | grep group
```

---

## 5. GRUB Debug

### Verbose Boot (Kernel-Meldungen anzeigen)

```bash
# quiet splash → loglevel=7
docker exec linbo-rsync sed -i 's/quiet splash/loglevel=7/g' \
  /srv/linbo/boot/grub/win11_pro.cfg

# Auch MAC-Fallback aendern
docker exec linbo-rsync sed -i \
  '/bc:24:11:5c:25:09/,/boot/s/quiet splash/loglevel=7/' \
  /srv/linbo/boot/grub/grub.cfg

# Zurueck auf normal:
docker exec linbo-rsync sed -i 's/loglevel=7/quiet splash/g' \
  /srv/linbo/boot/grub/win11_pro.cfg
```

### GRUB Download pruefen (Web-Logs)

```bash
# GRUB laedt Kernel + Initrd via HTTP
docker logs linbo-web --tail 50 2>&1 | grep "10.0.150.2"

# Erwartete Eintraege:
# GET /linbo64 HTTP/1.1 200 15006088 "GRUB 2.12-1ubuntu7.3"
# GET /linbofs64 HTTP/1.1 200 165304360 "GRUB 2.12-1ubuntu7.3"
```

---

## 6. GRUB-Probleme und Loesungen

### Problem: Client bootet nicht via PXE

1. `core.efi` vorhanden?
   ```bash
   docker exec linbo-web ls -la /srv/linbo/boot/grub/x86_64-efi/core.efi
   ```
2. TFTP-Container laeuft?
   ```bash
   docker compose ps linbo-tftp
   ```
3. dnsmasq zeigt PXE-Boot?
   ```bash
   docker logs linbo-dhcp --tail 20 2>&1 | grep PXE
   ```

### Problem: GRUB zeigt "file not found"

1. linbo64 / linbofs64 vorhanden?
   ```bash
   docker exec linbo-web ls -la /srv/linbo/linbo64 /srv/linbo/linbofs64
   ```
2. Web-Container hat Zugriff?
   ```bash
   docker exec linbo-web cat /srv/linbo/linbo64 | wc -c
   ```

### Problem: Falsche Gruppe/Server

1. hostcfg Symlink pruefen (s.o.)
2. MAC-Fallback pruefen (s.o.)
3. Produktions-DHCP `extensions-path` und `nis-domain` pruefen

### Problem: GRUB Config geaendert aber Client bootet mit alter Config

GRUB cached die Config NICHT — beim naechsten PXE-Boot wird die neue
Config geladen. Wenn die Aenderung nicht wirkt:
1. Richtige Datei geaendert? (hostcfg Symlink folgen!)
2. Container hat Schreibzugriff? (linbo-rsync hat R/W, linbo-web nur R/O!)
3. Config-Syntax korrekt? (GRUB-Fehler auf Client-Bildschirm sichtbar)
