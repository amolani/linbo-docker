# Session 7: Vollstaendige Sidecar-Verarbeitung (Phase 13)

**Datum:** 2026-02-07/08
**Server:** 10.0.0.11 (Produktion), 10.0.0.13 (Test-VM)
**Aenderungen:** 17 Dateien, +2344/-184 Zeilen
**Neue Tests:** 107 (76 image-path + 31 internal-sidecar)
**Tests Gesamt:** 535 (525 passing, 10 preexisting Integration-Failures)
**Functional Parity:** ~98%

---

## Ausgangslage

Nach Phase 12 (Image Workflow Fixes) verarbeitete der `internal.js` Post-Upload-Handler nur `.qcow2`/`.qdiff` Dateien. Sidecars (`.info`, `.desc`, `.torrent`, `.macct`, `.md5`) und Supplements (`.reg`, `.prestart`, `.postsync`) landeten zwar auf der Festplatte (rsync Upload), wurden aber von der API ignoriert:

- Kein DB-Update bei `.info` Upload (Metadaten gingen verloren)
- Kein DB-Update bei `.desc` Upload (Beschreibung nicht synchronisiert)
- `.torrent` und `.md5` Pfade/Hashes nicht in DB gespeichert
- Kein UI fuer Sidecar-Anzeige oder -Bearbeitung
- Delete loeschte nur die Haupt-Image-Datei, nicht Sidecars/Backups

### Produktions-Dateistruktur pro Image

```
/srv/linbo/images/<base>/
├── <base>.qcow2           # Haupt-Image (Client-Upload)
├── <base>.qcow2.info      # Metadaten (key="value", vom Client generiert)
├── <base>.qcow2.desc      # Changelog/Beschreibung (Freitext)
├── <base>.qcow2.torrent   # BitTorrent-Verteilungsdatei
├── <base>.qcow2.macct     # Machine-Account LDIF (Server-generiert)
├── <base>.qcow2.md5       # Checksum
├── <base>.reg             # Windows Registry-Patches
├── <base>.prestart        # Custom Pre-Start Script
├── <base>.postsync        # Custom Post-Sync Script
└── backups/<timestamp>/   # Backup-Verzeichnis
```

---

## Design-Entscheidungen

### Kategorien

| Konstante | Werte | Zweck |
|-----------|-------|-------|
| `IMAGE_SIDECARS` | `.info`, `.desc`, `.torrent`, `.macct`, `.md5` | An `<filename>` angehaengt |
| `IMAGE_SUPPLEMENTS` | `.reg`, `.prestart`, `.postsync` | An `<base>` angehaengt |
| `READABLE_TYPES` | `desc`, `info`, `reg`, `prestart`, `postsync` | GET erlaubt |
| `WRITABLE_TYPES` | `desc`, `reg`, `prestart`, `postsync` | PUT erlaubt (`info` read-only!) |

### Catch-up Pattern

Sidecars koennen vor dem Haupt-Image per rsync ankommen (rsync-Reihenfolge nicht deterministisch). Loesung:

1. Sidecar vor Image → Rate-limited Warning (LRU-Map, max 200 Eintraege, TTL 10min), kein DB-Update
2. `handleImageUpload()` ruft **immer** `catchUpSidecars()` auf → liest alle vorhandenen Sidecars nachtraeglich ein
3. Robust gegen beliebige Upload-Reihenfolge

### Performance (Liste vs Detail)

- **Liste** (`GET /images`): Keine `stat()` Calls. Optional `?includeSidecars=true` liefert DB-Indikatoren (`hasInfo`, `hasDesc`, etc.) + max 3 `stat()` fuer Supplements
- **Detail** (`GET /images/:id`): Filesystem-Truth — `stat()` fuer alle 8 Typen + `fileSize` via `stat()` auf dem Image

### Source of Truth

