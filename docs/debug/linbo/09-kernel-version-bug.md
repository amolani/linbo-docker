# 09 — Kernel-Version-Bug (Session 19, 2026-03-01)

## TL;DR

Der Docker-Host (10.0.0.13) lief mit Kernel **6.8.0-64-generic**, obwohl
**6.8.0-101-generic** bereits installiert war (Server wurde nie rebootet).
Der alte Kernel hat einen Bug der verhindert, dass virtio-net auf QEMU/KVM
VMs funktioniert. Zwei Tage Debug-Zeit.

**Fix:** Docker-Host rebooten → neuer Kernel → linbofs64 neu bauen.

---

## Zeitleiste des Debugging

| Zeitpunkt | Erkenntnis |
|-----------|-----------|
| Session 18 | linbofs64 mit Host-Kernel-Modulen (6.8.0-64) neu gebaut |
| Session 19, Start | Client zeigt "Remote Control Mode" |
| +1h | dnsmasq zeigt KEIN `udhcp 1.37.0` → Kernel erreicht network() nie |
| +2h | Alle Container-Logs leer → **falscher Server** (wir waren auf 10.0.0.11!) |
| +2.5h | Docker-Volume vs Host-Filesystem entdeckt: Container nutzen Volume-Pfad |
| +3h | Debug-Patch in init.sh → Client nicht erreichbar (kein Netzwerk) |
| +3.5h | Produktions-Boot-Dateien (6.8.0-94) auf Docker-Server kopiert → **CLIENT BOOTET!** |
| +4h | Root Cause: Kernel 6.8.0-64 hat Bug, 6.8.0-94 funktioniert |
| +4h | Docker-Host hat 6.8.0-101 installiert aber nie rebootet |

---

## Root Cause: Kernel 6.8.0-64-generic Bug

### Betroffene Konfiguration

```
Client VM: QEMU Q35 + ICH9, Proxmox, KVM
  - NIC: virtio-net [1af4:1000] auf PCI 0000:06:12.0
  - MAC: BC:24:11:5C:25:09
  - RAM: 8 GB

Docker-Host (10.0.0.13): Proxmox VM
  - Kernel laufend:    6.8.0-64-generic (Ubuntu 6.8.0-64.67, ~Juni 2025)
  - Kernel installiert: 6.8.0-101-generic (Ubuntu 6.8.0-101.101, ~Feb 2026)
  - Server NICHT rebootet nach Kernel-Update!

Produktionsserver (10.0.0.11):
  - Kernel: 6.8.0-94-generic (Ubuntu 6.8.0-94.96, ~Jan 2026)
  - FUNKTIONIERT mit dem gleichen Client
```

### Symptom

1. GRUB laedt linbo64 + linbofs64 erfolgreich via HTTP (bestaetigt durch Web-Logs)
2. Kernel bootet (init.sh laeuft durch bis exit 0)
3. **KEIN `udhcp 1.37.0` im dnsmasq-Log** → network() findet keine Interfaces
4. **KEIN rsync** → kein start.conf → kein GUI → "Remote Control Mode"
5. Client per Ping/SSH nicht erreichbar (kein Netzwerk)

### Beweis

```
# Kernel 6.8.0-64-generic (Docker-Host)
# → dnsmasq-Log: NUR PXEClient, KEIN udhcp 1.37.0
# → Client: "Remote Control Mode"

# Kernel 6.8.0-94-generic (Produktion, gleiche linbofs64-Basis)
# → dnsmasq-Log: PXEClient UND udhcp 1.37.0 ✓
# → Client: Qt GUI mit OS-Auswahl ✓
```

### Kernel-Config Vergleich

Beide Kernel haben **identische** virtio-Konfiguration:
```
CONFIG_VIRTIO_NET=y       # BUILTIN (kein Modul noetig!)
CONFIG_VIRTIO_PCI=y       # BUILTIN
CONFIG_VIRTIO_PCI_LEGACY=y
CONFIG_VIRTIO=y
CONFIG_BLK_MQ_VIRTIO=y
CONFIG_SCSI_VIRTIO=y
CONFIG_VIRTIO_BLK=y
CONFIG_VIRTIO_BALLOON=y
```

Der einzige Config-Unterschied im Netzwerk-Bereich:
```
# In 6.8.0-64, nicht in 6.8.0-94:
CONFIG_NET_VENDOR_CIRRUS=y  # Irrelevant (Cirrus Logic NICs)
```

### Schlussfolgerung

Da die Konfiguration identisch ist und virtio_net BUILTIN ist, liegt der Fehler
im **Kernel-Code** selbst. Zwischen 6.8.0-64.67 und 6.8.0-94.96 liegen
30 Ubuntu-Patchlevel-Releases mit hunderten Bugfixes. Ein Fix in der
virtio-PCI-Initialisierung, dem PCI-Subsystem oder der ACPI-Erkennung
behebt das Problem.

---

## Warum hat das so lange gedauert?

### Falle 1: Falscher Server (2h verloren)

Die Diagnose lief auf 10.0.0.11 (Produktionsserver), aber die Docker-Container
fuer den Client liefen auf 10.0.0.13 (Testserver). Beide haben Docker
installiert, aber verschiedene Container-Sets:

| Server | IP | Container | DHCP |
|--------|------|-----------|------|
| Produktion | 10.0.0.11 | 7 Container (ohne dhcp) | ISC dhcpd (nativ) |
| Testserver | 10.0.0.13 | 8 Container (mit dhcp) | dnsmasq (Docker) |

