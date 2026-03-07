# Phase 3: API Security - Research

**Researched:** 2026-03-07
**Domain:** Express.js API security (WebSocket auth, rate limiting, CORS)
**Confidence:** HIGH

## Summary

Phase 3 addresses three specific security gaps in the LINBO Docker API: unauthenticated WebSocket access (PROD-06), brute-force login attempts (PROD-07), and wildcard CORS default (PROD-08). All three are well-understood problems with established solutions in the Express.js ecosystem.

The codebase already has the building blocks: `verifyToken()` in `auth.js` for JWT verification, `INTERNAL_API_KEY` pattern for service-to-service auth, a `?token=` query-param pattern used by Terminal WS, and `ioredis` already installed for Redis-backed rate limiting. The main work is wiring these existing primitives into the WebSocket upgrade handler and adding `express-rate-limit` middleware.

One critical gap discovered: the Express app has **no `trust proxy` setting**, but sits behind nginx which sends `X-Forwarded-For` and `X-Real-IP` headers. Without `app.set('trust proxy', ...)`, `req.ip` always returns the nginx container's internal IP, making per-IP rate limiting useless. This MUST be fixed as part of the rate limiting work.

**Primary recommendation:** Use existing `verifyToken()` + INTERNAL_API_KEY check in the WebSocket upgrade handler, `express-rate-limit` v8 with `rate-limit-redis` for login rate limiting, and change CORS default from `*` to `http://localhost:8080` with a production startup warning.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Both JWT tokens AND INTERNAL_API_KEY are accepted for `/ws` connections (users + internal services)
- Token passed via `?token=` query parameter -- consistent with existing Terminal WS pattern
- Token verified only at connection upgrade time -- established connections are not interrupted on token expiry
- Rejected connections get HTTP 401 response before the upgrade completes (socket destroyed, no WebSocket handshake)
- INTERNAL_API_KEY passed as `?token=<key>` -- same mechanism, server checks against env var

### Claude's Discretion
- **Rate limiting implementation:** Library choice (e.g., express-rate-limit), storage backend (in-memory vs Redis), sliding vs fixed window, Retry-After header format, exact 429 response body
- **Rate limit scope:** Whether to apply only to POST /auth/login or also to /auth/register and /auth/password -- user trusts Claude's judgment
- **CORS default value:** What the default origin should be when CORS_ORIGIN is not set (replacing current wildcard `*`), and whether to add a production startup warning for CORS_ORIGIN=*
- **Rate limit UX details:** Lockout window behavior, reset mechanism, response format

### Deferred Ideas (OUT OF SCOPE)
- Token revocation (server-side JWT blacklist in Redis) -- already tracked as SEC-01 in v2 requirements
- CORS_ORIGIN validation was deferred from Phase 2 and is now addressed here
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROD-06 | WebSocket `/ws` endpoint verifies JWT token at connection upgrade | Existing `verifyToken()` + INTERNAL_API_KEY pattern; manual verification in `server.on('upgrade')` handler at index.js:503-517 |
| PROD-07 | Rate-Limiting on POST /auth/login (5 attempts/minute/IP) | `express-rate-limit` v8 + `rate-limit-redis` with ioredis; requires `trust proxy` fix |
| PROD-08 | CORS default on web container origin instead of wildcard `*` | Change `index.js:51` default from `*`; add startup warning in `validateSecrets()` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express-rate-limit | ^8.3.0 | Login rate limiting middleware | De facto standard for Express rate limiting; 12M+ weekly npm downloads |
| rate-limit-redis | ^4.3.1 | Redis-backed store for express-rate-limit | Official companion package; works with ioredis |

### Already Installed (reuse)
| Library | Version | Purpose | Already In |
|---------|---------|---------|------------|
| jsonwebtoken | ^9.0.2 | JWT verify for WebSocket auth | package.json |
| ioredis | ^5.3.2 | Redis client (rate limit store) | package.json |
| ws | ^8.16.0 | WebSocket server (noServer mode) | package.json |
| cors | ^2.8.5 | CORS middleware | package.json |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| express-rate-limit | Custom Redis INCR/EXPIRE | More code, more bugs, no community testing |
| rate-limit-redis | In-memory store (default) | Works but resets on restart; multi-instance unsafe. Redis is already available. |
| Manual Origin check on WS | verifyClient callback | Project uses noServer:true so verifyClient is not available; manual check in upgrade handler is the only option |