- Client laedt `.desc` hoch → DB `description` wird ueberschrieben
- Admin aendert per UI → Datei UND DB werden ueberschrieben
- Letzter Schreiber gewinnt. Audit-Log fuer Nachvollziehbarkeit.
- Leer-Semantik: `.desc` leer oder nur Whitespace → DB `description = null`

### Delete Cleanup

`?deleteFile=true` loescht das **komplette Image-Verzeichnis** (`/srv/linbo/images/<base>/`) inkl. Backups via `fs.rm(imageDir, { recursive: true, force: true })`.

---

## Geaenderte Dateien

### 1. `containers/api/prisma/schema.prisma`

Zwei neue Felder im Image-Model:

```prisma
imageInfo       Json?     @map("image_info")
infoUpdatedAt   DateTime? @map("info_updated_at") @db.Timestamptz
```

### 2. `containers/api/src/lib/image-path.js` (NEU, 183 Zeilen)

Zentrales Modul fuer Image-Pfad-Operationen:

- **Konstanten:** `IMAGE_SIDECARS`, `IMAGE_SUPPLEMENTS`, `READABLE_TYPES`, `WRITABLE_TYPES`, `INFO_KEYS`
- **`parseSidecarFilename(filename)`** — Parst `"ubuntu.qcow2.info"` → `{ imageFilename: "ubuntu.qcow2", sidecarExt: ".info" }`. Unterstuetzt alle `IMAGE_EXTS × IMAGE_SIDECARS`. Null fuer ungueltige Eingaben.
- **`resolveSupplementPath(mainFilename, suffix)`** — Loest `IMAGES_DIR/<base>/<base><suffix>` auf. Validiert Suffix gegen `IMAGE_SUPPLEMENTS`.

### 3. `containers/api/src/routes/internal.js` (+351 Zeilen)

Post-Upload-Handler erweitert + 5 neue Funktionen:

- **`shouldWarnSidecarBeforeImage(imageFilename)`** — Rate-limited LRU Warning Map (max 200, TTL 10min, max 1x/min pro Dateiname)
- **`parseInfoTimestamp("202601271107")`** — Parst LINBO Timestamp-Format als UTC → ISO-String
- **`readInfoFile(imageFilename)`** — Liest/parst `.info` mit Whitelist-Keys. Cross-check: `image` != erwarteter Filename → Warning
- **`handleSidecarUpload(imageFilename, sidecarExt, clientIp)`** — Verarbeitet einzelne Sidecar-Uploads, aktualisiert DB + WS Broadcast
- **`catchUpSidecars(imageFilename, imageId)`** — Holt alle Sidecars nach Image-Registrierung nach (single DB-Update)

### 4. `containers/rsync/scripts/rsync-pre-upload-api.sh` (+22 Zeilen)

- **Traversal-Check:** `mkdir` nur wenn `$DIRNAME` unter `$RSYNC_MODULE_PATH` liegt
- **Erweiterte Case-Anweisung:** Erstellt Verzeichnisse fuer alle Sidecar/Supplement-Extensions

### 5. `containers/api/src/routes/images.js` (+471/-74 Zeilen)

Umfangreiche Erweiterung:

- **`addSidecarSummary(image)`** — DB-Indikatoren + FS-stat fuer Supplements (Listenansicht)
- **`getSidecarDetails(image)`** — Vollstaendige FS-Truth stat fuer alle 8 Typen (Detailansicht)
- **`resolveSidecarTypePath(imageFilename, type)`** — Pfadaufloesung fuer Sidecar/Supplement
- **`GET /images/:id/sidecars/:type`** — Liest Sidecar-Inhalt (max 1 MB, `READABLE_TYPES`)
- **`PUT /images/:id/sidecars/:type`** — Schreibt Sidecar-Inhalt (max 200 KB, `WRITABLE_TYPES`, mit Audit)
- **`DELETE /images/:id`** — Nutzt `fs.rm(imageDir, { recursive: true, force: true })` fuer komplettes Verzeichnis
- **`GET /images`** — Unterstuetzt `?includeSidecars=true` Query-Parameter
- **`GET /images/:id`** — Liefert `sidecars` + `fileSize` in Response

