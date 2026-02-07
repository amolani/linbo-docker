# Session 5: Reaktives Frontend via WebSocket

**Datum:** 2026-02-07
**Server:** 10.0.0.11 (Produktion), 10.0.0.13 (Test-VM)
**Commits:** `fb85fbf` → `fe880dc` → `2a5c8a8` (3 Commits, +451/-125 Zeilen, 15 Dateien)
**Tests:** 428 total (418 passing, 10 preexisting Integration-Failures)

---

## Ausgangslage

Das Frontend war statisch — jede Änderung (Host erstellen, Room löschen, Config deployen, etc.) war erst nach einem manuellen Page-Reload sichtbar. Die WebSocket-Infrastruktur existierte zwar, war aber **stillschweigend kaputt**:

1. **Kritischer Bug: `payload` vs `data` Mismatch** — Die API sendet Events im Format `{ type, data, timestamp }`, das Frontend las aber `event.payload`. Alle WS-Subscriptions empfingen `undefined` als Daten. Fehler wurden im catch-Block geschluckt → keinerlei Fehlermeldung.

2. **Fehlende CRUD-Broadcasts** — Die REST-API-Routen (hosts, rooms, configs, images) sendeten nach Create/Update/Delete keine WebSocket-Events. Es gab also gar keine Events, auf die das Frontend hätte reagieren können.

3. **Kein Invalidation-Mechanismus** — Selbst wenn Events korrekt angekommen wären, gab es keinen Hook, der darauf mit einem Refetch reagiert hätte.

---

## Strategie: Invalidation + Refetch

Bewusste Entscheidung **gegen** inkrementellen State-Sync (zu komplex bei Pagination/Filterung/Sortierung) und **für** ein einfaches Pattern:

```
WS-Event signalisiert Datenänderung → betroffene Seite refetcht (debounced)
```

Einzige Ausnahme: `operation.progress` — dieses hochfrequente Event wird direkt im State geupdated (Progress-Bar live), ohne Refetch.

---

## Akzeptanzkriterien

| AC | Beschreibung | Status |
|----|-------------|--------|
| AC1 | WS-Fehler sichtbar: rate-limited `console.warn` (1x/min) mit event.type + gekürztem Raw-Event | Implementiert |
| AC2 | Max 1 WS-getriggerter Refetch pro `debounceMs` pro Hook-Instanz (Bulk-Import 50 Hosts → max 1 Refetch) | Implementiert |
| AC3 | `operation.progress` direktes State-Update, KEIN Refetch via `useDataInvalidation` | Implementiert |
| AC4 | Reconnect-Resync: WS-Reconnect nach Tab-Hintergrund/WLAN → debounced Refetch für aktive Seite | Implementiert |

---

## Commit 1: `fb85fbf` — Kernimplementierung

### Alle Änderungen im Detail:

### 1. Type-System: `WsEventBase` + `data` statt `payload`

**Datei:** `containers/web/frontend/src/types/index.ts`

Vorher waren die 4 WsEvent-Interfaces unabhängig voneinander definiert und verwendeten `payload`:

```typescript
// VORHER
export interface WsHostStatusEvent {
  type: 'host.status.changed';
  payload: { hostId: string; ... };
  timestamp: string;
}
```

Neu: Gemeinsames `WsEventBase`-Interface, alle Events nutzen `data`:

```typescript
// NACHHER
export interface WsEventBase {
  type: string;
  timestamp: string;
  payload?: unknown; // Legacy-Compat für getEventData() Fallback
}

export interface WsHostStatusEvent extends WsEventBase {
  type: 'host.status.changed';
  data: {
    hostId: string;
    hostname: string;
    status: HostStatus;
    detectedOs: string | null;
    lastSeen: string;
  };
}

export interface WsSyncProgressEvent extends WsEventBase {
  type: 'sync.progress';
  data: {
    hostId: string;
    hostname: string;
    progress: number;
    speed?: string;
    eta?: string;
  };
}

export interface WsOperationProgressEvent extends WsEventBase {
  type: 'operation.progress';
  data: {
    operationId: string;
    progress: number;
    stats: OperationStats;
  };
}

export interface WsNotificationEvent extends WsEventBase {
  type: 'notification';
  data: {
    level: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
  };
}
```

