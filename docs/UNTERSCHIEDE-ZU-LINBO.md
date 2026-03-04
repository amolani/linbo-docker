# Unterschiede zwischen LINBO Docker und Vanilla-LINBO (linuxmuster-linbo7)

Dieses Dokument beschreibt alle Abweichungen, Erweiterungen und Patches, die LINBO Docker gegenueber dem Original-LINBO-Paket (`linuxmuster-linbo7`) einfuehrt. Es richtet sich an Administratoren, Entwickler und alle, die verstehen wollen, was LINBO Docker anders macht — und warum.

> **Lesehinweis:** "Vanilla-LINBO" meint das unmodifizierte `linuxmuster-linbo7`-Paket, wie es im Rahmen von linuxmuster.net 7.x installiert wird. "LINBO Docker" meint die standalone Docker-Loesung in diesem Repository.

---

## Inhaltsverzeichnis

1. [Uebersicht](#1-uebersicht)
- [Was ist LINBO?](#was-ist-linbo)
2. [Docker-exklusive Features](#2-docker-exklusive-features)
   - [2.1 Patchclass — Automatische Windows-Treiber-Installation](#21-patchclass--automatische-windows-treiber-installation)
   - [2.2 Firmware Auto-Detection](#22-firmware-auto-detection)
   - [2.3 Kernel Switching und Host-Kernel-Schutz](#23-kernel-switching-und-host-kernel-schutz)
   - [2.4 Web Terminal (xterm.js)](#24-web-terminal-xtermjs)
   - [2.5 GRUB Theme Customization](#25-grub-theme-customization)
   - [2.6 React Frontend (16 Seiten)](#26-react-frontend-16-seiten)
   - [2.7 Sync-Modus (Authority API Integration)](#27-sync-modus-authority-api-integration)
3. [Infrastruktur-Verbesserungen](#3-infrastruktur-verbesserungen)
   - [3.1 Auto-Key-Provisioning](#31-auto-key-provisioning)
   - [3.2 TFTP Race Condition Fix](#32-tftp-race-condition-fix)
4. [Die 9 Boot-Patches (linbofs64)](#4-die-9-boot-patches-linbofs64)
   - [4.1 Warum Patches noetig sind](#41-warum-patches-noetig-sind)
   - [4.2 Patch-Uebersicht](#42-patch-uebersicht)
   - [4.3 Patch 1 — SERVERID_GUARD](#43-patch-1--serverid_guard)
   - [4.4 Patch 2 — DHCP_FALLBACK](#44-patch-2--dhcp_fallback)
   - [4.5 Patch 3 — NET_DIAG](#45-patch-3--net_diag)
   - [4.6 Patch 4 — IFACE_WAIT](#46-patch-4--iface_wait)
   - [4.7 Patch 5 — NET_RECOVERY](#47-patch-5--net_recovery)
   - [4.8 Patch 6 — STORAGE_MODULES](#48-patch-6--storage_modules)
   - [4.9 Patch 7 — UDEV_INPUT](#49-patch-7--udev_input)
   - [4.10 Patch 8 — DEVPTS_MOUNT](#410-patch-8--devpts_mount)
   - [4.11 Patch 9 — BLKDEV_COMPAT](#411-patch-9--blkdev_compat)
5. [Modifizierte Vanilla-Dateien](#5-modifizierte-vanilla-dateien)
6. [Zusammenfassung](#6-zusammenfassung)

---

## 1. Uebersicht

| Feature | Vanilla-LINBO | LINBO Docker | Kategorie |
|---------|--------------|-------------|-----------|
| Patchclass (Windows-Treiber) | Nicht vorhanden | DMI + PCI/USB Matching, automatische Installation | Neues Feature |
| Firmware Auto-Detection | Statische Liste | SSH-Scan von Clients, automatische Injection | Neues Feature |
| Kernel Switching | Fester Kernel | 3-Schicht-Schutz + stable/longterm/legacy Varianten | Neues Feature |
| Web Terminal (xterm.js) | Nur CLI (`linbo-ssh`) | Browser-Terminal mit Tab-System | Neues Feature |
| GRUB Theme UI | Manuelle Konfiguration | Web-basierter Editor | Neues Feature |
| React Frontend | PHP webui7 | 16 Seiten, Dark Theme, WebSocket-Live-Updates | Neues Feature |
| Sync-Modus (Authority API) | Nicht vorhanden | Read-Only Delta-Feed von LMN Authority | Neues Feature |
| Auto-Key-Provisioning | Manuelle Installation | Automatische Generierung beim Container-Start | Infrastruktur |
| TFTP Race Condition Fix | N/A | Marker-basiertes Warten auf gepatchtes linbofs64 | Infrastruktur |
| 9 Docker-Patches in linbofs64 | N/A (nicht noetig) | Kritisch fuer Betrieb in Docker/KVM-Umgebungen | Boot-Patches |

---

## Was ist LINBO?

LINBO (**Li**nux **N**etwork **Bo**ot) ist das Netzwerk-Boot- und Imaging-System von [linuxmuster.net](https://linuxmuster.net). Es ermoeglicht, Hunderte von Clients gleichzeitig ueber das Netzwerk zu booten, mit Betriebssystem-Images zu bespielen und fernzusteuern.

### Boot-Kette

```
┌──────────┐   DHCP    ┌──────────┐   TFTP    ┌──────────┐
│  Client   │ ───────> │   DHCP   │ ───────> │   GRUB   │
│  PXE/UEFI │ <─ next- │  Server  │          │ Bootldr  │
└──────────┘  server   └──────────┘          └────┬─────┘
                                                   │
                       ┌───────────────────────────┘
                       │  GRUB laedt:
                       │  1. grub.cfg (TFTP, ~10KB)
                       │  2. <gruppe>.cfg (TFTP)
                       │  3. linbo64 (HTTP, 15MB Kernel)
                       │  4. linbofs64 (HTTP, 160MB Initramfs)
                       ▼
              ┌──────────────────┐
              │  Linux Kernel    │
              │  (linbo64)       │
              │       │          │
              │  Initramfs       │
              │  (linbofs64)     │
              │       │          │
              │  init.sh         │
              │  ├── hwsetup()   │  Treiber laden
              │  ├── network()   │  DHCP, IP, Server finden
              │  ├── dropbear    │  SSH-Daemon starten
              │  └── rsync       │  start.conf herunterladen
              │       │          │
              │  linbo.sh        │
              │  ├── udevd       │  Input-Devices erkennen
              │  └── linbo_gui   │  Qt-GUI starten
              └──────────────────┘
                       │
                  Nutzer waehlt Aktion
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
           Start     Sync      Neu
          (Boot)   (Image    (Format +
                   laden)    Sync + Boot)
```

### Kernsystem — Was LINBO auf dem Client macht

LINBO laeuft **komplett im RAM**. Es schreibt nichts auf die Festplatte des Clients, bis explizit ein Befehl (Sync, Format, Start) ausgefuehrt wird.

**init.sh** — Erster Userspace-Prozess nach Kernel-Boot:
- `hwsetup()` — Storage- und Netzwerk-Treiber laden, `/dev`-Symlinks erstellen
- `network()` — DHCP ausfuehren, Server-IP ermitteln, `/.env` mit Variablen schreiben
- dropbear SSH-Daemon starten (Port 2222)
- start.conf per rsync vom Server herunterladen

**linbo.sh** — GUI-Umgebung starten:
- linbo_gui-Bundle vom Server laden (falls nicht im Cache)
- udevd fuer Input-Device-Erkennung starten
- `linbo_gui` Qt-Anwendung starten (Framebuffer, kein X11)

**linbo_gui** — Qt6 GUI-Anwendung (23 MB, statisch gelinkt):
- Liest `/start.conf` und zeigt fuer jedes `[OS]` eine Karte mit Buttons
- **Start** — OS direkt booten (Chainload EFI/MBR)
- **Sync** — Image per rsync herunterladen und auf Partition schreiben
- **Neu** — Partition formatieren, Image herunterladen, booten
- Glassmorphism-Design mit Gradient-Hintergrund (Navy → Teal)

### start.conf — Konfigurationsdatei

Jeder Client erhaelt eine `start.conf`, die sein Boot-Verhalten steuert:

```ini
[LINBO]                          # Globale Einstellungen
Server = 10.0.0.13               # LINBO-Server-IP
Group = win11_pro                # Gruppe (bestimmt GRUB-Menue)
Cache = /dev/disk0p4             # Cache-Partition fuer Images
SystemType = efi64               # BIOS oder UEFI
KernelOptions = ...              # Kernel-Parameter

[Partition]                       # Partitionsdefinition
Dev = /dev/disk0p1
Label = efi
Size = 200M
Id = ef
FSType = vfat
Bootable = yes

[Partition]
Dev = /dev/disk0p3
Label = windows
Size = 70G
FSType = ntfs

[OS]                              # Betriebssystem-Definition
Name = Windows 11
BaseImage = win11_pro_edu.qcow2  # QCOW2-Image auf dem Server
Boot = /dev/disk0p3               # Boot-Partition
StartEnabled = yes                # "Start"-Button anzeigen
SyncEnabled = yes                 # "Sync"-Button anzeigen
NewEnabled = yes                  # "Neu"-Button anzeigen
DefaultAction = sync              # Standard-Aktion
```

**Dateipfade auf dem Server:**
- `/srv/linbo/start.conf.<gruppe>` — Pro Gruppe
- `/srv/linbo/start.conf-<ip>` — Symlink zur Gruppen-Datei

### Imaging-Pipeline

LINBO nutzt **QCOW2** (QEMU Copy-On-Write) als Image-Format:

```
/srv/linbo/images/
├── win11_pro_edu/
│   ├── win11_pro_edu.qcow2          # Komprimiertes Disk-Image
│   ├── win11_pro_edu.qcow2.md5      # Hash-Verifikation
│   └── win11_pro_edu.postsync       # Post-Sync-Script (optional)
```

**Sync-Ablauf:**
1. Client → rsync verbindet sich zum Server (`::linbo/images/...`)
2. Server sendet komprimiertes QCOW2-Image
3. Client schreibt Image direkt auf Partition (`/dev/disk0p3`)
4. MD5-Verifikation
5. Falls vorhanden: Postsync-Script ausfuehren (z.B. Treiber installieren)

**Postsync-Scripte** — Shell-Scripte, die nach dem Image-Sync auf dem Client laufen. Sie koennen die Windows-Partition mounten und Dateien aendern (Registry, Treiber, Konfiguration). Dies ist der Einstiegspunkt fuer das Patchclass-Feature.

### Remote Control (linbo-remote / SSH)

Der Server kann Befehle an LINBO-Clients senden:

```bash
# Vom Server aus:
linbo-remote -c "sync:1,start:1" 10.0.150.100

# Oder per linbocmd auf der GRUB-Kommandozeile:
linux /linbo64 server=10.0.0.13 linbocmd=sync:1,start:1
```

**Verfuegbare Befehle:**
| Befehl | Aktion |
|--------|--------|
| `start:<n>` | OS auf Partition n booten |
| `sync:<n>` | Image herunterladen und auf Partition n schreiben |
| `format:<n>` | Partition n formatieren |
| `partition` | Partitionstabelle neu schreiben |
| `initcache` | Cache initialisieren |
| `create_image:<n>` | Image von Partition n erstellen |
| `reboot` | Client neustarten |
| `halt` | Client herunterfahren |

Diese Befehle koennen verkettet werden: `format:3,sync:1,start:1` = formatieren, dann syncen, dann booten.

### GRUB-Konfiguration

LINBO nutzt GRUB als Bootloader mit dynamisch generierten Menueintraegen:

```
/srv/linbo/boot/grub/
├── grub.cfg                  # Hauptkonfiguration
├── win11_pro.cfg             # Gruppen-Menue
│   ├── menuentry 'LINBO'                    # LINBO-GUI starten
│   ├── menuentry 'Windows 11 (Start)'       # Direkt booten
│   ├── menuentry 'Windows 11 (Sync+Start)'  # Sync dann Boot
│   └── menuentry 'Windows 11 (Neu+Start)'   # Format+Sync+Boot
├── themes/linbo/             # Boot-Theme
└── x86_64-efi/               # UEFI-Module
```

**HTTP-Boot:** GRUB selbst wird per TFTP geladen (~10 KB). Der Kernel (15 MB) und das Initramfs (160 MB) werden per HTTP geladen — **5-10x schneller** als reines TFTP.

### rsync-Module

```ini
[linbo]                      # Read-Only: Images + Configs
path = /srv/linbo
read only = yes

[linbo-upload]               # Authentifiziert: Image-Upload
path = /srv/linbo
read only = no
auth users = linbo

[drivers]                    # Docker-exklusiv: Patchclass-Treiber
path = /var/lib/linbo/drivers
read only = yes
```

### SSH-Schluessel-Architektur

```
Server:
├── ssh_host_rsa_key           # OpenSSH Host-Key (Server-Identitaet)
├── dropbear_rsa_host_key      # Dropbear Host-Key (in linbofs64 injiziert)
├── linbo_client_key           # Private Key fuer Server → Client SSH
└── server_id_rsa.pub          # Public Key (in linbofs64 authorized_keys)

Client (in linbofs64):
├── /etc/dropbear/dropbear_rsa_host_key  # Client-SSH-Daemon
└── /.ssh/authorized_keys                # Erlaubt Server-Zugriff
```

---

## 2. Docker-exklusive Features

### 2.1 Patchclass — Automatische Windows-Treiber-Installation

**Was es macht:**
Ein vollstaendiges Pipeline-System fuer die automatische Erkennung und Installation von Windows-Treibern basierend auf der Hardware-Identifikation des Clients. Die Pipeline funktioniert wie folgt:

1. Der Administrator definiert eine **Patchclass** (z.B. `win11_standard`) und erstellt darin **Driver-Sets** (z.B. `Lenovo_L16`, `Dell_OptiPlex`)
2. In der `driver-map.json` werden **DMI-Matching-Rules** definiert, die Hardware-Modelle auf Driver-Sets abbilden
3. Die API generiert automatisch eine `driver-rules.sh` mit `case`-Statements fuer Vendor/Product-Matching
4. Ein **Postsync-Script** (`00-match-drivers.sh`) wird auf das QCOW2-Image deployed

Beim Client-Boot laeuft folgende Kette:
```
Client bootet -> DMI aus /sys/class/dmi/id/ lesen
  -> match_drivers() in driver-rules.sh
  -> rsync nur passende Driver-Sets vom Server (::drivers Modul)
  -> Kopie nach /mnt/Drivers/LINBO/
  -> Windows RunOnce Registry-Eintrag
  -> pnputil /add-driver installiert bei naechstem Windows-Start
```

Zusaetzliche Funktionen:
- **PCI/USB-ID-Matching** (`match_device_drivers()`): Erkennung ueber Hardware-IDs (4-stellig Hex), nicht nur DMI
- **Manifest-Hashing**: Nur geaenderte Driver-Sets werden synchronisiert (MD5-basiert)
- **Archiv-Extraktion**: ZIP, 7z und Inno-Setup-EXE werden serverseitig entpackt mit Security-Checks (Path-Traversal, Groessenlimits, Symlink-Entfernung)

**Warum es noetig war:**
In Schulnetzwerken mit heterogener Hardware (verschiedene Lenovo-, Dell-, HP-Modelle) fehlen nach einem Windows-Image-Sync regelmaessig Treiber fuer NIC, GPU oder Storage-Controller. Jedes neue Hardware-Modell erforderte bisher manuellen Eingriff — entweder im Image selbst oder ueber statische Postsync-Scripte.

**Was Vanilla-LINBO stattdessen macht:**
Kein automatischer Treiber-Mechanismus. Treiber muessen entweder direkt ins Master-Image integriert oder ueber manuell geschriebene Postsync-Scripte nachinstalliert werden. Es gibt keine DMI-basierte Hardware-Erkennung und kein Driver-Set-Konzept.

**Auswirkung wenn fehlend:**
Windows-Clients haben nach einem Sync fehlende NIC/GPU/Storage-Treiber. Insbesondere NIC-Treiber sind kritisch, da ohne Netzwerk kein Remote-Management moeglich ist. Jedes neue Hardware-Modell erfordert manuellen Eingriff ins Image.

---

### 2.2 Firmware Auto-Detection

**Was es macht:**
Erkennung fehlender Linux-Firmware durch SSH-Scan von laufenden LINBO-Clients:

1. API verbindet sich per SSH (Port 2222) zu einem laufenden Client
2. Liest PCI-Devices (`/sys/bus/pci/devices/`) und USB-Devices (`/sys/bus/usb/devices/`)
3. Vergleicht mit dem Firmware-Katalog auf dem Server (`/lib/firmware/`)
4. Identifiziert fehlende Firmware-Dateien (WLAN: iwlwifi, rtl8xxx; Bluetooth; Storage-Controller)
5. Fehlende Firmware wird in einer Konfigurationsdatei vermerkt
6. Beim naechsten `update-linbofs` Rebuild werden die Firmware-Dateien in das linbofs64-Initramfs injiziert

Das Firmware-Injection-System im `update-linbofs.sh` unterstuetzt:
- Automatische `.zst`-Dekompression (zstd-komprimierte Firmware)
- Symlink-Verfolgung innerhalb `/lib/firmware/` (aber Schutz gegen Symlinks ausserhalb)
- Path-Traversal-Schutz
- CRLF-Kompatibilitaet in der Konfigurationsdatei

**Warum es noetig war:**
Moderne Hardware (insbesondere Intel WLAN-Chips wie iwlwifi und Realtek USB-WLAN) benoetigt Firmware-Blobs, die nicht im Standard-linbofs64 enthalten sind. Ohne die passende Firmware kann der LINBO-Client kein WLAN nutzen, Bluetooth ist nicht verfuegbar, und manche NVMe-Controller funktionieren nicht.

**Was Vanilla-LINBO stattdessen macht:**
Statische Firmware-Liste, die mit dem Paket ausgeliefert wird. Keine automatische Hardware-Erkennung, kein SSH-Scan. Fehlende Firmware muss manuell identifiziert und in `/etc/linuxmuster/linbo/firmware` eingetragen werden.

**Auswirkung wenn fehlend:**
WLAN-Clients koennen sich nicht mit dem Netzwerk verbinden. Bluetooth-Peripherie funktioniert nicht. Bei manchen Laptops (insbesondere mit NVMe-Only-Storage) kann das Betriebssystem nicht gestartet werden.

---

### 2.3 Kernel Switching und Host-Kernel-Schutz

**Was es macht:**
Ein dreischichtiges Schutzsystem, das sicherstellt, dass LINBO-Clients immer mit einem Kernel booten, der ausreichend Hardware-Unterstuetzung bietet:

**Schicht 1 — Container-Entrypoint:**
Beim Start des API-Containers wird automatisch geprueft, ob der Host-Kernel (`/boot/vmlinuz`) noch mit dem Kernel in `/srv/linbo/linbo64` uebereinstimmt. Bei Abweichung wird der Host-Kernel zurueckkopiert.

**Schicht 2 — update-linbofs.sh:**
Die Umgebungsvariable `SKIP_KERNEL_COPY=true` verhindert, dass ein LINBO-Paket-Update den Host-Kernel ueberschreibt. Die Variable `USE_HOST_KERNEL=true` steuert, dass statt der Paket-Module die Host-Module (`/lib/modules/<kver>`) injiziert werden.

**Schicht 3 — linbo-update.service.js:**
Nach jedem LINBO-Rebuild wird automatisch geprueft, ob der Kernel in `/srv/linbo/linbo64` noch der Host-Kernel ist. Falls nicht, wird er zurueckkopiert.

Zusaetzlich:
- `.host-kernel-version` Marker fuer Drift-Detection bei Host-Kernel-Updates
- Kernel-Varianten: `stable`, `longterm`, `legacy` ueber die API umschaltbar
- Module werden per `rsync` oder `cp` injiziert, `depmod` wird ausgefuehrt

**Warum es noetig war:**
Das linbo7-Paket liefert einen minimalen Kernel mit ca. 720 Modulen (4.5 MB). Diesem Kernel fehlen Treiber fuer viele gaengige Netzwerkkarten (Intel igc, Realtek r8169), NVMe-Controller und USB-Geraete. Der Host-Kernel hat ca. 6000 Module (15 MB) und deckt nahezu alle Hardware ab.

**Wichtig:** Dies ist kein Docker-Spezifikum. Auch das produktive linuxmuster.net nutzt den Host-Kernel (`/boot/vmlinuz`) und nicht den Paket-Kernel. LINBO Docker macht das gleiche — nur expliziter und mit Schutz gegen versehentliches Ueberschreiben.

**Was Vanilla-LINBO stattdessen macht:**
Vanilla-LINBO verwendet ebenfalls den Host-Kernel, aber ohne expliziten Schutzmechanismus. Ein `apt upgrade` des linbo7-Pakets kann den Host-Kernel ueberschreiben, ohne dass dies bemerkt wird. Es gibt keine Varianten-Auswahl und keine automatische Drift-Detection.

**Auswirkung wenn fehlend:**
Clients verlieren nach dem GRUB-Handoff die Netzwerkverbindung, weil der Paket-Kernel den NIC-Treiber nicht enthaelt. Die LINBO-GUI zeigt "This LINBO client is in remote control mode." — der Client ist nicht mehr steuerbar. Dies ist der haeufigste und kritischste Fehler bei LINBO-Docker-Installationen.

---

### 2.4 Web Terminal (xterm.js)

**Was es macht:**
Ein vollwertiges interaktives SSH-Terminal im Browser:

- Eigener WebSocket-Endpunkt `/ws/terminal` mit JWT-Authentifizierung
- SSH2-Bibliothek verbindet sich zum LINBO-Client (Port 2222, Key-Auth)
- PTY-Allokation (pseudo-terminal) mit exec-Modus als Fallback
- xterm.js Frontend mit FitAddon (automatische Groessenanpassung) und WebLinksAddon (klickbare Links)
- Tab-System fuer mehrere gleichzeitige Verbindungen
- Maximal 10 gleichzeitige Sessions, 30 Minuten Idle-Timeout
- Verbindungstest-Endpunkt (`POST /terminal/test-connection`)

**Warum es noetig war:**
Debugging von LINBO-Clients erfordert oft interaktiven Shell-Zugang. In einer Docker-Umgebung ohne direkten SSH-Zugang zum Host ist ein browserbasiertes Terminal der natuerliche Weg. Insbesondere fuer Administratoren, die keinen SSH-Client installiert haben oder von einem Tablet/Chromebook aus arbeiten.

**Was Vanilla-LINBO stattdessen macht:**
Nur das Kommandozeilen-Tool `linbo-ssh` (Wrapper um `ssh -p 2222 -i <key>`). Kein Web-UI, keine Session-Verwaltung, kein Verbindungstest. Der Administrator muss einen SSH-Client installiert haben und den korrekten Key-Pfad kennen.

**Auswirkung wenn fehlend:**
Kein interaktiver Debug-Zugang ueber den Browser. Administratoren ohne SSH-Erfahrung koennen Client-Probleme nicht direkt diagnostizieren.

---

### 2.5 GRUB Theme Customization

**Was es macht:**
Web-basierter Editor fuer das GRUB-Boot-Menue:

- Logo- und Icon-Upload (PNG-Validierung)
- Farbschema anpassen: Desktop-Hintergrund, Item-Farben, Selection-Farben, Timeout-Darstellung
- Dynamische `theme.txt`-Generierung aus den Web-Einstellungen
- Vorschau im Browser

**Warum es noetig war:**
Schulen wollen oft ein eigenes Branding im Boot-Menue (Schullogo, Farben). Die manuelle Bearbeitung von `theme.txt` und das Kopieren von Bilddateien ist fehleranfaellig und erfordert GRUB-Kenntnisse.

**Was Vanilla-LINBO stattdessen macht:**
Manuelle Bearbeitung der Dateien in `/srv/linbo/boot/grub/themes/`. Kein Web-Editor, keine Vorschau. Das Standard-Theme wird mit dem Paket installiert.

**Auswirkung wenn fehlend:**
Generisches GRUB-Menue ohne Schulbranding. Funktional kein Problem, aber optisch nicht angepasst.

---

### 2.6 React Frontend (16 Seiten)

**Was es macht:**
Eine vollstaendige Single-Page-Application als Verwaltungsoberflaeche:

**Tech-Stack:**
- React 18 + TypeScript + Vite + Tailwind CSS
- Zustand State Management (5 Stores: auth, host, ws, notification, serverConfig)
- WebSocket mit Auto-Reconnect fuer Echtzeit-Updates
- Axios HTTP-Client mit JWT-Interceptor
- Dark Theme (schwarz/blau)

**8 Seiten mit Entsprechung in webui7:**

| Seite | Funktion |
|-------|----------|
| DashboardPage | Uebersicht: Hosts online, Images, Speicher |
| HostsPage | Host-Verwaltung mit Echtzeit-Status |
| RoomsPage | Raum-Verwaltung mit Sammelaktionen |
| ConfigsPage | start.conf-Editor mit Vorschau |
| ImagesPage | Image-Verwaltung (QCOW2/CLOOP) |
| OperationsPage | Operationen (sync, start, create) |
| DhcpPage | DHCP-Export (ISC, dnsmasq) |
| LoginPage | JWT-Authentifizierung |

**8 Docker-exklusive Seiten:**

| Seite | Funktion |
|-------|----------|
| TerminalPage | Interaktives SSH-Terminal (xterm.js) |
| DriversPage | Patchclass/Driver-Management |
| FirmwarePage | Firmware Auto-Detection und Injection |
| KernelPage | Kernel-Varianten und Host-Kernel-Schutz |
| GrubThemePage | GRUB Theme Editor |
| LinboGuiPage | LINBO GUI-Konfiguration |
| SettingsPage | Runtime-Einstellungen (Redis-backed) |
| SyncPage | Sync-Modus Verwaltung und Status |

**Warum es noetig war:**
webui7 ist eng mit der linuxmuster.net-Infrastruktur (Sophomorix, LDAP, webui7-Session-Management) verzahnt und kann nicht standalone betrieben werden. LINBO Docker benoetigt eine eigene Oberflaeche, die ohne diese Abhaengigkeiten funktioniert.

**Was Vanilla-LINBO stattdessen macht:**
Die linuxmuster.net-Weboberflaeche (webui7, PHP-basiert) mit LINBO-Modulen. Diese setzt eine vollstaendige linuxmuster.net-Installation voraus (Samba AD, Sophomorix, Webui7-Server).

**Auswirkung wenn fehlend:**
Keine grafische Verwaltung. Alle Operationen muessten ueber die REST-API oder Kommandozeile erfolgen.

---

### 2.7 Sync-Modus (Authority API Integration)

**Was es macht:**
Integration mit einem bestehenden linuxmuster.net-Server als "Authority" (Datenquelle):

- **Cursor-basierter Delta-Feed:** Nur Aenderungen seit dem letzten Sync werden abgerufen (Endpunkt `:8400`)
- **Redis als Cache:** Hosts, Configs und Rooms werden als `sync:host:{mac}`, `sync:config:{group}` etc. gecacht
- **Read-Only fuer LMN-Daten:** Host/Config/Room CRUD-Endpunkte geben `409 SYNC_MODE_ACTIVE` zurueck
- **start.conf server= Umschreibung:** Die Server-IP in heruntergeladenen start.conf-Dateien wird auf die Docker-IP umgeschrieben
- **Operations via Redis:** Im Sync-Modus werden Operationen ausschliesslich in Redis gespeichert (kein PostgreSQL)
- **Toggle per API:** `sync_enabled` kann als Runtime-Setting umgeschaltet werden

Routing im Sync-Modus (aus `routes/index.js`):
```
Immer aktiv: auth, sync, internal, system, patchclass, settings, terminal, images
Sync-Modus:  hosts/rooms/configs/stats/dhcp -> 409 SYNC_MODE_ACTIVE
             operations -> sync-operations (Redis-only)
Standalone:  Alle Routen mit vollem Prisma-Support
```

**Warum es noetig war:**
LINBO Docker soll als Ergaenzung zu einem bestehenden linuxmuster.net-Server betrieben werden koennen, ohne die Host- und Konfigurationsdaten doppelt pflegen zu muessen. Der Sync-Modus macht LINBO Docker zum "Satellite-Server".

**Was Vanilla-LINBO stattdessen macht:**
Kein Multi-Server-Konzept. LINBO ist integraler Bestandteil des linuxmuster.net-Servers. Es gibt keine Authority-API, keinen Delta-Feed und keinen Read-Only-Modus.

**Auswirkung wenn fehlend:**
LINBO Docker kann nur standalone betrieben werden. Alle Hosts und Konfigurationen muessen manuell angelegt werden, auch wenn bereits ein linuxmuster.net-Server existiert.

---

## 3. Infrastruktur-Verbesserungen

### 3.1 Auto-Key-Provisioning

**Was es macht:**
Der SSH-Container generiert beim Start automatisch alle fehlenden kryptographischen Schluessel:

```bash
# Aus containers/ssh/entrypoint.sh:
# 1. SSH Host Keys (RSA + Ed25519)
ssh-keygen -t rsa -b 4096 -f /etc/linuxmuster/linbo/ssh_host_rsa_key -N ""
ssh-keygen -t ed25519 -f /etc/linuxmuster/linbo/ssh_host_ed25519_key -N ""

# 2. Dropbear Host Keys (fuer LINBO-Client-SSH-Daemon)
dropbearkey -t rsa -f /etc/linuxmuster/linbo/dropbear_rsa_host_key
dropbearkey -t dss -f /etc/linuxmuster/linbo/dropbear_dss_host_key

# 3. LINBO Client Key (API -> Client SSH-Verbindungen)
ssh-keygen -t rsa -b 4096 -f /etc/linuxmuster/linbo/linbo_client_key -N ""

# 4. server_id_rsa.pub (Kompatibilitaet mit update-linbofs.sh)
cp linbo_client_key.pub server_id_rsa.pub
```

Alle Keys werden im `linbo_config` Docker Volume gespeichert und ueberleben Container-Neustarts.

**Warum es noetig war:**
Problem: Die SSH-Keys sind in `.gitignore` gelistet (sie gehoeren nicht ins Repository). Bei einem frischen `git clone` existieren die Key-Dateien nicht. Docker-Bind-Mounts erzeugen in diesem Fall leere Dateien statt Verzeichnisse, was zu stillen Fehlern fuehrt:
- Dropbear im LINBO-Client startet nicht (leerer Host-Key)
- SSH von API zu Client schlaegt fehl (leerer Client-Key)
- `update-linbofs.sh` injiziert leere Keys ins Initramfs

**Was Vanilla-LINBO stattdessen macht:**
Keys werden einmalig bei der linuxmuster.net-Installation generiert (`linuxmuster-setup`). Bei Verlust muessen sie manuell neu generiert werden. Es gibt keine automatische Erkennung fehlender Keys.

**Auswirkung wenn fehlend:**
Nach `git clone && docker compose up` funktioniert SSH nicht:
- Kein Dropbear auf LINBO-Clients (kein `linbo-ssh`)
- Kein Web-Terminal
- Kein Remote-Management (Operationen wie sync, start, shutdown)

---

### 3.2 TFTP Race Condition Fix

**Was es macht:**
Der TFTP-Container wartet auf ein Marker-File (`.linbofs-patch-status`), bevor er Clients bedient:

```bash
# Aus containers/tftp/entrypoint.sh:
MARKER="/srv/linbo/.linbofs-patch-status"
TIMEOUT=300  # 5 Minuten max

if [ -f "$MARKER" ]; then
    # Bestehende Installation: sofort starten
    exec "$@"
fi

# Frischer Deploy: warten bis API linbofs64 gepatcht hat
while [ ! -f "$MARKER" ] && [ $elapsed -lt $TIMEOUT ]; do
    sleep 2
    elapsed=$((elapsed + 2))
done
exec "$@"
```

Zusaetzlich in `docker-compose.yml`: `depends_on: api`

**Warum es noetig war:**
Problem: Bei einem frischen Deploy starten TFTP und API gleichzeitig. Die API braucht 30-60 Sekunden, um `update-linbofs.sh` auszufuehren und die 9 Docker-Patches zu injizieren. In diesem Zeitfenster serviert TFTP ein **ungepatchtes** linbofs64 an alle PXE-Clients, die gerade booten.

Ein Client, der in diesen 30-60 Sekunden bootet, erhaelt ein linbofs64 ohne:
- Storage-Module (kein Disk-Zugriff)
- NIC-Warte-Schleife (kein Netzwerk)
- SERVERID-Guard (falscher Server)
- devpts (kein SSH)

**Was Vanilla-LINBO stattdessen macht:**
Nicht anwendbar. In Vanilla-LINBO gibt es keine Container und damit kein Timing-Problem zwischen TFTP- und Patch-Prozess. Der TFTP-Server (atftpd) wird erst nach der vollstaendigen Paketinstallation gestartet.

**Auswirkung wenn fehlend:**
Clients, die in den ersten 30-60 Sekunden nach `docker compose up` booten, erhalten ein defektes linbofs64 und bleiben im "Remote Control Mode" haengen — ohne Netzwerk, ohne SSH, ohne GUI.

---

## 4. Die 9 Boot-Patches (linbofs64)

### 4.1 Warum Patches noetig sind

Der wichtigste Hintergrund fuer alle 9 Patches ist ein fundamentaler Unterschied in der Boot-Umgebung:

**Vanilla-LINBO geht davon aus, dass:**
- Hardware-Treiber bereits geladen sind (Built-in oder frueh per udev)
- Netzwerkkarten sofort nach `udevadm settle` verfuegbar sind
- DHCP zuverlaessig funktioniert (eigener DHCP-Server auf dem gleichen Host)
- udevd durchgehend laeuft
- `/dev/pts` fuer PTY-Allokation existiert
- Der LINBO-Server per DHCP-Option mitgeteilt wird

**In Docker/KVM-Umgebungen ist das anders:**
- `virtio_net`, `virtio_blk` und AHCI sind Kernel-Module, nicht Built-in
- NICs erscheinen verzoegert (manchmal erst 2-10 Sekunden nach udev settle)
- Der DHCP-Server ist ein externer Dienst (moeglicherweise nicht verfuegbar)
- udevd kann zwischen init.sh und linbo.sh sterben (`/run/udev/` leer)
- Das Netzwerk-Setup (`hwsetup()` und `network()`) wird gar nicht ausgefuehrt

**Kritisches Detail — init.sh bricht ab:**

Die Datei `init.sh` im linbofs64 bricht bei **Zeile 605** ab:

```bash
exec > >(tee /tmp/init.log) 2>&1
```

Diese Zeile verwendet Process Substitution (`>()`), die in BusyBox ash im `sysinit`-Kontext von `/sbin/init` nicht funktioniert. Das Resultat: **`hwsetup()` und `network()` werden NIEMALS ausgefuehrt.** Die Docker-Patches muessen deren Funktionalitaet ersetzen.

### 4.2 Patch-Uebersicht

| Nr. | Name | Zieldatei | Prioritaet | Zweck |
|-----|------|-----------|-----------|-------|
| 1 | SERVERID_GUARD | init.sh | KRITISCH | Guard fuer `server=` Cmdline-Parameter |
| 2 | DHCP_FALLBACK | init.sh | OPTIONAL | Statische IP als Fallback bei DHCP-Fehler |
| 3 | NET_DIAG | linbo.sh | OPTIONAL | Netzwerk-Debug-Infos bei GUI-Fehler |
| 4 | IFACE_WAIT | init.sh | KRITISCH | Warten auf NICs nach udev settle |
| 5 | NET_RECOVERY | linbo.sh | OPTIONAL | Netzwerk-Setup vor GUI-Download wiederholen |
| 6 | STORAGE_MODULES | init.sh | KRITISCH | Fruehes Laden von Disk/NIC-Treibern |
| 7 | UDEV_INPUT | linbo.sh | KRITISCH | udevd-Restart vor GUI-Start |
| 8 | DEVPTS_MOUNT | init.sh | KRITISCH | /dev/pts fuer PTY-Allokation |
| 9 | BLKDEV_COMPAT | linbo_link_blkdev | KRITISCH | disk0pN UND disk0N Symlinks |

Alle Patches werden von `update-linbofs.sh` ueber das `try_patch()`-Framework angewendet. Jeder Patch hat eine primaere und eine Fallback-Methode. Kritische Patches brechen den Build ab, wenn sie fehlschlagen. Optionale Patches warnen nur.

---

### 4.3 Patch 1 — SERVERID_GUARD

**Problem:**
In der originalen `init.sh` gibt es die Zeile:
```bash
LINBOSERVER="${SERVERID}"
```
Diese ueberschreibt die Server-Adresse mit dem Wert aus der DHCP-Antwort (Option `next-server`). In einer linuxmuster.net-Umgebung ist das korrekt, weil LINBO-Server und DHCP-Server identisch sind.

In Docker-Standalone wird der LINBO-Server ueber `server=<ip>` auf der GRUB-Kommandozeile uebergeben. Ohne Guard wuerde `SERVERID` (aus DHCP) die korrekte Adresse ueberschreiben — z.B. mit der Adresse des Schul-DHCP-Servers statt des Docker-Hosts.

**Wie der Patch es loest:**
```bash
grep -q "server=" /proc/cmdline || LINBOSERVER="${SERVERID}"
```
Die Ueberschreibung findet nur statt, wenn `server=` NICHT auf der Kernel-Kommandozeile steht. Damit bleibt das Verhalten fuer Standard-linuxmuster.net unveraendert.

**Was ohne den Patch passiert:**
Der Client versucht, sich mit dem falschen Server zu verbinden. start.conf-Download, rsync und alle Remote-Operationen schlagen fehl.

**Warum Vanilla-LINBO dieses Problem nicht hat:**
In Vanilla-LINBO sind DHCP-Server und LINBO-Server derselbe Host. Die Ueberschreibung ist gewollt und korrekt.

---

### 4.4 Patch 2 — DHCP_FALLBACK

**Problem:**
Wenn `udhcpc` keinen DHCP-Server findet (z.B. in isolierten Testnetzen oder wenn der DHCP-Server noch nicht bereit ist), hat der Client keine IP-Adresse und kann den LINBO-Server nicht erreichen.

**Wie der Patch es loest:**
Ein Helper-Script (`docker_net_fallback.sh`) wird in das linbofs64 injiziert und nach der DHCP-Schleife aufgerufen. Es:
1. Prueft, ob `udhcpc` fehlgeschlagen ist UND `server=` auf der Cmdline steht
2. Probiert alle Ethernet-Interfaces durch
3. Weist eine statische Fallback-IP zu (konfigurierbar, Standard: `10.0.150.254/16`)
4. Setzt die Default-Route
5. Verifiziert die Erreichbarkeit des Servers per `ping`

**Was ohne den Patch passiert:**
In Umgebungen ohne DHCP bleibt der Client ohne Netzwerk. Die GUI zeigt "Remote Control Mode" und der Client ist nicht erreichbar.

**Warum Vanilla-LINBO dieses Problem nicht hat:**
In Vanilla-LINBO laeuft der DHCP-Server auf demselben Host. Der DHCP-Server ist immer verfuegbar, wenn LINBO laeuft.

---

### 4.5 Patch 3 — NET_DIAG

**Problem:**
Wenn die LINBO-GUI nicht geladen werden kann, zeigt Vanilla-LINBO nur die knappe Meldung: "This LINBO client is in remote control mode." — ohne jegliche Diagnoseinformation. Der Administrator muss per SSH auf den Client zugreifen (was moeglicherweise auch nicht funktioniert).

**Wie der Patch es loest:**
Ersetzt die einzeilige Meldung durch einen ausfuehrlichen Diagnoseblock:
```
Kernel: 6.12.64
LINBOSERVER=10.0.0.13 SERVERID=10.0.0.13
cmdline: server=10.0.0.13 group=win11 ...

Network interfaces:
  enp3s0 [ethernet] state=up carrier=1 ip=10.0.0.42/16 mac=aa:bb:cc:dd:ee:ff
  (oder: "no interfaces found!")

init.sh log (last 20 lines):
  ...
```

**Was ohne den Patch passiert:**
Bei Boot-Problemen sieht der Administrator nur "remote control mode" auf dem Bildschirm und hat keine Informationen, um das Problem einzugrenzen.

**Warum Vanilla-LINBO dieses Problem nicht hat:**
In Vanilla-LINBO ist der "Remote Control Mode" selten, da die Hardware-Erkennung und das Netzwerk-Setup zuverlaessig funktionieren. Falls er doch auftritt, ist SSH (ueber linuxmuster.net) in der Regel verfuegbar.

---

### 4.6 Patch 4 — IFACE_WAIT

**Problem:**
`udevadm settle` kehrt zurueck, bevor `virtio_net` (oder andere modular geladene NIC-Treiber) das Netzwerk-Interface erstellt hat. Die anschliessende Schleife ueber `/sys/class/net/` findet keine Interfaces und ueberspringt das gesamte Netzwerk-Setup.

**Wie der Patch es loest:**
Fuegt eine Warte-Schleife VOR der Interface-Iteration ein:
```bash
# Warte bis zu 10 Sekunden auf ein Non-Loopback-Interface
local _iface_wait=0
while [ $_iface_wait -lt 10 ]; do
    _found_if=$(ls /sys/class/net/ 2>/dev/null | grep -v ^lo | head -1)
    [ -n "$_found_if" ] && break
    _iface_wait=$((_iface_wait + 1))
    sleep 1
done
# Force UP alle Interfaces
for _fif in $(ls /sys/class/net/ 2>/dev/null | grep -v ^lo); do
    ip link set dev "$_fif" up 2>/dev/null
done
sleep 2
```

**Was ohne den Patch passiert:**
Auf KVM/QEMU mit virtio_net und auf mancher physischer Hardware (Intel igc, Realtek r8169) wird das Netzwerk-Interface nicht rechtzeitig erkannt. Der Client hat keine IP-Adresse und erreicht den LINBO-Server nicht.

**Warum Vanilla-LINBO dieses Problem nicht hat:**
In der typischen Bare-Metal-Umgebung mit dem Host-Kernel sind die NIC-Treiber entweder built-in oder laden schnell genug, dass `udevadm settle` abwartet. In VMs mit emuliertem e1000 (statt virtio) tritt das Problem ebenfalls nicht auf.

---

### 4.7 Patch 5 — NET_RECOVERY

**Problem:**
Selbst wenn die Patches in `init.sh` fehlschlagen (oder init.sh komplett bei Zeile 605 abbricht), muss das Netzwerk bis zum Start von `linbo.sh` funktionieren. Die NET_RECOVERY ist das "Sicherheitsnetz", das alle Netzwerk-Funktionalitaet nachholt.

**Wie der Patch es loest:**
Ein umfassendes Shell-Script (`docker_net_recovery.sh`) wird in das linbofs64 injiziert und am Anfang von `linbo.sh` per `source` geladen. Es:

1. Erstellt Block-Device-Symlinks (`linbo_link_blkdev`), falls init.sh dies nicht getan hat
2. Prueft, ob das primaere Netzwerk bereits funktioniert
3. Laedt NIC-Treiber per `modprobe` (30+ gaengige Treiber)
4. Sucht alle Ethernet-Interfaces, bevorzugt diese vor WLAN
5. Wartet auf Link-Negotiation (bis 8 Sekunden)
6. Fuehrt `udhcpc` durch, probiert alternative Interfaces bei Fehler
7. Parst die Umgebung (`server=`, `group=`, `hostgroup=` von Cmdline + DHCP)
8. Setzt alle Umgebungsvariablen (`LINBOSERVER`, `HOSTGROUP`, `HOSTNAME`, `IP`, `MACADDR`)
9. Laedt `start.conf` per rsync vom Server herunter
10. Mountet `/dev/pts` und startet dropbear SSH
11. Startet im Hintergrund WLAN-Setup (falls `wpa_supplicant.conf` existiert)

**Was ohne den Patch passiert:**
Wenn init.sh bei Zeile 605 abbricht (was in Docker/KVM **immer** der Fall ist), gibt es kein Netzwerk, kein SSH, keine start.conf und keine GUI. Der Client ist ein schwarzer Bildschirm.

**Warum Vanilla-LINBO dieses Problem nicht hat:**
In Vanilla-LINBO laeuft init.sh vollstaendig durch, weil der BusyBox-Init-Kontext korrekt konfiguriert ist (oder die Umgebung die Process-Substitution unterstuetzt). Die Funktionen `hwsetup()` und `network()` werden normal ausgefuehrt.

---

### 4.8 Patch 6 — STORAGE_MODULES

**Problem:**
Der Host-Kernel hat AHCI, NVMe und virtio_blk als **Module** kompiliert, nicht als Built-in. Ohne explizites Laden dieser Module findet der Kernel keine Festplatten. Das gleiche gilt fuer NIC-Treiber, HID (Eingabegeraete) und USB-Host-Controller.

**Wie der Patch es loest:**
Fuegt ganz am Anfang von `init.sh` (nach dem Shebang) ein `modprobe`-Block ein:
```bash
for _mod in ahci sd_mod sr_mod nvme ata_piix ata_generic \
            virtio_blk virtio_scsi evdev hid hid_generic usbhid \
            virtio_input psmouse xhci_hcd ehci_hcd uhci_hcd \
            e1000 e1000e igb igc ixgbe r8169 r8152 sky2 tg3 \
            bnxt_en virtio_net vmxnet3 atlantic alx atl1c bcmgenet; do
    modprobe "$_mod" 2>/dev/null
done
```

30+ Treiber werden geladen. `2>/dev/null` unterdrueckt Fehler fuer Module, die im jeweiligen Kernel nicht vorhanden sind.

**Was ohne den Patch passiert:**
- Keine Festplatten sichtbar (`/dev/sda`, `/dev/nvme0n1` existieren nicht)
- Keine Netzwerkkarten sichtbar (kein `/sys/class/net/eth0`)
- Keine Tastatur/Maus-Eingabe in der GUI
- `linbo_link_blkdev` findet keine Block-Devices

**Warum Vanilla-LINBO dieses Problem nicht hat:**
In Vanilla-LINBO wird `hwsetup()` in init.sh ausgefuehrt, die alle notwendigen Module laedt. Da init.sh in Docker bei Zeile 605 abbricht, wird `hwsetup()` nie erreicht. Ausserdem haben manche Produktions-Kernel diese Treiber als Built-in.

---

### 4.9 Patch 7 — UDEV_INPUT

**Problem:**
Der udevd-Daemon stirbt zwischen `init.sh` und `linbo.sh` (oder wurde nie gestartet, weil init.sh abbrach). Ohne udevd existiert `/run/udev/` nicht bzw. ist leer. Die Qt-GUI (`linbo_gui`) nutzt `libinput`, das auf die udev-Datenbank angewiesen ist, um Eingabegeraete zu identifizieren. Ohne udev-Datenbank ignoriert libinput alle Maus- und Tastatur-Events — die GUI ist sichtbar, aber nicht bedienbar.

**Wie der Patch es loest:**
Direkt vor dem Start von `linbo_gui` in `linbo.sh`:
```bash
if ! pidof udevd >/dev/null 2>&1; then
    mkdir -p /run/udev
    udevd --daemon 2>/dev/null
    udevadm trigger --type=all --action=add 2>/dev/null
    udevadm settle --timeout=5 2>/dev/null
fi
```

**Was ohne den Patch passiert:**
Die LINBO-GUI wird angezeigt, aber Maus-Klicks und Tastatur-Eingaben werden ignoriert. Buttons sind nicht klickbar. Der Client ist nur per SSH bedienbar.

**Warum Vanilla-LINBO dieses Problem nicht hat:**
In Vanilla-LINBO laeuft udevd durchgehend vom init-Prozess. Die Laufzeitumgebung von BusyBox init auf Bare-Metal haelt udevd am Leben.

---

### 4.10 Patch 8 — DEVPTS_MOUNT

**Problem:**
Das devpts-Dateisystem (`/dev/pts`) wird normalerweise von init.sh gemountet — aber da init.sh bei Zeile 605 abbricht, passiert das nicht. Ohne `/dev/pts` kann dropbear (SSH-Daemon) keine Pseudo-Terminals allokieren. Die Folge:
- `linbo-ssh` zeigt "PTY allocation request failed"
- Das Web-Terminal faellt auf exec-Modus zurueck (kein Echo, kein Prompt)

**Wie der Patch es loest:**
Fuegt vor dem dropbear-Start in `init.sh` ein:
```bash
if [ ! -d /dev/pts ] || ! mountpoint -q /dev/pts 2>/dev/null; then
    mkdir -p /dev/pts
    mount -t devpts devpts /dev/pts 2>/dev/null
fi
```

Das gleiche Mount wird auch in `docker_net_recovery.sh` (Patch 5) durchgefuehrt, als doppelte Absicherung.

**Was ohne den Patch passiert:**
SSH-Verbindungen zum Client funktionieren, aber ohne interaktives Terminal. Befehle muessen einzeln per `ssh host command` ausgefuehrt werden. Das Web-Terminal ist degradiert (kein echtes Terminal-Feeling).

**Warum Vanilla-LINBO dieses Problem nicht hat:**
In Vanilla-LINBO wird devpts im regulaeren init-Ablauf gemountet, da init.sh vollstaendig durchlaeuft.

---

### 4.11 Patch 9 — BLKDEV_COMPAT

**Problem:**
Das Script `linbo_link_blkdev` erstellt Symlinks fuer Block-Devices im Format `disk0p1`, `disk0p2` etc. (mit `p`-Separator, wie bei NVMe: `/dev/nvme0n1p1`). Die LINBO-GUI (`linbo_gui`) normalisiert Device-Namen intern jedoch zu `disk01`, `disk02` (ohne `p`-Separator). Dadurch findet die GUI die Symlinks nicht und Partitionsoperationen (formatieren, mounten, syncen) schlagen fehl.

**Wie der Patch es loest:**
Nach dem Erstellen des `disk0pN`-Symlinks wird zusaetzlich ein `disk0N`-Symlink erstellt:
```bash
# Original: disk0p1 -> /dev/nvme0n1p1
# Patch:    disk01  -> /dev/nvme0n1p1 (zusaetzlich)
alt_link="${disk_link}${part_nr}"
if [ ! -e "$alt_link" ]; then
    ln -sf "$part" "$alt_link"
fi
```

**Was ohne den Patch passiert:**
Auf NVMe-Geraeten (und anderen Devices mit `p`-Separator in den Partitionsnamen) schlagen alle Partitionsoperationen der GUI fehl. Images koennen nicht synchronisiert, formatiert oder gestartet werden.

**Warum Vanilla-LINBO dieses Problem nicht hat:**
In aelteren linuxmuster-linbo7-Versionen wurde dieses Problem nicht bemerkt, weil die meisten Schulen SATA-Festplatten nutzen (dort gibt es keinen `p`-Separator: `/dev/sda1` wird zu `disk01`). Mit zunehmendem NVMe-Einsatz in neueren Geraeten wird dieses Problem auch in Vanilla-LINBO relevant — der Patch koennte als Upstream-Fix eingereicht werden.

---

## 5. Modifizierte Vanilla-Dateien

Von den vielen Dateien im linbofs64-Initramfs werden nur **3 Vanilla-Dateien** tatsaechlich modifiziert:

| Datei | Patches | Aenderungsart |
|-------|---------|---------------|
| `init.sh` | 5 (SERVERID_GUARD, DHCP_FALLBACK, IFACE_WAIT, STORAGE_MODULES, DEVPTS_MOUNT) | sed-Insertionen an definierten Ankerpunkten |
| `linbo.sh` | 3 (NET_DIAG, NET_RECOVERY, UDEV_INPUT) | sed-Insertionen und awk-Ersetzung |
| `usr/bin/linbo_link_blkdev` | 1 (BLKDEV_COMPAT) | sed-Insertion nach Symlink-Erstellung |

**Alles andere ist ADDITIV** — es werden nur neue Dateien hinzugefuegt:

| Neue Datei | Zweck |
|-----------|-------|
| `docker_net_fallback.sh` | DHCP-Fallback-Script (Patch 2) |
| `docker_net_recovery.sh` | Netzwerk-Recovery-Script (Patch 5) |

Die Features Patchclass, Firmware-Detection, Web-Terminal, Frontend, Sync-Modus und alle anderen Docker-exklusiven Funktionen aendern **keinen einzigen Byte** an Vanilla-LINBO-Code. Sie sind rein additive Erweiterungen, die ueber die REST-API, WebSocket-Server und zusaetzliche Container bereitgestellt werden.

---

## 6. Zusammenfassung

### Die 9 Patches sind umgebungsbedingt, nicht fehlerbehebend

Keiner der 9 Boot-Patches behebt einen Bug in Vanilla-LINBO. Sie kompensieren Unterschiede zwischen der erwarteten Bare-Metal-Umgebung (vorkonfigurierte Hardware, eigener DHCP-Server, stabiler udevd) und der Docker/KVM-Realitaet (Module statt Built-in, externer DHCP, init.sh-Abbruch bei Zeile 605).

### Minimale Eingriffe in Vanilla-Code

Nur 3 von hunderten Dateien im linbofs64 werden modifiziert. Alle Aenderungen sind per `try_patch()`-Framework nachvollziehbar, haben Fallback-Strategien und werden nach dem Build verifiziert.

### Host-Kernel ist kein Docker-Spezifikum

Die Nutzung des Host-Kernels statt des Paket-Kernels ist **kein** Docker-spezifischer Hack. Das produktive linuxmuster.net macht exakt das Gleiche — `update-linbofs.sh` kopiert `/boot/vmlinuz` nach `/srv/linbo/linbo64`. LINBO Docker macht dies nur expliziter und schuetzt aktiv gegen versehentliches Ueberschreiben.

### Docker-exklusive Features sind Mehrwert

Die 7 Docker-exklusiven Features (Patchclass, Firmware-Detection, Kernel Switching, Web Terminal, GRUB Theme UI, React Frontend, Sync-Modus) sind keine Abweichungen, sondern zusaetzliche Funktionalitaet. Sie aendern kein Vanilla-LINBO-Verhalten und koennen potenziell als Upstream-Beitraege in linuxmuster-linbo7 einfliessen.

### Ziel

Langfristig sollen die Docker-Patches minimiert werden (idealerweise durch Upstream-Fixes in init.sh/linbo.sh) und die Docker-exklusiven Features als optionale Module fuer Vanilla-LINBO bereitgestellt werden.

---

*Letzte Aktualisierung: 2026-03-04*
*LINBO Docker Version: Aktueller Stand auf `main` Branch*
