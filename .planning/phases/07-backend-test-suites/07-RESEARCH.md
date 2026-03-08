# Phase 7: Backend Test Suites - Research

**Researched:** 2026-03-08
**Domain:** Jest unit testing for Node.js backend services (image-sync, terminal)
**Confidence:** HIGH

## Summary

Phase 7 adds unit test coverage for two critical backend services: `image-sync.service.js` (696 lines, 7 exports) and `terminal.service.js` (275 lines, 7 exports). The codebase already has 41 test files with 1207 tests using Jest 29.7.0 on Node 18.19.1. Established patterns are clear and well-documented across the existing test suite.

The primary challenge is mocking complexity. Image-sync requires mocking `global.fetch` (with Range/resume semantics), `fs/fsp`, Redis (with NX lock + list queue operations), WebSocket broadcasts, and the `settings.service`. Terminal requires mocking `ssh2.Client` (EventEmitter-based with PTY shell + exec fallback), `uuid`, and `fs.readFileSync` (key loading). Both services use module-level state (`activeAbort`/`activeStream` for image-sync, `sessions` Map for terminal) which complicates test isolation.

The codebase has strong precedent for all these mocking patterns -- ssh2 mocking in `ssh.service.test.js`, Redis Map-based mocks in `linbo-update.service.test.js` and `settings.service.test.js`, and fake timers in `ssh.service.test.js`. The CONTEXT.md decision to create a shared `tests/mocks/redis.js` module is sound and will benefit Phase 8 (WebSocket integration tests).

**Primary recommendation:** Follow existing codebase patterns exactly. Create a shared Redis mock module in `tests/mocks/redis.js`, then build each test file using established `jest.mock()` + `describe/it` conventions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Cover the 4 success criteria per service plus 2-3 important edge cases each (~15-20 tests total)
- Image-sync edge cases: network failure mid-download, stale lock recovery, cancel running job
- Terminal edge cases: max sessions reached, resize on exec-mode session, destroyAll cleanup
- Test through public API only -- no _testing exports for internal helpers (flattenJob, _formatBytes, etc.)
- Test the actual MD5 implementation (not SHA256) -- criteria likely meant "hash verification" generically
- Terminal idle timeout tests use jest.useFakeTimers() + jest.advanceTimersByTime()
- fetch: jest.fn() for global.fetch with configurable responses (200, 206, HEAD with content-length/etag)
- ssh2.Client: EventEmitter stubs -- connect() triggers 'ready', shell() returns mock stream. ~30 lines mock setup.
- Redis: Shared mock module tests/mocks/redis.js with in-memory Map-based implementation. Reusable across both test files and future tests.
- fs/fsp: jest.mock('fs') and jest.mock('fs/promises') with controlled returns. No actual disk I/O.
- WebSocket: jest.mock with no-op broadcast (existing pattern)
- Inline constants per test file -- MOCK_MANIFEST, MOCK_MD5_HASH etc. No external fixture files.
- Resume simulation: Mock fsp.stat() to return { size: N } for .part files. Verify fetch gets correct Range header.
- Atomic swap: Verify fsp.rm() then fsp.rename() call sequence. Mock-based, not real files.
- Queue ordering: Verify lock acquisition + FIFO via rpush/lpop. Mock Redis list operations.