Neues Interface für CRUD-Events:

```typescript
export interface WsEntityChangeEvent extends WsEventBase {
  type: string; // z.B. 'host.created', 'room.deleted'
  data: { id: string; name?: string };
}

export type WsEvent =
  | WsHostStatusEvent
  | WsSyncProgressEvent
  | WsOperationProgressEvent
  | WsNotificationEvent
  | WsEntityChangeEvent;
```

---

### 2. WebSocket Store: Komplett-Rewrite

**Datei:** `containers/web/frontend/src/stores/wsStore.ts` (214 Zeilen → ~163 Zeilen, klarer strukturiert)

#### 2a. Zentralisierte `emit()` Funktion

Vorher: `onmessage`-Handler rief Listener direkt auf mit `try/catch` inline.

Nachher: `emit()` wird **innerhalb** des `create<WsState>((set, get) => { ... })`-Bodys definiert, so dass es Closure-Zugriff auf `get()` hat:

```typescript
export const useWsStore = create<WsState>((set, get) => {
  function emit(event: WsEvent) {
    const { listeners } = get();
    const run = (cbs?: Set<(e: WsEvent) => void>) =>
      cbs?.forEach((cb) => {
        try { cb(event); }
        catch (e) { console.error('[WS] listener failed', event.type, e); }
      });
    run(listeners.get(event.type));
    run(listeners.get('*'));
  }

  return { /* store properties + methods, all using emit() */ };
});
```

#### 2b. Rate-limited Error Log (AC1)

Module-level `lastWsError`-Variable. `onmessage`-Handler loggt Fehler maximal 1x/Minute:

```typescript
let lastWsError = 0;

ws.onmessage = (msg) => {
  const raw = typeof msg.data === 'string' ? msg.data : '';
  try {
    const parsed = JSON.parse(raw) as WsEvent;
    emit(parsed);
  } catch (err) {
    const now = Date.now();
    if (now - lastWsError > 60_000) {
      const typeMatch = raw.match(/"type"\s*:\s*"([^"]+)"/);
      const typeHint = typeMatch?.[1] ?? 'unknown';
      console.warn('[WS] Event parse/dispatch failed:', err, '| type:', typeHint, '| raw:', raw.slice(0, 200));
      lastWsError = now;
    }
  }
};
```

Wichtig: `msg` statt `event` als Parameter-Name, um Namenskollision mit `WsEvent`-Typ zu vermeiden.

#### 2c. Reconnect-Resync (AC4)

Zwei Mechanismen:

**1. Nach WebSocket-Reconnect:**
```typescript
ws.onopen = () => {
  const wasReconnect = get().reconnectAttempts > 0;
  set({ socket: ws, isConnected: true, reconnectAttempts: 0 });
  if (wasReconnect) {
    setTimeout(() => {
      emit({ type: '_reconnected', data: {}, timestamp: new Date().toISOString() } as WsEvent);
    }, 500); // 500ms Delay: Server-State stabilisieren lassen
  }
};
```

**2. Tab-Rückkehr aus Hintergrund:**
```typescript
let visibilityListenerAdded = false;

// Im connect():
if (!visibilityListenerAdded) {
  visibilityListenerAdded = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && get().isConnected) {
      emit({ type: '_reconnected', data: {}, timestamp: new Date().toISOString() } as WsEvent);
    }
  });
}
```

`visibilityListenerAdded`-Guard verhindert doppelte Registrierung bei HMR/Reconnect.

---

### 3. Legacy-Fallback Helper: `getEventData()`

