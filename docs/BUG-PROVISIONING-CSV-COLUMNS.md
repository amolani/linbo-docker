# BUG: Host Provisioning fails — devices.csv Column Mapping

**Datum:** 2026-02-06
**Status:** Behoben (Commit da7ce31, 2026-02-06)
**Severity:** Critical
**Betrifft:** Phase 11 (Host Provisioning), Phase 7b (Device Import/Export)
**Entdeckt bei:** Live-Test auf Produktionsserver 10.0.0.11

---

## Zusammenfassung

Host Provisioning über den DC Worker schlägt fehl, weil die generierten devices.csv-Zeilen
nicht dem von `sophomorix-device` erwarteten Spalten-Layout entsprechen. Es gibt drei
zusammenhängende Bugs:

1. **DC Worker**: `_format_csv_line` erzeugt nur 5 Spalten — Pflichtfeld `pxeFlag` (Spalte 10) fehlt
2. **CSV_COLUMNS Mapping**: Import/Export-Konstanten sind um +1 verschoben (ROLE=9 statt 8, PXE_FLAG=11 statt 10)
3. **Import-Script Fehler-Verschluckung**: `linuxmuster-import-devices` ignoriert `sophomorix-device --sync` Fehlschläge (Upstream-Bug)

---

## Bug 1: DC Worker — Fehlende Pflichtfelder in Delta-CSV

### Betroffene Datei
`dc-worker/macct-worker.py`, Zeile 755-763

### Ist-Zustand
```python
def _format_csv_line(self, options: Dict[str, Any]) -> str:
    """Format minimal 5-column CSV line"""
    return ';'.join([
        options.get('csvCol0', ''),
        options.get('hostname', ''),
        options.get('configName', '') or 'nopxe',
        (options.get('mac', '') or '').upper(),
        options.get('ip', '') or 'DHCP',
    ])
```

Erzeugt: `testlab;linbo-test03;nopxe;AA:BB:CC:DD:EE:A3;10.0.0.232`

### Problem
Die `_merge()`-Methode (Zeile 821-825) padded neue Einträge auf Master-Spaltenanzahl (16)
mit leeren Strings:
```python
padded = list(parts) + [''] * max(0, master_cols - len(parts))
```

Ergebnis in devices.csv:
```
testlab;linbo-test03;nopxe;AA:BB:CC:DD:EE:A3;10.0.0.232;;;;;;;;;;;
```

### Warum es scheitert
`sophomorix-device` (Perl) parst Spalte 10 als `$pxe`:
```perl
# /usr/sbin/sophomorix-device, Zeile 1660
my (..., $pxe, ...) = split(/;/, $line);
```
Und validiert in `check_pxe()` (Zeile 2033):
```perl
sub check_pxe {
    my ($pxe, ...) = @_;
    if ( $pxe =~ /[0-9]/ ) { return $pxe; }    # OK: digit
    if ( not exists $pxe{$pxe} ) {               # OK: "ml"
        print "  ERROR: >$pxe< is invalid Option in pxe field\n";
        exit 88;                                  # ← FATAL!
    }
}
```
Leerer String → **exit 88**.

### Beweis: sophomorix-device --dry-run Ausgabe
```
LINE: ;linbo-test01;nopxe;AA:BB:CC:DD:EE:A1;10.0.0.230;;;;;;;;;;;
  ERROR: >< is invalid Option in pxe field in devices.csv
```

### Soll-Zustand
`_format_csv_line` muss alle 16 Spalten erzeugen, mindestens `pxeFlag` (Spalte 10):
```python
def _format_csv_line(self, options: Dict[str, Any]) -> str:
    """Format full 16-column CSV line compatible with sophomorix"""
    pxe = str(options.get('pxeFlag', 1))
    role = options.get('role', '')
    return ';'.join([
        options.get('csvCol0', ''),     # 0: room
        options.get('hostname', ''),     # 1: hostname
        options.get('configName', '') or 'nopxe',  # 2: device group
        (options.get('mac', '') or '').upper(),     # 3: MAC
        options.get('ip', '') or 'DHCP', # 4: IP
        '',                              # 5: ms_office_key
        '',                              # 6: ms_windows_key
        '',                              # 7: unused
        role,                            # 8: sophomorix_role
        '',                              # 9: unused_2
        pxe,                             # 10: pxeFlag ← PFLICHTFELD!
        '',                              # 11: option
        '',                              # 12: field_13
        '',                              # 13: field_14
        '',                              # 14: sophomorix_comment
    ])
```

