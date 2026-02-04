import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ComputerDesktopIcon,
  BuildingOfficeIcon,
  UsersIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline';
import { statsApi } from '@/api/stats';
import { operationsApi } from '@/api/operations';
import type { DashboardStats, Operation } from '@/types';
import { OperationStatusBadge } from '@/components/ui';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentOperations, setRecentOperations] = useState<Operation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsData, opsData] = await Promise.all([
          statsApi.overview(),
          operationsApi.list({ limit: 5 }),
        ]);
        setStats(statsData);
        setRecentOperations(opsData.data);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  const statCards = [
    {
      name: 'Hosts Online',
      value: stats?.hosts.online || 0,
      total: stats?.hosts.total || 0,
      icon: ComputerDesktopIcon,
      color: 'bg-green-500',
      link: '/hosts',
    },
    {
      name: 'Räume',
      value: stats?.rooms || 0,
      icon: BuildingOfficeIcon,
      color: 'bg-blue-500',
      link: '/rooms',
    },
    {
      name: 'Gruppen',
      value: stats?.groups || 0,
      icon: UsersIcon,
      color: 'bg-purple-500',
      link: '/groups',
    },
    {
      name: 'Images',
      value: stats?.images.total || 0,
      subtitle: formatBytes(stats?.images.totalSize || 0),
      icon: CircleStackIcon,
      color: 'bg-orange-500',
      link: '/images',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Übersicht über das LINBO System</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Link
            key={stat.name}
            to={stat.link}
            className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow"
          >
            <div className="p-5">
              <div className="flex items-center">
                <div className={`flex-shrink-0 ${stat.color} rounded-md p-3`}>
                  <stat.icon className="h-6 w-6 text-white" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      {stat.name}
                    </dt>
                    <dd className="flex items-baseline">
                      <div className="text-2xl font-semibold text-gray-900">
                        {stat.value}
                      </div>
                      {stat.total !== undefined && (
                        <span className="ml-2 text-sm text-gray-500">
                          / {stat.total}
                        </span>
                      )}
                      {stat.subtitle && (
                        <span className="ml-2 text-sm text-gray-500">
                          ({stat.subtitle})
                        </span>
                      )}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Host Status Overview */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Host Status</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Online</span>
              <span className="font-medium text-green-600">
                {stats?.hosts.online || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Offline</span>
              <span className="font-medium text-gray-500">
                {stats?.hosts.offline || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Synchronisiert</span>
              <span className="font-medium text-blue-600">
                {stats?.hosts.syncing || 0}
              </span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full mt-4 overflow-hidden">
              {stats && stats.hosts.total > 0 && (
                <>
                  <div
                    className="h-full bg-green-500 float-left"
                    style={{
                      width: `${(stats.hosts.online / stats.hosts.total) * 100}%`,
                    }}
                  />
                  <div
                    className="h-full bg-blue-500 float-left"
                    style={{
                      width: `${(stats.hosts.syncing / stats.hosts.total) * 100}%`,
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Operations Overview */}
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Operationen Übersicht
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Laufend</span>
              <span className="font-medium text-blue-600">
                {stats?.operations.running || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Abgeschlossen</span>
              <span className="font-medium text-green-600">
                {stats?.operations.completed || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Fehlgeschlagen</span>
              <span className="font-medium text-red-600">
                {stats?.operations.failed || 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Operations */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">
              Letzte Operationen
            </h3>
            <Link
              to="/operations"
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              Alle anzeigen
            </Link>
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {recentOperations.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              Keine Operationen vorhanden
            </div>
          ) : (
            recentOperations.map((op) => (
              <div
                key={op.id}
                className="px-6 py-4 flex items-center justify-between"
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
    </div>
  );
}
