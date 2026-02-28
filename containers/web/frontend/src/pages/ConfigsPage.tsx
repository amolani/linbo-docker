import { useState, useEffect, useCallback } from 'react';
import { Plus, Copy, Eye, Code, CloudUpload, Monitor, FileText } from 'lucide-react';
import { configsApi } from '@/api/configs';
import { syncApi } from '@/api/sync';
import type { SyncConfig } from '@/api/sync';
import { systemApi } from '@/api/system';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { useIconCache } from '@/hooks/useIconCache';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import { Button, Table, Modal, Input, Textarea, Badge, ConfirmModal } from '@/components/ui';
import { LinboSettingsForm, PartitionsEditor, OsEntriesEditor, RawConfigEditorModal, GrubMenuPreview } from '@/components/configs';
import { notify } from '@/stores/notificationStore';
import type { Config, Column, LinboSettings, ConfigPartition, ConfigOs, GrubThemeConfig } from '@/types';

type PartitionData = Omit<ConfigPartition, 'id' | 'configId'>;
type OsEntryData = Omit<ConfigOs, 'id' | 'configId'>;

type TabId = 'basic' | 'linbo' | 'partitions' | 'os';

const defaultLinboSettings: LinboSettings = {
  server: '10.0.0.1',
  cache: '/dev/disk0p4',
  downloadType: 'rsync',
  roottimeout: 600,
  autopartition: false,
  autoformat: false,
  autoinitcache: true,
};

// =============================================================================
// Config Templates (based on production /srv/linbo/examples/)
// =============================================================================

interface ConfigTemplate {
  id: string;
  label: string;
  description: string;
  icon: 'windows' | 'linux';
  name: string;
  linboSettings: LinboSettings;
  partitions: PartitionData[];
  osEntries: OsEntryData[];
}