**Datei:** `containers/web/frontend/src/hooks/useWebSocket.ts`

Neue Funktion, die `event.data` bevorzugt und bei Legacy-Events auf `event.payload` zurückfällt:

```typescript
let legacyWarned = false;

export function getEventData(event: WsEvent): unknown {
  if ('data' in event && event.data != null) return event.data;
  if ('payload' in event && event.payload != null) {
    if (!legacyWarned) {
      console.warn('[WS] Legacy payload field used for event:', event.type, '— migrate to data');
      legacyWarned = true;
    }
    return event.payload;
  }
  return {};
}
```

Return-Typ ist `unknown` → erzwingt explizites Casting am Aufrufsite. Warnung wird max 1x pro Page-Load ausgegeben.

Alle bestehenden Handler wurden umgestellt:

```typescript
// VORHER (kaputt, da API data sendet):
const data = event.payload as WsHostStatusEvent['payload'];

// NACHHER:
const data = getEventData(event) as WsHostStatusEvent['data'];
```

Betroffen: `useHostStatusUpdates()`, `useNotificationEvents()`, `OperationsPage.tsx` (`operation.progress`-Handler).

---

### 4. API: WS-Broadcasts für CRUD-Operationen

Alle CRUD-Routen senden jetzt nach erfolgreichem DB-Write ein WebSocket-Event.

**Konsistenter Payload:** `{ id, name }` (bei Delete nur `{ id }`).

#### `containers/api/src/routes/hosts.js`

| Stelle | Event | Payload |
|--------|-------|---------|
| POST / (Create) | `host.created` | `{ id: host.id, name: host.hostname }` |
| PATCH /:id (Update) | `host.updated` | `{ id: host.id, name: host.hostname }` |
| DELETE /:id | `host.deleted` | `{ id: req.params.id }` |
| POST /import (Bulk) | `host.created` | `{ id: 'bulk', name: '${count} hosts imported' }` |

#### `containers/api/src/routes/rooms.js`

| Stelle | Event | Payload |
|--------|-------|---------|
| POST / (Create) | `room.created` | `{ id: room.id, name: room.name }` |
| PATCH /:id (Update) | `room.updated` | `{ id: room.id, name: room.name }` |
| DELETE /:id | `room.deleted` | `{ id: req.params.id }` |

#### `containers/api/src/routes/configs.js`

| Stelle | Event | Payload |
|--------|-------|---------|
| POST / (Create) | `config.created` | `{ id: config.id, name: config.name }` |
| PATCH /:id (Update) | `config.updated` | `{ id: config.id, name: config.name }` |
| DELETE /:id | `config.deleted` | `{ id: req.params.id }` |
| POST /:id/clone | `config.created` | `{ id: clone.id, name: clone.name }` |

Hinweis: `config.deployed` und `config.raw_updated` waren bereits vorher vorhanden.

#### `containers/api/src/routes/images.js`

| Stelle | Event | Payload |
|--------|-------|---------|
| POST / (Create/Register) | `image.created` | `{ id: image.id, name: image.filename }` |
| PATCH /:id (Update) | `image.updated` | `{ id: image.id, name: image.filename }` |
| DELETE /:id | `image.deleted` | `{ id: req.params.id }` |

---

### 5. Neuer Hook: `useDataInvalidation`

**Neue Datei:** `containers/web/frontend/src/hooks/useDataInvalidation.ts` (134 Zeilen)

Zentraler Hook, der WS-Events abonniert und einen debounced Refetch auslöst.

```typescript
const { suppress } = useDataInvalidation('host', fetchHosts);
// oder multi-entity:
useDataInvalidation(['host', 'room', 'config', 'image', 'operation'], fetchData, {
  showToast: false,
  debounceMs: 1000,
});
```