### Claude's Discretion
- Exact test descriptions and describe/it nesting structure
- Which additional edge cases beyond the 2-3 mentioned per service
- Mock setup utility functions if helpful for readability
- Whether to extract shared SSH mock setup into a reusable helper

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | Unit-Tests for Image-Sync Service (Resume-Download, Hash-Verify, Atomic Directory Swap, Queue) | Full source analysis of image-sync.service.js (696 lines, 7 exports). All 4 behaviors mapped to specific functions: _downloadFileWithResume (resume), _computeMd5 + MD5 check block (verify), fsp.rm+fsp.rename sequence (swap), rpush/lpop + NX lock (queue). Mocking patterns identified from existing tests. |
| TEST-02 | Unit-Tests for Terminal Service (Session-Create/Destroy, PTY/Exec-Fallback, Idle-Timeout, Cleanup) | Full source analysis of terminal.service.js (275 lines, 7 exports). All 4 behaviors mapped: createSession (create/destroy lifecycle), shell error -> exec fallback (PTY fallback), touchSession + setTimeout (idle timeout), destroyAll + sessions.delete (cleanup). ssh2 mock pattern from ssh.service.test.js. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jest | 29.7.0 | Test runner and assertion framework | Already installed in devDependencies, 41 existing test files use it |
| Node.js | 18.19.1 | Runtime | Project requirement (engines: >=18.0.0) |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| events (builtin) | N/A | EventEmitter for ssh2 mock streams | Terminal service ssh2 mock |

### No New Dependencies Needed
All mocking is done with `jest.fn()`, `jest.mock()`, and Node.js builtins. No additional test libraries required.

**Installation:**
```bash
# No installation needed -- all dependencies already present
```

## Architecture Patterns

### Test File Layout
```
containers/api/tests/
  mocks/
    redis.js              # NEW: Shared Redis mock module (reusable for Phase 8)
  services/
    image-sync.service.test.js   # NEW: ~150-180 lines
    terminal.service.test.js     # NEW: ~120-150 lines
```

### Pattern 1: Module-level jest.mock() with Map-backed Redis
**What:** Declare all jest.mock() calls at top of file, before any require(). Redis mock uses in-memory Map.
**When to use:** Every service test that depends on Redis, WebSocket, or settings.
**Example (from existing linbo-update.service.test.js):**
```javascript
const redisStore = new Map();

const mockRedisClient = {
  get: jest.fn(async (key) => redisStore.get(key) || null),
  set: jest.fn(async (key, val, ...args) => {
    if (args.includes('NX') && redisStore.has(key)) return null;
    redisStore.set(key, val);
    return 'OK';
  }),
  del: jest.fn(async (...keys) => { keys.flat().forEach((k) => redisStore.delete(k)); }),
  expire: jest.fn(async () => 1),
  hmset: jest.fn(async (key, data) => { redisStore.set(key, data); }),
  hgetall: jest.fn(async (key) => redisStore.get(key) || null),
  rpush: jest.fn(async (key, val) => { /* list push */ }),
  lpop: jest.fn(async (key) => { /* list pop */ }),
  lrange: jest.fn(async (key, start, stop) => { /* list range */ }),
  lrem: jest.fn(async (key, count, val) => { /* list remove */ }),
  setex: jest.fn(async (key, ttl, val) => { redisStore.set(key, val); }),
};
```

### Pattern 2: ssh2.Client EventEmitter Mock
**What:** Mock ssh2 module returning EventEmitter-based clients with connect/shell/exec/end methods.
**When to use:** Terminal service tests.
**Example (from existing ssh.service.test.js):**
```javascript
jest.mock('ssh2', () => ({
  Client: jest.fn().mockImplementation(() => {
    const EventEmitter = require('events');
    const client = new EventEmitter();
    client.connect = jest.fn(function(config) {
      setTimeout(() => this.emit('ready'), 10);
    });
    client.shell = jest.fn(function(opts, callback) {
      const stream = new EventEmitter();
      stream.write = jest.fn();
      stream.end = jest.fn();
      stream.setWindow = jest.fn();
      stream.stderr = new EventEmitter();
      callback(null, stream);
    });
    client.exec = jest.fn(function(cmd, callback) {
      const stream = new EventEmitter();
      stream.write = jest.fn();
      stream.end = jest.fn();
      stream.stderr = new EventEmitter();
      callback(null, stream);
    });
    client.end = jest.fn();
    return client;
  }),
}));
```

