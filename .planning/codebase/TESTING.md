# Testing Patterns

**Analysis Date:** 2026-03-06

## Test Framework

**API (Backend):**
- **Runner:** Jest 29.7.0
- **Config:** `containers/api/jest.config.js`
- **Environment:** Node.js (`testEnvironment: 'node'`)
- **Timeout:** 30000ms (30 seconds)
- **Test match:** `**/tests/**/*.test.js`

**Frontend:**
- **Runner:** Vitest 1.2.2
- **Config:** `containers/web/frontend/vitest.config.ts`
- **Environment:** jsdom
- **Globals:** enabled (`globals: true` -- no need to import `describe`/`it`/`expect`)
- **Setup file:** `containers/web/frontend/src/__tests__/setup.ts`

**Assertion Library:**
- API: Jest built-in (`expect`, `toBe`, `toEqual`, `toContain`, `toBeNull`, etc.)
- Frontend: Vitest built-in (same API as Jest) + `@testing-library/jest-dom` for DOM matchers

**Run Commands:**
```bash
# API tests (inside Docker container)
make test                                    # Runs: docker exec linbo-api npm test
docker exec linbo-api npm test               # Equivalent
docker exec linbo-api npx jest --runInBand   # Direct Jest

# API tests (local, if deps installed)
cd containers/api && npm test                # jest --runInBand
cd containers/api && npm run test:watch      # jest --watch
cd containers/api && npm run test:coverage   # jest --coverage
cd containers/api && npm run test:verbose    # jest --runInBand --verbose

# Frontend tests
cd containers/web/frontend && npm test       # vitest run
cd containers/web/frontend && npm run test:watch  # vitest (watch mode)
```

## Test File Organization

**Location:** Separate `tests/` directory (NOT co-located with source files)

**API test structure:**
```
containers/api/
  src/
    services/         # Source code
    routes/
    lib/
    workers/
  tests/
    setup.js          # Per-test-file setup (runs before each file)
    globalSetup.js    # One-time setup before all tests
    globalTeardown.js # One-time teardown after all tests
    helpers.js        # TestClient utility class
    api.test.js       # Integration test (requires running server)
    services/         # Service unit tests (21 files)
      host.service.test.js
      grub.service.test.js
      ...
    routes/           # Route integration tests (5 files)
      sync-read.test.js
      settings.test.js
      ...
    lib/              # Lib unit tests (7 files)
      image-path.test.js
      startconf-rewrite.test.js
      ...
    workers/          # Worker unit tests (1 file)
      host-status.worker.test.js
```

**Frontend test structure:**
```
containers/web/frontend/src/
  __tests__/
    setup.ts              # Test setup (localStorage mock, etc.)
    api/
      client.test.ts      # API client tests
      response.test.ts    # Response handling tests
    integration/
      auth-flow.test.ts   # Auth flow tests
    stores/
      authStore.test.ts   # Store tests
```

**Naming:**
- API: `{source-filename}.test.js` matching the source file name
- Frontend: `{feature}.test.ts`

**Test count and size (API):**
- 34 test files total
- ~14,878 lines of test code
- Largest: `containers/api/tests/services/grub.service.test.js` (882 lines)
- Smallest: `containers/api/tests/lib/driver-shell.test.js` (52 lines)

## Test Structure