**Abonnierte Events pro Entity:**
- **Standard:** `${entity}.created`, `${entity}.updated`, `${entity}.deleted`
- **config extra:** `config.deployed`, `config.raw_updated`
- **operation:** `operation.started`, `operation.completed`, `operation.cancelled` (NICHT `operation.progress` — AC3)
- **Immer:** `_reconnected` (AC4)

**Features:**
- Debounce-Timer pro Hook-Instanz (AC2)
- `useRef(refetchFn)` vermeidet Re-Subscriptions bei Renders
- Optionale Toast-Benachrichtigung (default: `false`)
- Per-instance `suppress()` für Dedup (siehe Commit 3)
- Sauberes Cleanup: `clearTimeout` + `unsubscribe` im useEffect return

---

### 6. Seiten verdrahtet

Alle 6 Seiten wurden mit dem Hook versehen:

| Seite | Hook-Aufruf |
|-------|-------------|
| `HostsPage.tsx` | `useDataInvalidation('host', fetchHosts)` |
| `RoomsPage.tsx` | `useDataInvalidation('room', fetchRooms)` + `useDataInvalidation('host', refreshAfterHostChange)` |
| `ConfigsPage.tsx` | `useDataInvalidation('config', fetchConfigs)` |
| `ImagesPage.tsx` | `useDataInvalidation('image', fetchImages)` |
| `DashboardPage.tsx` | `useDataInvalidation(['host', 'room', 'config', 'image', 'operation'], fetchData, { debounceMs: 1000 })` |
| `OperationsPage.tsx` | `useDataInvalidation('operation', fetchOperations)` |

---

## Commit 2: `fe880dc` — Flicker-Fix

### Problem

Nach dem ersten Deploy meldete der Benutzer **Seiten-Flackern**: Bei jedem WS-Event flackerte die Host-Tabelle kurz auf.

### Root Causes

1. **`hostStore.fetchHosts` setzte `isLoading: true` bei jedem Aufruf** → Tabelle zeigte kurz den Loading-Spinner, dann die Daten.

2. **Double-Fetch:** User's CRUD-Action ruft `fetchHosts()` auf, 500ms später kommt das WS-Echo und löst einen zweiten `fetchHosts()` aus.

### Fixes

#### Fix 1: Silent Refetch im hostStore

```typescript
// VORHER:
fetchHosts: async () => {
  set({ isLoading: true, error: null });
  // ...
}

// NACHHER:
fetchHosts: async () => {
  const { hosts } = get();
  // Nur beim initialen Load den Spinner zeigen
  if (hosts.length === 0) {
    set({ isLoading: true, error: null });
  }
  // ...
}
```

#### Fix 2: Dedup via `markFetched` (erster Ansatz)

Globaler `lastFetchTime`-Tracker pro Entity-Key. `useDataInvalidation` skipped den WS-Refetch wenn `Date.now() - lastFetch < debounceMs`.

`hostStore.fetchHosts` rief `markFetched('host')` nach dem Fetch auf.

#### Fix 3: `showToast` Default auf `false`

Toasts bei jedem WS-Event waren störend → Default geändert.

### Ergebnis

Flackern komplett beseitigt. Background-Refetches sind für den User unsichtbar.

---

## Commit 3: `2a5c8a8` — Per-instance Suppress + Expanded Rooms

### Problem 1: Cross-Component Dedup Bug

Der globale `markFetched('host')` aus Commit 2 hatte einen Seiteneffekt: Wenn `hostStore.fetchHosts` `markFetched('host')` aufrief, wurde auch der `useDataInvalidation('host', fetchRooms)` in der RoomsPage unterdrückt — weil beide den gleichen Entity-Key `'host'` verwendeten.

**Folge:** Wenn man auf der HostsPage einen Host erstellte/löschte, aktualisierten sich die Room-Host-Counts auf der RoomsPage nicht.

### Lösung: Per-instance `suppress()`

`markFetched`/`lastFetchTime` komplett entfernt. Stattdessen gibt `useDataInvalidation` jetzt eine `suppress()`-Funktion zurück:

```typescript
export function useDataInvalidation(entity, refetchFn, options) {
  // Per-instance suppress state (useRef — nicht global!)
  const suppressedUntilRef = useRef(0);

  const suppress = useCallback((durationMs?) => {
    suppressedUntilRef.current = Date.now() + (durationMs ?? debounceMs * 2);
  }, [debounceMs]);

  // Im scheduleRefetch:
  function scheduleRefetch() {
    timerRef.current = setTimeout(() => {
      if (Date.now() < suppressedUntilRef.current) return; // suppressed!
      refetchRef.current();
    }, debounceMs);
  }

  return { suppress };
}
```

**Verwendungspattern in jeder Seite:**

```typescript
const { suppress } = useDataInvalidation('host', fetchHosts);

const handleDelete = async () => {
  suppress();          // Unterdrückt WS-Echo für debounceMs*2
  await deleteHost(id);
  // fetchHosts() passiert sofort durch die CRUD-Action
  // Das WS-Echo 500ms später wird ignoriert
};
```

**Geänderte Dateien:**

| Datei | Suppress-Aufrufe |
|-------|------------------|
| `useDataInvalidation.ts` | Hook-Redesign: `suppress()` return statt globalem `markFetched` |
| `hostStore.ts` | `markFetched`-Import + Aufruf entfernt |
| `HostsPage.tsx` | `suppress()` vor Create, Update, Delete, Bulk Delete |
| `RoomsPage.tsx` | `suppress()` vor Create, Update, Delete, Bulk Delete |
| `ConfigsPage.tsx` | `suppress()` vor Create, Update, Delete, Clone, Deploy |
| `ImagesPage.tsx` | `suppress()` vor Create, Update, Delete |
| `OperationsPage.tsx` | `suppress()` vor Cancel |

### Problem 2: Expanded Rooms zeigen stale Hosts

Wenn ein Room-Accordion aufgeklappt war und ein Host in diesem Room geändert wurde (Status, neu erstellt, gelöscht), blieb die Host-Liste im Accordion stale.

### Lösung: `refreshAfterHostChange`

Neuer `useCallback` in RoomsPage, der bei WS-Host-Events:
1. Die Room-Liste refetcht (für aktualisierte Host-Counts)
2. Für jeden aktuell aufgeklappten Room die Hosts neu lädt

```typescript
// Ref um expandedRooms im Callback lesen zu können
const expandedRoomsRef = useRef(expandedRooms);
expandedRoomsRef.current = expandedRooms;

const refreshAfterHostChange = useCallback(async () => {
  fetchRooms(); // Room-Counts aktualisieren
  const expanded = Array.from(expandedRoomsRef.current);
  if (expanded.length === 0) return;
  for (const roomId of expanded) {
    try {
      const room = await roomsApi.get(roomId);
      setRoomHosts(prev => ({ ...prev, [roomId]: room.hosts || [] }));
      setRoomStatusSummary(prev => ({ ...prev, [roomId]: room.statusSummary || {} }));
    } catch {
      // Room könnte gelöscht worden sein
    }
  }
}, []);

// Hook-Verdrahtung:
useDataInvalidation('host', refreshAfterHostChange, { showToast: false });
```

---

## Datenfluss-Diagramm

