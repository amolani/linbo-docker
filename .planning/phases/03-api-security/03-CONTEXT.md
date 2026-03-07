# Phase 3: API Security - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Protect API endpoints against unauthenticated WebSocket access, brute-force login, and cross-origin abuse. Three requirements: WebSocket JWT verification (PROD-06), login rate-limiting (PROD-07), CORS restriction (PROD-08).

</domain>

<decisions>
## Implementation Decisions

### WebSocket authentication
- Both JWT tokens AND INTERNAL_API_KEY are accepted for `/ws` connections (users + internal services)
- Token passed via `?token=` query parameter — consistent with existing Terminal WS pattern
- Token verified only at connection upgrade time — established connections are not interrupted on token expiry
- Rejected connections get HTTP 401 response before the upgrade completes (socket destroyed, no WebSocket handshake)
- INTERNAL_API_KEY passed as `?token=<key>` — same mechanism, server checks against env var

### Claude's Discretion
- **Rate limiting implementation:** Library choice (e.g., express-rate-limit), storage backend (in-memory vs Redis), sliding vs fixed window, Retry-After header format, exact 429 response body
- **Rate limit scope:** Whether to apply only to POST /auth/login or also to /auth/register and /auth/password — user trusts Claude's judgment
- **CORS default value:** What the default origin should be when CORS_ORIGIN is not set (replacing current wildcard `*`), and whether to add a production startup warning for CORS_ORIGIN=*
- **Rate limit UX details:** Lockout window behavior, reset mechanism, response format

</decisions>

<specifics>
## Specific Ideas

- Terminal WS already uses `?token=` pattern — this is the reference implementation for main WS auth
- Success criteria from roadmap are explicit: HTTP 401 for unauthenticated WS, HTTP 429 after 5 failed logins/min/IP, no wildcard CORS default
- User understands security concepts at a high level but trusts Claude on implementation details

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `verifyToken()` in `containers/api/src/middleware/auth.js` — JWT verification, ready to reuse
- Terminal WS auth pattern in `index.js:401-411` — reference for `?token=` query param verification
- `INTERNAL_API_KEY` check pattern in `auth.js:72-78` — plain string comparison against env var

### Established Patterns
- `noServer: true` WebSocket setup with manual `server.on('upgrade')` routing in `index.js:503-517`
- CORS configured via `cors()` middleware in `index.js:50-53` with `CORS_ORIGIN` env var
- Startup validation pattern in `index.js:177-216` (validateSecrets) — can extend for CORS warning
- Prisma-optional pattern throughout — rate limiter should work without database

### Integration Points
- WebSocket upgrade handler: `index.js:503-517` — add JWT verification before `wss.handleUpgrade()`
- Login route: `containers/api/src/routes/auth.js:40` — add rate-limit middleware before handler
- CORS middleware: `index.js:50-53` — change default from `*` to specific origin
- Startup validation: `index.js:177-216` — add CORS_ORIGIN=* production warning

</code_context>

<deferred>
## Deferred Ideas

- Token revocation (server-side JWT blacklist in Redis) — already tracked as SEC-01 in v2 requirements
- CORS_ORIGIN validation was deferred from Phase 2 and is now addressed here

</deferred>

---

*Phase: 03-api-security*
*Context gathered: 2026-03-07*