**Suite Organization (API):**
```javascript
/**
 * LINBO Docker - Service Name Tests
 * Brief description of what is tested
 */

// 1. Environment setup (BEFORE imports)
const TEST_DIR = path.join(os.tmpdir(), `linbo-test-${Date.now()}`);
process.env.LINBO_DIR = TEST_DIR;
process.env.JWT_SECRET = 'test-secret';

// 2. Mock declarations (BEFORE requiring tested module)
jest.mock('../../src/lib/prisma', () => ({ ... }));
jest.mock('../../src/lib/redis', () => ({ ... }));
jest.mock('../../src/lib/websocket', () => ({ ... }));

// 3. Import mocked modules and the module under test
const { prisma } = require('../../src/lib/prisma');
const service = require('../../src/services/some.service');

// 4. Test fixtures
const mockHost = { id: '550e8400-...', hostname: 'pc-r101-01', ... };

// 5. Test suites
describe('Service Name', () => {
  beforeAll(async () => {
    // Create temp directories
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Cleanup temp directories
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe('functionName', () => {
    test('should do expected behavior', async () => {
      // Arrange
      prisma.host.findUnique.mockResolvedValue(mockHost);
      // Act
      const result = await service.functionName(mockHost.id);
      // Assert
      expect(result).toEqual(mockHost);
      expect(prisma.host.findUnique).toHaveBeenCalledWith({ ... });
    });
  });
});
```

**Frontend test structure:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Feature Name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do expected behavior', () => {
    // Arrange, Act, Assert
  });
});
```

**Patterns:**
- Use `test()` (not `it()`) in API tests -- both work but `test` is the convention
- Use `it()` in frontend tests (Vitest convention)
- Use `describe()` blocks to group related tests by function name
- Always call `jest.clearAllMocks()` in `beforeEach`
- Use `async/await` for async tests (never raw promises)
- Acceptance criteria labels: `test('AC1: no DB write when isOnline is false', ...)`

## Test Setup

**Global Setup** (`containers/api/tests/globalSetup.js`):
- Sets `NODE_ENV=test`
- Sets `JWT_SECRET` for test token generation

**Per-File Setup** (`containers/api/tests/setup.js`):
- Sets Jest timeout to 30s
- Suppresses `console.log`, `console.debug`, `console.info` (keeps `warn` and `error`)
- Can be overridden with `SUPPRESS_LOGS=false` env var

**Frontend Setup** (`containers/web/frontend/src/__tests__/setup.ts`):
- Imports `@testing-library/jest-dom`
- Mocks `localStorage` with `vi.fn()` for all methods
- Mocks `window.location`

## Mocking

**Framework:** Jest built-in (`jest.mock`, `jest.fn`) for API; Vitest (`vi.mock`, `vi.fn`) for frontend

**Standard Mocks (API):**

Prisma mock (used in almost every service test):
```javascript
jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    host: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    config: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    // Add other models as needed
  },
}));
```

Redis mock (two patterns used):

Pattern A -- mock the wrapper module directly:
```javascript
jest.mock('../../src/lib/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delPattern: jest.fn(),
}));
```

Pattern B -- mock the client with in-memory Map (for route/integration tests):
```javascript
const redisStore = new Map();
const mockClient = {
  get: jest.fn(async (key) => redisStore.get(key) || null),
  set: jest.fn(async (key, val) => { redisStore.set(key, val); }),
  del: jest.fn(async (...keys) => { keys.flat().forEach(k => redisStore.delete(k)); }),
  status: 'ready',
  ping: jest.fn(async () => 'PONG'),
};
jest.mock('../../src/lib/redis', () => ({
  getClient: () => mockClient,
  disconnect: jest.fn(),
}));
```

WebSocket mock:
```javascript
jest.mock('../../src/lib/websocket', () => ({
  broadcast: jest.fn(),
  getServer: () => null,
  init: jest.fn(),
}));
```

**What to Mock:**
- External I/O: Prisma (database), Redis, WebSocket, file system (when not testing FS ops)
- Network calls: `global.fetch` (replaced with `jest.fn()` for HTTP tests)
- Child services: mock other services when testing a specific service in isolation
- Time-sensitive operations: mock `Date.now()` when testing timeouts

**What NOT to Mock:**
- The module under test itself
- Pure helper functions (test them directly: `getGrubPart`, `parseDebianStanza`, etc.)
- File system when testing FS-dependent logic (use `os.tmpdir()` temp directories instead)

## Temp Directory Pattern

Services that write to the filesystem use a temporary directory pattern:
```javascript
const TEST_DIR = path.join(os.tmpdir(), `linbo-test-${Date.now()}`);
process.env.LINBO_DIR = TEST_DIR;