**Installation:**
```bash
cd containers/api && npm install express-rate-limit@^8 rate-limit-redis@^4
```

## Architecture Patterns

### Integration Points (existing code)

```
index.js:50-53     CORS middleware          -> change default, add warning
index.js:177-216   validateSecrets()        -> extend with CORS_ORIGIN=* warning
index.js:503-517   server.on('upgrade')     -> add JWT/API-key verification before wss.handleUpgrade
routes/auth.js:40  POST /login handler      -> prepend rate-limit middleware
middleware/auth.js  verifyToken(), INTERNAL_API_KEY check -> reuse in WS upgrade
```

### Pattern 1: WebSocket JWT Verification at Upgrade

**What:** Verify token from `?token=` query param before calling `wss.handleUpgrade()`
**When to use:** For the `/ws` endpoint (main WebSocket)
**Key insight:** The Terminal WS (`/ws/terminal`) already does this AFTER the upgrade (inside `terminalWss.on('connection')`). For `/ws`, the user decision is to reject BEFORE upgrade (HTTP 401 + socket.destroy).

```javascript
// In server.on('upgrade') handler, for pathname === '/ws':
const url = new URL(request.url, `http://${request.headers.host}`);
const token = url.searchParams.get('token');

if (!token) {
  socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
  socket.destroy();
  return;
}

// Check INTERNAL_API_KEY first (plain string comparison)
const internalKey = process.env.INTERNAL_API_KEY;
if (internalKey && token === internalKey) {
  // Internal service -- allow upgrade
  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.user = { id: 'internal', username: 'internal-service', role: 'admin' };
    wss.emit('connection', ws, request);
  });
  return;
}

// Then try JWT verification
try {
  const decoded = verifyToken(token);
  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.user = decoded;
    wss.emit('connection', ws, request);
  });
} catch (err) {
  socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
  socket.destroy();
}
```

### Pattern 2: Rate Limiting with Redis Store

**What:** express-rate-limit middleware with Redis-backed sliding window
**When to use:** On auth routes that accept credentials

```javascript
const { rateLimit } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../lib/redis');

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,           // 1 minute
  limit: 5,                       // 5 attempts per window
  standardHeaders: 'draft-7',     // RateLimit-* headers
  legacyHeaders: false,            // no X-RateLimit-* headers
  keyGenerator: (req) => req.ip,   // per-IP (requires trust proxy)
  store: new RedisStore({
    sendCommand: (command, ...args) => redis.getClient().call(command, ...args),
    prefix: 'rl:login:',
  }),
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Please try again later.',
    },
  },
});
```

### Pattern 3: CORS Default Change

**What:** Replace wildcard `*` default with web container origin
**When to use:** In CORS middleware configuration

```javascript
// Default to web container origin (port 8080 in production)
const CORS_DEFAULT = 'http://localhost:8080';

