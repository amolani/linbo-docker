import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, ChevronRight, Trash2, Power, Pencil } from 'lucide-react';
import { roomsApi } from '@/api/rooms';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { Button, Modal, Input, Textarea, ConfirmModal, StatusBadge } from '@/components/ui';
import { notify } from '@/stores/notificationStore';
import type { Room, Host } from '@/types';

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

  // Accordion state
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());
  const [roomHosts, setRoomHosts] = useState<Record<string, Host[]>>({});
  const [roomStatusSummary, setRoomStatusSummary] = useState<Record<string, Record<string, number>>>({});
  const [loadingHosts, setLoadingHosts] = useState<Record<string, boolean>>({});

  // Selection state
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const fetchRooms = async () => {
    try {
      const data = await roomsApi.list();
      setRooms(data);
    } catch {
      notify.error('Fehler beim Laden der Räume');
    } finally {
      setIsLoading(false);
    }
  };

  // Ref to track expanded rooms for WS-triggered host refresh
  const expandedRoomsRef = useRef(expandedRooms);
  expandedRoomsRef.current = expandedRooms;

  // Refresh expanded rooms' host lists + room counts
  const refreshAfterHostChange = useCallback(async () => {
    // Always refetch room list (updates host counts)
    fetchRooms();
    // Also refresh hosts for any currently expanded rooms
    const expanded = Array.from(expandedRoomsRef.current);
    if (expanded.length === 0) return;
    for (const roomId of expanded) {
      try {
        const room = await roomsApi.get(roomId);
        setRoomHosts(prev => ({ ...prev, [roomId]: room.hosts || [] }));
        setRoomStatusSummary(prev => ({ ...prev, [roomId]: (room as Room & { statusSummary?: Record<string, number> }).statusSummary || {} }));
      } catch {
        // Silently ignore — room may have been deleted
      }
    }
  }, []);

  // Reactive: refetch rooms on WS entity changes
  const { suppress: suppressRoomInvalidation } = useDataInvalidation('room', fetchRooms);
  useDataInvalidation('host', refreshAfterHostChange, { showToast: false }); // Host changes → room counts + expanded hosts

  useEffect(() => {
    fetchRooms();
  }, []);

  const toggleRoom = async (roomId: string) => {
    const next = new Set(expandedRooms);
    if (next.has(roomId)) {
      next.delete(roomId);
    } else {
      next.add(roomId);
      if (!roomHosts[roomId]) {
        setLoadingHosts(prev => ({ ...prev, [roomId]: true }));
        try {
          const room = await roomsApi.get(roomId);
          setRoomHosts(prev => ({ ...prev, [roomId]: room.hosts || [] }));
          setRoomStatusSummary(prev => ({ ...prev, [roomId]: (room as Room & { statusSummary?: Record<string, number> }).statusSummary || {} }));
        } catch {
          notify.error('Fehler beim Laden der Hosts');
        } finally {
          setLoadingHosts(prev => ({ ...prev, [roomId]: false }));
        }
      }
    }
    setExpandedRooms(next);
  };

  const toggleRoomSelect = (roomId: string) => {
    setSelectedRooms(prev => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId); else next.add(roomId);
      return next;
    });
  };

  const selectAllRooms = () => setSelectedRooms(new Set(rooms.map(r => r.id)));
  const deselectAllRooms = () => setSelectedRooms(new Set());

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
      suppressRoomInvalidation();
      if (editingRoom) {
        await roomsApi.update(editingRoom.id, formData);
        notify.success('Raum aktualisiert');
      } else {
        await roomsApi.create(formData);
        notify.success('Raum erstellt');
      }
      setIsModalOpen(false);
      fetchRooms();
    } catch {
      notify.error('Fehler beim Speichern');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmRoom) return;
    setIsSubmitting(true);
    const id = deleteConfirmRoom.id;

    try {
      suppressRoomInvalidation();
      await roomsApi.delete(id);
      notify.success('Raum gelöscht');
      setDeleteConfirmRoom(null);
      // Clean up UI state for deleted room
      setExpandedRooms(prev => { const n = new Set(prev); n.delete(id); return n; });
      setRoomHosts(prev => { const n = { ...prev }; delete n[id]; return n; });
      setRoomStatusSummary(prev => { const n = { ...prev }; delete n[id]; return n; });
      setSelectedRooms(prev => { const n = new Set(prev); n.delete(id); return n; });
      fetchRooms();
    } catch {
      notify.error('Fehler beim Löschen');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkDeleteRooms = async () => {
    setIsSubmitting(true);
    try {
      suppressRoomInvalidation();
      const ids = Array.from(selectedRooms);
      const result = await roomsApi.bulkDelete(ids);
      if (result.failed > 0) {
        notify.warning(
          `${result.success} gelöscht, ${result.failed} fehlgeschlagen`,
          result.errors[0]
        );
      } else {
        notify.success(`${result.success} Raum/Räume gelöscht`);
      }
      // Clean up UI state
      setSelectedRooms(new Set());
      setBulkDeleteConfirm(false);
      setExpandedRooms(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      setRoomHosts(prev => {
        const next = { ...prev };
        ids.forEach(id => delete next[id]);
        return next;
      });
      setRoomStatusSummary(prev => {
        const next = { ...prev };
        ids.forEach(id => delete next[id]);
        return next;
      });
      fetchRooms();
    } catch {
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
    } catch {
      notify.error('Fehler beim Senden von Wake-on-LAN');
    }
  };

  const getHostCount = (room: Room) =>
    (room as Room & { hostCount?: number }).hostCount ?? room._count?.hosts ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Räume</h1>
          <p className="text-muted-foreground">Verwaltung der Computerräume</p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <Plus className="h-5 w-5 mr-2" />
          Neuer Raum
        </Button>
      </div>

      {/* Bulk Actions */}
      {selectedRooms.size > 0 && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center justify-between">
          <span className="text-primary">
            {selectedRooms.size} Raum/Räume ausgewählt
          </span>
          <div className="flex space-x-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setBulkDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Löschen
            </Button>
            <Button size="sm" variant="secondary" onClick={deselectAllRooms}>
              Auswahl aufheben
            </Button>
          </div>
        </div>
      )}

      {/* Room Cards */}
      {isLoading ? (
        <div className="bg-card shadow-sm rounded-lg p-8 text-center text-muted-foreground">
          Lade Räume...
        </div>
      ) : rooms.length === 0 ? (
        <div className="bg-card shadow-sm rounded-lg p-8 text-center text-muted-foreground">
          Keine Räume gefunden
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select All */}
          <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="rounded border-border"
              checked={selectedRooms.size === rooms.length && rooms.length > 0}
              onChange={() => selectedRooms.size === rooms.length ? deselectAllRooms() : selectAllRooms()}
            />
            <span>Alle auswählen</span>
          </div>

          {rooms.map((room) => {
            const isExpanded = expandedRooms.has(room.id);
            const isSelected = selectedRooms.has(room.id);
            const hosts = roomHosts[room.id];
            const statusSummary = roomStatusSummary[room.id];
            const isLoadingRoom = loadingHosts[room.id];
            const hostCount = getHostCount(room);

            return (
              <div key={room.id} className="bg-card shadow-sm rounded-lg overflow-hidden border border-border">
                {/* Room Header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleRoom(room.id)}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    checked={isSelected}
                    onChange={() => toggleRoomSelect(room.id)}
                    onClick={(e) => e.stopPropagation()}
                  />

                  {/* Expand Arrow */}
                  <ChevronRight
                    className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />

                  {/* Room Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{room.name}</span>
                      {room.location && (
                        <span className="text-xs text-muted-foreground">({room.location})</span>
                      )}
                    </div>
                    {room.description && (
                      <div className="text-sm text-muted-foreground truncate">{room.description}</div>
                    )}
                  </div>

                  {/* Host Count */}
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {hostCount} Host{hostCount !== 1 ? 's' : ''}
                  </span>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleWakeAll(room.id); }}
                      className="p-1.5 rounded hover:bg-muted text-primary"
                      title="Alle wecken"
                    >
                      <Power className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleOpenModal(room); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                      title="Bearbeiten"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmRoom(room); }}
                      className="p-1.5 rounded hover:bg-muted text-destructive"
                      title="Löschen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-border px-4 py-3">
                    {isLoadingRoom ? (
                      <div className="text-sm text-muted-foreground py-2">Lade Hosts...</div>
                    ) : hosts && hosts.length > 0 ? (
                      <>
                        {/* Status Summary */}
                        {statusSummary && Object.keys(statusSummary).length > 0 && (
                          <div className="flex gap-3 mb-3 text-sm">
                            {Object.entries(statusSummary).map(([status, count]) => (
                              <span key={status} className="text-muted-foreground">
                                {count}x <StatusBadge status={status} />
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Hosts Table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border text-left text-muted-foreground">
                                <th className="pb-2 pr-4 font-medium">Hostname</th>
                                <th className="pb-2 pr-4 font-medium">IP-Adresse</th>
                                <th className="pb-2 pr-4 font-medium">MAC</th>
                                <th className="pb-2 pr-4 font-medium">Status</th>
                                <th className="pb-2 font-medium">Konfiguration</th>
                              </tr>
                            </thead>
                            <tbody>
                              {hosts.map((host) => (
                                <tr key={host.id} className="border-b border-border/50 last:border-0">
                                  <td className="py-2 pr-4 font-medium text-foreground">{host.hostname}</td>
                                  <td className="py-2 pr-4 text-muted-foreground">{host.ipAddress || '-'}</td>
                                  <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">{host.macAddress}</td>
                                  <td className="py-2 pr-4"><StatusBadge status={host.status} /></td>
                                  <td className="py-2 text-muted-foreground">{host.config?.name || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground py-2">Keine Hosts in diesem Raum</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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

      {/* Single Delete Confirmation */}
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

      {/* Bulk Delete Confirmation */}
      <ConfirmModal
        isOpen={bulkDeleteConfirm}
        onClose={() => setBulkDeleteConfirm(false)}
        onConfirm={handleBulkDeleteRooms}
        title="Räume löschen"
        message={`Möchten Sie ${selectedRooms.size} Raum/Räume wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`}
        confirmLabel="Löschen"
        variant="danger"
        loading={isSubmitting}
      />
    </div>
  );
}