### Pattern 3: global.fetch Mock with Range/Resume
**What:** Replace global.fetch with jest.fn() returning configurable responses including 206 Partial Content.
**When to use:** Image-sync tests for download, manifest, sidecar operations.
**Example (from existing linbo-update.service.test.js pattern):**
```javascript
beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

// Mock HEAD + GET for resume download
global.fetch = jest.fn()
  .mockResolvedValueOnce({  // HEAD request
    ok: true,
    headers: new Map([['content-length', '1000'], ['etag', '"abc123"']]),
  })
  .mockResolvedValueOnce({  // GET with Range
    status: 206,
    body: mockReadableStream,
    headers: new Map([['content-range', 'bytes 500-999/1000']]),
  });
```

### Pattern 4: Fake Timers for Idle Timeout
**What:** Use jest.useFakeTimers() to test setTimeout-based idle timeout without real waits.
**When to use:** Terminal service idle timeout tests.
**Example (from existing ssh.service.test.js):**
```javascript
jest.useFakeTimers();
// ... trigger session creation ...
jest.advanceTimersByTime(30 * 60 * 1000); // 30 min idle timeout
// ... verify session was destroyed ...
jest.useRealTimers();
```

### Anti-Patterns to Avoid
- **Never use _testing exports:** CONTEXT.md explicitly says "no _testing exports for internal helpers". Test only through the 7 public exports of each service.
- **Never use real timers for timeout tests:** Always use jest.useFakeTimers().
- **Never use actual disk I/O:** Mock fs and fsp completely. No tmpDir creation.
- **Never use actual network:** Mock global.fetch completely. No HTTP requests.
- **Avoid process.nextTick races:** Use explicit setTimeout(fn, 0) or direct callback invocation in mocks to avoid test timing sensitivity.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redis mock | Inline Redis mock per test file | Shared `tests/mocks/redis.js` module | Reusable for Phase 8, reduces duplication, single source of truth for Redis mock behavior |
| EventEmitter mock streams | Custom stream objects | `new (require('events'))()` with added methods | Consistent with existing ssh.service.test.js pattern, proper event emission |
| Readable web stream mock | Custom ReadableStream | Simple object with Symbol.asyncIterator or mock Readable.fromWeb | Avoid complex Web Streams API mocking |

**Key insight:** The image-sync `_downloadFileWithResume` uses `stream.pipeline(Readable.fromWeb(response.body), ...transforms, writeStream)` which is complex to mock. Instead of mocking the full pipeline, the tests should mock at the function boundary level -- mock `global.fetch` responses and `fs.createWriteStream`, then verify the correct calls were made (Range headers, write flags, etc.) rather than testing stream piping internally.

## Common Pitfalls

### Pitfall 1: Module-level State Leaks Between Tests
**What goes wrong:** image-sync has module-level `let activeAbort = null; let activeStream = null;` and terminal has module-level `const sessions = new Map()`. If tests don't clean up, state leaks between tests.
**Why it happens:** Jest runs tests sequentially within a file but the required module retains state.
**How to avoid:** In `beforeEach`, clear module state. For terminal, call `destroyAll()` to empty the sessions Map. For image-sync, the `_runDownload` finally block clears activeAbort/activeStream, but if a test doesn't complete the download cycle, manually reset via the Redis mock (clear lock/current keys).
**Warning signs:** Tests pass individually but fail when run together.

### Pitfall 2: Async Event Emission Timing
**What goes wrong:** ssh2 mock emits 'ready' via setTimeout but test assertions run before the event fires.
**Why it happens:** Event-driven code with microtask/macrotask ordering differences.
**How to avoid:** Use `setTimeout(() => this.emit('ready'), 0)` (not 10ms) in mocks, or for cleaner tests use `process.nextTick(() => this.emit('ready'))`. Always await the Promise returned by createSession.
**Warning signs:** Tests intermittently fail with "connection error" or hang.