### Hinweis
`pxeFlag` wird bereits korrekt von der API berechnet und in den Operation-Options mitgeliefert:
```javascript
// provisioning.service.js, Zeile 85
pxeFlag: configName ? 1 : 0,
```
Aber der DC Worker ignoriert den Wert aktuell komplett.

---

## Bug 2: CSV_COLUMNS Mapping — Off-by-One

### Betroffene Datei
`containers/api/src/services/deviceImport.service.js`, Zeile 35-44

### Ist-Zustand
```javascript
const CSV_COLUMNS = {
  ROOM: 0,
  HOSTNAME: 1,
  CONFIG: 2,
  MAC: 3,
  IP: 4,
  DHCP_OPTIONS: 7,
  ROLE: 9,        // ← FALSCH
  PXE_FLAG: 11,   // ← FALSCH
};
```

### Soll-Zustand (laut sophomorix-device Perl-Parser + Template + Produktionsdaten)
```javascript
const CSV_COLUMNS = {
  ROOM: 0,
  HOSTNAME: 1,
  CONFIG: 2,
  MAC: 3,
  IP: 4,
  MS_OFFICE_KEY: 5,
  MS_WINDOWS_KEY: 6,
  DHCP_OPTIONS: 7,   // "unused" in sophomorix, wir nutzen es für DHCP options
  ROLE: 8,           // ← KORREKTUR: sophomorix_role
  PXE_FLAG: 10,      // ← KORREKTUR: $pxe im Perl-Parser
};
```

### Beweis: Spalten-Vergleich

**Sophomorix-device Perl Parser** (`/usr/sbin/sophomorix-device`, Zeile 1646-1660):
```perl
my ($room,            # 0
    $host,            # 1
    $dgr,             # 2
    $mac,             # 3
    $ip,              # 4
    $ms_office_key,   # 5
    $ms_windows_key,  # 6
    $unused,          # 7
    $sophomorix_role, # 8  ← ROLE
    $unused_2,        # 9
    $pxe,             # 10 ← PXE_FLAG
    $option,          # 11
    $field_13,        # 12
    $field_14,        # 13
    $sophomorix_comment  # 14
) = split(/;/, $line);
```

**Sophomorix Template** (`/usr/share/sophomorix/config-templates/devices.csv.template`):
```
# Example Entry in *.devices.csv, 15 fields
ROOM;HOST;DGR;DE:EA:DB:EE:FE:ED;10.0.0.1;---;---;1;classroom-studentcomputer;---;1;;;;COMMENT;
```
```
Index: 0    1    2   3                4        5   6   7 8                        9   10
```

**Produktionsdaten** (verifiziert mit awk):
```
sgm;sgm-pc02;bios_sata;BC:24:11:63:8E:40;10.0.0.102;;;;classroom-studentcomputer;;1;;;;;

 0: >sgm<
 1: >sgm-pc02<
 2: >bios_sata<
 3: >BC:24:11:63:8E:40<
 4: >10.0.0.102<
 5: ><               ← ms_office_key (leer)
 6: ><               ← ms_windows_key (leer)
 7: ><               ← unused (leer)
 8: >classroom-studentcomputer<  ← ROLE (Spalte 8!)
 9: ><               ← unused_2 (leer)
10: >1<              ← PXE_FLAG (Spalte 10!)
11: ><
...
```

### Auswirkung
- **Import**: `fields[9]` liest leeren String statt Role → Role-Information geht verloren
- **Import**: `fields[11]` liest leeren String statt pxeFlag → fällt auf Default `1` zurück (maskierter Bug)
- **Export**: Role landet auf Spalte 9, pxeFlag auf Spalte 11 → sophomorix-device schlägt fehl