```
┌─────────────┐     POST /hosts      ┌─────────┐
│   Frontend   │ ──────────────────► │   API   │
│  (HostsPage) │                     │ (Express)│
└──────┬───────┘                     └────┬─────┘
       │                                   │
       │ suppress()                        │ 1. DB Write (Prisma)
       │                                   │ 2. ws.broadcast('host.created', { id, name })
       │                                   │
       │ fetchHosts()                      ▼
       │ (sofort nach                 ┌─────────┐
       │  CRUD-Response)              │WebSocket│
       │                              │ Server  │
       │                              └────┬────┘
       │                                   │
       │                                   │ JSON: { type: 'host.created',
       │                                   │         data: { id, name },
       │                                   │         timestamp: '...' }
       │                                   ▼
       │                              ┌──────────────────┐
       │                              │  useWsStore      │
       │                              │  emit(parsed)    │
       │                              └────────┬─────────┘
       │                                       │
       │                            ┌──────────┼──────────┐
       │                            ▼          ▼          ▼
       │                      HostsPage   RoomsPage   Dashboard
       │                      hook        hook        hook
       │                         │          │           │
       │                    SUPPRESSED!     │        debounced
       │                    (suppress()  scheduleRefetch  1000ms
       │                     aktiv)         │
       │                                    ▼
       │                              fetchRooms()
       │                              + refreshExpandedHosts()
       │
       ▼
  Hosts-Tabelle zeigt neue Daten
  (kein Flicker, kein doppelter Fetch)
```

---

## Geänderte Dateien (Gesamt alle 3 Commits)

| Datei | Änderung | Zeilen |
|-------|----------|--------|
| `api/src/routes/hosts.js` | +Import ws, +4 broadcasts | +15 |
| `api/src/routes/rooms.js` | +Import ws, +3 broadcasts | +10 |
| `api/src/routes/configs.js` | +4 broadcasts | +12 |
| `api/src/routes/images.js` | +Import ws, +4 broadcasts | +13 |
| `web/frontend/src/types/index.ts` | WsEventBase, payload→data, +WsEntityChangeEvent | +34/-14 |
| `web/frontend/src/hooks/useWebSocket.ts` | +getEventData() helper, Handler-Fixes | +28/-5 |
| `web/frontend/src/stores/wsStore.ts` | Komplett-Rewrite: emit(), error log, reconnect, visibility | +117/-97 |
| `web/frontend/src/hooks/useDataInvalidation.ts` | **Neue Datei:** debounced refetch + suppress | +134 |
| `web/frontend/src/stores/hostStore.ts` | Silent refetch (isLoading nur initial) | +4/-3 |
| `web/frontend/src/pages/HostsPage.tsx` | +useDataInvalidation + suppress | +9 |
| `web/frontend/src/pages/RoomsPage.tsx` | +refreshAfterHostChange + suppress | +32/-2 |
| `web/frontend/src/pages/ConfigsPage.tsx` | +useDataInvalidation + suppress | +8 |
| `web/frontend/src/pages/ImagesPage.tsx` | +useDataInvalidation + suppress | +6 |
| `web/frontend/src/pages/DashboardPage.tsx` | fetchData useCallback + Hook | +22/-19 |
| `web/frontend/src/pages/OperationsPage.tsx` | payload→data fix + Hook + suppress | +13/-5 |
| **Total** | **15 Dateien (1 neu)** | **+451/-125** |

---

## WS-Event-Übersicht (komplett)

| Event | Quelle | Abonnenten |
|-------|--------|------------|
| `host.created` | hosts.js POST / + POST /import | HostsPage, RoomsPage, DashboardPage |
| `host.updated` | hosts.js PATCH /:id | HostsPage, RoomsPage, DashboardPage |
| `host.deleted` | hosts.js DELETE /:id | HostsPage, RoomsPage, DashboardPage |
| `host.status.changed` | hosts.js PATCH /:id/status, rsync hooks | useHostStatusUpdates (direktes State-Update) |
| `room.created` | rooms.js POST / | RoomsPage, DashboardPage |
| `room.updated` | rooms.js PATCH /:id | RoomsPage, DashboardPage |
| `room.deleted` | rooms.js DELETE /:id | RoomsPage, DashboardPage |
| `config.created` | configs.js POST /, POST /:id/clone | ConfigsPage, DashboardPage |
| `config.updated` | configs.js PATCH /:id | ConfigsPage, DashboardPage |
| `config.deleted` | configs.js DELETE /:id | ConfigsPage, DashboardPage |
| `config.deployed` | configs.js POST /:id/deploy | ConfigsPage |
| `config.raw_updated` | configs.js PUT /:id/raw | ConfigsPage |
| `image.created` | images.js POST /, POST /register | ImagesPage, DashboardPage |
| `image.updated` | images.js PATCH /:id | ImagesPage, DashboardPage |
| `image.deleted` | images.js DELETE /:id | ImagesPage, DashboardPage |
| `operation.started` | hosts.js, rooms.js (remote commands) | OperationsPage, DashboardPage |
| `operation.completed` | operation.worker.js | OperationsPage, DashboardPage |
| `operation.cancelled` | operations API | OperationsPage, DashboardPage |
| `operation.progress` | operation.worker.js | OperationsPage (direktes State-Update, KEIN Refetch) |
| `_reconnected` | wsStore (synthetisch) | ALLE Hooks (debounced Refetch) |