app.use(cors({
  origin: process.env.CORS_ORIGIN || CORS_DEFAULT,
  credentials: true,
}));
```

### Pattern 4: Trust Proxy Configuration

**What:** Enable Express trust proxy so req.ip uses X-Forwarded-For from nginx
**Why critical:** Without this, ALL rate limiting keys to the nginx container IP, effectively a single shared counter

```javascript
// The API runs behind nginx (containers/web/nginx.conf proxies to api:3000)
// nginx sends X-Real-IP and X-Forwarded-For headers
// 'loopback, linklocal, uniquelocal' trusts private IPs (Docker network)
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
```

### Anti-Patterns to Avoid
- **Checking token AFTER WebSocket upgrade:** Once `handleUpgrade()` is called, the handshake is complete. An unauthenticated client briefly has a live WS connection. Must verify BEFORE upgrade.
- **Using in-memory rate limit store:** Resets on API container restart, and does not share state if scaled. Redis is already available.
- **Forgetting `trust proxy`:** All requests appear from the same Docker internal IP. Rate limiting becomes useless.
- **Sending detailed error messages on auth failure:** "Token expired" vs "Invalid token" distinction leaks information. For WS, just return 401.
- **Blocking established WS connections on token expiry:** User decision is verify-at-connect-only. Existing connections persist until disconnect.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom Redis INCR+TTL counter | express-rate-limit + rate-limit-redis | Handles edge cases: race conditions, atomic increment, sliding window, header generation, IPv6 subnet grouping |
| Token extraction from query | Custom URL parser | `new URL(request.url, ...)` + `searchParams.get('token')` | Standard API, handles encoding edge cases |
| CORS headers | Manual Access-Control-* headers | `cors` middleware (already installed) | Handles preflight, credentials, methods, headers |

**Key insight:** The rate limiting problem seems simple (INCR key, check count) but has subtle race conditions with concurrent requests. express-rate-limit + Redis store handles atomic operations correctly.

## Common Pitfalls

### Pitfall 1: Missing `trust proxy` setting
**What goes wrong:** `req.ip` returns Docker internal IP (e.g., `172.18.0.5`) for ALL requests. Rate limiting applies to all users collectively, not per-user.
**Why it happens:** Express defaults to trusting the direct connection, not proxy headers. The API sits behind nginx in Docker.
**How to avoid:** Add `app.set('trust proxy', 'loopback, linklocal, uniquelocal')` BEFORE any middleware that uses `req.ip`.
**Warning signs:** All rate-limited responses fire at the same time for all users; Redis shows only one rate-limit key.

### Pitfall 2: WebSocket CORS is NOT enforced by browsers
**What goes wrong:** Assuming CORS middleware protects WebSocket connections. Browsers do NOT enforce CORS on WebSocket upgrades.
**Why it happens:** WebSocket operates over WS/WSS protocol, not HTTP. SOP/CORS only applies to HTTP responses.
**How to avoid:** JWT token verification at upgrade time is the primary protection. Optionally check `Origin` header in upgrade handler as defense-in-depth.
**Warning signs:** Cross-origin WebSocket connections succeed even with restrictive CORS policy.

### Pitfall 3: Rate limit bypass via X-Forwarded-For spoofing
**What goes wrong:** Attacker sends custom `X-Forwarded-For` headers to rotate rate-limit keys.
**Why it happens:** If `trust proxy` is set to `true` (trust all), the last hop IP in the header is used.
**How to avoid:** Use `'loopback, linklocal, uniquelocal'` instead of `true`. This only trusts private-range IPs (the Docker network) and ignores client-supplied headers.
**Warning signs:** Rate limits never trigger during testing with spoofed headers.

### Pitfall 4: Breaking existing frontend WebSocket connections
**What goes wrong:** Frontend WS connections fail after adding auth to `/ws` upgrade.
**Why it happens:** Frontend `wsStore.ts` already sends `?token=${token}` (line 56), but also has a fallback path where it connects without token (line 56: `token ? ... : WS_URL`).
**How to avoid:** After implementing WS auth, the frontend will fail to connect without a token. This is the DESIRED behavior -- but verify that the frontend always has a token before connecting. The wsStore.ts `connect()` reads `localStorage.getItem('token')` and passes it if available. Connections without token will now be rejected (401).
**Warning signs:** WebSocket "connected" status never turns true after login until page refresh.

### Pitfall 5: CORS change breaking development workflow
**What goes wrong:** Changing CORS default from `*` breaks Vite dev proxy or direct API access during development.
**Why it happens:** Vite dev server runs on port 5173, not 8080.
**How to avoid:** The `CORS_ORIGIN` env var still works for overrides. Document that developers should set `CORS_ORIGIN=*` in `.env` for local development. In Docker, the web container proxies through nginx so CORS origin matching works.
**Warning signs:** 403 CORS errors in browser console during development.

## Code Examples

### Example 1: WebSocket Auth in Upgrade Handler (verified pattern from existing Terminal WS)

Source: `containers/api/src/index.js:401-411` (Terminal WS auth pattern, adapted for pre-upgrade check)

```javascript
// Current Terminal WS auth (AFTER upgrade -- reference only):
terminalWss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  let user;
  try {
    user = verifyToken(token);
  } catch (err) {
    ws.close(4001, 'Authentication failed');
    return;
  }
  // ...
});

// NEW: Main WS auth (BEFORE upgrade):
// In server.on('upgrade') handler, for pathname === '/ws':
// See Pattern 1 above for full implementation
```

### Example 2: express-rate-limit with ioredis

Source: rate-limit-redis official docs (GitHub)

```javascript
const { RedisStore } = require('rate-limit-redis');

