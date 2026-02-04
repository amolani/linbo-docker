import { useState, useEffect } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { roomsApi } from '@/api/rooms';
import { Button, Table, Modal, Input, Textarea, ConfirmModal } from '@/components/ui';
import { notify } from '@/stores/notificationStore';
import type { Room, Column } from '@/types';

export function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [deleteConfirmRoom, setDeleteConfirmRoom] = useState<Room | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    location: '',
  });

  const fetchRooms = async () => {
    try {
      const data = await roomsApi.list();
      setRooms(data);
    } catch (error) {
      notify.error('Fehler beim Laden der Räume');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  const handleOpenModal = (room?: Room) => {
    if (room) {
      setEditingRoom(room);
      setFormData({
        name: room.name,
        description: room.description || '',
        location: room.location || '',
      });
    } else {
      setEditingRoom(null);
      setFormData({ name: '', description: '', location: '' });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (editingRoom) {
        await roomsApi.update(editingRoom.id, formData);
        notify.success('Raum aktualisiert');
      } else {
        await roomsApi.create(formData);
        notify.success('Raum erstellt');
      }
      setIsModalOpen(false);
      fetchRooms();
    } catch (error) {
      notify.error('Fehler beim Speichern');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmRoom) return;
    setIsSubmitting(true);

    try {
      await roomsApi.delete(deleteConfirmRoom.id);
      notify.success('Raum gelöscht');
      setDeleteConfirmRoom(null);
      fetchRooms();
    } catch (error) {
      notify.error('Fehler beim Löschen');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWakeAll = async (roomId: string) => {
    try {
      const result = await roomsApi.wakeAll(roomId);
      notify.success(
        'Wake-on-LAN gesendet',
        `${result.success} erfolgreich, ${result.failed} fehlgeschlagen`
      );
    } catch (error) {
      notify.error('Fehler beim Senden von Wake-on-LAN');
    }
  };

  const columns: Column<Room>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (room) => (
        <div>
          <div className="font-medium text-gray-900">{room.name}</div>
          {room.location && (
            <div className="text-gray-500 text-xs">{room.location}</div>
          )}
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Beschreibung',
      render: (room) => room.description || '-',
    },
    {
      key: 'hosts',
      header: 'Hosts',
      render: (room) => room._count?.hosts || 0,
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (room) => (
        <div className="flex space-x-2">
          <button
            onClick={() => handleWakeAll(room.id)}
            className="text-primary-600 hover:text-primary-900 text-sm"
          >
            Alle wecken
          </button>
          <button
            onClick={() => handleOpenModal(room)}
            className="text-gray-600 hover:text-gray-900 text-sm"
          >
            Bearbeiten
          </button>
          <button
            onClick={() => setDeleteConfirmRoom(room)}
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
          <h1 className="text-2xl font-bold text-gray-900">Räume</h1>
          <p className="text-gray-600">Verwaltung der Computerräume</p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Neuer Raum
        </Button>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <Table
          columns={columns}
          data={rooms}
          keyExtractor={(room) => room.id}
          loading={isLoading}
          emptyMessage="Keine Räume gefunden"
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRoom ? 'Raum bearbeiten' : 'Neuer Raum'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <Input
            label="Standort"
            placeholder="z.B. Gebäude A, Raum 101"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
          />
          <Textarea
            label="Beschreibung"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
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
              {editingRoom ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteConfirmRoom}
        onClose={() => setDeleteConfirmRoom(null)}
        onConfirm={handleDelete}
        title="Raum löschen"
        message={`Möchten Sie den Raum "${deleteConfirmRoom?.name}" wirklich löschen?`}
        confirmLabel="Löschen"
        variant="danger"
        loading={isSubmitting}
      />
    </div>
  );
}