### 6. `containers/web/frontend/src/types/index.ts` (+23 Zeilen)

```typescript
export interface ImageSidecar {
  exists: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface ImageSidecarSummary {
  hasInfo: boolean; hasDesc: boolean; hasTorrent: boolean;
  hasMd5: boolean; hasReg: boolean; hasPrestart: boolean; hasPostsync: boolean;
}
```

Image-Interface erweitert um `fileSize`, `sidecars`, `sidecarSummary`, `imageInfo`, `infoUpdatedAt`.

### 7. `containers/web/frontend/src/api/images.ts` (+15 Zeilen)

- `list()` akzeptiert `includeSidecars` Parameter
- Neue Methoden: `getSidecar(id, type)`, `updateSidecar(id, type, content)`

### 8. `containers/web/frontend/src/pages/ImagesPage.tsx` (+522/-82 Zeilen)

Komplett ueberarbeitete Image-Seite:

- **Sidecar-Badges:** Farbige Badges pro Image (I/D/T/M/R/P/S) in der Listenansicht
- **Klickbare Dateinamen:** Oeffnen Detail-Modal
- **Detail-Modal mit 5 Tabs:**
  - **Uebersicht:** Sidecars-Grid mit exists/size/modified + usedBy-Hosts
  - **Info:** Read-only `.info` Daten (Key=Value Tabelle)
  - **Beschreibung:** `.desc` Editor + Save-Button
  - **Registry:** `.reg` Editor + Warning-Hinweis + Save-Button
  - **Scripts:** `.prestart` + `.postsync` Editoren + Warning-Hinweis + Save-Buttons
- **Delete mit Checkbox:** "Dateien auf dem Server loeschen (inkl. Backups)" mit Warnung

### 9. Weitere Aenderungen

| Datei | Aenderung |
|-------|-----------|
| `components/ui/Modal.tsx` | `ConfirmModal.message` von `string` auf `ReactNode` |
| `middleware/validate.js` | Minor Anpassung fuer neue Validierung |
| `routes/configs.js` | Config-Delete Cleanup (GRUB, start.conf, Symlinks) |
| `routes/stats.js` | Stats-Route erweitert |
| `index.js` | Startup Sanity Check fuer `/srv/linbo` |
| `rsync-post-upload-api.sh` | Minor Logging-Anpassung |
| `docker-compose.yml` | Minor Config-Anpassung |

---

## Neue Tests (107)

### `tests/lib/image-path.test.js` (76 Tests)

| Bereich | Tests | Beschreibung |
|---------|-------|-------------|
| IMAGE_SIDECARS/SUPPLEMENTS | 4 | Konstanten-Validierung |
| parseSidecarFilename | 45 | Alle EXTS x SIDECARS Kombinationen, Edge Cases, Security (Traversal), null/undefined |
| resolveSupplementPath | 27 | Gueltige Suffixes, Security (ungueltige Suffixes → throw), Pfad-Korrektheit |

### `tests/routes/internal-sidecar.test.js` (31 Tests)

| Bereich | Tests | Beschreibung |
|---------|-------|-------------|
| parseInfoTimestamp | 9 | UTC-Parsing, Quotes, null/undefined/empty, Edge Cases |
| shouldWarnSidecarBeforeImage | 4 | Rate-Limiting, verschiedene Filenames, LRU-Groessenlimit |
| parseSidecarFilename integration | 3 | Alle Sidecar-Extensions, Supplements nicht erkannt |
| .desc empty semantics | 2 | Whitespace → null, Non-empty erhalten |
| .md5 parsing | 3 | "hash  filename" Format, pure hash, multiple spaces |
| .info key=value parsing | 5 | Production-Format, unbekannte Keys, Header ignoriert, leere Datei |
| parseInfoTimestamp edge cases | 3 | Extra Zeichen, Schaltjahr, Quoted Timestamps |