### Export-Funktion (ebenfalls betroffen)
`deviceImport.service.js`, Zeile 624-642:
```javascript
// Aktuell (FALSCH):
const fields = [
  room,                // 0
  hostname,            // 1
  configName,          // 2
  mac,                 // 3
  ip,                  // 4
  '',                  // 5
  '',                  // 6
  dhcpOptions,         // 7
  '',                  // 8  ← Hier sollte ROLE stehen!
  role,                // 9  ← Role auf falscher Position
  '',                  // 10 ← Hier sollte PXE_FLAG stehen!
  String(pxeFlag),     // 11 ← PXE auf falscher Position
  ...
];
```

---

## Bug 3: linuxmuster-import-devices ignoriert Fehler (Upstream)

### Betroffene Datei
`/usr/sbin/linuxmuster-import-devices` (linuxmuster.net Paket, nicht unser Code)

### Problem
```python
# linuxmuster-import-devices, ab Zeile 66:
try:
    msg = 'sophomorix-device finished '
    subProc('sophomorix-device --sync')       # ← return value IGNORIERT!
    printScript(msg + ' OK!')                 # ← wird trotz Fehler erreicht
except Exception as err:
    printScript(msg + ' errors detected!')
    sys.exit(1)
```

Die `subProc()`-Funktion (in `functions.py`) gibt `False` zurück bei Non-Zero Exit Code,
wirft aber **keine Exception**:
```python
def subProc(cmd, logfile=None, hideopts=False):
    try:
        p = Popen(cmd, shell=True, ...)
        output, errors = p.communicate()
        if p.returncode or errors:
            rc = False        # ← setzt nur rc, kein raise!
        return rc             # ← False wird zurückgegeben
    except Exception:
        return False
```

### Ablauf bei fehlerhaftem devices.csv
1. `sophomorix-device --sync` → findet leere pxeFlag → `exit 88` (Perl)
2. `subProc()` → Perl-Prozess endet mit Code 88 → gibt `False` zurück
3. `linuxmuster-import-devices` → ignoriert Rückgabe → druckt "OK!"
4. Script fährt mit GRUB/DHCP-Konfiguration fort
5. Script beendet sich mit **Exit Code 0**
6. DC Worker sieht Exit 0 → loggt "import-devices completed successfully"

### Auswirkung
- `sophomorix-device --sync` erstellt KEINE AD-Objekte oder DNS-Einträge
- `linuxmuster-import-devices` meldet trotzdem Erfolg
- DC Worker loggt irreführend "completed successfully"
- **Rettung**: Die Verify-Phase im DC Worker erkennt das Problem korrekt:
  ```
  status: "failed"
  error: "Verify failed: {\"ad_object_exists\": false, ...}"
  ```

### Workaround im DC Worker
Da wir den Upstream-Bug nicht fixen können, sollten wir die `_run_import_script()`-Methode
robuster machen: den stdout/stderr auf Fehlermeldungen parsen:
```python
# Prüfe auf bekannte Fehlerpatterns im Output
if 'ERROR:' in result.stdout or 'ERROR:' in result.stderr:
    return {'success': False, 'error': 'sophomorix-device errors detected',
            'stdout': result.stdout, 'stderr': result.stderr}
```

---

## Bug 4: Irreführende Batch-Completion-Meldung

### Betroffene Datei
`dc-worker/macct-worker.py`, Zeile 662

### Problem
```python
logging.info(f"[Provision] Batch complete: {len(valid_jobs_final)} succeeded")
```
`valid_jobs_final` zählt die verarbeiteten Jobs, NICHT die verifizierten. Jobs die beim Verify
fehlschlagen werden trotzdem als "succeeded" gezählt.

### Fix
```python
completed = sum(1 for _, op_id, _ in valid_jobs_final
                if self.api.get_operation(op_id).get('status') == 'completed')
failed = len(valid_jobs_final) - completed
logging.info(f"[Provision] Batch complete: {completed} succeeded, {failed} failed")
```

