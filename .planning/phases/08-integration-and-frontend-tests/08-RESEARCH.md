# Phase 8: Integration and Frontend Tests - Research

**Researched:** 2026-03-08
**Domain:** WebSocket integration testing (Node.js/Jest) + Frontend Zustand store testing (Vitest/jsdom)
**Confidence:** HIGH

## Summary

Phase 8 covers two distinct testing domains: (1) backend WebSocket integration tests using a real Express server with ws clients, and (2) frontend Zustand store unit tests in jsdom with mocked dependencies. Both test frameworks are already established in the project -- Jest 29.7 for backend (43 test files, ~41+ tests) and Vitest 1.6.1 for frontend (4 test files, 22 tests). No new dependencies are needed; the `ws` package (8.19.0) is already installed and works as both server and client.

The backend WS integration tests require a minimal Express+WS server setup that mirrors the production `index.js` upgrade handler (JWT auth, heartbeat, channel subscription, message handling) but without Redis, Prisma, or other services. The frontend store tests are straightforward Vitest tests using `vi.mock()` for API modules and a lightweight inline MockWebSocket class for wsStore.

**Primary recommendation:** Build the WS integration test as a self-contained test file that creates its own Express HTTP server with a WS upgrade handler on a random port, using real `ws` clients and real timers. For frontend stores, test through Zustand's `getState()`/`setState()` API directly, resetting stores between tests with `useStore.setState(initialState)`.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Test only the 4 success criteria behaviors: JWT connect succeeds, no-JWT rejected, heartbeat keeps alive, channel subscription delivers broadcasts
- Do NOT test individual websocket.js broadcast helpers (broadcast, sendTo, getStats etc.) -- out of scope
- Channel tests cover both specific channel subscription (`room:lab1`) and wildcard `*` subscription
- ~8-10 backend WS tests total
- **Integration tests** with real Express server on random port + real `ws` client connections
- Real timers with short intervals (100-200ms heartbeat) -- no fake timers for backend WS
- Test file location: `tests/integration/websocket.test.js` (new directory, separate from unit tests)
- 4 behaviors per store + 2-3 edge cases each (~12-15 tests across 3 stores)
- **wsStore:** reconnect logic (onclose triggers reconnect after delay, respects maxReconnectAttempts), subscribe/unsubscribe, emit dispatch, visibility change re-emit
- **hostStore:** updateHostStatus merge (correct host updated, other fields preserved, unknown ID handling)
- **configStore:** cache guard (first call fetches, second returns cached), error fallback to defaults for both fetchServerConfig and fetchMode
- Backend WS: real timers with short intervals (integration style)
- Frontend wsStore: **vi.useFakeTimers()** + vi.advanceTimersByTime() for reconnect delay testing
- **Backend WS:** Real `ws` client (already installed) connecting to real Express server. No mock WS client.
- **Frontend wsStore:** Lightweight inline MockWebSocket class (~30 lines) with OPEN/CLOSED readyState, send(), close(), trigger helpers. Local to wsStore.test.ts, not in setup.ts.
- **Frontend hostStore/configStore:** vi.mock() for API modules (hostsApi, syncApi, axios). Standard Vitest mocking.
- **Redis mock:** Claude's discretion whether to reuse Phase 7's shared `tests/mocks/redis.js` or handle differently based on integration test needs
- **Backend:** Jest 29.7 (41+ existing tests) -- no change
- **Frontend:** Vitest 1.2 + jsdom + @testing-library/react (4 existing tests) -- no change
- No framework consolidation -- each side follows its established patterns
- Backend WS integration: `containers/api/tests/integration/websocket.test.js`
- Frontend stores: `containers/web/frontend/src/__tests__/stores/wsStore.test.ts`, `hostStore.test.ts`, `serverConfigStore.test.ts`
- Follows existing conventions in both codebases