---

## API-Nachrichtenformat

Alle WS-Nachrichten folgen demselben Schema:

```json
{
  "type": "host.created",
  "data": {
    "id": "uuid-...",
    "name": "pc-101-01"
  },
  "timestamp": "2026-02-07T17:30:00.000Z"
}
```

Generiert durch `websocket.js`:

```javascript
function broadcast(event, data) {
  const message = JSON.stringify({
    type: event,
    data,
    timestamp: new Date().toISOString(),
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
```

---

## Verifikation

### Automatisiert
- **TypeScript:** `npx tsc --noEmit` → Exit 0 (keine Fehler)
- **Jest:** 428 Tests, 418 passing, 10 preexisting Integration-Failures (unverändert)

### Manuell auf Test-VM (10.0.0.13)
- Tab 1: HostsPage offen, Tab 2: Host erstellen → Tab 1 aktualisiert sofort (kein Flicker)
- RoomsPage: Room aufklappen, Host hinzufügen → Host-Liste im Accordion aktualisiert
- DashboardPage: Host erstellen → Zähler aktualisiert ohne Reload
- ConfigsPage: Config klonen → Tabelle aktualisiert
- ImagesPage: Image löschen → Tabelle aktualisiert
- OperationsPage: Progress-Bar live, Operation abbrechen → Status-Update sofort

### Flicker-Test
- 50 Hosts per CSV-Import → Tabelle: 1x Refetch (kein Flackern), Daten sofort sichtbar

### Reconnect-Test
- Tab in Hintergrund → Tab zurück → Daten refreshen automatisch (via `_reconnected`)

---

## Bekannte Einschränkungen

1. **Kein inkrementeller State-Sync** — Bei jeder Änderung wird die komplette Liste refetcht. Bei sehr vielen gleichzeitigen Änderungen (z.B. 100 Hosts gleichzeitig editieren) könnte es kurzzeitig zu vielen API-Calls kommen. Mitigiert durch Debouncing (500ms default, 1000ms Dashboard).

2. **`host.status.changed` wird separat behandelt** — Dieses Event wird von `useHostStatusUpdates()` direkt im Zustand-Store geupdated (kein Refetch). Es ist NICHT in `useDataInvalidation('host', ...)` enthalten. Grund: Status-Events kommen häufig (Port-Scanner), ein voller Refetch wäre zu teuer.

3. **Expanded Rooms: Sequential Fetch** — Bei vielen aufgeklappten Rooms werden die Hosts sequentiell (nicht parallel) nachgeladen. Bei 10+ offenen Rooms könnte das spürbar werden.

---

## Deployment

```bash
# Commit & Push
git add . && git commit -m "..." && git push

# Deploy auf Test-VM
ssh root@10.0.0.13 "cd linbo-docker && git pull && docker compose up -d --build web"

# Verifikation
ssh root@10.0.0.13 "docker exec linbo-api curl -s http://localhost:3000/health"
# → {"status":"healthy",...,"websocketClients":2}
```
