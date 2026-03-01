# 03 — DHCP & Netzwerk

## Ueberblick: Zwei DHCP-Server

In der Docker-Standalone-Umgebung gibt es **zwei DHCP-Server**:

| Server | Typ | IP | Rolle |
|--------|-----|-----|-------|
| Produktions-DHCP | ISC DHCP | 10.0.0.11 | IP-Vergabe, Hostname, Hostgroup (nis-domain) |
| Proxy-DHCP | dnsmasq | 10.0.0.13 | Nur PXE-Boot-Optionen (kein IP!) |

```
Client PXE Boot
    |
    +-- DHCP DISCOVER (broadcast) --------+
    |                                      |
    v                                      v
Produktions-DHCP (10.0.0.11)       Proxy-DHCP dnsmasq (10.0.0.13)
  - IP-Adresse (fixed-address)       - PXE Boot Filename
  - Hostname (host-name)             - TFTP Server (next-server)
  - Hostgroup (nis-domain)           - Vendor-Class: PXEClient
  - next-server 10.0.0.13
    |                                      |
    +---------- Client hat IP + PXE -------+
                       |
                       v
                TFTP → GRUB → HTTP → Kernel
                       |
                       v
                udhcpc (zweiter DHCP im Kernel)
                       |
                       v
                Produktions-DHCP antwortet erneut
                  - Gleiche IP
                  - Vendor-Class: udhcp 1.37.0
```

---

## 1. Proxy-DHCP (dnsmasq auf 10.0.0.13)

### Konfiguration

```bash
# Aktuelle dnsmasq-Konfiguration anzeigen
docker exec linbo-dhcp cat /etc/dnsmasq.d/linbo.conf
```

Wichtige Einstellungen:
```
port=0                    # Kein DNS (nur DHCP)
dhcp-range=10.0.0.0,proxy # Proxy-Modus (kein IP-Lease!)
log-dhcp                  # Logging aktiviert
interface=enp6s18         # Physisches Interface
bind-interfaces           # Nur auf diesem Interface

# PXE Boot Optionen
dhcp-boot=tag:efi64,boot/grub/x86_64-efi/core.efi,10.0.0.13
pxe-service=tag:efi64,x86-64_EFI,"LINBO PXE",boot/grub/x86_64-efi/core.efi,10.0.0.13
```

### Was Proxy-DHCP tut (und was nicht)

**TUT:**
- Antwortet auf PXE-DISCOVER mit Boot-Filename (core.efi)
- Setzt next-server auf 10.0.0.13 (TFTP)
- Loggt PXE-Anfragen mit Vendor-Class

**TUT NICHT:**
- Vergibt keine IP-Adressen (das macht Produktions-DHCP)
- Vergibt keinen Hostnamen
- Vergibt keine Hostgroup/nis-domain

### Diagnose

```bash
# PXE-Requests im Log
docker logs linbo-dhcp --tail 50 2>&1

# Auf bestimmte MAC filtern
docker logs linbo-dhcp 2>&1 | grep "bc:24:11:5c:25:09"

# Erwartete Log-Eintraege:
# dnsmasq-dhcp: PXE(enp6s18) bc:24:11:5c:25:09 PXEClient:Arch:00007:UNDI:003001
# dnsmasq-dhcp: vendor class: PXEClient:Arch:00007:UNDI:003001

# Spaetere Kernel-DHCP-Anfrage (nach init.sh network()):
docker logs linbo-dhcp 2>&1 | grep "udhcp" | tail -10
# → vendor class: udhcp 1.37.0
```

**WICHTIG:** Wenn `PXEClient` erscheint aber KEIN `udhcp 1.37.0`, hat der Kernel
die `network()`-Phase in init.sh nicht erreicht! → Siehe [04-kernel-module.md](./04-kernel-module.md)

---

## 2. Produktions-DHCP (ISC DHCP auf 10.0.0.11)

### Host-Konfiguration pruefen

```bash
# Via SSH-Hop (10.0.0.11 nur von 10.0.0.13 erreichbar)
ssh root@10.0.0.13 'ssh root@10.0.0.11 "grep -B2 -A10 \"vier\" /etc/dhcp/devices/default-school.conf"'
```

Beispiel-Konfiguration:
```
host vier {
    option host-name "vier";
    hardware ethernet BC:24:11:5C:25:09;
    fixed-address 10.0.150.2;
    option extensions-path "win11_pro";
    option nis-domain "win11_pro";
}
```

Wichtige Felder:
| Feld | Bedeutung | Wird genutzt von |
|------|-----------|-----------------|
| `host-name` | Hostname des Clients | init.sh → HOSTNAME |
| `hardware ethernet` | MAC-Adresse | DHCP Matching |
| `fixed-address` | Feste IP | IP-Konfiguration |
| `extensions-path` | GRUB-Gruppenname | GRUB (nicht init.sh!) |
| `nis-domain` | Hostgruppe | init.sh → HOSTGROUP |

### Globale Einstellungen

```bash
# next-server pruefen (muss auf Docker-Server zeigen)
ssh root@10.0.0.13 'ssh root@10.0.0.11 "grep next-server /etc/dhcp/dhcpd.conf"'
# Erwartet: next-server 10.0.0.13;
```