// ioredis integration -- use .call() method
const store = new RedisStore({
  sendCommand: (command, ...args) =>
    redisClient.call(command, ...args),
  prefix: 'rl:login:',
});
```

### Example 3: HTTP 401 Response on Raw Socket (before WebSocket upgrade)

Source: ws library docs + Node.js net module

```javascript
// Write HTTP response directly to the raw TCP socket
// This is the standard pattern when rejecting a WebSocket upgrade
socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
socket.destroy();
```

### Example 4: Frontend Already Sends Token

Source: `containers/web/frontend/src/stores/wsStore.ts:54-58`

```typescript
const token = localStorage.getItem('token');
const wsUrl = token ? `${WS_URL}?token=${token}` : WS_URL;
const ws = new WebSocket(wsUrl);
```

The frontend already sends the token if available. After enabling WS auth, unauthenticated connections (no token in localStorage) will be rejected with 401. This is correct behavior -- users must log in first.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| express-rate-limit `max` option | `limit` option | v7.x (2024) | `max` deprecated, use `limit` |
| X-RateLimit-* headers | RateLimit-* (draft-7/8) | v7.x (2024) | Use `standardHeaders: 'draft-7'`, `legacyHeaders: false` |
| verifyClient callback on ws | Manual check in upgrade handler | Ongoing | verifyClient unavailable with `noServer: true` |
| CORS wildcard for dev ease | Explicit origins | Security best practice | Wildcard should never be production default |

**Deprecated/outdated:**
- `express-rate-limit` `max` option: renamed to `limit` in v7+
- `X-RateLimit-Remaining` / `X-RateLimit-Limit` headers: replaced by `RateLimit-*` standard headers

## Discretionary Recommendations

### Rate limit scope: Login only vs. all auth endpoints

**Recommendation: Apply rate limiting to POST /auth/login only.**

Rationale:
- `/auth/register` requires an authenticated admin session (`authenticateToken` middleware). An attacker cannot brute-force registration without already being authenticated.
- `/auth/password` also requires authentication. Rate-limiting authenticated routes provides minimal value since the attacker already has a valid token.
- `/auth/login` is the ONLY unauthenticated credential-accepting endpoint.

### CORS default value

**Recommendation: Default to `http://localhost:${WEB_PORT || 8080}`.**

Rationale:
- In Docker production, the web container serves on port 8080 (configurable via `WEB_PORT`). The API receives requests proxied through nginx, so the Origin header matches the web container's external URL.
- Defaulting to `http://localhost:8080` is safe: it matches the most common single-machine Docker deployment.
- For custom domains or HTTPS, operators set `CORS_ORIGIN` explicitly in docker-compose.yml.

### CORS_ORIGIN=* startup warning

**Recommendation: Yes, add a warning in `validateSecrets()` (rename to `validateStartup()`).**

Rationale:
- Consistent with Phase 2's secrets validation pattern.
- Production with `CORS_ORIGIN=*` is a security risk. Warning (not blocking) is appropriate because some setups legitimately need wildcard CORS (e.g., multi-domain access).

### Rate limit response format

**Recommendation:**
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many login attempts. Please try again later."
  }
}
```
Plus `Retry-After` header (standard). Consistent with existing error response format throughout the API.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `containers/api/jest.config.js` |
| Quick run command | `cd containers/api && npx jest --testPathPattern='<pattern>' --runInBand` |
| Full suite command | `cd containers/api && npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROD-06 | WS connection without valid token rejected at upgrade (401) | unit | `cd containers/api && npx jest tests/middleware/ws-auth.test.js --runInBand` | No -- Wave 0 |
| PROD-06 | WS connection with valid JWT token succeeds | unit | `cd containers/api && npx jest tests/middleware/ws-auth.test.js --runInBand` | No -- Wave 0 |
| PROD-06 | WS connection with INTERNAL_API_KEY succeeds | unit | `cd containers/api && npx jest tests/middleware/ws-auth.test.js --runInBand` | No -- Wave 0 |
| PROD-07 | 6th login attempt within 1 minute returns 429 | unit | `cd containers/api && npx jest tests/middleware/rate-limit.test.js --runInBand` | No -- Wave 0 |
| PROD-07 | 5th attempt within 1 minute still succeeds (returns 401 or 200) | unit | `cd containers/api && npx jest tests/middleware/rate-limit.test.js --runInBand` | No -- Wave 0 |
| PROD-07 | Retry-After header present on 429 response | unit | `cd containers/api && npx jest tests/middleware/rate-limit.test.js --runInBand` | No -- Wave 0 |
| PROD-08 | CORS default is not wildcard `*` | unit | `cd containers/api && npx jest tests/startup-validation.test.js --runInBand` | Partial (file exists, new tests needed) |
| PROD-08 | CORS_ORIGIN=* in production triggers warning | unit | `cd containers/api && npx jest tests/startup-validation.test.js --runInBand` | Partial (file exists, new tests needed) |

