# Coding Conventions

**Analysis Date:** 2026-03-06

## Naming Patterns

**Files:**
- Services: `kebab-case.service.js` (e.g., `host.service.js`, `grub-theme.service.js`, `linbo-update.service.js`)
- Routes: `kebab-case.js` (e.g., `hosts.js`, `sync-operations.js`, `system.js`)
- Middleware: `camelCase.js` (e.g., `auth.js`, `validate.js`, `audit.js`)
- Lib modules: `kebab-case.js` (e.g., `redis.js`, `lmn-api-client.js`, `atomic-write.js`, `image-path.js`)
- Workers: `kebab-case.worker.js` (e.g., `operation.worker.js`, `host-status.worker.js`)
- Tests: mirror source path in `tests/` with `.test.js` suffix (e.g., `tests/services/grub.service.test.js`)
- Frontend pages: `PascalCase.tsx` (e.g., `DashboardPage.tsx`, `HostsPage.tsx`)
- Frontend stores: `camelCase.ts` (e.g., `authStore.ts`, `hostStore.ts`)
- Frontend components: organized in subdirectories by domain (e.g., `components/hosts/`, `components/system/`)

**Functions:**
- Use `camelCase` for all functions: `getHostById`, `updateHostStatus`, `generateConfigGrubConfig`
- Prefix getters with `get`: `getHostById`, `getStaleHosts`, `getLinboSetting`
- Prefix boolean queries with `is` or `has`: `isNewer`, `isProvisioningEnabled`
- Use verb-noun pattern: `createAuditLog`, `deleteHostGrubConfig`, `markStaleHostsOffline`

**Variables:**
- Use `camelCase` for variables and parameters: `cacheKey`, `kernelOptions`, `isSyncMode`
- Use `UPPER_SNAKE_CASE` for constants derived from environment: `LINBO_DIR`, `GRUB_DIR`, `JWT_SECRET`
- Use `UPPER_SNAKE_CASE` for file-level constants: `OFFLINE_TIMEOUT_SEC`, `TEMPLATES_DIR`

**Types (Frontend):**
- Use `PascalCase` for interfaces and types: `AuthState`, `User`, `PersistedAuthState`
- Prefix store hooks with `use`: `useAuthStore`, `useHostStore`

## Code Style

**Formatting:**
- No Prettier config detected -- formatting is informal
- 2-space indentation throughout the codebase
- Trailing commas in multi-line objects and arrays
- Single quotes for strings
- Semicolons used consistently