const configTemplates: ConfigTemplate[] = [
  {
    id: 'win-efi',
    label: 'Windows UEFI',
    description: 'Windows 10/11, GPT, EFI — 5 Partitionen (EFI, MSR, Windows, Cache, Daten)',
    icon: 'windows',
    name: 'win_efi',
    linboSettings: {
      server: '10.0.0.1',
      cache: '/dev/disk0p4',
      roottimeout: 600,
      autopartition: false,
      autoformat: false,
      autoinitcache: false,
      downloadType: 'torrent',
      systemtype: 'efi64',
      locale: 'de-de',
      backgroundfontcolor: 'white',
      consolefontcolorsstdout: 'lightgreen',
      consolefontcolorstderr: 'orange',
    },
    partitions: [
      { position: 1, device: '/dev/disk0p1', label: 'efi', size: '200M', partitionId: 'ef', fsType: 'vfat', bootable: true },
      { position: 2, device: '/dev/disk0p2', label: 'msr', size: '128M', partitionId: '0c01', fsType: '', bootable: false },
      { position: 3, device: '/dev/disk0p3', label: 'windows', size: '50G', partitionId: '7', fsType: 'ntfs', bootable: false },
      { position: 4, device: '/dev/disk0p4', label: 'cache', size: '50G', partitionId: '83', fsType: 'ext4', bootable: false },
      { position: 5, device: '/dev/disk0p5', label: 'data', size: '', partitionId: '7', fsType: 'ntfs', bootable: false },
    ],
    osEntries: [
      {
        position: 1, name: 'Windows 10', version: '', description: 'Windows 10',
        osType: 'windows', iconName: 'win10', image: '', baseImage: 'win10.qcow2',
        differentialImage: '', rootDevice: '/dev/disk0p3', root: '/dev/disk0p3',
        kernel: 'auto', initrd: '', append: [],
        startEnabled: true, syncEnabled: true, newEnabled: true,
        autostart: false, autostartTimeout: 5, defaultAction: 'sync',
        hidden: false,
      },
    ],
  },
  {
    id: 'ubuntu-efi',
    label: 'Ubuntu UEFI',
    description: 'Ubuntu/Linux, GPT, EFI — 5 Partitionen (EFI, Ubuntu, Cache, Swap, Daten)',
    icon: 'linux',
    name: 'ubuntu_efi',
    linboSettings: {
      server: '10.0.0.1',
      cache: '/dev/disk0p3',
      roottimeout: 600,
      autopartition: false,
      autoformat: false,
      autoinitcache: false,
      downloadType: 'torrent',
      systemtype: 'efi64',
      locale: 'de-de',
      backgroundfontcolor: 'white',
      consolefontcolorsstdout: 'lightgreen',
      consolefontcolorstderr: 'orange',
    },
    partitions: [
      { position: 1, device: '/dev/disk0p1', label: 'efi', size: '200M', partitionId: 'ef', fsType: 'vfat', bootable: true },
      { position: 2, device: '/dev/disk0p2', label: 'ubuntu', size: '30G', partitionId: '83', fsType: 'ext4', bootable: false },
      { position: 3, device: '/dev/disk0p3', label: 'cache', size: '30G', partitionId: '83', fsType: 'ext4', bootable: false },
      { position: 4, device: '/dev/disk0p4', label: 'swap', size: '8G', partitionId: '82', fsType: 'swap', bootable: false },
      { position: 5, device: '/dev/disk0p5', label: 'data', size: '', partitionId: '83', fsType: 'ext4', bootable: false },
    ],
    osEntries: [
      {
        position: 1, name: 'Ubuntu', version: '', description: 'Ubuntu',
        osType: 'linux', iconName: 'ubuntu', image: '', baseImage: 'ubuntu.qcow2',
        differentialImage: '', rootDevice: '/dev/disk0p2', root: '/dev/disk0p2',
        kernel: 'boot/vmlinuz', initrd: 'boot/initrd.img', append: ['ro', 'splash'],
        startEnabled: true, syncEnabled: true, newEnabled: true,
        autostart: false, autostartTimeout: 5, defaultAction: 'sync',
        hidden: false,
      },
    ],
  },
  {
    id: 'dual-efi',
    label: 'Dual-Boot UEFI',
    description: 'Windows + Ubuntu, GPT, EFI — 6 Partitionen (EFI, MSR, Windows, Ubuntu, Cache, Daten)',
    icon: 'windows',
    name: 'dual_efi',
    linboSettings: {
      server: '10.0.0.1',
      cache: '/dev/disk0p5',
      roottimeout: 600,
      autopartition: false,
      autoformat: false,
      autoinitcache: false,
      downloadType: 'torrent',
      systemtype: 'efi64',
      locale: 'de-de',
      backgroundfontcolor: 'white',
      consolefontcolorsstdout: 'lightgreen',
      consolefontcolorstderr: 'orange',
    },
    partitions: [
      { position: 1, device: '/dev/disk0p1', label: 'efi', size: '200M', partitionId: 'ef', fsType: 'vfat', bootable: true },
      { position: 2, device: '/dev/disk0p2', label: 'msr', size: '128M', partitionId: '0c01', fsType: '', bootable: false },
      { position: 3, device: '/dev/disk0p3', label: 'windows', size: '50G', partitionId: '7', fsType: 'ntfs', bootable: false },
      { position: 4, device: '/dev/disk0p4', label: 'ubuntu', size: '30G', partitionId: '83', fsType: 'ext4', bootable: false },
      { position: 5, device: '/dev/disk0p5', label: 'cache', size: '50G', partitionId: '83', fsType: 'ext4', bootable: false },
      { position: 6, device: '/dev/disk0p6', label: 'data', size: '', partitionId: '7', fsType: 'ntfs', bootable: false },
    ],
    osEntries: [
      {
        position: 1, name: 'Windows 10', version: '', description: 'Windows 10',
        osType: 'windows', iconName: 'win10', image: '', baseImage: 'win10.qcow2',
        differentialImage: '', rootDevice: '/dev/disk0p3', root: '/dev/disk0p3',
        kernel: 'auto', initrd: '', append: [],
        startEnabled: true, syncEnabled: true, newEnabled: true,
        autostart: false, autostartTimeout: 5, defaultAction: 'sync',
        hidden: false,
      },
      {
        position: 2, name: 'Ubuntu', version: '', description: 'Ubuntu',
        osType: 'linux', iconName: 'ubuntu', image: '', baseImage: 'ubuntu.qcow2',
        differentialImage: '', rootDevice: '/dev/disk0p4', root: '/dev/disk0p4',
        kernel: 'boot/vmlinuz', initrd: 'boot/initrd.img', append: ['ro', 'splash'],
        startEnabled: true, syncEnabled: true, newEnabled: true,
        autostart: false, autostartTimeout: 5, defaultAction: 'sync',
        hidden: false,
      },
    ],
  },
];

export function ConfigsPage() {
  const { serverIp, fetchServerConfig, isSyncMode, modeFetched, fetchMode } = useServerConfigStore();

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
    return <SyncConfigsView />;
  }

  return <StandaloneConfigsView serverIp={serverIp} fetchServerConfig={fetchServerConfig} />;
}

