import { Link } from 'react-router-dom';
import type { DashboardStats } from '@/types';
import {
  ComputerDesktopIcon,
  BuildingOfficeIcon,
  Cog6ToothIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline';

interface StatsCardsProps {
  stats: DashboardStats | null;
  isLoading: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function StatsCards({ stats, isLoading }: StatsCardsProps) {
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
      name: 'Konfigurationen',
      value: stats?.configs || 0,
      icon: Cog6ToothIcon,
      color: 'bg-purple-500',
      link: '/configs',
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

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-white overflow-hidden shadow rounded-lg animate-pulse"
          >
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-gray-200 rounded-md p-3 w-12 h-12" />
                <div className="ml-5 w-0 flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-20" />
                  <div className="h-6 bg-gray-200 rounded w-12" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
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
  );
}