### Claude's Discretion
- Exact test descriptions and describe/it nesting
- Whether shared Redis mock is needed for WS integration tests or if the test can mock at a different level
- MockWebSocket class implementation details
- Express server setup/teardown pattern for integration tests
- Additional edge cases beyond the mentioned ones per store

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-03 | Integration-Tests for WebSocket (Connection with/without Auth, Heartbeat, Channel-Subscription, Broadcast) | Backend WS integration test with real Express+WS server on random port; verified `ws` 8.19.0 supports both server and client usage; `verifyWsToken` from `index.js._testing` provides auth; heartbeat via `setInterval` with short 100-200ms intervals; channel subscription via JSON message protocol; broadcast via `broadcastToChannels` |
| TEST-04 | Frontend-Tests for critical Zustand stores (wsStore Reconnect, hostStore Merge, configStore Cache) | Vitest 1.6.1 with jsdom; Zustand 4.5.7 stores testable via `getState()`/`setState()`; vi.useFakeTimers for wsStore reconnect delay; vi.mock for hostsApi/syncApi/axios modules; inline MockWebSocket class for wsStore |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Jest | 29.7.0 | Backend test runner | 43 existing test files, established patterns |
| ws | 8.19.0 | WS server AND client in integration tests | Already installed, same package used in production |
| Vitest | 1.6.1 | Frontend test runner | 4 existing test files, 22 tests passing |
| jsdom | 24.1.3 | Browser environment for frontend tests | Configured in vitest.config.ts |
| Zustand | 4.5.7 | State management (test target) | Project standard, stores under test |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jsonwebtoken | 9.0.2 | Generate valid JWT tokens in WS tests | Backend WS auth testing |
| express | 4.18.2 | Create minimal HTTP server for WS upgrade | Backend WS integration tests |
| @testing-library/jest-dom | 6.4.2 | DOM assertions (already in setup) | Frontend tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Real `ws` client | jest-websocket-mock | Decision locked: real ws client for integration tests |
| Inline MockWebSocket | vitest-websocket-mock | Decision locked: lightweight inline class, no extra dependency |
| vi.useFakeTimers for WS | Real timers | Decision locked: fake timers for frontend wsStore, real timers for backend |

**Installation:**
```bash
# No new packages needed - everything is already installed
```

## Architecture Patterns

### Recommended Project Structure
```
containers/api/tests/
  integration/
    websocket.test.js          # NEW - WS integration tests (8-10 tests)
  mocks/
    redis.js                   # Existing shared Redis mock
  services/                    # 18 existing test files
  middleware/                  # 3 existing test files
  ...

containers/web/frontend/src/__tests__/
  stores/
    authStore.test.ts          # Existing (7 tests)
    wsStore.test.ts            # NEW - WS store tests (~5 tests)
    hostStore.test.ts          # NEW - Host store tests (~4 tests)
    serverConfigStore.test.ts  # NEW - Config store tests (~4 tests)
  setup.ts                     # Existing test setup
  ...
```

### Pattern 1: Express+WS Integration Test Server
**What:** Create a minimal HTTP server with WebSocket upgrade handler for testing
**When to use:** Backend WS integration tests
**Example:**
```javascript
// Source: containers/api/src/index.js upgrade handler pattern
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'test-ws-integration-secret';
const TEST_INTERNAL_KEY = 'test-internal-key';
const HEARTBEAT_INTERVAL = 150; // Short interval for tests

let server, wss, app, heartbeatInterval;

function verifyWsToken(token) {
  if (!token) return null;
  if (token === TEST_INTERNAL_KEY) {
    return { id: 'internal', username: 'internal-service', role: 'admin' };
  }
  try {
    return jwt.verify(token, TEST_JWT_SECRET);
  } catch { return null; }
}

beforeAll((done) => {
  app = express();
  server = http.createServer(app);
  wss = new WebSocket.Server({ noServer: true });

  wss.on('connection', (ws, req) => {
    ws.channels = [];
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      const data = JSON.parse(raw);
      if (data.type === 'subscribe') {
        ws.channels = data.channels || [];
        ws.send(JSON.stringify({ type: 'subscribed', channels: ws.channels }));
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });
    ws.send(JSON.stringify({ type: 'connected', message: 'Welcome' }));
  });

  heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://localhost`);
    const token = url.searchParams.get('token');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const user = verifyWsToken(token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      wss.emit('connection', ws, req);
    });
  });

  server.listen(0, () => done()); // port 0 = random available port
});

