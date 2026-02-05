import { useState, useEffect, useCallback } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { operationsApi } from '@/api/operations';
import { Table, Pagination, OperationStatusBadge, Modal, Button, Select } from '@/components/ui';
import { RemoteCommandModal, ScheduledCommandsSection } from '@/components/operations';
import { notify } from '@/stores/notificationStore';
import { useWsEventHandler } from '@/hooks/useWebSocket';
import type { Operation, Session, Column, WsOperationProgressEvent } from '@/types';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(start: string, end?: string): string {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diff = endDate.getTime() - startDate.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function OperationsPage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'operations' | 'scheduled'>('operations');

  const fetchOperations = useCallback(async () => {
    try {
      const data = await operationsApi.list({
        page,
        limit,
        status: statusFilter || undefined,
      });
      setOperations(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (error) {
      notify.error('Fehler beim Laden der Operationen');
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, statusFilter]);

  useEffect(() => {
    fetchOperations();
  }, [fetchOperations]);

  // Listen for real-time updates
  useWsEventHandler<WsOperationProgressEvent>('operation.progress', (event) => {
    const { operationId, progress, stats } = event.payload;
    setOperations((prev) =>
      prev.map((op) =>
        op.id === operationId ? { ...op, progress, stats } : op
      )
    );
  });

  const handleViewDetails = async (operationId: string) => {
    try {
      const operation = await operationsApi.get(operationId);
      setSelectedOperation(operation);
      setIsDetailOpen(true);
    } catch (error) {
      notify.error('Fehler beim Laden der Details');
    }
  };

  const handleCancel = async (operationId: string) => {
    try {
      await operationsApi.cancel(operationId);
      notify.success('Operation abgebrochen');
      fetchOperations();
    } catch (error) {
      notify.error('Fehler beim Abbrechen');
    }
  };

  const columns: Column<Operation>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (op) => (
        <span className="font-mono text-xs">{op.id.substring(0, 8)}</span>
      ),
    },
    {
      key: 'commands',
      header: 'Befehle',
      render: (op) => (
        <span className="font-medium">{op.commands.join(', ')}</span>
      ),
    },
    {
      key: 'hosts',
      header: 'Hosts',
      render: (op) => op.targetHosts.length,
    },
    {
      key: 'status',
      header: 'Status',
      render: (op) => <OperationStatusBadge status={op.status} />,
    },
    {
      key: 'progress',
      header: 'Fortschritt',
      render: (op) => (
        <div className="w-24">
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                op.status === 'failed' ? 'bg-red-500' : 'bg-primary-600'
              }`}
              style={{ width: `${op.progress}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{op.progress}%</span>
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Gestartet',
      render: (op) => (
        <div>
          <div>{formatDate(op.createdAt)}</div>
          {op.startedAt && (
            <div className="text-xs text-gray-500">
              Dauer: {formatDuration(op.startedAt, op.completedAt || undefined)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Aktionen',
      render: (op) => (
        <div className="flex space-x-2">
          <button
            onClick={() => handleViewDetails(op.id)}
            className="text-primary-600 hover:text-primary-900 text-sm"
          >
            Details
          </button>
          {(op.status === 'pending' || op.status === 'running') && (
            <button
              onClick={() => handleCancel(op.id)}
              className="text-red-600 hover:text-red-900 text-sm"
            >
              Abbrechen
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operationen</h1>
          <p className="text-gray-600">Remote-Befehle und Operationsübersicht</p>
        </div>
        <Button onClick={() => setIsRemoteModalOpen(true)}>
          <PlusIcon className="h-5 w-5 mr-2" />
          Remote-Befehl
        </Button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('operations')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'operations'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Operationen
          </button>
          <button
            onClick={() => setActiveTab('scheduled')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'scheduled'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Geplante Befehle
          </button>
        </nav>
      </div>

      {activeTab === 'operations' ? (
        <>
          {/* Filters */}
          <div className="bg-white shadow rounded-lg p-4">
            <div className="flex items-center space-x-4">
              <Select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'Alle Status' },
                  { value: 'pending', label: 'Ausstehend' },
                  { value: 'running', label: 'Läuft' },
                  { value: 'completed', label: 'Abgeschlossen' },
                  { value: 'failed', label: 'Fehlgeschlagen' },
                  { value: 'cancelled', label: 'Abgebrochen' },
                ]}
              />
              <Button variant="secondary" onClick={fetchOperations}>
                Aktualisieren
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <Table
              columns={columns}
              data={operations}
              keyExtractor={(op) => op.id}
              loading={isLoading}
              emptyMessage="Keine Operationen gefunden"
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
        </>
      ) : (
        <ScheduledCommandsSection />
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title="Operation Details"
        size="lg"
      >
        {selectedOperation && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">Status</dt>
                <dd className="mt-1">
                  <OperationStatusBadge status={selectedOperation.status} />
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Fortschritt</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {selectedOperation.progress}%
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Befehle</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {selectedOperation.commands.join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Gestartet</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {formatDate(selectedOperation.createdAt)}
                </dd>
              </div>
            </div>

            {selectedOperation.stats && (
              <div className="border-t pt-4">
                <h4 className="font-medium text-gray-900 mb-3">Statistiken</h4>
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div className="bg-gray-50 rounded p-3">
                    <div className="text-2xl font-bold text-gray-900">
                      {selectedOperation.stats.total}
                    </div>
                    <div className="text-xs text-gray-500">Gesamt</div>
                  </div>
                  <div className="bg-blue-50 rounded p-3">
                    <div className="text-2xl font-bold text-blue-600">
                      {selectedOperation.stats.inProgress}
                    </div>
                    <div className="text-xs text-gray-500">Laufend</div>
                  </div>
                  <div className="bg-green-50 rounded p-3">
                    <div className="text-2xl font-bold text-green-600">
                      {selectedOperation.stats.completed}
                    </div>
                    <div className="text-xs text-gray-500">Abgeschlossen</div>
                  </div>
                  <div className="bg-red-50 rounded p-3">
                    <div className="text-2xl font-bold text-red-600">
                      {selectedOperation.stats.failed}
                    </div>
                    <div className="text-xs text-gray-500">Fehlgeschlagen</div>
                  </div>
                </div>
              </div>
            )}

            {selectedOperation.sessions && selectedOperation.sessions.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="font-medium text-gray-900 mb-3">Sessions</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {selectedOperation.sessions.map((session: Session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded"
                    >
                      <div>
                        <span className="font-medium">
                          {session.hostname || session.hostId?.substring(0, 8)}
                        </span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className="w-20">
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary-600"
                              style={{ width: `${session.progress}%` }}
                            />
                          </div>
                        </div>
                        <OperationStatusBadge status={session.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-4 border-t">
              <Button variant="secondary" onClick={() => setIsDetailOpen(false)}>
                Schließen
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Remote Command Modal */}
      <RemoteCommandModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
        onSuccess={() => {
          fetchOperations();
          if (activeTab === 'scheduled') {
            // Will auto-refresh via the ScheduledCommandsSection
          }
        }}
      />
    </div>
  );
}
