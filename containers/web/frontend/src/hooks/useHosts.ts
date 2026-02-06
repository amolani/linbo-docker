import { useEffect, useState, useCallback } from 'react';
import { useHostStore } from '@/stores/hostStore';
import { hostsApi } from '@/api/hosts';
import { notify } from '@/stores/notificationStore';
import type { HostFilters } from '@/types';

export function useHosts() {
  const {
    hosts,
    selectedHosts,
    total,
    page,
    limit,
    totalPages,
    filters,
    sort,
    order,
    isLoading,
    error,
    fetchHosts,
    setPage,
    setLimit,
    setFilters,
    setSort,
    selectHost,
    deselectHost,
    selectAll,
    deselectAll,
    toggleHost,
  } = useHostStore();

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts]);

  return {
    hosts,
    selectedHosts,
    total,
    page,
    limit,
    totalPages,
    filters,
    sort,
    order,
    isLoading,
    error,
    fetchHosts,
    setPage,
    setLimit,
    setFilters,
    setSort,
    selectHost,
    deselectHost,
    selectAll,
    deselectAll,
    toggleHost,
  };
}

export function useHostActions() {
  const [isActionLoading, setIsActionLoading] = useState(false);
  const { fetchHosts } = useHostStore();

  const wakeOnLan = useCallback(async (hostId: string) => {
    setIsActionLoading(true);
    try {
      const result = await hostsApi.wakeOnLan(hostId);
      if (result.success) {
        notify.success('Wake-on-LAN', 'Magic Packet gesendet');
      }
      return result;
    } catch (error) {
      notify.error('Wake-on-LAN fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, []);

  const syncHost = useCallback(async (hostId: string, options?: { image?: string; force?: boolean }) => {
    setIsActionLoading(true);
    try {
      const result = await hostsApi.sync(hostId, options);
      notify.success('Sync gestartet', `Operation ID: ${result.operationId}`);
      return result;
    } catch (error) {
      notify.error('Sync fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, []);

  const startHost = useCallback(async (hostId: string, osIndex?: number) => {
    setIsActionLoading(true);
    try {
      const result = await hostsApi.start(hostId, osIndex);
      if (result.success) {
        notify.success('Start-Befehl gesendet');
      }
      return result;
    } catch (error) {
      notify.error('Start fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, []);

  const bulkWakeOnLan = useCallback(async (hostIds: string[]) => {
    setIsActionLoading(true);
    try {
      const result = await hostsApi.bulkWakeOnLan(hostIds);
      notify.success(
        'Bulk Wake-on-LAN',
        `${result.success} erfolgreich, ${result.failed} fehlgeschlagen`
      );
      return result;
    } catch (error) {
      notify.error('Bulk Wake-on-LAN fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, []);

  const bulkSync = useCallback(async (hostIds: string[], options?: { image?: string; force?: boolean }) => {
    setIsActionLoading(true);
    try {
      const result = await hostsApi.bulkSync(hostIds, options);
      notify.success('Bulk Sync gestartet', `Operation ID: ${result.operationId}`);
      return result;
    } catch (error) {
      notify.error('Bulk Sync fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, []);

  const bulkStart = useCallback(async (hostIds: string[], osIndex?: number) => {
    setIsActionLoading(true);
    try {
      const result = await hostsApi.bulkStart(hostIds, osIndex);
      notify.success(
        'Bulk Start',
        `${result.success} erfolgreich, ${result.failed} fehlgeschlagen`
      );
      return result;
    } catch (error) {
      notify.error('Bulk Start fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, []);

  const bulkDelete = useCallback(async (hostIds: string[]) => {
    setIsActionLoading(true);
    try {
      const result = await hostsApi.bulkDelete(hostIds);
      if (result.failed > 0) {
        notify.warning(
          'Bulk Delete',
          `${result.success} gelöscht, ${result.failed} fehlgeschlagen`
        );
      } else {
        notify.success('Bulk Delete', `${result.success} Host(s) gelöscht`);
      }
      fetchHosts();
      return result;
    } catch (error) {
      notify.error('Bulk Delete fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, [fetchHosts]);

  const deleteHost = useCallback(async (hostId: string) => {
    setIsActionLoading(true);
    try {
      await hostsApi.delete(hostId);
      notify.success('Host gelöscht');
      fetchHosts();
    } catch (error) {
      notify.error('Löschen fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, [fetchHosts]);

  const createHost = useCallback(async (data: Parameters<typeof hostsApi.create>[0]) => {
    setIsActionLoading(true);
    try {
      const host = await hostsApi.create(data);
      notify.success('Host erstellt', host.hostname);
      fetchHosts();
      return host;
    } catch (error) {
      notify.error('Erstellen fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, [fetchHosts]);

  const updateHost = useCallback(async (hostId: string, data: Parameters<typeof hostsApi.update>[1]) => {
    setIsActionLoading(true);
    try {
      const host = await hostsApi.update(hostId, data);
      notify.success('Host aktualisiert', host.hostname);
      fetchHosts();
      return host;
    } catch (error) {
      notify.error('Aktualisieren fehlgeschlagen', error instanceof Error ? error.message : undefined);
      throw error;
    } finally {
      setIsActionLoading(false);
    }
  }, [fetchHosts]);

  return {
    isActionLoading,
    wakeOnLan,
    syncHost,
    startHost,
    bulkWakeOnLan,
    bulkSync,
    bulkStart,
    bulkDelete,
    deleteHost,
    createHost,
    updateHost,
  };
}

export function useHostFilters() {
  const { filters, setFilters } = useHostStore();

  const updateFilter = useCallback(
    (key: keyof HostFilters, value: string | undefined) => {
      setFilters({ ...filters, [key]: value });
    },
    [filters, setFilters]
  );

  const clearFilters = useCallback(() => {
    setFilters({});
  }, [setFilters]);

  return {
    filters,
    updateFilter,
    clearFilters,
    setFilters,
  };
}