afterAll((done) => {
  clearInterval(heartbeatInterval);
  wss.clients.forEach((c) => c.terminate());
  wss.close();
  server.close(done);
});
```

### Pattern 2: Zustand Store Testing via getState/setState
**What:** Test store actions and state transitions directly without rendering components
**When to use:** Frontend store unit tests
**Example:**
```typescript
// Source: Zustand testing documentation + existing authStore.test.ts patterns
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useHostStore } from '@/stores/hostStore';

vi.mock('@/api/hosts', () => ({
  hostsApi: {
    list: vi.fn(),
  },
}));

describe('hostStore - updateHostStatus', () => {
  beforeEach(() => {
    // Reset store to initial state
    useHostStore.setState({
      hosts: [
        { id: 'h1', hostname: 'pc-01', status: 'offline', detectedOs: null },
        { id: 'h2', hostname: 'pc-02', status: 'online', detectedOs: 'Windows' },
      ],
      selectedHosts: [],
      total: 2,
      page: 1,
      limit: 25,
      totalPages: 1,
      filters: {},
      sort: 'hostname',
      order: 'asc',
      isLoading: false,
      error: null,
    });
  });

  it('should update status of matching host', () => {
    useHostStore.getState().updateHostStatus('h1', 'online');
    const hosts = useHostStore.getState().hosts;
    expect(hosts.find(h => h.id === 'h1')?.status).toBe('online');
  });

  it('should preserve other host fields', () => {
    useHostStore.getState().updateHostStatus('h2', 'offline');
    const host = useHostStore.getState().hosts.find(h => h.id === 'h2');
    expect(host?.hostname).toBe('pc-02');
    expect(host?.detectedOs).toBe('Windows');
  });
});
```

### Pattern 3: MockWebSocket for wsStore
**What:** Inline mock class simulating browser WebSocket API
**When to use:** Frontend wsStore tests
**Example:**
```typescript
// Inline MockWebSocket class -- local to wsStore.test.ts
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  url: string;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateError() {
    this.onerror?.();
  }
}
```

### Anti-Patterns to Avoid
- **Testing websocket.js internals via integration tests:** Decision locked -- only test the 4 success criteria behaviors, not broadcast/sendTo/getStats
- **Using mock WS libraries for backend:** Decision locked -- use real `ws` client for integration tests
- **Sharing MockWebSocket across test files:** Decision locked -- keep inline in wsStore.test.ts
- **Using real timers for wsStore reconnect tests:** Would make tests slow and flaky; use vi.useFakeTimers
- **Importing the actual store module without mocking dependencies:** wsStore imports `window.location`, `document.addEventListener`, `localStorage` -- all need to be available (jsdom provides these) or mocked

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT token generation for tests | Custom token builder | `jwt.sign()` from jsonwebtoken | Already installed, exact same function used in production auth |
| Random port allocation | Manual port management | `server.listen(0)` | OS assigns available port, no conflicts |
| WebSocket client | Custom HTTP upgrade client | `new WebSocket('ws://...')` from ws | Same package already in production |
| Store state reset | Manual property reset | `useStore.setState(initialState)` | Zustand's built-in API, guaranteed clean reset |

**Key insight:** Both test suites reuse existing project dependencies. No new packages needed.

## Common Pitfalls

### Pitfall 1: WebSocket Client Connection Timing
**What goes wrong:** Test sends messages before the WebSocket connection is fully established (OPEN state)
**Why it happens:** `new WebSocket(url)` is async; the connection is not open immediately after construction
**How to avoid:** Wait for `ws.on('open')` event before sending messages or making assertions
**Warning signs:** Intermittent test failures, "WebSocket is not open" errors
```javascript
// Good pattern
function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
```

### Pitfall 2: WebSocket Server Teardown
**What goes wrong:** Tests hang because the server or WS connections are not properly closed
**Why it happens:** Open WebSocket connections and intervals prevent Node.js from exiting
**How to avoid:** In afterAll: clear heartbeat interval, terminate all clients, close wss, close server
**Warning signs:** Jest warns "did not exit in time" or hangs after test completion

### Pitfall 3: wsStore Module-Level State
**What goes wrong:** `lastWsError` and `visibilityListenerAdded` module-level variables leak between tests
**Why it happens:** Vitest module cache preserves module-level state across tests in the same file
**How to avoid:** For `visibilityListenerAdded`, either accept it (first test triggers listener add) or use `vi.resetModules()` + dynamic import between tests. For `lastWsError`, the 60-second rate limiter is unlikely to affect tests since fake timers control time.
**Warning signs:** Second test in a file behaves differently from first; visibility listener fires unexpectedly

### Pitfall 4: vi.useFakeTimers vs WebSocket Constructor
**What goes wrong:** MockWebSocket constructor is called inside a setTimeout callback that never fires because fake timers aren't advanced
**Why it happens:** wsStore's `connect()` method might be called from a reconnect setTimeout
**How to avoid:** Call `vi.advanceTimersByTime(RECONNECT_DELAY)` to trigger the reconnect timeout, then manually trigger the MockWebSocket lifecycle events
**Warning signs:** Store state stays at `reconnectAttempts: N` but never actually reconnects

### Pitfall 5: Zustand Store Global Mocking
**What goes wrong:** Following the official Zustand testing docs to create a `__mocks__/zustand.ts` that auto-resets stores
**Why it happens:** Over-engineering; this project's stores don't need global auto-reset because tests manually set state via `useStore.setState()`
**How to avoid:** Don't create `__mocks__/zustand.ts`. Instead, call `useStore.setState(initialState)` in `beforeEach` for each store test file. This matches the existing authStore.test.ts pattern.
**Warning signs:** Zustand mock breaks store behavior, actions don't work

### Pitfall 6: Asserting on WebSocket Messages Asynchronously
**What goes wrong:** Test asserts before the WS message arrives
**Why it happens:** WebSocket messages are delivered asynchronously even on localhost
**How to avoid:** Use Promise-based message waiting:
```javascript
function waitForMessage(ws, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}
```

## Code Examples

### Backend: Connect with Valid JWT
```javascript
// Source: Verified pattern from containers/api/src/index.js upgrade handler
test('connection with valid JWT succeeds', async () => {
  const token = jwt.sign(
    { id: 'u1', username: 'testuser', role: 'admin' },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
  const port = server.address().port;
  const ws = await connectWs(`ws://localhost:${port}/ws?token=${token}`);

  const welcome = await waitForMessage(ws);
  expect(welcome.type).toBe('connected');

  ws.close();
});
```

### Backend: Connection Without JWT Rejected
```javascript
// Source: Verified pattern from containers/api/src/index.js upgrade handler
test('connection without JWT is rejected', async () => {
  const port = server.address().port;
  await expect(
    connectWs(`ws://localhost:${port}/ws`)
  ).rejects.toThrow(); // ws emits 'error' on 401 response
});
```

### Backend: Channel Subscription Delivers Broadcasts
```javascript
// Source: Verified pattern from containers/api/src/index.js message handler + websocket.js broadcastToChannels
test('channel subscription delivers broadcasts', async () => {
  const token = jwt.sign({ id: 'u1', username: 'test', role: 'admin' }, TEST_JWT_SECRET, { expiresIn: '1h' });
  const port = server.address().port;

  const client = await connectWs(`ws://localhost:${port}/ws?token=${token}`);
  await waitForMessage(client); // consume 'connected' message

  // Subscribe to channel
  client.send(JSON.stringify({ type: 'subscribe', channels: ['room:lab1'] }));
  const subAck = await waitForMessage(client);
  expect(subAck.type).toBe('subscribed');
  expect(subAck.channels).toEqual(['room:lab1']);

  // Broadcast to channel using websocket.js utility
  const websocket = require('../../src/lib/websocket');
  websocket.init(wss);
  websocket.broadcastToChannels('test.event', { msg: 'hello' }, ['room:lab1']);

  const received = await waitForMessage(client);
  expect(received.type).toBe('test.event');
  expect(received.data.msg).toBe('hello');

  client.close();
});
```

### Frontend: wsStore Reconnect
```typescript
// Source: Verified pattern from containers/web/frontend/src/stores/wsStore.ts
import { useWsStore } from '@/stores/wsStore';

// Replace global WebSocket with mock
let mockWsInstances: MockWebSocket[] = [];
vi.stubGlobal('WebSocket', class extends MockWebSocket {
  constructor(url: string) {
    super(url);
    mockWsInstances.push(this);
  }
});

it('should attempt reconnect on close when under maxReconnectAttempts', () => {
  vi.useFakeTimers();

  useWsStore.getState().connect();
  const ws = mockWsInstances[mockWsInstances.length - 1];
  ws.simulateOpen();
  expect(useWsStore.getState().isConnected).toBe(true);

  ws.simulateClose();
  expect(useWsStore.getState().isConnected).toBe(false);

  vi.advanceTimersByTime(3000); // RECONNECT_DELAY
  // A new WebSocket instance should have been created
  expect(mockWsInstances.length).toBe(2);

  vi.useRealTimers();
});
```

### Frontend: configStore Cache Guard
```typescript
// Source: Verified pattern from containers/web/frontend/src/stores/serverConfigStore.ts
import { useServerConfigStore } from '@/stores/serverConfigStore';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

it('should fetch config on first call and return cached on second', async () => {
  const axios = await import('axios');
  (axios.default.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    data: { serverIp: '10.0.0.11' },
  });

  await useServerConfigStore.getState().fetchServerConfig();
  expect(useServerConfigStore.getState().serverIp).toBe('10.0.0.11');
  expect(useServerConfigStore.getState().fetched).toBe(true);

  // Second call should not trigger fetch
  await useServerConfigStore.getState().fetchServerConfig();
  expect(axios.default.get).toHaveBeenCalledTimes(1);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jest-websocket-mock for all WS tests | Real ws client for integration, inline mock for unit | 2024+ | More realistic integration tests |
| Zustand auto-mock via __mocks__ | Direct setState/getState in tests | Zustand 4.x docs | Simpler, no mock infrastructure needed |
| supertest for HTTP integration | Direct ws client connection | N/A for WS | supertest doesn't handle WebSocket upgrade |

**Deprecated/outdated:**
- `jest-websocket-mock` pre-v2: only works with mock-socket, not real ws connections
- Zustand's old testing pattern with `__mocks__/zustand.ts`: over-engineered for simple store tests

## Open Questions

1. **Redis mock for WS integration tests**
   - What we know: The WS integration test creates its own Express+WS server independently of production Redis. The `broadcastToChannels` function from `websocket.js` only needs a `wss` instance, not Redis.
   - What's unclear: Whether any test scenario would require Redis (e.g., testing broadcast via websocket.js utilities that depend on Redis)
   - Recommendation: Redis is NOT needed for WS integration tests. The `websocket.js` module only uses `wss` (WebSocket.Server instance), not Redis. Simply call `websocket.init(wss)` in the test to initialize the utility, then call broadcast functions directly. No Redis mock required.

2. **wsStore module-level cleanup**
   - What we know: `lastWsError` (rate limiter) and `visibilityListenerAdded` (guard flag) are module-level
   - What's unclear: Whether `vi.resetModules()` is needed between tests or if the module-level state is acceptable
   - Recommendation: Accept the module-level state. `lastWsError` is controlled by fake timers. `visibilityListenerAdded` only adds one listener per module load -- tests should not depend on multiple listener additions. If needed, add `vi.resetModules()` only if tests actually fail.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (backend) | Jest 29.7.0 |
| Framework (frontend) | Vitest 1.6.1 |
| Config file (backend) | `containers/api/jest.config.js` |
| Config file (frontend) | `containers/web/frontend/vitest.config.ts` |
| Quick run command (backend) | `cd containers/api && npx jest tests/integration/websocket.test.js --verbose` |
| Quick run command (frontend) | `cd containers/web/frontend && npx vitest run src/__tests__/stores/ --reporter=verbose` |
| Full suite command (backend) | `cd containers/api && npx jest --runInBand` |
| Full suite command (frontend) | `cd containers/web/frontend && npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-03a | WS connect with valid JWT succeeds | integration | `cd containers/api && npx jest tests/integration/websocket.test.js -t "valid JWT" -x` | Wave 0 |
| TEST-03b | WS connect without JWT rejected | integration | `cd containers/api && npx jest tests/integration/websocket.test.js -t "without JWT" -x` | Wave 0 |
| TEST-03c | Heartbeat keeps connection alive | integration | `cd containers/api && npx jest tests/integration/websocket.test.js -t "heartbeat" -x` | Wave 0 |
| TEST-03d | Channel subscription delivers broadcasts | integration | `cd containers/api && npx jest tests/integration/websocket.test.js -t "channel" -x` | Wave 0 |
| TEST-04a | wsStore reconnect logic | unit | `cd containers/web/frontend && npx vitest run src/__tests__/stores/wsStore.test.ts -x` | Wave 0 |
| TEST-04b | hostStore merge behavior | unit | `cd containers/web/frontend && npx vitest run src/__tests__/stores/hostStore.test.ts -x` | Wave 0 |
| TEST-04c | configStore cache invalidation | unit | `cd containers/web/frontend && npx vitest run src/__tests__/stores/serverConfigStore.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** Run the specific test file for the task
- **Per wave merge:** Full suite for that side (backend or frontend)
- **Phase gate:** Both full suites green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `containers/api/tests/integration/` directory -- does not exist yet, needs creation
- [ ] `containers/api/tests/integration/websocket.test.js` -- covers TEST-03
- [ ] `containers/web/frontend/src/__tests__/stores/wsStore.test.ts` -- covers TEST-04a
- [ ] `containers/web/frontend/src/__tests__/stores/hostStore.test.ts` -- covers TEST-04b
- [ ] `containers/web/frontend/src/__tests__/stores/serverConfigStore.test.ts` -- covers TEST-04c

No framework install needed -- Jest 29.7 and Vitest 1.6.1 are already configured and working. The `tests/integration/` directory pattern is new but Jest config already matches `**/tests/**/*.test.js` which will include `tests/integration/*.test.js` automatically.

## Sources

### Primary (HIGH confidence)
- `containers/api/src/index.js` -- Verified WS upgrade handler, verifyWsToken, heartbeat interval, connection handler, channel subscription logic (lines 370-566)
- `containers/api/src/lib/websocket.js` -- Verified broadcastToChannels does NOT use Redis, only wss.clients (306 lines)
- `containers/api/jest.config.js` -- Verified testMatch pattern `**/tests/**/*.test.js` includes integration subdirectory
- `containers/web/frontend/vitest.config.ts` -- Verified jsdom environment, setup file path, path alias
- `containers/web/frontend/src/__tests__/setup.ts` -- Verified localStorage mock, window.location mock
- `containers/web/frontend/src/__tests__/stores/authStore.test.ts` -- Verified existing Vitest store test patterns
- `containers/web/frontend/src/stores/wsStore.ts` -- Verified reconnect logic, module-level variables, subscribe/emit pattern (162 lines)
- `containers/web/frontend/src/stores/hostStore.ts` -- Verified updateHostStatus merge logic (136 lines)
- `containers/web/frontend/src/stores/serverConfigStore.ts` -- Verified cache guard pattern (49 lines)
- `ws` package v8.19.0 -- Verified installed, works as both server and client
- Vitest 1.6.1 -- Verified vi.useFakeTimers, vi.advanceTimersByTime available
- Zustand 4.5.7 -- Verified getState/setState API for testing

### Secondary (MEDIUM confidence)
- [Zustand Testing Guide](https://docs.pmnd.rs/zustand/guides/testing) -- setState/getState approach for testing, __mocks__ pattern (redirected; used search results)
- [Vitest Timers Guide](https://vitest.dev/guide/mocking/timers) -- vi.useFakeTimers, vi.advanceTimersByTime patterns
- [WebSocket Integration Testing with Jest/Vitest and WS](https://thomason-isaiah.medium.com/writing-integration-tests-for-websocket-servers-using-jest-and-ws-8e5c61726b2a) -- Pattern for real ws client integration testing

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all packages already installed and verified in codebase
- Architecture: HIGH - patterns derived directly from production code and existing test files
- Pitfalls: HIGH - identified from code inspection of actual modules under test

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable -- no moving targets; all deps are locked versions)
