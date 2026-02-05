import { useState, useEffect } from 'react';
import { PlusIcon, DocumentDuplicateIcon, EyeIcon } from '@heroicons/react/24/outline';
import { configsApi } from '@/api/configs';
import { Button, Table, Modal, Input, Textarea, Badge, ConfirmModal } from '@/components/ui';
import { LinboSettingsForm, PartitionsEditor, OsEntriesEditor } from '@/components/configs';
import { notify } from '@/stores/notificationStore';
import type { Config, Column, LinboSettings, ConfigPartition, ConfigOs } from '@/types';

type PartitionData = Omit<ConfigPartition, 'id' | 'configId'>;
type OsEntryData = Omit<ConfigOs, 'id' | 'configId'>;

type TabId = 'basic' | 'linbo' | 'partitions' | 'os';

const defaultLinboSettings: LinboSettings = {
  server: '10.0.0.1',
  cache: '/dev/sda4',
  downloadType: 'rsync',
  roottimeout: 600,
  autopartition: false,
  autoformat: false,
  autoinitcache: true,
};

export function ConfigsPage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [editingConfig, setEditingConfig] = useState<Config | null>(null);
  const [deleteConfirmConfig, setDeleteConfirmConfig] = useState<Config | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('basic');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });
  const [linboSettings, setLinboSettings] = useState<LinboSettings>(defaultLinboSettings);
  const [partitions, setPartitions] = useState<PartitionData[]>([]);
  const [osEntries, setOsEntries] = useState<OsEntryData[]>([]);

  const fetchConfigs = async () => {
    try {
      const data = await configsApi.list();
      setConfigs(data);
    } catch (error) {
      notify.error('Fehler beim Laden der Konfigurationen');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const resetForm = () => {
    setFormData({ name: '', description: '' });
    setLinboSettings(defaultLinboSettings);
    setPartitions([]);
    setOsEntries([]);
    setActiveTab('basic');
  };

  const handleOpenModal = async (config?: Config) => {
    if (config) {
      setEditingConfig(config);
      setFormData({
        name: config.name,
        description: config.description || '',
      });
      setLinboSettings(config.linboSettings || defaultLinboSettings);
      setPartitions(
        (config.partitions || []).map(({ id, configId, ...rest }) => rest)
      );
      setOsEntries(
        (config.osEntries || []).map(({ id, configId, ...rest }) => rest)
      );
    } else {
      setEditingConfig(null);
      resetForm();
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const payload = {
      ...formData,
      linboSettings,
      partitions,
      osEntries,
    };

    try {
      if (editingConfig) {
        await configsApi.update(editingConfig.id, payload);
        notify.success('Konfiguration aktualisiert');
      } else {
        await configsApi.create(payload);
        notify.success('Konfiguration erstellt');
      }
      setIsModalOpen(false);
      fetchConfigs();
    } catch (error) {
      notify.error('Fehler beim Speichern');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmConfig) return;
    setIsSubmitting(true);

    try {
      await configsApi.delete(deleteConfirmConfig.id);
      notify.success('Konfiguration geloescht');
      setDeleteConfirmConfig(null);
      fetchConfigs();
    } catch (error) {
      notify.error('Fehler beim Loeschen');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePreview = async (configId: string) => {
    try {
      const content = await configsApi.preview(configId);
      setPreviewContent(content);
      setIsPreviewOpen(true);
    } catch (error) {
      notify.error('Fehler beim Laden der Vorschau');
    }
  };

  const handleClone = async (configId: string, name: string) => {
    try {
      await configsApi.clone(configId, `${name} (Kopie)`);
      notify.success('Konfiguration geklont');
      fetchConfigs();
    } catch (error) {
      notify.error('Fehler beim Klonen');
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'default'> = {
      active: 'success',
      draft: 'warning',
      archived: 'default',
    };
    const labels: Record<string, string> = {
      active: 'Aktiv',
      draft: 'Entwurf',
      archived: 'Archiviert',
    };
    return (
      <Badge variant={variants[status] || 'default'}>
        {labels[status] || status}
      </Badge>
    );
  };

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'basic', label: 'Grundeinstellungen' },
    { id: 'linbo', label: 'LINBO-Einstellungen' },
    { id: 'partitions', label: 'Partitionen', count: partitions.length },
    { id: 'os', label: 'Betriebssysteme', count: osEntries.length },
  ];

  const columns: Column<Config>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (config) => (
        <div>
          <div className="font-medium text-gray-900">{config.name}</div>
          <div className="text-gray-500 text-xs">Version {config.version}</div>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Beschreibung',
      render: (config) => config.description || '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (config) => getStatusBadge(config.status),
    },
    {
      key: 'partitions',
      header: 'Partitionen',
      render: (config) => config.partitions?.length || 0,
    },
    {
      key: 'osEntries',
      header: 'Betriebssysteme',
      render: (config) => config.osEntries?.length || 0,
    },
    {
      key: 'hosts',
      header: 'Hosts',
      render: (config) => (config as Config & { hostCount?: number }).hostCount ?? config._count?.hosts ?? 0,
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (config) => (
        <div className="flex space-x-2">
          <button
            onClick={() => handlePreview(config.id)}
            className="text-primary-600 hover:text-primary-900"
            title="Vorschau"
          >
            <EyeIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleClone(config.id, config.name)}
            className="text-primary-600 hover:text-primary-900"
            title="Klonen"
          >
            <DocumentDuplicateIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleOpenModal(config)}
            className="text-gray-600 hover:text-gray-900 text-sm"
          >
            Bearbeiten
          </button>
          <button
            onClick={() => setDeleteConfirmConfig(config)}
            className="text-red-600 hover:text-red-900 text-sm"
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
          <h1 className="text-2xl font-bold text-gray-900">Konfigurationen</h1>
          <p className="text-gray-600">Verwaltung der start.conf Konfigurationen</p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Neue Konfiguration
        </Button>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <Table
          columns={columns}
          data={configs}
          keyExtractor={(config) => config.id}
          loading={isLoading}
          emptyMessage="Keine Konfigurationen gefunden"
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingConfig ? 'Konfiguration bearbeiten' : 'Neue Konfiguration'}
        size="xl"
      >
        <form onSubmit={handleSubmit}>
          {/* Tabs */}
          <div className="border-b border-gray-200 mb-4">
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className={`${
                      activeTab === tab.id ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-900'
                    } ml-2 py-0.5 px-2.5 rounded-full text-xs font-medium`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="min-h-[300px]">
            {activeTab === 'basic' && (
              <div className="space-y-4">
                <Input
                  label="Name"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="z.B. pc-raum-101"
                />
                <Textarea
                  label="Beschreibung"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optionale Beschreibung der Konfiguration"
                />
              </div>
            )}

            {activeTab === 'linbo' && (
              <LinboSettingsForm
                settings={linboSettings}
                onChange={setLinboSettings}
              />
            )}

            {activeTab === 'partitions' && (
              <PartitionsEditor
                partitions={partitions}
                onChange={setPartitions}
              />
            )}

            {activeTab === 'os' && (
              <OsEntriesEditor
                osEntries={osEntries}
                partitions={partitions}
                onChange={setOsEntries}
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center pt-4 mt-4 border-t">
            <div className="text-sm text-gray-500">
              {partitions.length} Partition(en), {osEntries.length} Betriebssystem(e)
            </div>
            <div className="flex space-x-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsModalOpen(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {editingConfig ? 'Speichern' : 'Erstellen'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Preview Modal */}
      <Modal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="start.conf Vorschau"
        size="lg"
      >
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono max-h-96">
          {previewContent}
        </pre>
        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={() => setIsPreviewOpen(false)}>
            Schliessen
          </Button>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteConfirmConfig}
        onClose={() => setDeleteConfirmConfig(null)}
        onConfirm={handleDelete}
        title="Konfiguration loeschen"
        message={`Moechten Sie die Konfiguration "${deleteConfirmConfig?.name}" wirklich loeschen?`}
        confirmLabel="Loeschen"
        variant="danger"
        loading={isSubmitting}
      />
    </div>
  );
}
