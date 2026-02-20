import { Link } from 'react-router-dom';
import type { DashboardStats } from '@/types';
import {
  Monitor,
  Building2,
  Settings,
  HardDrive,
} from 'lucide-react';

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
      icon: Monitor,
      color: 'bg-ciGreen',
      link: '/hosts',
    },
    {
      name: 'Räume',
      value: stats?.rooms || 0,
      icon: Building2,
      color: 'bg-primary',
      link: '/rooms',
    },
    {
      name: 'Konfigurationen',
      value: stats?.configs || 0,
      icon: Settings,
      color: 'bg-purple-500',
      link: '/configs',
    },
    {
      name: 'Images',
      value: stats?.images.total || 0,
      subtitle: formatBytes(stats?.images.totalSize || 0),
      icon: HardDrive,
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
            className="bg-card overflow-hidden shadow-sm rounded-lg animate-pulse"
          >
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-border rounded-md p-3 w-12 h-12" />
                <div className="ml-5 w-0 flex-1 space-y-2">
                  <div className="h-4 bg-border rounded w-20" />
                  <div className="h-6 bg-border rounded w-12" />
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
          className="bg-card overflow-hidden shadow-sm rounded-lg hover:shadow-md transition-shadow"
        >
          <div className="p-5">
            <div className="flex items-center">
              <div className={`flex-shrink-0 ${stat.color} rounded-md p-3`}>
                <stat.icon className="h-6 w-6 text-white" aria-hidden="true" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-muted-foreground truncate">
                    {stat.name}
                  </dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-foreground">
                      {stat.value}
                    </div>
                    {stat.total !== undefined && (
                      <span className="ml-2 text-sm text-muted-foreground">
                        / {stat.total}
                      </span>
                    )}
                    {stat.subtitle && (
                      <span className="ml-2 text-sm text-muted-foreground">
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