---

## .info Datei-Format

Produktions-Format (vom LINBO-Client via `linbo_mkinfo` generiert):

```
["ubuntu.qcow2" Info File]
timestamp="202507291424"
image="ubuntu.qcow2"
imagesize="8482210304"
partition="/dev/nvme0n1p3"
partitionsize="52428800"
```

**Parsing:** Whitelist-Keys (`timestamp`, `image`, `imagesize`, `partition`, `partitionsize`). Unbekannte Keys werden ignoriert. Timestamp als UTC interpretiert: `"202601271107"` → `2026-01-27T11:07:00.000Z`.

---

## Image-Erstellungs-Workflow (Analyse)

Analyse des vollstaendigen Workflows: PXE Boot → Partitionieren → Windows installieren → Domain Join → LINBO Image erstellen → Upload.

### Ablauf im Docker-Setup

| Schritt | Funktioniert | Details |
|---------|-------------|---------|
| 1. PXE Boot + LINBO laden | Ja | DHCP → TFTP → GRUB → linbo64 + linbofs64 |
| 2. Festplatte partitionieren | Ja | LINBO-Client arbeitet lokal |
| 3. Windows installieren (ISO) | Ja | Manuell per BIOS Boot-Menue |
| 4. Domain Join | Ja | Erfordert DC Worker + AD DC |
| 5. Neustarten → LINBO GUI | Ja | GRUB laedt LINBO, start.conf vom Server |
| 6. Image erstellen | Ja | `linbo_create_image` nutzt `qemu-img convert` lokal |
| 7. Image hochladen | Ja* | `linbo_upload` nutzt rsync zu `linbo-upload` Modul |

**\* Hinweis:** Das rsync-Passwort im Docker-Setup (`linbo_rsync_secret`) unterscheidet sich vom Produktions-Passwort (`Muster!`). Der Benutzer muss in der LINBO GUI das Docker-Passwort eingeben.

### Client-seitige Scripts (aus linbofs64 extrahiert)

- **`linbo_create_image`:** Nutzt `qemu-img convert -p -c -f raw -O qcow2` fuer Base-Images, `qemu-nbd` + rsync fuer Differential-Images. Generiert `.info` via `linbo_mkinfo` und `.torrent` via `linbo_mktorrent`.
- **`linbo_upload`:** Exportiert `RSYNC_PASSWORD` aus erstem CLI-Argument. Laedt Image + Sidecars (.info, .desc, .torrent) hoch zu `linbo@$LINBOSERVER::linbo-upload/images/<base>/<filename>`.
- **`LINBOSERVER`:** Wird aus `start.conf` `Server=` gelesen (via `/conf/linbo` Sourcing im initramfs). Im Docker-Setup: `Server = 10.0.0.13`.

---

## Verifikation

- [x] Schema: `imageInfo` + `infoUpdatedAt` Felder per `prisma db push` angewendet
- [x] Sidecar-Upload: `.info`/`.desc`/`.torrent`/`.md5` werden von internal.js verarbeitet
- [x] Catch-up: Sidecars vor Image → nach Image-Registrierung korrekt nachgeholt
- [x] Rate-limited Warnings: Max 1x/min pro Dateiname
- [x] API: `GET /images?includeSidecars=true` liefert sidecarSummary
- [x] API: `GET /images/:id` liefert sidecars + fileSize
- [x] API: `GET /images/:id/sidecars/desc` liest Sidecar-Inhalt
- [x] API: `PUT /images/:id/sidecars/reg` schreibt Datei + Audit-Log
- [x] API: `PUT /images/:id/sidecars/info` → 400 (read-only)
- [x] Delete: `?deleteFile=true` entfernt komplettes Image-Verzeichnis
- [x] Frontend: Sidecar-Badges + Detail-Modal mit 5 Tabs
- [x] Tests: 535 gesamt (525 passing)
- [x] Container rebuilt: api, rsync, web
- [x] Health-Check OK