**Lesson Learned:** Immer zuerst `hostname` und `ip addr` pruefen!

### Falle 2: Docker-Volume vs Host-Pfad (1h verloren)

Container nutzen das Docker-Volume:
```
/var/lib/docker/volumes/linbo_srv_data/_data/  ← Container sehen DAS
/srv/linbo/                                     ← Host-Filesystem (NICHT identisch!)
```

Wir haben linbofs64 nach `/srv/linbo/` geschrieben, aber der Web-Container
serviert aus dem Docker-Volume. Der Client bekam die alte Datei.

**Lesson Learned:** Immer `docker exec linbo-web stat /srv/linbo/linbofs64`
nutzen um die Container-Sicht zu pruefen!

### Falle 3: Rebuild waehrend Download (30min verloren)

Waehrend wir linbofs64 neu packten, hat der Client die halb-geschriebene
Datei heruntergeladen (0 bytes). GRUB steckte danach in einer Retry-Schleife.

```
16:37:18 GET /linbofs64 → 200, 0 bytes ← KAPUTT
16:37:20 GET /linbo64  → retry...
16:38:30 GET /linbo64  → retry...
```

**Lesson Learned:** Erst in temporaere Datei packen, dann atomar umbenennen!

### Falle 4: Kernel-Version nicht geprueft (Grundursache)

Der Docker-Host (10.0.0.13) hatte Kernel 6.8.0-64-generic laufend, obwohl
6.8.0-101-generic bereits installiert war. Der Server wurde nach dem
Kernel-Update nie rebootet.

**Lesson Learned:** Nach `apt upgrade` mit Kernel-Update MUSS ein Reboot
erfolgen, BESONDERS wenn der Host-Kernel fuer PXE-Boot-Clients verwendet wird!

---

## Client-Hardware-Details (fuer Referenz)

Ermittelt via SSH (Port 2222) auf den laufenden Client:

```bash
# Plattform
DMI: QEMU Standard PC (Q35 + ICH9, 2009)
Hypervisor: KVM
EFI: Proxmox distribution of EDK II

# Netzwerk
Interface: eth0
Driver: virtio_net (version 1.0.0)
Bus-Info: 0000:06:12.0
Vendor: 0x1af4 (Red Hat / Virtio)
Device: 0x0001 (virtio-net)
MAC: bc:24:11:5c:25:09

# PCI-Geraete (Virtio)
0000:06:03.0 [1af4:1002] — virtio-balloon
0000:06:12.0 [1af4:1000] — virtio-net (Netzwerk)
0000:07:1d.0 [1af4:1005] — virtio-rng
```

---

## Permanenter Fix

### Schritt 1: Docker-Host rebooten

```bash
ssh root@10.0.0.13 "reboot"
# Wartet auf Kernel 6.8.0-101-generic (oder neuer)
# Verifizieren:
ssh root@10.0.0.13 "uname -r"
# Erwartet: 6.8.0-101-generic
```

### Schritt 2: linbofs64 mit neuem Kernel neu bauen

```bash
ssh root@10.0.0.13 'docker exec -e USE_HOST_KERNEL=true -e SKIP_KERNEL_COPY=true \
  linbo-api bash /usr/share/linuxmuster/linbo/update-linbofs.sh'
# Danach Host-Kernel zurueckkopieren:
ssh root@10.0.0.13 'docker exec linbo-api cp /boot/vmlinuz-$(uname -r) /srv/linbo/linbo64'
```

### Schritt 3: Verifizieren

```bash
# Kernel-Version
ssh root@10.0.0.13 'uname -r'
# Module im Initrd
ssh root@10.0.0.13 'docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -t 2>/dev/null | grep lib/modules/ | head -1"'
# SERVERID-Guard
ssh root@10.0.0.13 'docker exec linbo-api sh -c \
  "xz -dc /srv/linbo/linbofs64 | cpio -i --to-stdout init.sh 2>/dev/null | grep -n SERVERID"'
```

---

## Praevention

### 1. Kernel-Version-Check in entrypoint.sh

Pruefen ob der laufende Kernel "zu alt" ist (konfigurierbare Mindestversion).

### 2. Monitoring: Kernel-Version nach apt upgrade

```bash
# Pruefen ob Reboot noetig
if [ "$(uname -r)" != "$(ls -t /boot/vmlinuz-* | head -1 | sed 's|/boot/vmlinuz-||')" ]; then
    echo "WARNING: Kernel-Update installiert aber nicht aktiv! Reboot noetig!"
fi
```

### 3. Docker-Volume Pfade dokumentieren

Alle Schreib-Operationen MUESSEN ueber den Docker-Volume-Pfad gehen:
```bash
# RICHTIG:
/var/lib/docker/volumes/linbo_srv_data/_data/linbofs64

# ODER via Container:
docker exec linbo-api cp /tmp/linbofs64 /srv/linbo/linbofs64

# FALSCH (Host-Pfad, Container sieht das nicht):
/srv/linbo/linbofs64
```

### 4. Atomares Deployment

Nie direkt in die Live-Datei schreiben. Stattdessen:
```bash
# In temporaere Datei packen
xz ... > /tmp/linbofs64.new
# Atomar umbenennen
mv /tmp/linbofs64.new /var/lib/docker/volumes/linbo_srv_data/_data/linbofs64
```