### Pitfall 3: image-sync _runDownload is Fire-and-Forget
**What goes wrong:** `pullImage()` calls `_runDownload().catch(...)` without await -- the download runs in the background. Tests that call `pullImage()` and immediately check Redis state may check before download completes.
**Why it happens:** `pullImage` returns the job object immediately while `_runDownload` runs async.
**How to avoid:** After calling `pullImage()`, wait for the async download to settle. Either: (a) mock `_runDownload` to be synchronous by making all async operations resolve immediately, or (b) add a small `await new Promise(r => setTimeout(r, 0))` after `pullImage()` to flush microtasks, or (c) test `pullImage` for job creation/queuing behavior only (not download completion) and test download indirectly via Redis state.
**Warning signs:** Tests pass with delays but fail without them.

### Pitfall 4: stream.pipeline Mocking Complexity
**What goes wrong:** Trying to fully mock `stream.pipeline(Readable.fromWeb(body), transforms, writeStream)` leads to brittle, complex test setup.
**Why it happens:** Node streams API has many edge cases (backpressure, error propagation, destroy semantics).
**How to avoid:** For resume tests, focus on verifying the Range header in fetch calls and the write stream flags ('a' for append, 'w' for fresh). Mock `stream/promises` pipeline to resolve immediately. Don't test stream data flow -- test the observable effects (Redis status updates, WS broadcasts, fs operations).
**Warning signs:** Tests that are 50+ lines of stream mock setup.

### Pitfall 5: fs.readFileSync in Terminal Module Top-Level
**What goes wrong:** `terminal.service.js` calls `fs.readFileSync(linboKeyPath)` at module load time (lines 18-31). If not mocked before require(), it tries to read an actual file that doesn't exist in test.
**Why it happens:** Module-level side effects run on first require().
**How to avoid:** Mock `fs` before requiring the terminal service. The mock must handle `readFileSync` returning a Buffer for the key path. The module has a try/catch so returning `Buffer.from('mock-key')` is fine.
**Warning signs:** "Failed to read LINBO client key" error in test output (non-fatal but noisy).

### Pitfall 6: Redis Mock Missing List Operations
**What goes wrong:** Image-sync uses Redis list operations (rpush, lpop, lrange, lrem) for the queue. Basic Redis mocks only have get/set/del.
**Why it happens:** Each existing test file builds its own Redis mock with only the operations it needs.
**How to avoid:** The shared `tests/mocks/redis.js` module must include list operations backed by a real array/Map structure. Include: rpush, lpop, lrange, lrem, plus the existing get/set/del/hmset/hgetall/setex/expire.
**Warning signs:** "mockRedisClient.rpush is not a function" errors.

## Code Examples

### Image-Sync: Functions to Test and Their Behaviors

```
Public API (7 exports):
1. getRemoteManifest()  -- fetches manifest, Redis cache (60s TTL)
2. getLocalImages()     -- scans fs directories
3. compareImages()      -- combines remote + local, returns status
4. pullImage(name)      -- creates job, acquires lock or queues, fires _runDownload
5. getQueue()           -- reads current + queued from Redis
6. cancelJob(jobId)     -- aborts running or removes from queue
7. recoverOnStartup()   -- cleans stale locks, starts next queued

Success Criteria Mapping:
- Resume download: pullImage -> _downloadFileWithResume uses Range header when .part exists
- Hash verification: _runDownload -> _computeMd5 -> compares with .md5 sidecar content
- Atomic directory swap: _runDownload -> fsp.rm(target) then fsp.rename(staging, target)
- Queue ordering: pullImage NX lock -> rpush queue; _processNextInQueue lpop -> next job
```

### Terminal: Functions to Test and Their Behaviors