beforeAll(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  // Create subdirectories as needed
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
});
```

This is used extensively in: `grub.service.test.js`, `linbo-update.service.test.js`, `kernel.service.test.js`, `firmware.service.test.js`, `patchclass.service.test.js`, `config.service.test.js`

## _testing Export Pattern

Services with complex internal logic expose internals via a `_testing` namespace:
```javascript
// In the service file
module.exports = {
  publicFunction1,
  publicFunction2,

  _testing: {
    internalHelper1,
    internalHelper2,
    acquireLock,
    releaseLock,
  },
};

// In the test file
const { _testing: { internalHelper1 } } = require('../../src/services/some.service');
// Or:
const svc = require('../../src/services/linbo-update.service');
const { parseDebianStanza } = svc._testing;
```

Used in: `containers/api/src/services/linbo-update.service.js`

## Route Integration Tests

Route tests spin up a real Express app with mocked dependencies:
```javascript
// Create mini Express app with just the route being tested
const express = require('express');
const app = express();
app.use(express.json());

// Mount the route
const syncRoutes = require('../../src/routes/sync');
app.use('/api/v1/sync', syncRoutes);

// Start a real HTTP server
let server;
beforeAll((done) => { server = app.listen(0, done); });
afterAll((done) => { server.close(done); });

// Make real HTTP requests
test('GET /sync/mode returns current mode', async () => {
  const res = await fetch(`http://localhost:${server.address().port}/api/v1/sync/mode`);
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.data.mode).toBeDefined();
});
```

Auth in route tests uses JWT tokens generated during test setup:
```javascript
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { id: 'test', username: 'admin', role: 'admin' },
  process.env.JWT_SECRET
);
// Use as: Authorization: Bearer ${token}
```

## Fixtures and Factories

**Test Data -- inline fixture objects:**
```javascript
const mockHost = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  hostname: 'pc-r101-01',
  macAddress: 'aa:bb:cc:dd:ee:ff',
  ipAddress: '10.0.0.101',
  status: 'online',
  lastSeen: new Date(),
  room: { id: 'room-1', name: 'Room 101' },
  config: { id: 'config-1', name: 'win11_efi_sata' },
};

