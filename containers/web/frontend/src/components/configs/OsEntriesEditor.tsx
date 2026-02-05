import { useState, useEffect } from 'react';
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline';
import { Button, Input, Select, Modal } from '@/components/ui';
import { imagesApi } from '@/api/images';
import type { ConfigOs, ConfigPartition, Image } from '@/types';

type OsEntryData = Omit<ConfigOs, 'id' | 'configId'>;

interface OsEntriesEditorProps {
  osEntries: OsEntryData[];
  partitions: Omit<ConfigPartition, 'id' | 'configId'>[];
  onChange: (osEntries: OsEntryData[]) => void;
}

const defaultOsEntry: OsEntryData = {
  position: 0,
  name: '',
  description: '',
  osType: 'windows',
  iconName: 'windows.svg',
  baseImage: '',
  differentialImage: '',
  rootDevice: '/dev/sda1',
  kernel: '',
  initrd: '',
  append: [],
  startEnabled: true,
  syncEnabled: true,
  newEnabled: true,
  autostart: false,
  autostartTimeout: 5,
  defaultAction: 'sync',
};

const osTypeOptions = [
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
  { value: 'other', label: 'Andere' },
];

const defaultActionOptions = [
  { value: 'start', label: 'Starten' },
  { value: 'sync', label: 'Synchronisieren' },
  { value: 'new', label: 'Neu installieren' },
];

const iconOptions = [
  { value: 'windows.svg', label: 'Windows' },
  { value: 'ubuntu.svg', label: 'Ubuntu' },
  { value: 'linux.svg', label: 'Linux (generisch)' },
  { value: 'mint.svg', label: 'Linux Mint' },
  { value: 'debian.svg', label: 'Debian' },
  { value: 'fedora.svg', label: 'Fedora' },
];

