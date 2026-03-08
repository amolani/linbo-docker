# Phase 7: Backend Test Suites - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Unit tests for image-sync service and terminal service. Tests verify the 4 required behaviors per service plus key edge cases. All tests run in CI without network access or running containers (fully mocked dependencies).

</domain>

<decisions>
## Implementation Decisions

### Test scope
- Cover the 4 success criteria per service **plus** 2-3 important edge cases each (~15-20 tests total)
- Image-sync edge cases: network failure mid-download, stale lock recovery, cancel running job
- Terminal edge cases: max sessions reached, resize on exec-mode session, destroyAll cleanup
- Test through public API only — no _testing exports for internal helpers (flattenJob, _formatBytes, etc.)

### Hash verification
- Success criteria say "SHA256" but code uses MD5 (.md5 sidecar files with _computeMd5)
- **Test the actual MD5 implementation** — criteria likely meant "hash verification" generically
- Note: this is a criteria/code mismatch, not a bug

### Timer strategy
- Terminal idle timeout tests use **jest.useFakeTimers()** + jest.advanceTimersByTime()
- No real timer waits — instant execution, no flaky potential

### Mocking strategy
- **fetch:** jest.fn() for global.fetch with configurable responses (200, 206, HEAD with content-length/etag)
- **ssh2.Client:** EventEmitter stubs — connect() triggers 'ready', shell() returns mock stream (EventEmitter with write/end). ~30 lines mock setup.
- **Redis:** Shared mock module `tests/mocks/redis.js` with in-memory Map-based implementation (get/set/del/hmset/lrange/lpop etc.). Reusable across both test files and future tests.
- **fs/fsp:** jest.mock('fs') and jest.mock('fs/promises') with controlled returns. No actual disk I/O.
- **WebSocket:** jest.mock with no-op broadcast (existing pattern)

### Test data and fixtures
- **Inline constants** per test file — MOCK_MANIFEST, MOCK_MD5_HASH etc. as const at top. Self-contained, no external fixture files.
- **Resume simulation:** Mock fsp.stat() to return { size: N } for .part files at different offsets. Verify fetch gets correct Range header.
- **Atomic swap:** Verify fsp.rm() then fsp.rename() call sequence. Mock-based, not real files.
- **Queue ordering:** Verify lock acquisition + FIFO via rpush/lpop. Mock Redis list operations.

### Claude's Discretion
- Exact test descriptions and describe/it nesting structure
- Which additional edge cases beyond the 2-3 mentioned per service
- Mock setup utility functions if helpful for readability
- Whether to extract shared SSH mock setup into a reusable helper

</decisions>

<specifics>
## Specific Ideas

- Existing test suite has 40+ files establishing strong patterns — follow the same jest.mock() style
- The shared Redis mock module should be general enough for Phase 8 (WebSocket integration tests) to reuse
- Test file naming follows existing convention: `tests/services/image-sync.service.test.js` and `tests/services/terminal.service.test.js`

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/helpers.js`: Shared test utilities already in use
- `tests/setup.js`: Jest setup file (setupFilesAfterEnv)
- `tests/globalSetup.js` / `tests/globalTeardown.js`: Global test lifecycle
- Existing Redis mock pattern in `tests/lib/redis.test.js` (Phase 6) — can inform shared mock module design

### Established Patterns
- One test file per service in `tests/services/`
- jest.mock() at module level for dependencies
- describe() blocks per function, it() blocks per behavior
- No _testing exports for internal helpers (test through public API)

### Integration Points
- `containers/api/src/services/image-sync.service.js` (696 lines) — 7 exports: getRemoteManifest, getLocalImages, compareImages, pullImage, getQueue, cancelJob, recoverOnStartup
- `containers/api/src/services/terminal.service.js` (275 lines) — 7 exports: createSession, writeToSession, resizeSession, destroySession, listSessions, getSession, destroyAll
- Dependencies to mock: redis, websocket, settings.service, fetch, fs/fsp, crypto, ssh2, uuid

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-backend-test-suites*
*Context gathered: 2026-03-08*