const mockPartitions = [
  { device: '/dev/sda1', label: 'EFI', size: '512M', partitionId: 'ef00', fsType: 'vfat', position: 1 },
  { device: '/dev/sda2', label: 'windows', size: '100G', partitionId: '0700', fsType: 'ntfs', position: 2 },
  { device: '/dev/sda3', label: 'cache', size: '50G', partitionId: '8300', fsType: 'ext4', position: 3 },
];
```

**Dynamic test data** (from `containers/api/tests/helpers.js`):
```javascript
const generateTestData = {
  hostname: () => `test-pc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
  mac: () => {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
    return `${hex()}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`;
  },
  ip: () => `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  name: () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
};
```

**Location:**
- Fixtures are defined inline at the top of each test file (no shared fixture files)
- `containers/api/tests/helpers.js` provides `TestClient` class and `generateTestData`

## Coverage

**Requirements:** None enforced (no minimum coverage thresholds configured)

**View Coverage:**
```bash
cd containers/api && npm run test:coverage   # jest --coverage
```

**Coverage config** (from `containers/api/jest.config.js`):
```javascript
collectCoverageFrom: ['src/**/*.js'],
coverageDirectory: 'coverage',
coverageReporters: ['text', 'lcov', 'html'],
```

## Test Types

**Unit Tests (majority of tests):**
- Test individual service functions with mocked dependencies
- Files: `tests/services/*.test.js`, `tests/lib/*.test.js`
- Pattern: mock Prisma/Redis/WebSocket, call service function, assert result and mock interactions
- ~21 service test files, ~7 lib test files

**Route Integration Tests:**
- Spin up Express app with real routing, mocked backends
- Test HTTP request/response cycle including middleware chain
- Files: `tests/routes/*.test.js` (5 files)
- Pattern: create Express app, mount route, make HTTP requests, verify status + body

**Worker Tests:**
- Test background worker logic with mocked dependencies
- Files: `tests/workers/host-status.worker.test.js`

**E2E Tests (via TestClient):**
- `tests/api.test.js` and `tests/helpers.js` provide `TestClient` for full API testing
- Requires a running server (not run in standard test suite -- used for manual verification)

**Frontend Tests:**
- 4 test files in `containers/web/frontend/src/__tests__/`
- Test store logic (rehydration, login/logout) and API client token management
- Use jsdom environment with mocked localStorage

## Common Patterns

**Async Testing:**
```javascript
test('should fetch host from database', async () => {
  prisma.host.findUnique.mockResolvedValue(mockHost);
  const result = await hostService.getHostById(mockHost.id);
  expect(result).toEqual(mockHost);
});
```

**Error Testing:**
```javascript
test('throws 409 when update already in progress', async () => {
  await svc._testing.acquireLock();
  await expect(svc._testing.acquireLock()).rejects.toThrow('LINBO update already in progress');
  await svc._testing.releaseLock();
});
```

**Null/edge case testing:**
```javascript
test('should return null for non-existent host', async () => {
  redis.get.mockResolvedValue(null);
  prisma.host.findUnique.mockResolvedValue(null);
  const result = await hostService.getHostById('non-existent');
  expect(result).toBeNull();
  expect(redis.set).not.toHaveBeenCalled();  // Don't cache null
});
```

**Mock verification:**
```javascript
test('should invalidate all related caches', async () => {
  prisma.host.update.mockResolvedValue(mockHost);
  await hostService.updateHostStatus(mockHost.id, 'offline');
  expect(redis.del).toHaveBeenCalledWith(`host:${mockHost.id}`);
  expect(redis.del).toHaveBeenCalledWith(`host:hostname:${mockHost.hostname}`);
  expect(redis.del).toHaveBeenCalledWith(`host:mac:${mockHost.macAddress.toLowerCase()}`);
});
```

**File system assertions:**
```javascript
test('should write file to correct location', async () => {
  const result = await grubService.generateConfigGrubConfig('win11_efi_sata');
  expect(result.filepath).toContain('win11_efi_sata.cfg');
  const fileExists = await fs.access(result.filepath).then(() => true).catch(() => false);
  expect(fileExists).toBe(true);
});
```

**Content assertions:**
```javascript
test('should generate valid GRUB config', async () => {
  prisma.config.findFirst.mockResolvedValue(mockConfig);
  const result = await grubService.generateConfigGrubConfig('win11_efi_sata');
  expect(result.content).toContain('# LINBO Docker - Group GRUB Configuration');
  expect(result.content).toContain('insmod all_video');
  expect(result.content).toContain('server=10.0.0.11');
});
```

**Global fetch mocking:**
```javascript
test('reads version from APT repo', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn()
    .mockRejectedValueOnce(new Error('no gz'))
    .mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(packagesBody),
    });
  try {
    const result = await svc.checkVersion();
    expect(result.available).toBe('4.3.30-0');
  } finally {
    global.fetch = originalFetch;  // Always restore
  }
});
```

## Test Gaps

**Areas with good coverage:**
- Services: 21/22 services have dedicated test files (all except `image-sync.service.js`, `terminal.service.js`)
- Lib modules: 7/14 lib modules have tests
- Core GRUB generation: extensively tested (882 lines)

**Areas with limited coverage:**
- Frontend: only 4 test files for the entire React app (stores and API client only)
- No component rendering tests (no React Testing Library render tests)
- Route tests: 5 of 16 route modules have tests
- Middleware tests: no dedicated test files for `auth.js`, `validate.js`, `audit.js`
- WebSocket: no tests for WebSocket connection handling
- Workers: only `host-status.worker.test.js` (1 of 2 workers tested)

---

*Testing analysis: 2026-03-06*
