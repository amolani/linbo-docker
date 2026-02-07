import { useEffect, useCallback } from 'react';
import { useWsStore } from '@/stores/wsStore';
import { useHostStore } from '@/stores/hostStore';
import { notify } from '@/stores/notificationStore';
import type { WsEvent, WsHostStatusEvent, WsNotificationEvent } from '@/types';

// Module-level — warns max 1x per page load
let legacyWarned = false;

/**
 * Extract event data with legacy fallback.
 * Prefers .data (current API contract), falls back to .payload (legacy).
 * Returns `unknown` — caller must cast/assert.
 */
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

export function useWebSocket() {
  const { connect, disconnect, isConnected, subscribe, send } = useWsStore();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { isConnected, subscribe, send };
}

export function useHostStatusUpdates() {
  const { subscribe } = useWsStore();
  const { updateHostStatus } = useHostStore();

  useEffect(() => {
    const unsubscribe = subscribe('host.status.changed', (event: WsEvent) => {
      const data = getEventData(event) as WsHostStatusEvent['data'];
      updateHostStatus(data.hostId, data.status);
    });

    return unsubscribe;
  }, [subscribe, updateHostStatus]);
}

export function useNotificationEvents() {
  const { subscribe } = useWsStore();

  useEffect(() => {
    const unsubscribe = subscribe('notification', (event: WsEvent) => {
      const data = getEventData(event) as WsNotificationEvent['data'];
      notify[data.level](data.title, data.message);
    });

    return unsubscribe;
  }, [subscribe]);
}

export function useWsEventHandler<T extends WsEvent>(
  eventType: string,
  handler: (event: T) => void
) {
  const { subscribe } = useWsStore();

  const stableHandler = useCallback(handler, [handler]);

  useEffect(() => {
    const unsubscribe = subscribe(eventType, stableHandler as (event: WsEvent) => void);
    return unsubscribe;
  }, [subscribe, eventType, stableHandler]);
}
