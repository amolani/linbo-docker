# Phase 2: Secrets Hardening - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

No default credentials or tracked secrets can reach production. API startup validation, deploy script auth migration, rsyncd.secrets cleanup.

</domain>

<decisions>
## Implementation Decisions

### Startup validation
- Block API start in NODE_ENV=production if JWT_SECRET or INTERNAL_API_KEY have default values
- Exit with clear error message naming the offending variable
- Only JWT_SECRET and INTERNAL_API_KEY — NOT ADMIN_PASSWORD or DB_PASSWORD
- In NODE_ENV=development: log warning if defaults are used, but don't block
- CORS_ORIGIN validation is Phase 3 scope — not included here

### Deploy script auth
- Read INTERNAL_API_KEY from remote server's .env file (SSH into target, grep .env)
- Use X-Internal-Key header directly — no login/JWT flow needed
- deploy.sh is a development tool, not for production deployments
- Include rsync container restart in --rebuild flow
- Multi-target support: comma-separated hosts (e.g., `deploy.sh host1,host2 --rebuild`)
- Targets execute in user-specified order (no automatic sorting/enforcement)

### rsyncd.secrets cleanup
- Remove config/rsyncd.secrets from git tracking
- Add config/rsyncd.secrets to .gitignore
- Create config/rsyncd.secrets.example with simple placeholder (linbo:CHANGE_ME), no generation hints

### Claude's Discretion
- Fallback behavior when INTERNAL_API_KEY not found in remote .env
- Error handling for multi-target deploys (stop on first failure vs continue)
- Exact error messages for startup validation
- Default value detection patterns (exact string match vs regex)

</decisions>

<specifics>
## Specific Ideas

- deploy.sh is a dev tool for syncing code to test servers, not a production deployment mechanism
- deploy/install.sh handles first-time production setup (separate script, not in Phase 2 scope)
- Current deploy.sh hardcodes admin/Muster! — this is the auth pattern being replaced

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- API auth middleware already supports X-Internal-Key header (containers/api/src/middleware/auth.js)
- rsync hook scripts already read INTERNAL_API_KEY from env with fallback to default

### Established Patterns
- docker-compose.yml uses `${VAR:-default}` pattern for all env vars
- .env file at project root holds actual values
- .env.example exists at root and in containers/api/

### Integration Points
- API startup: containers/api/src/index.js (add validation before server.listen)
- Deploy script: scripts/deploy.sh (replace login auth with X-Internal-Key)
- Git tracking: config/rsyncd.secrets (remove), .gitignore (add entry)
- rsync hooks: containers/rsync/scripts/*.sh (already use INTERNAL_API_KEY env var)

</code_context>

<deferred>
## Deferred Ideas

- ADMIN_PASSWORD default validation — could be added later but not required for PROD-02
- DB_PASSWORD default validation — PostgreSQL only reachable internally
- CORS_ORIGIN=* warning — belongs in Phase 3 (API Security)

</deferred>

---

*Phase: 02-secrets-hardening*
*Context gathered: 2026-03-07*