```
Public API (7 exports):
1. createSession(hostIp, userId, opts) -- SSH connect, PTY shell, fallback exec
2. writeToSession(sessionId, data)     -- write to stream, touch activity
3. resizeSession(sessionId, cols, rows) -- setWindow on PTY mode
4. destroySession(sessionId)           -- cleanup session
5. listSessions()                      -- return session list
6. getSession(sessionId)               -- get single session
7. destroyAll()                        -- cleanup all sessions

Success Criteria Mapping:
- Session create/destroy: createSession adds to Map, destroySession removes + cleans
- PTY-to-exec fallback: shell() error triggers exec('sh') fallback
- Idle timeout: touchSession sets setTimeout(IDLE_TIMEOUT_MS), fires destroySession
- No orphaned sessions: destroyAll iterates Map, calls cleanup for each
```

### Shared Redis Mock Module Design

```javascript
// tests/mocks/redis.js
function createRedisMock() {
  const store = new Map();
  const lists = new Map();

  const client = {
    get: jest.fn(async (key) => store.get(key) || null),
    set: jest.fn(async (key, val, ...args) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    }),
    setex: jest.fn(async (key, ttl, val) => { store.set(key, val); return 'OK'; }),
    del: jest.fn(async (...keys) => {
      keys.flat().forEach(k => { store.delete(k); lists.delete(k); });
    }),
    expire: jest.fn(async () => 1),
    hmset: jest.fn(async (key, data) => { store.set(key, data); }),
    hgetall: jest.fn(async (key) => store.get(key) || null),
    rpush: jest.fn(async (key, val) => {
      if (!lists.has(key)) lists.set(key, []);
      lists.get(key).push(val);
      return lists.get(key).length;
    }),
    lpop: jest.fn(async (key) => {
      const list = lists.get(key);
      return list && list.length > 0 ? list.shift() : null;
    }),
    lrange: jest.fn(async (key, start, stop) => {
      const list = lists.get(key) || [];
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    }),
    lrem: jest.fn(async (key, count, val) => {
      const list = lists.get(key);
      if (!list) return 0;
      const idx = list.indexOf(val);
      if (idx !== -1) { list.splice(idx, 1); return 1; }
      return 0;
    }),
    status: 'ready',
  };

  function reset() {
    store.clear();
    lists.clear();
    Object.values(client).forEach(v => { if (jest.isMockFunction(v)) v.mockClear(); });
  }

  return { client, store, lists, reset };
}

module.exports = { createRedisMock };
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline Redis mock per file | Shared mock module (this phase) | Phase 7 | Reduces duplication, enables Phase 8 reuse |
| _testing exports for internals | Test through public API only | Phase 7 decision | Cleaner API, tests don't depend on internal structure |

**Codebase conventions to maintain:**
- `jest.mock()` at module top, before requires
- `describe()` per function, `it()`/`test()` per behavior
- `beforeEach(() => jest.clearAllMocks())` in every describe
- Console output suppressed via `tests/setup.js` (log/debug/info mocked, warn/error visible)
- 30s test timeout (from jest.config.js)
- Test files named `{service-name}.service.test.js` in `tests/services/`

## Open Questions

1. **stream.pipeline mocking strategy for _runDownload**
   - What we know: `_runDownload` uses `pipeline(Readable.fromWeb(response.body), transforms, writeStream)`. This is called inside the fire-and-forget `_runDownload` triggered by `pullImage`.
   - What's unclear: Whether to mock `stream/promises.pipeline` to resolve immediately (simpler) or to mock the full stream chain (more realistic but complex).
   - Recommendation: Mock `stream/promises` with `pipeline: jest.fn(async () => {})`. This avoids stream complexity while still allowing verification of the fetch Range headers and fs.createWriteStream flags. The pipeline internals (progress transform, throttle) are implementation details.

2. **Terminal module-level fs.readFileSync**
   - What we know: Lines 17-31 read SSH key at module load time with try/catch.
   - What's unclear: Whether mocking fs before require() cleanly prevents the file read.
   - Recommendation: Mock `fs` with `readFileSync: jest.fn(() => Buffer.from('mock-ssh-key'))` before requiring terminal.service. The try/catch in the module handles errors gracefully anyway.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | `containers/api/jest.config.js` |
| Quick run command | `cd containers/api && npx jest tests/services/image-sync.service.test.js tests/services/terminal.service.test.js --runInBand --verbose` |
| Full suite command | `cd containers/api && npx jest --runInBand` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01a | Resume download from byte offset | unit | `npx jest tests/services/image-sync.service.test.js -t "resume" --runInBand -x` | Wave 0 |
| TEST-01b | MD5 hash verification pass/fail | unit | `npx jest tests/services/image-sync.service.test.js -t "md5\|hash\|verify" --runInBand -x` | Wave 0 |
| TEST-01c | Atomic directory swap | unit | `npx jest tests/services/image-sync.service.test.js -t "atomic\|swap" --runInBand -x` | Wave 0 |
| TEST-01d | Queue ordering | unit | `npx jest tests/services/image-sync.service.test.js -t "queue" --runInBand -x` | Wave 0 |
| TEST-02a | Session create/destroy lifecycle | unit | `npx jest tests/services/terminal.service.test.js -t "create\|destroy" --runInBand -x` | Wave 0 |
| TEST-02b | PTY-to-exec fallback | unit | `npx jest tests/services/terminal.service.test.js -t "fallback\|exec" --runInBand -x` | Wave 0 |
| TEST-02c | Idle timeout triggers cleanup | unit | `npx jest tests/services/terminal.service.test.js -t "idle\|timeout" --runInBand -x` | Wave 0 |
| TEST-02d | No orphaned sessions after cleanup | unit | `npx jest tests/services/terminal.service.test.js -t "orphan\|destroyAll\|cleanup" --runInBand -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd containers/api && npx jest tests/services/image-sync.service.test.js tests/services/terminal.service.test.js --runInBand --verbose`
- **Per wave merge:** `cd containers/api && npx jest --runInBand`
- **Phase gate:** All new tests pass with `npx jest tests/services/image-sync.service.test.js tests/services/terminal.service.test.js --runInBand --verbose` and no regressions in full suite

### Wave 0 Gaps
- [ ] `tests/mocks/redis.js` -- shared Redis mock module (new directory + file)
- [ ] `tests/services/image-sync.service.test.js` -- covers TEST-01
- [ ] `tests/services/terminal.service.test.js` -- covers TEST-02

## Sources

### Primary (HIGH confidence)
- `containers/api/src/services/image-sync.service.js` -- 696 lines, full source analysis
- `containers/api/src/services/terminal.service.js` -- 275 lines, full source analysis
- `containers/api/jest.config.js` -- Jest 29.7.0 config (node env, 30s timeout, setup files)
- `containers/api/package.json` -- dependencies and devDependencies
- `containers/api/tests/services/ssh.service.test.js` -- ssh2 EventEmitter mock pattern
- `containers/api/tests/services/linbo-update.service.test.js` -- Redis mock, global.fetch mock, fake timers
- `containers/api/tests/services/settings.service.test.js` -- Redis mock pattern
- `containers/api/tests/services/sync.service.test.js` -- Redis mock with list operations
- `containers/api/tests/lib/redis.test.js` -- scanStream/pipeline mock pattern
- `containers/api/tests/setup.js` -- console suppression, 30s timeout
- `containers/api/tests/globalSetup.js` -- NODE_ENV=test, JWT_SECRET

### Secondary (MEDIUM confidence)
- Test suite execution: 35/41 suites pass, 1174/1207 tests pass (6 pre-existing failures unrelated to Phase 7)
- Node 18.19.1 confirmed via `node --version`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Jest 29.7.0 already in use, 41 test files establish patterns
- Architecture: HIGH - Full source analysis of both services, all mock patterns exist in codebase
- Pitfalls: HIGH - Identified from code analysis and existing test patterns (module state, async events, fire-and-forget)

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable -- no dependency changes expected)