### DHCP-Logs pruefen

```bash
# Letzte 30 Minuten
ssh root@10.0.0.13 'ssh root@10.0.0.11 "journalctl -u isc-dhcp-server --since \"30 minutes ago\" --no-pager"'

# Fuer bestimmte MAC
ssh root@10.0.0.13 'ssh root@10.0.0.11 "journalctl -u isc-dhcp-server --since \"30 minutes ago\" --no-pager | grep bc:24:11:5c:25:09"'

# Erwartete Abfolge:
# DHCPDISCOVER from bc:24:11:5c:25:09 via 10.0.0.1
# DHCPOFFER on 10.0.150.2 to bc:24:11:5c:25:09
# DHCPREQUEST for 10.0.150.2 from bc:24:11:5c:25:09
# DHCPACK on 10.0.150.2 to bc:24:11:5c:25:09
```

**ACHTUNG Zeitzonen:** Produktionsserver ist CET (UTC+1), Docker-Container sind UTC!
Wenn Docker 14:30 UTC zeigt, ist es am Produktionsserver 15:30 CET.

---

## 3. udhcpc im Kernel (init.sh)

Nach dem Kernel-Boot nutzt init.sh `udhcpc` (busybox DHCP-Client) fuer die Netzwerk-Konfiguration.

### Ablauf in init.sh

```
network() {
    for dev in /proc/net/dev (Interfaces); do
        ip link set dev "$dev" up
        udhcpc -O nisdomain -n -i "$dev" -t $dhcpretry
        do_env()  →  parsed LINBOSERVER, HOSTGROUP, HOSTNAME
    done
    rsync $LINBOSERVER::linbo/start.conf.$HOSTGROUP /start.conf
    linbo_update_gui
}
```

### udhcpc Optionen

| Option | Wirkung |
|--------|---------|
| `-O nisdomain` | Fordert nis-domain Option an (fuer HOSTGROUP) |
| `-n` | Exit wenn kein Lease (keine Endlosschleife) |
| `-i "$dev"` | Interface |
| `-t $dhcpretry` | Anzahl Retries (Standard: 9, ca. 30 Sekunden) |

### udhcpc default.script

Das Callback-Script schreibt DHCP-Daten in `/tmp/dhcp.log`:
```bash
date >>/tmp/dhcp.log
set >>/tmp/dhcp.log
# Bei "bound": IP und Route konfigurieren
```

### Diagnose udhcpc-Probleme

1. **Kein `udhcp 1.37.0` im dnsmasq-Log:**
   → Kernel hat network() nie erreicht (Haenger in hwsetup/Plymouth)
   → Siehe [04-kernel-module.md](./04-kernel-module.md)

2. **udhcpc im Log aber kein rsync danach:**
   → do_env() hat LINBOSERVER/HOSTGROUP nicht korrekt gesetzt
   → Siehe [06-init-sh.md](./06-init-sh.md) (SERVERID-Guard)

3. **IP bekommen aber rsync schlaegt fehl:**
   → Firewall oder rsync-Container pruefen
   → `docker logs linbo-rsync --tail 30`

---

## 4. Netzwerk-Capture (tcpdump)

### Alle DHCP-Pakete

```bash
# Auf dem Server-Interface
tcpdump -i enp6s18 -nn "udp port 67 or udp port 68" -c 20

# Nur fuer bestimmte MAC
tcpdump -i enp6s18 -nn "ether host bc:24:11:5c:25:09 and (udp port 67 or udp port 68)" -c 5
```

**ACHTUNG:** DHCP-Responses sind oft Broadcast (`ff:ff:ff:ff:ff:ff`), daher
MAC-Filter ggf. weglassen!

### HTTP-Downloads (GRUB-Phase)

```bash
# GRUB laedt Kernel + Initrd via HTTP (Port 8080)
tcpdump -i enp6s18 -nn "tcp port 8080" -c 20
```

### rsync-Verbindungen

```bash
# rsync (Port 873)
tcpdump -i enp6s18 -nn "tcp port 873" -c 10
```

---

## 5. Haeufige DHCP-Probleme

### Problem: Client bekommt keine IP

1. Produktions-DHCP laeuft? → `ssh root@10.0.0.11 "systemctl status isc-dhcp-server"`
2. Client in DHCP-Konfig? → Host-Eintrag pruefen (s.o.)
3. Netzwerk-Verbindung? → `tcpdump` auf Broadcast pruefen
4. Subnetz korrekt? → Client muss im gleichen Subnetz oder DHCP-Relay konfiguriert

### Problem: PXE Boot funktioniert nicht

1. dnsmasq laeuft? → `docker compose ps linbo-dhcp`
2. Host-Netzwerk? → DHCP-Container muss `network_mode: host` haben
3. Interface korrekt? → `interface=enp6s18` in dnsmasq.conf
4. Port-Konflikt? → Kein anderer DHCP-Server auf 10.0.0.13 Port 67

### Problem: Zwei DHCP-Antworten, Client verwirrt

Ist normal! Client verarbeitet:
- Produktions-DHCP: IP + Options
- Proxy-DHCP: PXE Boot Filename

Beide zusammen ergeben die vollstaendige Boot-Konfiguration.
