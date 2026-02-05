import { useState } from 'react';
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline';
import { Button, Input, Select, Modal } from '@/components/ui';
import type { ConfigPartition } from '@/types';

type PartitionData = Omit<ConfigPartition, 'id' | 'configId'>;

interface PartitionsEditorProps {
  partitions: PartitionData[];
  onChange: (partitions: PartitionData[]) => void;
}

const defaultPartition: PartitionData = {
  position: 0,
  device: '/dev/sda1',
  label: '',
  size: '',
  fsType: 'ntfs',
  bootable: false,
};

const fsTypeOptions = [
  { value: 'ntfs', label: 'NTFS (Windows)' },
  { value: 'ext4', label: 'ext4 (Linux)' },
  { value: 'vfat', label: 'FAT32 (EFI)' },
  { value: 'swap', label: 'Swap' },
  { value: 'cache', label: 'LINBO Cache' },
  { value: '', label: 'Unformatiert' },
];

export function PartitionsEditor({ partitions, onChange }: PartitionsEditorProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formData, setFormData] = useState<PartitionData>(defaultPartition);

  const handleOpenModal = (index?: number) => {
    if (index !== undefined) {
      setEditingIndex(index);
      setFormData(partitions[index]);
    } else {
      setEditingIndex(null);
      const nextPosition = partitions.length > 0
        ? Math.max(...partitions.map(p => p.position)) + 1
        : 1;
      const nextPartNum = partitions.length + 1;
      setFormData({
        ...defaultPartition,
        position: nextPosition,
        device: `/dev/sda${nextPartNum}`,
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (editingIndex !== null) {
      const updated = [...partitions];
      updated[editingIndex] = formData;
      onChange(updated);
    } else {
      onChange([...partitions, formData]);
    }
    setIsModalOpen(false);
  };

  const handleDelete = (index: number) => {
    const updated = partitions.filter((_, i) => i !== index);
    // Reposition
    updated.forEach((p, i) => p.position = i + 1);
    onChange(updated);
  };

  const movePartition = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= partitions.length) return;

    const updated = [...partitions];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    updated.forEach((p, i) => p.position = i + 1);
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600">
          Definieren Sie die Partitionsstruktur der Festplatte
        </p>
        <Button size="sm" onClick={() => handleOpenModal()}>
          <PlusIcon className="h-4 w-4 mr-1" />
          Partition hinzufuegen
        </Button>
      </div>

      {partitions.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <p className="text-gray-500">Keine Partitionen definiert</p>
          <p className="text-sm text-gray-400 mt-1">
            Klicken Sie auf "Partition hinzufuegen" um zu beginnen
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Device</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Label</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Groesse</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dateisystem</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bootable</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Aktionen</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {partitions.map((partition, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-500">
                    <div className="flex items-center space-x-1">
                      <span>{partition.position}</span>
                      <div className="flex flex-col">
                        <button
                          onClick={() => movePartition(index, 'up')}
                          disabled={index === 0}
                          className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        >
                          <span className="text-xs">&#9650;</span>
                        </button>
                        <button
                          onClick={() => movePartition(index, 'down')}
                          disabled={index === partitions.length - 1}
                          className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        >
                          <span className="text-xs">&#9660;</span>
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-900">{partition.device}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{partition.label || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{partition.size || 'Rest'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {fsTypeOptions.find(o => o.value === partition.fsType)?.label || partition.fsType || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {partition.bootable ? (
                      <span className="text-green-600">Ja</span>
                    ) : (
                      <span className="text-gray-400">Nein</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingIndex !== null ? 'Partition bearbeiten' : 'Neue Partition'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Device"
              value={formData.device}
              onChange={(e) => setFormData({ ...formData, device: e.target.value })}
              placeholder="/dev/sda1"
              helperText="z.B. /dev/sda1, /dev/nvme0n1p1"
            />
            <Input
              label="Label"
              value={formData.label || ''}
              onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              placeholder="Windows, Linux, Cache..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Groesse"
              value={formData.size || ''}
              onChange={(e) => setFormData({ ...formData, size: e.target.value })}
              placeholder="100G, 50%, oder leer fuer Rest"
              helperText="Leer lassen fuer restlichen Speicherplatz"
            />
            <Select
              label="Dateisystem"
              value={formData.fsType || ''}
              onChange={(e) => setFormData({ ...formData, fsType: e.target.value })}
              options={fsTypeOptions}
            />
          </div>

          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
              checked={formData.bootable}
              onChange={(e) => setFormData({ ...formData, bootable: e.target.checked })}
            />
            <span className="text-sm text-gray-700">Bootable (aktive Partition)</span>
          </label>

          <div className="flex justify-end space-x-3 pt-4">
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
