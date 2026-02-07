import { useEffect, useRef } from 'react';
import { useWsStore } from '@/stores/wsStore';
import { getEventData } from '@/hooks/useWebSocket';
import { notify } from '@/stores/notificationStore';
import type { WsEvent } from '@/types';

interface UseDataInvalidationOptions {
  debounceMs?: number;
  showToast?: boolean;
}

/**
 * Global last-fetch tracker per entity.
 * Prevents double-fetch when the user's own action already refetched
 * and the WS echo arrives shortly after.
 */
const lastFetchTime: Record<string, number> = {};

/** Call this to record that a fetch just happened for an entity key. */
export function markFetched(key: string) {
  lastFetchTime[key] = Date.now();
}

/**
 * Subscribe to WS entity change events and trigger a debounced refetch.
 *
 * Events per entity:
 * - Always: `${entity}.created`, `${entity}.updated`, `${entity}.deleted`
 * - config extra: `config.deployed`, `config.raw_updated`
 * - operation: `operation.started`, `operation.completed`, `operation.cancelled`
 *   (NOT operation.progress — AC3)
 * - Reconnect: `_reconnected` (AC4)
 *
 * AC2: Only 1 refetch per debounceMs window per hook instance.
 * Dedup: Skips WS-triggered refetch if data was fetched within the last debounceMs
 *        (e.g. from the user's own CRUD action).
 */
export function useDataInvalidation(
  entity: string | string[],
  refetchFn: () => void,
  options: UseDataInvalidationOptions = {}
) {
  const { debounceMs = 500, showToast = false } = options;
  const { subscribe } = useWsStore();

  // Stable refs to avoid re-subscriptions on renders
  const refetchRef = useRef(refetchFn);
  refetchRef.current = refetchFn;

  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  useEffect(() => {
    const entities = Array.isArray(entity) ? entity : [entity];
    const entityKey = entities.join(',');
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    function scheduleRefetch() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Dedup: skip if data was fetched very recently (user's own action)
        const lastFetch = lastFetchTime[entityKey] || 0;
        if (Date.now() - lastFetch < debounceMs) {
          return;
        }
        lastFetchTime[entityKey] = Date.now();
        refetchRef.current();
      }, debounceMs);
    }

    // Build event list
    const eventTypes: string[] = ['_reconnected'];
    for (const e of entities) {
      if (e === 'operation') {
        eventTypes.push('operation.started', 'operation.completed', 'operation.cancelled');
      } else {
        eventTypes.push(`${e}.created`, `${e}.updated`, `${e}.deleted`);
      }
      if (e === 'config') {
        eventTypes.push('config.deployed', 'config.raw_updated');
      }
    }

    const handler = (event: WsEvent) => {
      // Show toast for entity changes (not reconnect)
      if (showToastRef.current && event.type !== '_reconnected') {
        const data = getEventData(event) as { id?: string; name?: string };
        const label = data?.name ?? data?.id?.slice(0, 8) ?? '';
        const action = event.type.split('.').pop() ?? '';
        const entityName = event.type.split('.')[0] ?? '';

        const actionLabels: Record<string, string> = {
          created: 'erstellt',
          updated: 'aktualisiert',
          deleted: 'gelöscht',
          deployed: 'deployed',
          raw_updated: 'aktualisiert (raw)',
          started: 'gestartet',
          completed: 'abgeschlossen',
          cancelled: 'abgebrochen',
        };

        const entityLabels: Record<string, string> = {
          host: 'Host',
          room: 'Raum',
          config: 'Konfiguration',
          image: 'Image',
          operation: 'Operation',
        };

        const actionText = actionLabels[action] ?? action;
        const entityText = entityLabels[entityName] ?? entityName;

        if (label) {
          notify.info(`${entityText} ${actionText}`, label);
        }
      }

      scheduleRefetch();
    };

    // Subscribe to all relevant events
    const unsubscribes = eventTypes.map((et) => subscribe(et, handler));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [
    // Stringify entity array for stable deps
    Array.isArray(entity) ? entity.join(',') : entity,
    debounceMs,
    subscribe,
  ]);
}
