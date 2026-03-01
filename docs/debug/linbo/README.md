# LINBO PXE Boot - Debug-Handbuch

**Stand:** 2026-03-01 | **Testserver:** 10.0.0.13 | **Produktion:** 10.0.0.11

Dieses Handbuch dokumentiert alle Erkenntnisse aus dem Debugging von LINBO PXE Boot
in der Docker-Umgebung. Ziel: Beim naechsten Problem nicht von vorne anfangen.

---

## Inhaltsverzeichnis

1. [Boot-Kette (Architektur)](./01-boot-chain.md) — Gesamtablauf PXE → GUI
2. [Diagnose-Befehle](./02-diagnose-befehle.md) — Schnellreferenz aller Debug-Commands
3. [DHCP & Netzwerk](./03-dhcp-netzwerk.md) — Proxy-DHCP, Produktions-DHCP, udhcpc
4. [Kernel & Module](./04-kernel-module.md) — Host-Kernel, Modul-Mismatch, Boot-Dauer
5. [GRUB Konfiguration](./05-grub-config.md) — Gruppenaufloesung, MAC-Fallback, hostcfg
6. [init.sh Analyse](./06-init-sh.md) — SERVERID-Guard, do_env(), network(), hwsetup()
7. [Haeufige Fehlerbilder](./07-fehlerbilder.md) — "Remote Control Mode" und Co.
8. [Dreischicht-Kernelschutz](./08-kernel-schutz.md) — Update-sichere Architektur
9. [Kernel-Version-Bug](./09-kernel-version-bug.md) — 6.8.0-64 virtio-net Bug (2 Tage Debug)

---

## Schnelldiagnose: "Remote Control Mode"

Wenn ein Client "This LINBO client is in remote control mode" anzeigt,
pruefe in dieser Reihenfolge:

```
0. Kernel-Version OK?     → uname -r pruefen! Reboot nach apt upgrade noetig?
1. GRUB-Phase OK?         → Web-Logs pruefen (linbo64 + linbofs64 Download)
2. Kernel bootet?          → dnsmasq-Log auf "udhcp 1.37.0" pruefen
3. DHCP funktioniert?      → Produktions-DHCP-Log pruefen (10.0.0.11)
4. rsync erreichbar?       → rsync-Logs pruefen
5. start.conf vorhanden?   → Container-Dateisystem pruefen
6. GUI downloadbar?        → linbo_gui64_7.tar.lz vorhanden?
```

**WICHTIG:** Schritt 0 zuerst! Ein veralteter Host-Kernel kann Netzwerk-Treiber
(virtio-net) komplett brechen, obwohl die Kernel-Config korrekt ist.
Siehe [09-kernel-version-bug.md](./09-kernel-version-bug.md) fuer den 2-Tage-Bug.

Siehe [07-fehlerbilder.md](./07-fehlerbilder.md) fuer Details zu jedem Schritt.
