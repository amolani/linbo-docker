# Requirements: LINBO Docker

**Defined:** 2026-03-06
**Core Value:** LINBO als eigenständige Docker-Lösung mit modernem Web-Interface, ohne den LINBO-Kern zu verändern

## v1 Requirements

### Production-Readiness

- [ ] **PROD-01**: Docker Base-Images mit festen Version-Tags gepinnt (reproduzierbare Builds)
- [ ] **PROD-02**: API verweigert Start wenn JWT_SECRET oder INTERNAL_API_KEY Default-Werte haben (NODE_ENV=production)
- [ ] **PROD-03**: .dockerignore in allen Container-Verzeichnissen vorhanden (kein node_modules/Host-Artefakte)
- [ ] **PROD-04**: Deploy-Script nutzt INTERNAL_API_KEY statt Default-Admin-Passwort für Rebuilds
- [ ] **PROD-05**: rsyncd.secrets aus Git-Tracking entfernt, rsyncd.secrets.example bereitgestellt
- [ ] **PROD-06**: WebSocket `/ws` Endpoint verifiziert JWT-Token bei Connection-Upgrade
- [ ] **PROD-07**: Rate-Limiting auf POST /auth/login (5 Versuche/Minute/IP)
- [ ] **PROD-08**: CORS Default auf Web-Container Origin statt Wildcard `*`

### Test Coverage

- [ ] **TEST-01**: Unit-Tests für Image-Sync Service (Resume-Download, SHA256-Verify, Atomic Directory Swap, Queue)
- [ ] **TEST-02**: Unit-Tests für Terminal Service (Session-Create/Destroy, PTY/Exec-Fallback, Idle-Timeout, Cleanup)
- [ ] **TEST-03**: Integration-Tests für WebSocket (Connection mit/ohne Auth, Heartbeat, Channel-Subscription, Broadcast)
- [ ] **TEST-04**: Frontend-Tests für kritische Zustand-Stores (wsStore Reconnect, hostStore Merge, configStore Cache)

### Tech-Debt

- [ ] **DEBT-01**: Alle 31 silent catch-blocks durch kategorisiertes Logging ersetzen (debug/warn/rethrow)
- [ ] **DEBT-02**: system.js (1483 Zeilen) in Sub-Router splitten: kernel, firmware, grub-theme, grub-config, linbo-update, worker, wlan
- [ ] **DEBT-03**: operation.worker.js Prisma-optional Pattern anwenden (try/catch Guard statt top-level require)
- [ ] **DEBT-04**: Redis KEYS-Command durch SCAN-basierte Iteration in delPattern() ersetzen

## v2 Requirements

### Security Hardening

- **SEC-01**: Token-Revocation (Server-side JWT Blacklist in Redis)
- **SEC-02**: execFile statt exec für dpkg/dpkg-deb Aufrufe (Shell-Injection Prevention)
- **SEC-03**: API-Key Authentifizierung optimieren (Prefix-Lookup statt O(N) bcrypt)

### Missing Features

- **FEAT-01**: Multicast Image Distribution (udpcast)
- **FEAT-02**: Torrent Image Distribution (ctorrent)
- **FEAT-03**: Image Versioning
- **FEAT-04**: Host-GRUB .img Generation

## Out of Scope

| Feature | Reason |
|---------|--------|
| LINBO-Kern modifizieren | Prinzip: nur Hooks, nie init.sh/linbo.sh ändern |
| Sophomorix/LDAP Integration | LMN-seitig, nicht Docker-Scope |
| Mobile App | Web-first, responsive reicht |
| Multi-Instance API | Single-Container Constraint akzeptiert (Module-Level State) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROD-01 | Phase 1: Build Hygiene | Pending |
| PROD-02 | Phase 2: Secrets Hardening | Pending |
| PROD-03 | Phase 1: Build Hygiene | Pending |
| PROD-04 | Phase 2: Secrets Hardening | Pending |
| PROD-05 | Phase 2: Secrets Hardening | Pending |
| PROD-06 | Phase 3: API Security | Pending |
| PROD-07 | Phase 3: API Security | Pending |
| PROD-08 | Phase 3: API Security | Pending |
| TEST-01 | Phase 7: Backend Test Suites | Pending |
| TEST-02 | Phase 7: Backend Test Suites | Pending |
| TEST-03 | Phase 8: Integration and Frontend Tests | Pending |
| TEST-04 | Phase 8: Integration and Frontend Tests | Pending |
| DEBT-01 | Phase 5: Error Handling Cleanup | Pending |
| DEBT-02 | Phase 4: System Router Split | Pending |
| DEBT-03 | Phase 6: Isolated Debt Fixes | Pending |
| DEBT-04 | Phase 6: Isolated Debt Fixes | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-06 after roadmap creation*
