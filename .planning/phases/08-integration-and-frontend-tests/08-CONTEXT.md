# Phase 8: Integration and Frontend Tests - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

WebSocket integration tests (backend, Jest) and frontend Zustand store tests (Vitest). WS tests verify connection auth, heartbeat, and channel subscriptions using a real Express server. Store tests verify wsStore reconnect, hostStore merge, and configStore cache using mocked dependencies. All tests run headlessly without a running API.

</domain>

<decisions>
## Implementation Decisions

### WebSocket test scope
- Test only the 4 success criteria behaviors: JWT connect succeeds, no-JWT rejected, heartbeat keeps alive, channel subscription delivers broadcasts
- Do NOT test individual websocket.js broadcast helpers (broadcast, sendTo, getStats etc.) — out of scope
- Channel tests cover both specific channel subscription (`room:lab1`) and wildcard `*` subscription
- ~8-10 backend WS tests total

### WebSocket test style
- **Integration tests** with real Express server on random port + real `ws` client connections
- Real timers with short intervals (100-200ms heartbeat) — no fake timers for backend WS
- Test file location: `tests/integration/websocket.test.js` (new directory, separate from unit tests)

### Frontend store test depth
- 4 behaviors per store + 2-3 edge cases each (~12-15 tests across 3 stores)
- **wsStore:** reconnect logic (onclose triggers reconnect after delay, respects maxReconnectAttempts), subscribe/unsubscribe, emit dispatch, visibility change re-emit
- **hostStore:** updateHostStatus merge (correct host updated, other fields preserved, unknown ID handling)
- **configStore:** cache guard (first call fetches, second returns cached), error fallback to defaults for both fetchServerConfig and fetchMode

### Timer strategy
- Backend WS: real timers with short intervals (integration style)
- Frontend wsStore: **vi.useFakeTimers()** + vi.advanceTimersByTime() for reconnect delay testing

### Mock strategy
- **Backend WS:** Real `ws` client (already installed) connecting to real Express server. No mock WS client.
- **Frontend wsStore:** Lightweight inline MockWebSocket class (~30 lines) with OPEN/CLOSED readyState, send(), close(), trigger helpers. Local to wsStore.test.ts, not in setup.ts.
- **Frontend hostStore/configStore:** vi.mock() for API modules (hostsApi, syncApi, axios). Standard Vitest mocking.
- **Redis mock:** Claude's discretion whether to reuse Phase 7's shared `tests/mocks/redis.js` or handle differently based on integration test needs

### Test framework split
- **Backend:** Jest 29.7 (41+ existing tests) — no change
- **Frontend:** Vitest 1.2 + jsdom + @testing-library/react (4 existing tests) — no change
- No framework consolidation — each side follows its established patterns

### File locations
- Backend WS integration: `containers/api/tests/integration/websocket.test.js`
- Frontend stores: `containers/web/frontend/src/__tests__/stores/wsStore.test.ts`, `hostStore.test.ts`, `serverConfigStore.test.ts`
- Follows existing conventions in both codebases

### Claude's Discretion
- Exact test descriptions and describe/it nesting
- Whether shared Redis mock is needed for WS integration tests or if the test can mock at a different level
- MockWebSocket class implementation details
- Express server setup/teardown pattern for integration tests
- Additional edge cases beyond the mentioned ones per store

</decisions>

<specifics>
## Specific Ideas

- Phase 7 built `tests/mocks/redis.js` specifically for Phase 8 reuse — use it if WS tests need Redis
- Existing authStore.test.ts in frontend provides the Vitest pattern reference (vi.fn, vi.clearAllMocks, beforeEach)
- wsStore has module-level variables (lastWsError, visibilityListenerAdded) that may need cleanup between tests

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/mocks/redis.js`: Shared Redis mock from Phase 7 (Map-backed, list ops, NX semantics)
- `src/__tests__/setup.ts`: Frontend test setup (localStorage mock, window.location mock)
- `src/__tests__/stores/authStore.test.ts`: Reference for Vitest store test patterns
- `ws` package: Already installed, usable as test client for WS integration tests

### Established Patterns
- Backend: jest.mock() at module level, describe/it blocks, inline constants
- Frontend: vi.fn()/vi.mock(), beforeEach cleanup, jsdom environment
- Test through public API only (Phase 7 decision carries forward)
- Inline test constants, no external fixture files

### Integration Points
- `containers/api/src/index.js`: WS upgrade handler with verifyWsToken — test target for backend
- `containers/api/src/lib/websocket.js`: 306 lines, 15 exports — broadcast/channel logic tested via integration
- `containers/web/frontend/src/stores/wsStore.ts`: 162 lines — reconnect, subscribe, emit
- `containers/web/frontend/src/stores/hostStore.ts`: 136 lines — updateHostStatus merge
- `containers/web/frontend/src/stores/serverConfigStore.ts`: 49 lines — cache guard pattern

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-integration-and-frontend-tests*
*Context gathered: 2026-03-08*
