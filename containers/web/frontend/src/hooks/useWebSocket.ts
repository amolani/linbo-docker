import { useEffect, useCallback } from 'react';
import { useWsStore } from '@/stores/wsStore';
import { useHostStore } from '@/stores/hostStore';
import { notify } from '@/stores/notificationStore';
import type { WsEvent, WsHostStatusEvent, WsNotificationEvent } from '@/types';

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
      const { payload } = event as WsHostStatusEvent;
      updateHostStatus(payload.hostId, payload.status);
    });

    return unsubscribe;
  }, [subscribe, updateHostStatus]);
}

export function useNotificationEvents() {
  const { subscribe } = useWsStore();

  useEffect(() => {
    const unsubscribe = subscribe('notification', (event: WsEvent) => {
      const { payload } = event as WsNotificationEvent;
      notify[payload.level](payload.title, payload.message);
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
