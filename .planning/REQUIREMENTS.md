# Requirements: LINBO Docker

**Defined:** 2026-03-10
**Core Value:** LINBO als eigenständige Docker-Lösung mit modernem Web-Interface, ohne den LINBO-Kern zu verändern

## v1.2 Requirements

Requirements for linbofs Boot-Pipeline Transparency. Each maps to roadmap phases.

### Pipeline-Transparenz

- [x] **DIFF-01**: LMN-Original `update-linbofs` als Referenzdatei im Repo gepinnt (`scripts/server/update-linbofs-lmn-original.sh`)
- [x] **DIFF-02**: `make linbofs-audit` zeigt linbofs64-Inhalt (Kernel-Version, Modul-Anzahl, SSH-Key-Fingerprints, Firmware, Hook-modifizierte Dateien)
- [x] **DIFF-03**: `make linbofs-diff` vergleicht Template-linbofs64.xz mit gebautem linbofs64 (was hat Docker geaendert?)
- [x] **DIFF-04**: Divergenz-Katalog in `docs/UNTERSCHIEDE-ZU-LINBO.md` (3-Spalten: LMN / Docker / Begruendung)
- [x] **DIFF-05**: CPIO-Concat-Format dokumentiert in update-linbofs.sh Header-Kommentaren

### Hook-Observability

- [x] **HOOK-01**: Build-Manifest JSON (`.linbofs-build-manifest.json`) mit Hook-Namen, Exit-Codes, Datei-Counts, Timestamp
- [x] **HOOK-02**: Build-Log Retention (`.linbofs-build.log`, letzte 3 Builds, via linbofs.service.js)
- [x] **HOOK-03**: `GET /system/hooks` API-Endpoint (installierte Hooks, letzter Exit-Code, Executable-Status)
- [x] **HOOK-04**: `validate-hook.sh` Script (Shebang, Executable-Bit, Pfad-Validierung)
- [x] **HOOK-05**: Hook-Scaffold-Generator (`make new-hook NAME=... TYPE=...`)
- [x] **HOOK-06**: `.linbofs-patch-status` erweitert um Hook-Warning-Summary

### Update-Hardening

- [x] **UPD-01**: `linbo-update.service.test.js` erweitert (Partial-Failure, Concurrent Update 409, Version-Edge-Cases)
- [ ] **UPD-02**: Pre-Injection Path Check in update-linbofs.sh (Zielverzeichnisse existieren im extrahierten linbofs)
- [ ] **UPD-03**: Size-Range-Check (warn >80MB, fail >200MB) + Modul-Count-Verifikation (`.ko` > 0)
- [ ] **UPD-04**: Post-Rebuild CPIO-Verifikation (beide XZ-Segmente valide, `dev/console` vorhanden)
- [ ] **UPD-05**: Module-Diff Script (Docker vs LMN linbofs64 Modul-Liste vergleichen)
- [ ] **UPD-06**: Boot-Test-Runbook in `docs/linbo-upgrade-flow.md`
- [ ] **UPD-07**: `make doctor` um APT-Repo-Connectivity-Check erweitern

## Future Requirements

### Security Hardening (v2+)

- **SEC-01**: Token-Revocation (Server-side JWT Blacklist in Redis)
- **SEC-02**: execFile statt exec für dpkg/dpkg-deb Aufrufe (Shell-Injection Prevention)
- **SEC-03**: API-Key Authentifizierung optimieren (Prefix-Lookup statt O(N) bcrypt)

### Missing Features (v2+)

- **FEAT-01**: Multicast Image Distribution (udpcast)
- **FEAT-02**: Torrent Image Distribution (ctorrent)
- **FEAT-03**: Image Versioning
- **FEAT-04**: Host-GRUB .img Generation

### Open-Source Readiness (v2+)

- **OSS-01**: GITHUB_TOKEN-Abhängigkeit für @edulution-io/ui-kit aufgelöst
- **OSS-02**: deploy/docker-compose.yml konsolidiert oder entfernt

## Out of Scope

| Feature | Reason |
|---------|--------|
| init.sh SERVERID Patch | Deferred — Ansatz (Hook vs GRUB cmdline) noch nicht entschieden, erst nach Hook-Governance |
| Hook Criticality Model | Design erst nach realen Failure-Patterns, nicht vorab |
| Firmware Audit | Nützlich aber nicht blocking für v1.2 |
| LINBO-Kern modifizieren | Prinzip: nur Hooks, nie init.sh/linbo.sh ändern |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DIFF-01 | Phase 13 | Complete |
| DIFF-02 | Phase 13 | Complete |
| DIFF-03 | Phase 13 | Complete |
| DIFF-04 | Phase 13 | Complete |
| DIFF-05 | Phase 13 | Complete |
| HOOK-01 | Phase 14 | Complete |
| HOOK-02 | Phase 14 | Complete |
| HOOK-03 | Phase 14 | Complete |
| HOOK-04 | Phase 14 | Complete |
| HOOK-05 | Phase 14 | Complete |
| HOOK-06 | Phase 14 | Complete |
| UPD-01 | Phase 15 | Complete |
| UPD-02 | Phase 15 | Pending |
| UPD-03 | Phase 15 | Pending |
| UPD-04 | Phase 15 | Pending |
| UPD-05 | Phase 15 | Pending |
| UPD-06 | Phase 15 | Pending |
| UPD-07 | Phase 15 | Pending |

**Coverage:**
- v1.2 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after roadmap creation*