**Linting:**
- ESLint 8.x configured for both API (`containers/api/package.json`) and frontend (`containers/web/frontend/package.json`)
- No custom `.eslintrc` file in the project root -- relies on package.json or defaults
- Frontend uses `@typescript-eslint/eslint-plugin`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`

## Language

**API (Backend):**
- Plain JavaScript (Node.js), CommonJS modules (`require`/`module.exports`)
- No TypeScript on the backend
- Node.js >= 18.0.0 required (see `engines` in `containers/api/package.json`)

**Frontend:**
- TypeScript with React 18
- ES modules (`import`/`export`)
- Vite as build tool

## Import Organization

**API (Backend) -- CommonJS:**
1. Node.js built-in modules: `const fs = require('fs').promises;`, `const path = require('path');`
2. Third-party packages: `const express = require('express');`, `const { z } = require('zod');`
3. Internal lib modules: `const redis = require('../lib/redis');`, `const ws = require('../lib/websocket');`
4. Internal services: `const grubService = require('../services/grub.service');`
5. Internal middleware: `const { authenticateToken, requireRole } = require('../middleware/auth');`

**Frontend -- ES Modules:**
1. Third-party: `import { create } from 'zustand';`
2. Internal with `@/` alias: `import type { User } from '@/types';`, `import { authApi } from '@/api/auth';`

**Path Aliases:**
- Frontend uses `@/` alias mapped to `./src/` (configured in `containers/web/frontend/vitest.config.ts`)
- Backend has no path aliases -- uses relative paths (`../lib/`, `../services/`, `../middleware/`)

## Error Handling

**API Response Error Format:**
Always use this structure for error responses:
```javascript
res.status(CODE).json({
  error: {
    code: 'UPPER_SNAKE_CASE_CODE',
    message: 'Human-readable message',
    details: optionalDetails,       // Zod errors, etc.
    requestId: req.requestId,       // From request middleware
  },
});
```

**Error Codes:**
- `UNAUTHORIZED` / `TOKEN_EXPIRED` / `INVALID_TOKEN` -- 401
- `FORBIDDEN` -- 403
- `HOST_NOT_FOUND` / `NOT_FOUND` -- 404
- `DUPLICATE_ENTRY` / `SYNC_MODE_ACTIVE` / `REBUILD_IN_PROGRESS` -- 409
- `VALIDATION_ERROR` / `INVALID_KEY_TYPE` -- 400
- `DATABASE_ERROR` / `INTERNAL_ERROR` -- 500
- `SERVICE_UNAVAILABLE` -- 503

**Route Error Pattern:**
Routes delegate to services, catch errors in `try/catch`, and call `next(error)` for unhandled cases:
```javascript
router.post('/endpoint', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    const result = await someService.doSomething(req.body);
    res.json({ data: result });
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({
        error: { code: 'SPECIFIC_CODE', message: error.message },
      });
    }
    next(error);
  }
});
```

**Service Error Pattern:**
Services throw errors with `statusCode` property for known error states:
```javascript
const error = new Error('LINBO update already in progress');
error.statusCode = 409;
throw error;
```

**Prisma Error Handling:**
- `P2002` -- unique constraint violation -> 409 `DUPLICATE_ENTRY`
- `P2025` -- record not found -> 404 `HOST_NOT_FOUND`
- Prisma error codes starting with `P` -> 400 `DATABASE_ERROR`

**Global Error Handler** (in `containers/api/src/index.js`):
Catches ZodError, JsonWebTokenError, TokenExpiredError, and Prisma errors as final fallback.

## API Response Format

**Success responses:**
```javascript
// Single item
res.json({ data: result });

// With pagination
res.json({
  data: items,
  pagination: { page, limit, total, pages: Math.ceil(total / limit) },
});

// Success message
res.json({ data: { message: 'Action completed', ...additionalFields } });
```

**HTTP Status Codes:**
- `200` -- Success (GET, PATCH, DELETE confirmation)
- `201` -- Created (POST that creates a resource)
- `400` -- Validation error
- `401` -- Unauthorized
- `403` -- Forbidden (valid auth but wrong role)
- `404` -- Not found
- `409` -- Conflict (duplicate, sync mode, in-progress)
- `500` -- Internal server error
- `503` -- Service unavailable

## Middleware Chain Pattern

Routes use a consistent middleware chain order:
```javascript
router.post(
  '/endpoint',
  authenticateToken,           // 1. Auth (always first for protected routes)
  requireRole(['admin']),      // 2. Role check (optional)
  validateBody(zodSchema),     // 3. Validation (when body is expected)
  auditAction('resource.action', { ... }), // 4. Audit logging (for write ops)
  async (req, res, next) => {  // 5. Handler
    // ...
  }
);
```

## Validation

**Framework:** Zod (`containers/api/src/middleware/validate.js`)

**Pattern:** Define schemas in `validate.js`, use `validateBody(schema)` or `validateQuery(schema)` middleware, or use inline `schema.safeParse(req.body)` in route handlers.

**Inline validation example (used in `system.js`):**
```javascript
const parsed = kernelSwitchSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({
    error: {
      code: 'INVALID_VARIANT',
      message: 'Invalid kernel variant',
      details: parsed.error.issues,
    },
  });
}
const { variant } = parsed.data;
```

## WebSocket Events

**Naming:** `resource.action` pattern using dot notation:
- `host.status.changed`, `host.created`, `host.updated`, `host.deleted`
- `system.linbofs_update_started`, `system.linbofs_updated`
- `system.kernel_switch_started`, `system.kernel_switched`
- `operation.started`
- `linbo.update.status`

**Broadcasting pattern:**
```javascript
ws.broadcast('event.name', {
  relevantField: value,
  timestamp: new Date(),
});
```

## Prisma-Optional Pattern

When code must work with or without a database (sync mode vs standalone mode), use:
```javascript
let prisma = null;
try {
  prisma = require('../lib/prisma').prisma;
} catch {}

