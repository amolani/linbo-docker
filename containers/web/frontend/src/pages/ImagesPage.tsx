import { useState, useEffect } from 'react';
import { Plus, CheckCircle2, RefreshCw } from 'lucide-react';
import { imagesApi } from '@/api/images';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { Button, Table, Modal, Input, Textarea, Select, Badge, ConfirmModal } from '@/components/ui';
import { notify } from '@/stores/notificationStore';
import type { Image, Column } from '@/types';

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function ImagesPage() {
  const [images, setImages] = useState<Image[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingImage, setEditingImage] = useState<Image | null>(null);
  const [deleteConfirmImage, setDeleteConfirmImage] = useState<Image | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    filename: '',
    type: 'base',
    path: '',
    description: '',
    backingImage: '',
  });

  const fetchImages = async () => {
    try {
      const data = await imagesApi.list();
      setImages(data);
    } catch (error) {
      notify.error('Fehler beim Laden der Images');
    } finally {
      setIsLoading(false);
    }
  };

  // Reactive: refetch images on WS entity changes
  useDataInvalidation('image', fetchImages);

  useEffect(() => {
    fetchImages();
  }, []);

  const handleOpenModal = (image?: Image) => {
    if (image) {
      setEditingImage(image);
      setFormData({
        filename: image.filename,
        type: image.type,
        path: image.path,
        description: image.description || '',
        backingImage: image.backingImage || '',
      });
    } else {
      setEditingImage(null);
      setFormData({
        filename: '',
        type: 'base',
        path: '/srv/linbo/images/',
        description: '',
        backingImage: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (editingImage) {
        await imagesApi.update(editingImage.id, {
          description: formData.description || undefined,
        });
        notify.success('Image aktualisiert');
      } else {
        await imagesApi.create({
          filename: formData.filename,
          type: formData.type as 'base' | 'differential' | 'rsync',
          path: formData.path,
          description: formData.description || undefined,
          backingImage: formData.backingImage || undefined,
        });
        notify.success('Image erstellt');
      }
      setIsModalOpen(false);
      fetchImages();
    } catch (error) {
      notify.error('Fehler beim Speichern');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmImage) return;
    setIsSubmitting(true);

    try {
      await imagesApi.delete(deleteConfirmImage.id);
      notify.success('Image gelöscht');
      setDeleteConfirmImage(null);
      fetchImages();
    } catch (error) {
      notify.error('Fehler beim Löschen');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (imageId: string) => {
    setVerifyingId(imageId);
    try {
      const result = await imagesApi.verify(imageId);
      if (result.valid) {
        notify.success('Prüfsumme gültig', `SHA256: ${result.checksum.substring(0, 16)}...`);
      } else {
        notify.warning('Prüfsumme ungültig');
      }
    } catch (error) {
      notify.error('Fehler bei der Verifizierung');
    } finally {
      setVerifyingId(null);
    }
  };

  const getTypeBadge = (type: string) => {
    const variants: Record<string, 'info' | 'warning' | 'success'> = {
      base: 'info',
      differential: 'warning',
      rsync: 'success',
    };
    const labels: Record<string, string> = {
      base: 'Basis',
      differential: 'Differentiell',
      rsync: 'Rsync',
    };
    return (
      <Badge variant={variants[type] || 'default'}>
        {labels[type] || type}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'info' | 'error'> = {
      available: 'success',
      uploading: 'info',
      verifying: 'warning',
      error: 'error',
    };
    const labels: Record<string, string> = {
      available: 'Verfügbar',
      uploading: 'Hochladen',
      verifying: 'Verifizieren',
      error: 'Fehler',
    };
    return (
      <Badge variant={variants[status] || 'default'}>
        {labels[status] || status}
      </Badge>
    );
  };

  const columns: Column<Image>[] = [
    {
      key: 'filename',
      header: 'Dateiname',
      render: (image) => (
        <div>
          <div className="font-medium text-foreground">{image.filename}</div>
          <div className="text-muted-foreground text-xs">{image.path}</div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Typ',
      render: (image) => getTypeBadge(image.type),
    },
    {
      key: 'size',
      header: 'Größe',
      render: (image) => formatBytes(image.size),
    },
    {
      key: 'status',
      header: 'Status',
      render: (image) => getStatusBadge(image.status),
    },
    {
      key: 'createdAt',
      header: 'Erstellt',
      render: (image) => formatDate(image.createdAt),
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (image) => (
        <div className="flex space-x-2">
          <button
            onClick={() => handleVerify(image.id)}
            className="text-primary hover:text-primary/80"
            title="Verifizieren"
            disabled={verifyingId === image.id}
          >
            {verifyingId === image.id ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => handleOpenModal(image)}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Bearbeiten
          </button>
          <button
            onClick={() => setDeleteConfirmImage(image)}
            className="text-red-400 hover:text-red-300 text-sm"
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
          <h1 className="text-2xl font-bold text-foreground">Images</h1>
          <p className="text-muted-foreground">Verwaltung der System-Images</p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <Plus className="h-5 w-5 mr-2" />
          Neues Image
        </Button>
      </div>

      <div className="bg-card shadow-sm rounded-lg overflow-hidden">
        <Table
          columns={columns}
          data={images}
          keyExtractor={(image) => image.id}
          loading={isLoading}
          emptyMessage="Keine Images gefunden"
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingImage ? 'Image bearbeiten' : 'Neues Image'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editingImage && (
            <>
              <Input
                label="Dateiname"
                required
                placeholder="ubuntu22.qcow2"
                value={formData.filename}
                onChange={(e) => setFormData({ ...formData, filename: e.target.value })}
              />
              <Select
                label="Typ"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                options={[
                  { value: 'base', label: 'Basis-Image' },
                  { value: 'differential', label: 'Differentielles Image' },
                  { value: 'rsync', label: 'Rsync-Image' },
                ]}
              />
              <Input
                label="Pfad"
                required
                value={formData.path}
                onChange={(e) => setFormData({ ...formData, path: e.target.value })}
              />
              {formData.type === 'differential' && (
                <Input
                  label="Basis-Image"
                  placeholder="base-image.qcow2"
                  value={formData.backingImage}
                  onChange={(e) => setFormData({ ...formData, backingImage: e.target.value })}
                />
              )}
            </>
          )}
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
              {editingImage ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteConfirmImage}
        onClose={() => setDeleteConfirmImage(null)}
        onConfirm={handleDelete}
        title="Image löschen"
        message={`Möchten Sie das Image "${deleteConfirmImage?.filename}" wirklich löschen?`}
        confirmLabel="Löschen"
        variant="danger"
        loading={isSubmitting}
      />
    </div>
  );
}
