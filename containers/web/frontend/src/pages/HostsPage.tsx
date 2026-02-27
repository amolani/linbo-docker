import { useState, useEffect, useCallback } from 'react';
import { Plus, Download, Upload, Trash2, Monitor } from 'lucide-react';
import { useHosts, useHostActions, useHostFilters } from '@/hooks/useHosts';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import { syncApi } from '@/api/sync';
import type { SyncHost } from '@/api/sync';
import { roomsApi } from '@/api/rooms';
import { configsApi } from '@/api/configs';
import { hostsApi } from '@/api/hosts';
import { Button, Table, Pagination, StatusBadge, Modal, Input, Select, ConfirmModal, Badge } from '@/components/ui';
import { ImportHostsModal, ProvisionBadge } from '@/components/hosts';
import { notify } from '@/stores/notificationStore';
import type { Host, Room, Config, Column } from '@/types';

export function HostsPage() {
  const { isSyncMode, modeFetched, fetchMode } = useServerConfigStore();

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  if (!modeFetched) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (isSyncMode) {
    return <SyncHostsView />;
  }

  return <StandaloneHostsView />;
}

// ============================================================================
// Sync Mode: read-only hosts from LMN server
// ============================================================================

function SyncHostsView() {
  const [hosts, setHosts] = useState<SyncHost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hostgroup, setHostgroup] = useState('');
  const [hostgroups, setHostgroups] = useState<string[]>([]);

  const fetchHosts = useCallback(async () => {
    try {
      const params: { search?: string; hostgroup?: string } = {};
      if (search) params.search = search;
      if (hostgroup) params.hostgroup = hostgroup;
      const data = await syncApi.getHosts(params);
      setHosts(data);
      // Derive unique hostgroups for filter
      const groups = [...new Set(data.map((h) => h.hostgroup).filter(Boolean))];
      setHostgroups((prev) => (prev.length === 0 ? groups : prev));
    } catch (error) {
      console.error('Failed to fetch sync hosts:', error);
    } finally {
      setIsLoading(false);
    }
  }, [search, hostgroup]);

  useDataInvalidation(['sync', 'host'], fetchHosts, { showToast: false });

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts]);

  const columns: Column<SyncHost>[] = [
    {
      key: 'hostname',
      header: 'Hostname',
      render: (host) => (
        <div>
          <div className="font-medium text-foreground">{host.hostname}</div>
          <div className="text-muted-foreground text-xs">{host.mac}</div>
        </div>
      ),
    },
    {
      key: 'ip',
      header: 'IP-Adresse',
      render: (host) => host.ip || '-',
    },
    {
      key: 'hostgroup',
      header: 'Gruppe',
      render: (host) => host.hostgroup || '-',
    },
    {
      key: 'runtimeStatus',
      header: 'Status',
      render: (host) => <StatusBadge status={host.runtimeStatus} />,
    },
    {
      key: 'lastSeen',
      header: 'Zuletzt gesehen',
      render: (host) =>
        host.lastSeen
          ? new Date(host.lastSeen).toLocaleString('de-DE', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            })
          : '-',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            Hosts
            <Badge variant="info" size="sm">Verwaltet durch LMN Server</Badge>
          </h1>
          <p className="text-muted-foreground">Hosts vom linuxmuster.net Server</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card shadow-sm rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            placeholder="Suche..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={hostgroup}
            onChange={(e) => setHostgroup(e.target.value)}
            options={[
              { value: '', label: 'Alle Gruppen' },
              ...hostgroups.map((g) => ({ value: g, label: g })),
            ]}
          />
          <Button
            variant="secondary"
            onClick={() => { setSearch(''); setHostgroup(''); }}
          >
            Filter zuruecksetzen
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card shadow-sm rounded-lg overflow-hidden">
        <Table
          columns={columns}
          data={hosts}
          keyExtractor={(host) => host.mac}
          loading={isLoading}
          emptyMessage="Keine Hosts gefunden"
        />
      </div>
    </div>
  );
}

// ============================================================================
// Standalone Mode: original full-featured hosts view
// ============================================================================