export function OsEntriesEditor({ osEntries, partitions, onChange }: OsEntriesEditorProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState<OsEntryData>(defaultOsEntry);
  const [images, setImages] = useState<Image[]>([]);
  const [appendText, setAppendText] = useState('');

  useEffect(() => {
    imagesApi.list().then(setImages).catch(() => {});
  }, []);

  const partitionOptions = partitions.map(p => ({
    value: p.device,
    label: `${p.device} (${p.label || p.fsType || 'unbekannt'})`,
  }));

  const imageOptions = [
    { value: '', label: '-- Kein Image --' },
    ...images
      .filter(img => img.type === 'base' && img.status === 'available')
      .map(img => ({ value: img.filename, label: img.filename })),
  ];

  const diffImageOptions = [
    { value: '', label: '-- Kein Diff-Image --' },
    ...images
      .filter(img => img.type === 'differential' && img.status === 'available')
      .map(img => ({ value: img.filename, label: img.filename })),
  ];

  const handleOpenModal = (index?: number) => {
    if (index !== undefined) {
      setEditingIndex(index);
      const entry = osEntries[index];
      setFormData(entry);
      setAppendText(entry.append?.join('\n') || '');
    } else {
      setEditingIndex(null);
      const nextPosition = osEntries.length > 0
        ? Math.max(...osEntries.map(o => o.position)) + 1
        : 1;
      setFormData({ ...defaultOsEntry, position: nextPosition });
      setAppendText('');
    }
    setIsModalOpen(true);
  };

  const handleSave = () => {
    const entryToSave = {
      ...formData,
      append: appendText.split('\n').filter(line => line.trim()),
    };

    if (editingIndex !== null) {
      const updated = [...osEntries];
      updated[editingIndex] = entryToSave;
      onChange(updated);
    } else {
      onChange([...osEntries, entryToSave]);
    }
    setIsModalOpen(false);
  };

  const handleDelete = (index: number) => {
    const updated = osEntries.filter((_, i) => i !== index);
    updated.forEach((o, i) => o.position = i + 1);
    onChange(updated);
  };

  const moveEntry = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= osEntries.length) return;

    const updated = [...osEntries];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    updated.forEach((o, i) => o.position = i + 1);
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600">
          Definieren Sie die Betriebssysteme mit ihren Boot-Optionen
        </p>
        <Button size="sm" onClick={() => handleOpenModal()}>
          <PlusIcon className="h-4 w-4 mr-1" />
          Betriebssystem hinzufuegen
        </Button>
      </div>

      {osEntries.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <p className="text-gray-500">Keine Betriebssysteme definiert</p>
          <p className="text-sm text-gray-400 mt-1">
            Klicken Sie auf "Betriebssystem hinzufuegen" um zu beginnen
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {osEntries.map((entry, index) => (
            <div key={index} className="bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex flex-col items-center">
                    <span className="text-sm text-gray-400">#{entry.position}</span>
                    <div className="flex flex-col">
                      <button
                        onClick={() => moveEntry(index, 'up')}
                        disabled={index === 0}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <span className="text-xs">&#9650;</span>
                      </button>
                      <button
                        onClick={() => moveEntry(index, 'down')}
                        disabled={index === osEntries.length - 1}
                        className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <span className="text-xs">&#9660;</span>
                      </button>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">{entry.name || 'Unbenannt'}</h4>
                    <p className="text-sm text-gray-500">
                      {osTypeOptions.find(o => o.value === entry.osType)?.label || entry.osType}
                      {entry.baseImage && ` - ${entry.baseImage}`}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Root: {entry.rootDevice}
                      {entry.autostart && ' | Autostart'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex space-x-2 text-xs">
                    {entry.startEnabled && (
                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded">Start</span>
                    )}
                    {entry.syncEnabled && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">Sync</span>
                    )}
                    {entry.newEnabled && (
                      <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded">Neu</span>
                    )}
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleOpenModal(index)}
                      className="text-primary-600 hover:text-primary-900"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(index)}
                      className="text-red-600 hover:text-red-900"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingIndex !== null ? 'Betriebssystem bearbeiten' : 'Neues Betriebssystem'}
        size="lg"
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Windows 10, Ubuntu 22.04..."
            />
            <Select
              label="Betriebssystem-Typ"
              value={formData.osType || 'windows'}
              onChange={(e) => setFormData({ ...formData, osType: e.target.value })}
              options={osTypeOptions}
            />
          </div>

          <Input
            label="Beschreibung"
            value={formData.description || ''}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Optionale Beschreibung"
          />

          {/* Images */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Images</h4>
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Basis-Image"
                value={formData.baseImage || ''}
                onChange={(e) => setFormData({ ...formData, baseImage: e.target.value })}
                options={imageOptions}
              />
              <Select
                label="Differenz-Image (optional)"
                value={formData.differentialImage || ''}
                onChange={(e) => setFormData({ ...formData, differentialImage: e.target.value })}
                options={diffImageOptions}
              />
            </div>
          </div>

          {/* Boot Config */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Boot-Konfiguration</h4>
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Root-Partition"
                value={formData.rootDevice || ''}
                onChange={(e) => setFormData({ ...formData, rootDevice: e.target.value })}
                options={partitionOptions.length > 0 ? partitionOptions : [{ value: formData.rootDevice || '', label: formData.rootDevice || '(Bitte Partition definieren)' }]}
              />
              <Select
                label="Icon"
                value={formData.iconName || 'windows.svg'}
                onChange={(e) => setFormData({ ...formData, iconName: e.target.value })}
                options={iconOptions}
              />
            </div>
            {formData.osType === 'linux' && (
              <div className="grid grid-cols-2 gap-4 mt-4">
                <Input
                  label="Kernel"
                  value={formData.kernel || ''}
                  onChange={(e) => setFormData({ ...formData, kernel: e.target.value })}
                  placeholder="vmlinuz"
                />
                <Input
                  label="Initrd"
                  value={formData.initrd || ''}
                  onChange={(e) => setFormData({ ...formData, initrd: e.target.value })}
                  placeholder="initrd.img"
                />
              </div>
            )}
          </div>

          {/* Boot Options */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Aktionen aktivieren</h4>
            <div className="grid grid-cols-3 gap-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                  checked={formData.startEnabled}
                  onChange={(e) => setFormData({ ...formData, startEnabled: e.target.checked })}
                />
                <span className="text-sm text-gray-700">Starten</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                  checked={formData.syncEnabled}
                  onChange={(e) => setFormData({ ...formData, syncEnabled: e.target.checked })}
                />
                <span className="text-sm text-gray-700">Synchronisieren</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                  checked={formData.newEnabled}
                  onChange={(e) => setFormData({ ...formData, newEnabled: e.target.checked })}
                />
                <span className="text-sm text-gray-700">Neu installieren</span>
              </label>
            </div>
          </div>

          {/* Autostart */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Autostart</h4>
            <div className="grid grid-cols-3 gap-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                  checked={formData.autostart}
                  onChange={(e) => setFormData({ ...formData, autostart: e.target.checked })}
                />
                <span className="text-sm text-gray-700">Autostart aktivieren</span>
              </label>
              <Input
                label="Timeout (Sek.)"
                type="number"
                value={formData.autostartTimeout}
                onChange={(e) => setFormData({ ...formData, autostartTimeout: parseInt(e.target.value) || 5 })}
                disabled={!formData.autostart}
              />
              <Select
                label="Standard-Aktion"
                value={formData.defaultAction || 'sync'}
                onChange={(e) => setFormData({ ...formData, defaultAction: e.target.value })}
                options={defaultActionOptions}
              />
            </div>
          </div>

          {/* Append (Linux only) */}
          {formData.osType === 'linux' && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Kernel-Parameter (append)</h4>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 sm:text-sm font-mono"
                rows={3}
                value={appendText}
                onChange={(e) => setAppendText(e.target.value)}
                placeholder="quiet splash&#10;root=/dev/sda2"
              />
              <p className="text-xs text-gray-500 mt-1">Ein Parameter pro Zeile</p>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave}>
              {editingIndex !== null ? 'Speichern' : 'Hinzufuegen'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