// Then guard all Prisma calls:
if (!prisma) return; // or provide fallback behavior
```

Used in: `containers/api/src/middleware/auth.js`, `containers/api/src/middleware/audit.js`, `containers/api/src/index.js`

## Caching Pattern

**Redis wrapper** (`containers/api/src/lib/redis.js`):
- `get(key)` -- returns parsed JSON or null
- `set(key, value, ttl)` -- serializes to JSON, optional TTL in seconds
- `del(key)` -- delete single key
- `delPattern(pattern)` -- delete all matching keys (e.g., `hosts:*`)

**Cache-aside pattern in services:**
```javascript
async function getHostById(id) {
  const cacheKey = `host:${id}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const host = await prisma.host.findUnique({ where: { id } });
  if (host) await redis.set(cacheKey, host, 60); // TTL 60s
  return host;
}
```

**Cache invalidation:** Always invalidate related caches after write operations:
```javascript
await redis.del(`host:${id}`);
await redis.del(`host:hostname:${host.hostname}`);
await redis.del(`host:mac:${host.macAddress.toLowerCase()}`);
```

## Logging

**Framework:** `console` (no structured logging library)

**Patterns:**
- Service operations: `console.log('[ServiceName] Message');` (e.g., `[GrubService]`, `[Hosts]`, `[AutoRebuild]`)
- Errors: `console.error('[ServiceName] Error message:', error.message);`
- Warnings: `console.warn('  Warning message:', details);`
- Startup: indented lines with checkmarks for successful checks: `console.log('  LINBO root: /srv/linbo');`
- Use `console.error` for errors, `console.warn` for non-fatal issues
- In tests: console.log/debug/info are suppressed via `tests/setup.js`

## Comments

**When to Comment:**
- Every file starts with a JSDoc block: `/** * LINBO Docker - Module Name * Brief description */`
- Every exported function has JSDoc with `@param` and often `@returns` annotations
- Section separators use: `// =============================================================================`
- Inline comments for non-obvious logic (e.g., GRUB partition mapping, MAC normalization)

**JSDoc Pattern:**
```javascript
/**
 * Description of what the function does
 * @param {string} id - Parameter description
 * @param {object} options - Options object
 * @returns {Promise<{filepath: string, content: string}>}
 */
```

## Module Design

**Exports:** Services export an object of named functions (no classes):
```javascript
module.exports = {
  getHostById,
  getHostByHostname,
  updateHostStatus,
  // ...
};
```

**Internal test helpers:** Services that need to expose internals for testing use `_testing`:
```javascript
module.exports = {
  checkVersion,
  startUpdate,
  // Public API

  _testing: {
    parseDebianStanza,
    acquireLock,
    releaseLock,
    // Internal functions exposed for unit testing
  },
};
```

**Route modules:** Export an Express router:
```javascript
const router = express.Router();
// ... route definitions ...
module.exports = router;
```

**Route aggregator** (`containers/api/src/routes/index.js`): Exports an async factory `createRouter()` that conditionally mounts routes based on sync mode.

**Frontend stores:** Export a Zustand store hook:
```javascript
export const useAuthStore = create<AuthState>()(
  persist((set, get) => ({ ... }), { name: 'auth-storage' })
);
```

---

*Convention analysis: 2026-03-06*
