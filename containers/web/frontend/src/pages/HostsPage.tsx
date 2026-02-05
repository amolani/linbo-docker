import { useState, useEffect, useCallback } from 'react';
import { PlusIcon, ArrowDownTrayIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { useHosts, useHostActions, useHostFilters } from '@/hooks/useHosts';
import { roomsApi } from '@/api/rooms';
import { configsApi } from '@/api/configs';
import { hostsApi } from '@/api/hosts';
import { Button, Table, Pagination, StatusBadge, Modal, Input, Select, ConfirmModal } from '@/components/ui';
import { ImportHostsModal } from '@/components/hosts';
import { notify } from '@/stores/notificationStore';
import type { Host, Room, Config, Column } from '@/types';

export function HostsPage() {
  const {
    hosts,
    selectedHosts,
    total,
    page,
    limit,
    totalPages,
    sort,
    order,
    isLoading,
    setPage,
    setLimit,
    setSort,
    selectAll,
    deselectAll,
    toggleHost,
  } = useHosts();

  const { filters, updateFilter, clearFilters } = useHostFilters();
  const {
    isActionLoading,
    wakeOnLan,
    syncHost,
    startHost,
    bulkWakeOnLan,
    bulkSync,
    deleteHost,
    createHost,
    updateHost,
  } = useHostActions();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [deleteConfirmHost, setDeleteConfirmHost] = useState<Host | null>(null);
  const [formData, setFormData] = useState({
    hostname: '',
    macAddress: '',
    ipAddress: '',
    roomId: '',
    configId: '',
  });

  useEffect(() => {
    const fetchOptions = async () => {
      const [roomsData, configsData] = await Promise.all([
        roomsApi.list(),
        configsApi.list(),
      ]);
      setRooms(roomsData);
      setConfigs(configsData);
    };
    fetchOptions();
  }, []);

  const handleOpenModal = (host?: Host) => {
    if (host) {
      setEditingHost(host);
      setFormData({
        hostname: host.hostname,
        macAddress: host.macAddress,
        ipAddress: host.ipAddress || '',
        roomId: host.roomId || '',
        configId: host.configId || '',
      });
    } else {
      setEditingHost(null);
      setFormData({
        hostname: '',
        macAddress: '',
        ipAddress: '',
        roomId: '',
        configId: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      hostname: formData.hostname,
      macAddress: formData.macAddress,
      ipAddress: formData.ipAddress || undefined,
      roomId: formData.roomId || undefined,
      configId: formData.configId || undefined,
    };

    if (editingHost) {
      await updateHost(editingHost.id, data);
    } else {
      await createHost(data);
    }
    setIsModalOpen(false);
  };

  const handleDelete = async () => {
    if (deleteConfirmHost) {
      await deleteHost(deleteConfirmHost.id);
      setDeleteConfirmHost(null);
    }
  };

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const blob = await hostsApi.export();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hosts-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      notify.success('Export erfolgreich', 'CSV-Datei wurde heruntergeladen');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export fehlgeschlagen';
      notify.error('Export fehlgeschlagen', message);
    } finally {
      setIsExporting(false);
    }
  }, [notify]);

  const handleImportSuccess = useCallback(() => {
    // Refresh hosts list after import
    setPage(1);
  }, [setPage]);

  const columns: Column<Host>[] = [
    {
      key: 'hostname',
      header: 'Hostname',
      sortable: true,
      render: (host) => (
        <div>
          <div className="font-medium text-gray-900">{host.hostname}</div>
          <div className="text-gray-500 text-xs">{host.macAddress}</div>
        </div>
      ),
    },
    {
      key: 'ipAddress',
      header: 'IP-Adresse',
      sortable: true,
      render: (host) => host.ipAddress || '-',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (host) => <StatusBadge status={host.status} />,
    },
    {
      key: 'room',
      header: 'Raum',
      render: (host) => host.room?.name || '-',
    },
    {
      key: 'config',
      header: 'Konfiguration',
      render: (host) => host.config?.name || '-',
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (host) => (
        <div className="flex space-x-2">
          <button
            onClick={() => wakeOnLan(host.id)}
            className="text-primary-600 hover:text-primary-900 text-sm"
            disabled={isActionLoading}
          >
            WoL
          </button>
          <button
            onClick={() => syncHost(host.id)}
            className="text-primary-600 hover:text-primary-900 text-sm"
            disabled={isActionLoading || host.status !== 'online'}
          >
            Sync
          </button>
          <button
            onClick={() => startHost(host.id)}
            className="text-primary-600 hover:text-primary-900 text-sm"
            disabled={isActionLoading || host.status !== 'online'}
          >
            Start
          </button>
          <button
            onClick={() => handleOpenModal(host)}
            className="text-gray-600 hover:text-gray-900 text-sm"
          >
            Bearbeiten
          </button>
          <button
            onClick={() => setDeleteConfirmHost(host)}
            className="text-red-600 hover:text-red-900 text-sm"
          >
            Löschen
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hosts</h1>
          <p className="text-gray-600">Verwaltung der Client-Rechner</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="secondary" onClick={handleExport} loading={isExporting}>
            <ArrowDownTrayIcon className="h-5 w-5 mr-2" />
            Export
          </Button>
          <Button variant="secondary" onClick={() => setIsImportModalOpen(true)}>
            <ArrowUpTrayIcon className="h-5 w-5 mr-2" />
            Import
          </Button>
          <Button onClick={() => handleOpenModal()}>
            <PlusIcon className="h-5 w-5 mr-2" />
            Neuer Host
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Input
            placeholder="Suche..."
            value={filters.search || ''}
            onChange={(e) => updateFilter('search', e.target.value || undefined)}
          />
          <Select
            value={filters.status || ''}
            onChange={(e) => updateFilter('status', e.target.value || undefined)}
            options={[
              { value: '', label: 'Alle Status' },
              { value: 'online', label: 'Online' },
              { value: 'offline', label: 'Offline' },
              { value: 'syncing', label: 'Synchronisiert' },
              { value: 'booting', label: 'Startet' },
            ]}
          />
          <Select
            value={filters.roomId || ''}
            onChange={(e) => updateFilter('roomId', e.target.value || undefined)}
            options={[
              { value: '', label: 'Alle Räume' },
              ...rooms.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <Select
            value={filters.configId || ''}
            onChange={(e) => updateFilter('configId', e.target.value || undefined)}
            options={[
              { value: '', label: 'Alle Konfigurationen' },
              ...configs.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Button variant="secondary" onClick={clearFilters}>
            Filter zurücksetzen
          </Button>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedHosts.length > 0 && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 flex items-center justify-between">
          <span className="text-primary-700">
            {selectedHosts.length} Host(s) ausgewählt
          </span>
          <div className="flex space-x-2">
            <Button
              size="sm"
              onClick={() => bulkWakeOnLan(selectedHosts)}
              loading={isActionLoading}
            >
              Wake-on-LAN
            </Button>
            <Button
              size="sm"
              onClick={() => bulkSync(selectedHosts)}
              loading={isActionLoading}
            >
              Sync
            </Button>
            <Button size="sm" variant="secondary" onClick={deselectAll}>
              Auswahl aufheben
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <Table
          columns={columns}
          data={hosts}
          keyExtractor={(host) => host.id}
          loading={isLoading}
          selectable
          selectedKeys={selectedHosts}
          onSelect={toggleHost}
          onSelectAll={() => (selectedHosts.length === hosts.length ? deselectAll() : selectAll())}
          sortKey={sort}
          sortOrder={order}
          onSort={setSort}
          emptyMessage="Keine Hosts gefunden"
        />
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={setLimit}
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingHost ? 'Host bearbeiten' : 'Neuer Host'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Hostname"
            required
            value={formData.hostname}
            onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
          />
          <Input
            label="MAC-Adresse"
            required
            placeholder="AA:BB:CC:DD:EE:FF"
            value={formData.macAddress}
            onChange={(e) => setFormData({ ...formData, macAddress: e.target.value })}
          />
          <Input
            label="IP-Adresse"
            placeholder="192.168.1.100"
            value={formData.ipAddress}
            onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
          />
          <Select
            label="Raum"
            value={formData.roomId}
            onChange={(e) => setFormData({ ...formData, roomId: e.target.value })}
            options={[
              { value: '', label: 'Kein Raum' },
              ...rooms.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <Select
            label="Konfiguration"
            value={formData.configId}
            onChange={(e) => setFormData({ ...formData, configId: e.target.value })}
            options={[
              { value: '', label: 'Keine Konfiguration' },
              ...configs.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
            >
              Abbrechen
            </Button>
            <Button type="submit" loading={isActionLoading}>
              {editingHost ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteConfirmHost}
        onClose={() => setDeleteConfirmHost(null)}
        onConfirm={handleDelete}
        title="Host löschen"
        message={`Möchten Sie den Host "${deleteConfirmHost?.hostname}" wirklich löschen?`}
        confirmLabel="Löschen"
        variant="danger"
        loading={isActionLoading}
      />

      {/* Import Modal */}
      <ImportHostsModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
