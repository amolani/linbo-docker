# 01 — Boot-Kette (PXE → Qt GUI)

## Gesamtablauf

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Phase 1: PXE/DHCP                                                     │
│                                                                       │
│  Client UEFI/BIOS                                                     │
│    │                                                                  │
│    ├─ DHCP DISCOVER (broadcast)                                       │
│    │    ├─ Produktions-DHCP (10.0.0.11) → IP + next-server            │
│    │    └─ Proxy-DHCP dnsmasq (10.0.0.13) → PXE Boot-Optionen        │
│    │                                                                  │
│    ├─ TFTP: boot/grub/x86_64-efi/core.efi                            │
│    └─ GRUB startet (eigener Netzwerk-Stack)                           │
├─────────────────────────────────────────────────────────────────────────┤
│ Phase 2: GRUB                                                         │
│                                                                       │
│  GRUB laedt Konfiguration:                                            │
│    1. grub.cfg: Sucht hostcfg/<hostname>.cfg (Symlink → Gruppe.cfg)   │
│    2. Fallback: MAC-basierte Zuordnung in grub.cfg                    │
│    3. Setzt: server=, group=, hostgroup=, dhcpretry= auf Cmdline      │
│                                                                       │
│  GRUB laedt via HTTP (Port 8080):                                     │
│    ├─ linbo64      (~15 MB, Kernel)                                   │
│    └─ linbofs64    (~165 MB, Initrd, XZ-komprimiertes CPIO)           │
├─────────────────────────────────────────────────────────────────────────┤
│ Phase 3: Kernel-Boot                                                   │
│                                                                       │
│  Linux-Kernel (linbo64) startet                                       │
│    ├─ GRUB-Netzwerk-Stack ist WEG (komplett neuer Start)              │
│    ├─ Entpackt Initrd (linbofs64, ~250 MB unkomprimiert)              │
│    ├─ Startet busybox init (/init → /bin/busybox)                     │
│    └─ Liest /etc/inittab:                                             │
│         ::sysinit:/init.sh                                            │
│         ::respawn:/linbo.sh                                           │
│         ::wait:/usr/bin/linbo_vnc onboot                              │
├─────────────────────────────────────────────────────────────────────────┤
│ Phase 4: init.sh                                                       │
│                                                                       │
│  init_setup()                                                         │
│    ├─ mount /proc, /sys, /dev                                         │
│    ├─ Lade Module aus /etc/modules (fan, thermal, nbd, ntfs3, uinput) │
│    └─ Keyboard-Layout laden                                           │
│                                                                       │
│  hwsetup()                                                            │
│    ├─ udevd --daemon                                                  │
│    ├─ udevadm trigger --type=all --action=add                         │
│    ├─ udevadm settle  (WARTET auf alle udev-Events)                   │
│    └─ linbo_link_blkdev                                               │
│                                                                       │
│  Plymouth (wenn "splash" auf Cmdline)                                 │
│    ├─ plymouthd --mode=boot                                          │
│    └─ plymouth --show-splash                                          │
│                                                                       │
│  network()                                                            │
│    ├─ Iteriert alle Interfaces aus /proc/net/dev                      │
│    ├─ ip link set dev "$dev" up                                       │
│    ├─ udhcpc -O nisdomain -n -i "$dev" -t $dhcpretry                 │
│    ├─ do_env() → parsed /proc/cmdline + /tmp/dhcp.log                 │
│    │    ├─ server= → LINBOSERVER (wenn SERVERID-Guard OK)             │
│    │    ├─ nisdomain= → HOSTGROUP                                     │
│    │    └─ hostname= → HOSTNAME                                       │
│    ├─ rsync $LINBOSERVER::linbo/start.conf.$HOSTGROUP /start.conf     │
│    └─ linbo_update_gui (download linbo_gui64_7.tar.lz)                │
├─────────────────────────────────────────────────────────────────────────┤
│ Phase 5: LINBO GUI                                                     │
│                                                                       │
│  linbo.sh (respawn aus inittab)                                       │
│    ├─ Wenn /usr/bin/linbo_gui existiert → Qt GUI (OS-Auswahl)         │
│    └─ Wenn NICHT → "Remote Control Mode"                              │
└─────────────────────────────────────────────────────────────────────────┘
```

## Zeitlicher Ablauf (Referenzwerte)

| Phase | Dauer (normal) | Dauer (langsam) | Woran erkennbar |
|-------|---------------|-----------------|-----------------|
| PXE DHCP | < 5s | < 10s | dnsmasq-Log: "vendor class: PXEClient" |
| GRUB Download linbo64 | ~2s | ~10s | Web-Log: GET /linbo64 200 |
| GRUB Download linbofs64 | ~10s | ~30s | Web-Log: GET /linbofs64 200 |
| Kernel-Boot + init_setup | ~5s | ~30s | Kein externer Indikator |
| hwsetup (udevadm settle) | ~5s | **Minuten!** | Kein externer Indikator |
| Plymouth | ~1s | **Haengt!** | Kein externer Indikator |
| udhcpc DHCP | ~3s | ~30s (9 retries) | dnsmasq-Log: "vendor class: udhcp 1.37.0" |
| rsync start.conf | ~1s | ~5s | rsync-Log |
| GUI Download | ~3s | ~30s | rsync-Log |

**Gesamtzeit PXE → GUI:** ca. 30-60 Sekunden (optimal), 2-5 Minuten (langsam)

## Wichtige Dateien im Initrd (linbofs64)

| Datei | Beschreibung |
|-------|-------------|
| `/init` | Symlink → /bin/busybox |
| `/etc/inittab` | sysinit:/init.sh, respawn:/linbo.sh |
| `/init.sh` | Hauptskript (init_setup, hwsetup, network) |
| `/linbo.sh` | LINBO-Hauptloop (GUI oder Remote Control) |
| `/etc/modules` | Module die explizit geladen werden |
| `/lib/modules/<kver>/` | Alle verfuegbaren Kernel-Module |
| `/sbin/udhcpc` | DHCP-Client |
| `/usr/share/udhcpc/default.script` | udhcpc Callback → schreibt /tmp/dhcp.log |
| `/etc/linbo_pwhash` | Rsync-Passwort-Hash |
| `/.ssh/authorized_keys` | SSH-Keys fuer Server→Client Zugriff |

## Kernel-Cmdline Parameter (von GRUB gesetzt)

| Parameter | Beispiel | Wirkung in init.sh |
|-----------|---------|-------------------|
| `server=` | `10.0.0.13` | → LINBOSERVER (wenn SERVERID-Guard) |
| `group=` | `win11_pro` | → GROUP |
| `hostgroup=` | `win11_pro` | → HOSTGROUP |
| `dhcpretry=` | `9` | Anzahl udhcpc Retries |
| `quiet` | - | Unterdrueckt Kernel-Meldungen |
| `splash` | - | Aktiviert Plymouth Splash-Screen |
| `noefibootmgr` | - | Deaktiviert EFI Boot Manager |
| `netboot` / `localboot` | - | GRUB setzt je nach Bootquelle |