// ============================================================================
// Sync Mode: read-only configs from LMN server
// ============================================================================

function SyncConfigsView() {
  const [configs, setConfigs] = useState<SyncConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewName, setPreviewName] = useState('');

  const fetchConfigs = useCallback(async () => {
    try {
      const data = await syncApi.getConfigs();
      setConfigs(data);
    } catch (error) {
      notify.error('Fehler beim Laden der Konfigurationen');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useDataInvalidation(['sync', 'config'], fetchConfigs, { showToast: false });

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handlePreview = async (config: SyncConfig) => {
    try {
      const content = await syncApi.getConfigPreview(config.id);
      setPreviewContent(content);
      setPreviewName(config.name || config.id);
      setPreviewOpen(true);
    } catch (error) {
      notify.error('Fehler beim Laden der Vorschau');
    }
  };

  const columns: Column<SyncConfig>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (config) => (
        <span className="font-mono text-sm">{config.id}</span>
      ),
    },
    {
      key: 'name',
      header: 'Name / Gruppe',
      render: (config) => config.name || '-',
    },
    {
      key: 'osEntries',
      header: 'Betriebssysteme',
      render: (config) => config.osEntries?.length ?? 0,
    },
    {
      key: 'partitions',
      header: 'Partitionen',
      render: (config) => config.partitions?.length ?? 0,
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (config) => (
        <button
          onClick={() => handlePreview(config)}
          className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
        >
          <Eye className="h-4 w-4" />
          Vorschau
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            Konfigurationen
            <Badge variant="info" size="sm">Synchronisiert von LMN</Badge>
          </h1>
          <p className="text-muted-foreground">
            start.conf Konfigurationen vom linuxmuster.net Server
          </p>
        </div>
      </div>

      <div className="bg-card shadow-sm rounded-lg overflow-hidden">
        <Table
          columns={columns}
          data={configs}
          keyExtractor={(config) => config.id}
          loading={isLoading}
          emptyMessage="Keine Konfigurationen synchronisiert"
        />
      </div>

      {/* Preview Modal */}
      <Modal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`start.conf Vorschau: ${previewName}`}
        size="lg"
      >
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono max-h-96">
          {previewContent}
        </pre>
        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
            Schliessen
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// Standalone Mode: original full-featured configs view
// ============================================================================

function StandaloneConfigsView({ serverIp, fetchServerConfig }: { serverIp: string; fetchServerConfig: () => Promise<void> }) {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [editingConfig, setEditingConfig] = useState<Config | null>(null);
  const [rawEditorConfig, setRawEditorConfig] = useState<Config | null>(null);
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
  const [themeConfig, setThemeConfig] = useState<GrubThemeConfig | null>(null);
  const iconCache = useIconCache();

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

  // Reactive: refetch configs on WS entity changes
  const { suppress: suppressConfigInvalidation } = useDataInvalidation('config', fetchConfigs);

  useEffect(() => {
    fetchServerConfig();
    fetchConfigs();
  }, []);

  const resetForm = () => {
    setFormData({ name: '', description: '' });
    setLinboSettings({ ...defaultLinboSettings, server: serverIp });
    setPartitions([]);
    setOsEntries([]);
    setActiveTab('basic');
  };

  const applyTemplate = (template: ConfigTemplate) => {
    setFormData({ name: template.name, description: template.description });
    setLinboSettings({ ...template.linboSettings, server: serverIp });
    setPartitions(template.partitions.map(p => ({ ...p })));
    setOsEntries(template.osEntries.map(o => ({ ...o, append: [...(o.append as string[] || [])] })));
    notify.success(`Vorlage "${template.label}" angewendet — Werte koennen angepasst werden`);
  };

  const handleOpenModal = async (config?: Config) => {
    if (config) {
      // Fetch full config with partitions and OS entries
      try {
        const fullConfig = await configsApi.get(config.id);
        setEditingConfig(fullConfig);
        setFormData({
          name: fullConfig.name,
          description: fullConfig.description || '',
        });
        setLinboSettings(fullConfig.linboSettings || defaultLinboSettings);
        setPartitions(
          (fullConfig.partitions || []).map(({ id, configId, ...rest }) => rest)
        );
        setOsEntries(
          (fullConfig.osEntries || []).map(({ id, configId, ...rest }) => rest)
        );
      } catch (error) {
        notify.error('Fehler beim Laden der Konfiguration');
        return;
      }
    } else {
      setEditingConfig(null);
      resetForm();
    }
    // Load GRUB theme config for preview
    systemApi.getGrubThemeStatus().then(s => setThemeConfig(s.config)).catch(() => {});
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
      suppressConfigInvalidation();
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
      suppressConfigInvalidation();
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
      suppressConfigInvalidation();
      await configsApi.clone(configId, `${name} (Kopie)`);
      notify.success('Konfiguration geklont');
      fetchConfigs();
    } catch (error) {
      notify.error('Fehler beim Klonen');
    }
  };

  const handleDeploy = async (configId: string, name: string) => {
    try {
      suppressConfigInvalidation();
      const result = await configsApi.deploy(configId);
      notify.success(`"${name}" deployed: ${result.filepath} (${result.symlinkCount} Symlinks)`);
      fetchConfigs();
    } catch (error) {
      notify.error('Fehler beim Deploy');
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
          <div className="font-medium text-foreground">{config.name}</div>
          <div className="text-muted-foreground text-xs">Version {config.version}</div>
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
            onClick={() => handleDeploy(config.id, config.name)}
            className="text-ciGreen hover:text-ciGreen/80"
            title="Deploy (start.conf schreiben)"
          >
            <CloudUpload className="h-4 w-4" />
          </button>
          <button
            onClick={() => handlePreview(config.id)}
            className="text-primary hover:text-primary/80"
            title="Vorschau"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => setRawEditorConfig(config)}
            className="text-primary hover:text-primary/80"
            title="Raw Editor"
          >
            <Code className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleClone(config.id, config.name)}
            className="text-primary hover:text-primary/80"
            title="Klonen"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleOpenModal(config)}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Bearbeiten
          </button>
          <button
            onClick={() => setDeleteConfirmConfig(config)}
            className="text-destructive hover:text-destructive/80 text-sm"
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
          <h1 className="text-2xl font-bold text-foreground">Konfigurationen</h1>
          <p className="text-muted-foreground">Verwaltung der start.conf Konfigurationen</p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <Plus className="h-5 w-5 mr-2" />
          Neue Konfiguration
        </Button>
      </div>

      <div className="bg-card shadow-sm rounded-lg overflow-hidden">
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
        size="full"
      >
        <form onSubmit={handleSubmit}>
          {/* Tabs */}
          <div className="border-b border-border mb-4">
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`${
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className={`${
                      activeTab === tab.id ? 'bg-primary/10 text-primary' : 'bg-background text-foreground'
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
                {/* Template selection — only for new configs */}
                {!editingConfig && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Vorlage (optional)</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {configTemplates.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => applyTemplate(tpl)}
                          className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary hover:bg-muted/50 transition-colors text-left"
                        >
                          <div className="mt-0.5">
                            {tpl.icon === 'windows' ? (
                              <Monitor className="h-5 w-5 text-primary" />
                            ) : (
                              <FileText className="h-5 w-5 text-orange-400" />
                            )}
                          </div>
                          <div>
                            <div className="font-medium text-foreground text-sm">{tpl.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{tpl.description}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Vorlage befuellt alle Tabs — Name, Partitionen und OS koennen danach angepasst werden.
                    </p>
                  </div>
                )}
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
                serverIp={serverIp}
              />
            )}

            {activeTab === 'partitions' && (
              <PartitionsEditor
                partitions={partitions}
                onChange={setPartitions}
              />
            )}

            {activeTab === 'os' && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                  <OsEntriesEditor
                    osEntries={osEntries}
                    partitions={partitions}
                    onChange={setOsEntries}
                    iconOptions={iconCache.iconOptions}
                    getIconUrl={iconCache.getIconUrl}
                  />
                </div>
                <div className="lg:col-span-2">
                  <div className="sticky top-0">
                    <h4 className="text-sm font-medium text-foreground mb-2">GRUB-Menu Vorschau</h4>
                    <GrubMenuPreview
                      osEntries={osEntries}
                      linboSettings={linboSettings}
                      themeConfig={themeConfig}
                      getIconUrl={iconCache.getIconUrl}
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Vorschau basiert auf aktuellem GRUB-Theme
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center pt-4 mt-4 border-t">
            <div className="text-sm text-muted-foreground">
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

      {/* Raw Config Editor */}
      <RawConfigEditorModal
        isOpen={!!rawEditorConfig}
        onClose={() => setRawEditorConfig(null)}
        config={rawEditorConfig}
        onSaved={() => fetchConfigs()}
      />
    </div>
  );
}
