import { Link } from 'react-router-dom';
import type { Operation } from '@/types';
import { OperationStatusBadge } from '@/components/ui';

interface RecentOperationsProps {
  operations: Operation[];
  isLoading: boolean;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RecentOperations({ operations, isLoading }: RecentOperationsProps) {
  if (isLoading) {
    return (
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Letzte Operationen</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="px-6 py-4 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-32" />
                  <div className="h-3 bg-gray-200 rounded w-24" />
                </div>
                <div className="h-6 bg-gray-200 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Letzte Operationen</h3>
          <Link
            to="/operations"
            className="text-sm text-primary-600 hover:text-primary-700"
          >
            Alle anzeigen
          </Link>
        </div>
      </div>
      <div className="divide-y divide-gray-200">
        {operations.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            Keine Operationen vorhanden
          </div>
        ) : (
          operations.map((op) => (
            <div
              key={op.id}
              className="px-6 py-4 flex items-center justify-between hover:bg-gray-50"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {op.commands.join(', ')}
                </p>
                <p className="text-sm text-gray-500">
                  {op.targetHosts.length} Host(s) - {formatDate(op.createdAt)}
                </p>
              </div>
              <div className="flex items-center space-x-4">
                {op.status === 'running' && (
                  <div className="w-24">
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-600 transition-all"
                        style={{ width: `${op.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1 text-center">
                      {op.progress}%
                    </p>
                  </div>
                )}
                <OperationStatusBadge status={op.status} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
