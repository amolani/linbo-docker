import { useState, useEffect } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { groupsApi } from '@/api/groups';
import { configsApi } from '@/api/configs';
import { Button, Table, Modal, Input, Textarea, Select, ConfirmModal } from '@/components/ui';
import { notify } from '@/stores/notificationStore';
import type { HostGroup, Config, Column } from '@/types';

export function GroupsPage() {
  const [groups, setGroups] = useState<HostGroup[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<HostGroup | null>(null);
  const [deleteConfirmGroup, setDeleteConfirmGroup] = useState<HostGroup | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    defaultConfigId: '',
  });

  const fetchData = async () => {
    try {
      const [groupsData, configsData] = await Promise.all([
        groupsApi.list(),
        configsApi.list(),
      ]);
      setGroups(groupsData);
      setConfigs(configsData);
    } catch (error) {
      notify.error('Fehler beim Laden der Daten');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenModal = (group?: HostGroup) => {
    if (group) {
      setEditingGroup(group);
      setFormData({
        name: group.name,
        description: group.description || '',
        defaultConfigId: group.defaultConfigId || '',
      });
    } else {
      setEditingGroup(null);
      setFormData({ name: '', description: '', defaultConfigId: '' });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const data = {
        name: formData.name,
        description: formData.description || undefined,
        defaultConfigId: formData.defaultConfigId || undefined,
      };

      if (editingGroup) {
        await groupsApi.update(editingGroup.id, data);
        notify.success('Gruppe aktualisiert');
      } else {
        await groupsApi.create(data);
        notify.success('Gruppe erstellt');
      }
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      notify.error('Fehler beim Speichern');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmGroup) return;
    setIsSubmitting(true);

    try {
      await groupsApi.delete(deleteConfirmGroup.id);
      notify.success('Gruppe gelöscht');
      setDeleteConfirmGroup(null);
      fetchData();
    } catch (error) {
      notify.error('Fehler beim Löschen');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWakeAll = async (groupId: string) => {
    try {
      const result = await groupsApi.wakeAll(groupId);
      notify.success(
        'Wake-on-LAN gesendet',
        `${result.success} erfolgreich, ${result.failed} fehlgeschlagen`
      );
    } catch (error) {
      notify.error('Fehler beim Senden von Wake-on-LAN');
    }
  };

  const columns: Column<HostGroup>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (group) => (
        <div className="font-medium text-gray-900">{group.name}</div>
      ),
    },
    {
      key: 'description',
      header: 'Beschreibung',
      render: (group) => group.description || '-',
    },
    {
      key: 'defaultConfig',
      header: 'Standard-Konfiguration',
      render: (group) => group.defaultConfig?.name || '-',
    },
    {
      key: 'hosts',
      header: 'Hosts',
      render: (group) => (group as HostGroup & { hostCount?: number }).hostCount ?? group._count?.hosts ?? 0,
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (group) => (
        <div className="flex space-x-2">
          <button
            onClick={() => handleWakeAll(group.id)}
            className="text-primary-600 hover:text-primary-900 text-sm"
          >
            Alle wecken
          </button>
          <button
            onClick={() => handleOpenModal(group)}
            className="text-gray-600 hover:text-gray-900 text-sm"
          >
            Bearbeiten
          </button>
          <button
            onClick={() => setDeleteConfirmGroup(group)}
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
          <h1 className="text-2xl font-bold text-gray-900">Gruppen</h1>
          <p className="text-gray-600">Verwaltung der Host-Gruppen</p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Neue Gruppe
        </Button>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <Table
          columns={columns}
          data={groups}
          keyExtractor={(group) => group.id}
          loading={isLoading}
          emptyMessage="Keine Gruppen gefunden"
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingGroup ? 'Gruppe bearbeiten' : 'Neue Gruppe'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <Textarea
            label="Beschreibung"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          <Select
            label="Standard-Konfiguration"
            value={formData.defaultConfigId}
            onChange={(e) => setFormData({ ...formData, defaultConfigId: e.target.value })}
            options={[
              { value: '', label: 'Keine' },
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
            <Button type="submit" loading={isSubmitting}>
              {editingGroup ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteConfirmGroup}
        onClose={() => setDeleteConfirmGroup(null)}
        onConfirm={handleDelete}
        title="Gruppe löschen"
        message={`Möchten Sie die Gruppe "${deleteConfirmGroup?.name}" wirklich löschen?`}
        confirmLabel="Löschen"
        variant="danger"
        loading={isSubmitting}
      />
    </div>
  );
}