### Sampling Rate
- **Per task commit:** `cd containers/api && npx jest tests/middleware/ws-auth.test.js tests/middleware/rate-limit.test.js tests/startup-validation.test.js --runInBand`
- **Per wave merge:** `cd containers/api && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/middleware/ws-auth.test.js` -- covers PROD-06 (WS JWT verification)
- [ ] `tests/middleware/rate-limit.test.js` -- covers PROD-07 (login rate limiting)
- [ ] New test cases in existing `tests/startup-validation.test.js` -- covers PROD-08 (CORS warning)

## Open Questions

1. **Frontend behavior when WS auth fails**
   - What we know: `wsStore.ts` attempts connection with token if available, falls back to no-token URL. After WS auth enforcement, no-token connections will fail with 401 and trigger reconnect loop (up to `maxReconnectAttempts: 5`).
   - What's unclear: Whether the frontend gracefully handles WS 401 rejection (shows "not connected" indicator vs. crash). The `ws.onerror` and `ws.onclose` handlers exist but the error path is untested.
   - Recommendation: This is a UI/UX concern, not a blocker. The frontend already has reconnect logic with backoff. If the user is not logged in, the WS simply won't connect, which is correct behavior. No frontend changes needed for Phase 3.

2. **Rate limit behavior during legitimate burst logins (e.g., after server restart)**
   - What we know: Fixed window of 5/minute/IP. A classroom of students behind a single NAT IP could hit the limit.
   - What's unclear: Whether the school network topology has NAT (likely yes for student devices).
   - Recommendation: 5/minute/IP is the user-specified requirement. Accept this limitation. Can be increased via env var if needed (future enhancement, not Phase 3 scope).

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `containers/api/src/index.js` -- WebSocket setup, CORS config, upgrade handler
- Codebase inspection: `containers/api/src/middleware/auth.js` -- `verifyToken()`, INTERNAL_API_KEY check
- Codebase inspection: `containers/api/src/routes/auth.js` -- login route at line 40
- Codebase inspection: `containers/web/frontend/src/stores/wsStore.ts` -- frontend WS connection pattern
- Codebase inspection: `containers/web/nginx.conf` -- proxy headers (X-Real-IP, X-Forwarded-For)
- [express-rate-limit GitHub](https://github.com/express-rate-limit/express-rate-limit) -- v8.3.0 API, `limit` option
- [rate-limit-redis GitHub](https://github.com/express-rate-limit/rate-limit-redis) -- v4.3.1, ioredis integration

### Secondary (MEDIUM confidence)
- [CWE-1385: Missing Origin Validation in WebSockets](https://cwe.mitre.org/data/definitions/1385.html) -- WebSocket CORS bypass
- [Include Security: Cross-Site WebSocket Hijacking 2025](https://blog.includesecurity.com/2025/04/cross-site-websocket-hijacking-exploitation-in-2025/) -- Origin validation best practice
- [express-rate-limit configuration docs](https://express-rate-limit.mintlify.app/reference/configuration) -- v7+ API reference

### Tertiary (LOW confidence)
- None -- all findings verified against codebase or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- express-rate-limit is the undisputed standard, rate-limit-redis is the official companion
- Architecture: HIGH -- all integration points verified by reading actual source code; patterns match existing codebase conventions
- Pitfalls: HIGH -- trust proxy issue verified by inspecting codebase (no `trust proxy` setting found); CORS/WS behavior verified against CWE documentation

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable domain, low churn)