---

## Vollständiger Fehler-Ablauf (beobachtet am 2026-02-06)

```
1. API erstellt Host "linbo-test03" mit room=testlab, config=nopxe
   → provisioning.service.js berechnet pxeFlag=0

2. Redis Stream: Job mit options={hostname: "linbo-test03", pxeFlag: 0, ...}

3. DC Worker: _format_csv_line() erzeugt "testlab;linbo-test03;nopxe;AA:BB:CC:DD:EE:A3;10.0.0.232"
   → pxeFlag=0 wird IGNORIERT (nicht in der Funktion verwendet)

4. DC Worker: _merge() padded auf 16 Spalten mit leeren Strings
   → Spalte 10 (pxeFlag) = "" (leer)

5. DC Worker: Schreibt devices.csv mit fehlerhafter Zeile

6. DC Worker: Führt linuxmuster-import-devices aus

7. linuxmuster-import-devices: Ruft sophomorix-device --sync auf

8. sophomorix-device: Parst Zeile, findet leere pxeFlag
   → "ERROR: >< is invalid Option in pxe field"
   → exit 88

9. linuxmuster-import-devices: subProc() gibt False zurück
   → Return-Wert wird IGNORIERT
   → Druckt "sophomorix-device finished OK!"
   → Fährt mit DHCP/GRUB fort
   → Exit Code 0

10. DC Worker: Sieht Exit 0
    → Loggt "import-devices completed successfully"

11. DC Worker: Verify-Phase prüft AD + DNS
    → ad_object_exists = false
    → Markiert Operation als "failed"
    → Loggt "Batch complete: 1 succeeded"  ← IRREFÜHREND!

12. API: Operation-Status = "failed"
    → error = "Verify failed: {ad_object_exists: false, ...}"
    → Frontend zeigt "failed" Badge  ← KORREKT (dank Verify)
```

---

## Betroffene Dateien (Fix erforderlich)

| Datei | Bug | Priorität |
|-------|-----|-----------|
| `dc-worker/macct-worker.py` (Zeile 755-763) | Bug 1: Fehlende Spalten in _format_csv_line | **Kritisch** |
| `containers/api/src/services/deviceImport.service.js` (Zeile 35-44) | Bug 2: CSV_COLUMNS Off-by-One | **Hoch** |
| `containers/api/src/services/deviceImport.service.js` (Zeile 624-642) | Bug 2: Export Off-by-One | **Hoch** |
| `dc-worker/macct-worker.py` (Zeile 866-899) | Bug 3: Stdout-Parsing in _run_import_script | **Mittel** |
| `dc-worker/macct-worker.py` (Zeile 662) | Bug 4: Irreführende Log-Meldung | **Niedrig** |

---

## Test-Artefakte (Cleanup erforderlich)

Auf dem Produktionsserver (10.0.0.11) befinden sich Test-Einträge:

**devices.csv** (`/etc/linuxmuster/sophomorix/default-school/devices.csv`):
```
;linbo-test01;nopxe;AA:BB:CC:DD:EE:A1;10.0.0.230;;;;;;;;;;;
;linbo-test02;nopxe;AA:BB:CC:DD:EE:A2;10.0.0.231;;;;;;;;;;;
testlab;linbo-test03;nopxe;AA:BB:CC:DD:EE:A3;10.0.0.232;;;;;;;;;;;
```

**Delta-Datei** (`/etc/linuxmuster/sophomorix/default-school/linbo-docker.devices.csv`):
```
# managed-by: linbo-docker — DO NOT EDIT MANUALLY
;linbo-test01;nopxe;AA:BB:CC:DD:EE:A1;10.0.0.230
;linbo-test02;nopxe;AA:BB:CC:DD:EE:A2;10.0.0.231
testlab;linbo-test03;nopxe;AA:BB:CC:DD:EE:A3;10.0.0.232
```

**Backup**: `devices.csv.pre-test` (Originalzustand vor Tests)

→ Nach Fix: `devices.csv.pre-test` zurückkopieren, Delta-Datei löschen.