function StandaloneHostsView() {
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
    fetchHosts,
    setPage,
    setLimit,
    setSort,
    selectAll,
    deselectAll,
    toggleHost,
  } = useHosts();

  const { filters, updateFilter, clearFilters } = useHostFilters();

  // Reactive: refetch hosts on WS entity changes (AC2: debounced)
  const { suppress: suppressHostInvalidation } = useDataInvalidation('host', fetchHosts);

  const {
    isActionLoading,
    wakeOnLan,
    syncHost,
    startHost,
    bulkWakeOnLan,
    bulkSync,
    bulkDelete,
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
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
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

    suppressHostInvalidation();
    if (editingHost) {
      await updateHost(editingHost.id, data);
    } else {
      await createHost(data);
    }
    setIsModalOpen(false);
  };

  const handleDelete = async () => {
    if (deleteConfirmHost) {
      suppressHostInvalidation();
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
          <div className="font-medium text-foreground flex items-center gap-2">
            {host.hostname}
            <ProvisionBadge status={host.provisionStatus} opId={host.provisionOpId} />
          </div>
          <div className="text-muted-foreground text-xs">{host.macAddress}</div>
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
      key: 'detectedOs',
      header: 'OS',
      render: (host) => {
        if (!host.detectedOs) return <span className="text-muted-foreground">-</span>;
        const osLabels: Record<string, { label: string; color: string }> = {
          linbo: { label: 'LINBO', color: 'text-primary' },
          linux: { label: 'Linux', color: 'text-orange-500' },
          windows: { label: 'Windows', color: 'text-sky-500' },
        };
        const os = osLabels[host.detectedOs] || { label: host.detectedOs, color: 'text-muted-foreground' };
        return (
          <span className={`inline-flex items-center gap-1 text-sm ${os.color}`}>
            <Monitor className="h-3.5 w-3.5" />
            {os.label}
          </span>
        );
      },
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
            className="text-primary hover:text-primary text-sm"
            disabled={isActionLoading}
          >
            WoL
          </button>
          <button
            onClick={() => syncHost(host.id)}
            className="text-primary hover:text-primary text-sm"
            disabled={isActionLoading || host.status !== 'online'}
          >
            Sync
          </button>
          <button
            onClick={() => startHost(host.id)}
            className="text-primary hover:text-primary text-sm"
            disabled={isActionLoading || host.status !== 'online'}
          >
            Start
          </button>
          <button
            onClick={() => handleOpenModal(host)}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Bearbeiten
          </button>
          <button
            onClick={() => setDeleteConfirmHost(host)}
            className="text-destructive hover:text-destructive text-sm"
          >
            Loeschen
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Hosts</h1>
          <p className="text-muted-foreground">Verwaltung der Client-Rechner</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="secondary" onClick={handleExport} loading={isExporting}>
            <Download className="h-5 w-5 mr-2" />
            Export
          </Button>
          <Button variant="secondary" onClick={() => setIsImportModalOpen(true)}>
            <Upload className="h-5 w-5 mr-2" />
            Import
          </Button>
          <Button onClick={() => handleOpenModal()}>
            <Plus className="h-5 w-5 mr-2" />
            Neuer Host
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card shadow-sm rounded-lg p-4">
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
              { value: '', label: 'Alle Raeume' },
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
            Filter zuruecksetzen
          </Button>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedHosts.length > 0 && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center justify-between">
          <span className="text-primary">
            {selectedHosts.length} Host(s) ausgewaehlt
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
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setBulkDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Loeschen
            </Button>
            <Button size="sm" variant="secondary" onClick={deselectAll}>
              Auswahl aufheben
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card shadow-sm rounded-lg overflow-hidden">
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
        title="Host loeschen"
        message={`Moechten Sie den Host "${deleteConfirmHost?.hostname}" wirklich loeschen?`}
        confirmLabel="Loeschen"
        variant="danger"
        loading={isActionLoading}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmModal
        isOpen={bulkDeleteConfirm}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={async () => {
          suppressHostInvalidation();
          await bulkDelete(selectedHosts);
          deselectAll();
          setBulkDeleteConfirm(false);
        }}
        title="Hosts loeschen"
        message={`Moechten Sie ${selectedHosts.length} Host(s) wirklich loeschen? Diese Aktion kann nicht rueckgaengig gemacht werden.`}
        confirmLabel="Loeschen"
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
