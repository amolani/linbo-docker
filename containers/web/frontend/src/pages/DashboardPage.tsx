import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Monitor,
  Building2,
  Settings,
  HardDrive,
  Cpu,
  Loader2,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { statsApi } from '@/api/stats';
import { syncApi } from '@/api/sync';
import { operationsApi } from '@/api/operations';
import { systemApi } from '@/api/system';
import { useDataInvalidation } from '@/hooks/useDataInvalidation';
import { useServerConfigStore } from '@/stores/serverConfigStore';
import type { DashboardStats, Operation, KernelStatus } from '@/types';
import { OperationStatusBadge, Badge } from '@/components/ui';

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
  const { isSyncMode, modeFetched, fetchMode } = useServerConfigStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentOperations, setRecentOperations] = useState<Operation[]>([]);
  const [kernelStatus, setKernelStatus] = useState<KernelStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [syncHealthy, setSyncHealthy] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  const fetchData = useCallback(async () => {
    try {
      if (isSyncMode) {
        const syncStats = await syncApi.getStats();
        setStats({
          hosts: {
            total: syncStats.hosts.total,
            online: syncStats.hosts.online,
            offline: syncStats.hosts.offline,
            syncing: 0,
          },
          configs: syncStats.configs,
          rooms: 0,
          images: { total: 0, totalSize: 0 },
          operations: { total: 0, running: 0, completed: 0, failed: 0 },
        });
        setSyncHealthy(syncStats.lmnApiHealthy);
        setLastSyncAt(syncStats.sync.lastSyncAt);
        setRecentOperations([]);
      } else {
        const [statsData, opsData, kernelData] = await Promise.all([
          statsApi.overview(),
          operationsApi.list({ limit: 5 }),
          systemApi.getKernelStatus().catch(() => null),
        ]);
        setStats(statsData);
        setRecentOperations(opsData.data);
        setKernelStatus(kernelData);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isSyncMode]);

  // Reactive: refetch dashboard on any entity change
  useDataInvalidation(
    isSyncMode ? ['sync', 'host', 'config'] : ['host', 'room', 'config', 'image', 'operation'],
    fetchData,
    { showToast: false, debounceMs: 1000 },
  );

  useEffect(() => {
    if (modeFetched) {
      fetchData();
    }
  }, [fetchData, modeFetched]);

  if (!modeFetched || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  // --- Sync Mode Dashboard ---
  if (isSyncMode) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Uebersicht ueber das LINBO System</p>
        </div>

        {/* Sync Status Banner */}
        <Link
          to="/sync"
          className="block bg-card overflow-hidden shadow-sm rounded-lg hover:shadow-md transition-shadow border border-primary/30"
        >
          <div className="p-5 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-primary rounded-md p-3">
                <RefreshCw className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-muted-foreground">LMN Server Sync</h3>
                  <Badge variant="info" size="sm">Sync-Modus</Badge>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  {syncHealthy ? (
                    <span className="flex items-center gap-1 text-sm text-ciGreen">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Verbunden
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-destructive">
                      <XCircle className="h-3.5 w-3.5" />
                      Nicht erreichbar
                    </span>
                  )}
                  {lastSyncAt && (
                    <span className="text-sm text-muted-foreground">
                      Letzter Sync: {formatDate(lastSyncAt)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </Link>

        {/* Stat Cards - sync mode: only Hosts + Configs */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-2">
          <Link
            to="/hosts"
            className="bg-card overflow-hidden shadow-sm rounded-lg hover:shadow-md transition-shadow"
          >
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-ciGreen rounded-md p-3">
                  <Monitor className="h-6 w-6 text-white" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-muted-foreground truncate">
                      Hosts Online
                    </dt>
                    <dd className="flex items-baseline">
                      <div className="text-2xl font-semibold text-foreground">
                        {stats?.hosts.online || 0}
                      </div>
                      <span className="ml-2 text-sm text-muted-foreground">
                        / {stats?.hosts.total || 0}
                      </span>
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </Link>
          <Link
            to="/configs"
            className="bg-card overflow-hidden shadow-sm rounded-lg hover:shadow-md transition-shadow"
          >
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-purple-500 rounded-md p-3">
                  <Settings className="h-6 w-6 text-white" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-muted-foreground truncate">
                      Konfigurationen
                    </dt>
                    <dd className="flex items-baseline">
                      <div className="text-2xl font-semibold text-foreground">
                        {stats?.configs || 0}
                      </div>
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </Link>
        </div>

        {/* Host Status Overview */}
        <div className="bg-card shadow-sm rounded-lg p-6">
          <h3 className="text-lg font-medium text-foreground mb-4">Host Status</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Online</span>
              <span className="font-medium text-ciGreen">
                {stats?.hosts.online || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Offline</span>
              <span className="font-medium text-muted-foreground">
                {stats?.hosts.offline || 0}
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full mt-4 overflow-hidden">
              {stats && stats.hosts.total > 0 && (
                <div
                  className="h-full bg-ciGreen float-left"
                  style={{
                    width: `${(stats.hosts.online / stats.hosts.total) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Kernel Status Card */}
        {kernelStatus && (
          <Link
            to="/kernel"
            className="block bg-card shadow-sm rounded-lg hover:shadow-md transition-shadow"
          >
            <div className="p-5 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="bg-cyan-500 rounded-md p-3">
                  <Cpu className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground">LINBO Kernel</h3>
                  <div className="flex items-center space-x-2">
                    <span className="text-lg font-semibold text-foreground capitalize">
                      {kernelStatus.activeVariant}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      v{kernelStatus.activeVersion}
                    </span>
                    <span className="inline-block w-2 h-2 rounded-full bg-ciGreen" />
                  </div>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </Link>
        )}
      </div>
    );
  }

  // --- Standalone Mode Dashboard (original) ---
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
      name: 'Raeume',
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Uebersicht ueber das LINBO System</p>
      </div>

      {/* Stats Cards */}
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

      {/* Host Status Overview */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="bg-card shadow-sm rounded-lg p-6">
          <h3 className="text-lg font-medium text-foreground mb-4">Host Status</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Online</span>
              <span className="font-medium text-ciGreen">
                {stats?.hosts.online || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Offline</span>
              <span className="font-medium text-muted-foreground">
                {stats?.hosts.offline || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Synchronisiert</span>
              <span className="font-medium text-primary">
                {stats?.hosts.syncing || 0}
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full mt-4 overflow-hidden">
              {stats && stats.hosts.total > 0 && (
                <>
                  <div
                    className="h-full bg-ciGreen float-left"
                    style={{
                      width: `${(stats.hosts.online / stats.hosts.total) * 100}%`,
                    }}
                  />
                  <div
                    className="h-full bg-primary float-left"
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
        <div className="bg-card shadow-sm rounded-lg p-6">
          <h3 className="text-lg font-medium text-foreground mb-4">
            Operationen Uebersicht
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Laufend</span>
              <span className="font-medium text-primary">
                {stats?.operations.running || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Abgeschlossen</span>
              <span className="font-medium text-ciGreen">
                {stats?.operations.completed || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Fehlgeschlagen</span>
              <span className="font-medium text-destructive">
                {stats?.operations.failed || 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Kernel Status Card */}
      {kernelStatus && (
        <Link
          to="/kernel"
          className="block bg-card shadow-sm rounded-lg hover:shadow-md transition-shadow"
        >
          <div className="p-5 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-cyan-500 rounded-md p-3">
                <Cpu className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">LINBO Kernel</h3>
                <div className="flex items-center space-x-2">
                  {kernelStatus.rebuildRunning ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      <span className="text-sm text-primary">Rebuilding...</span>
                    </>
                  ) : (
                    <>
                      <span className="text-lg font-semibold text-foreground capitalize">
                        {kernelStatus.activeVariant}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        v{kernelStatus.activeVersion}
                      </span>
                      <span className="inline-block w-2 h-2 rounded-full bg-ciGreen" />
                    </>
                  )}
                </div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>
        </Link>
      )}

      {/* Recent Operations */}
      <div className="bg-card shadow-sm rounded-lg">
        <div className="px-6 py-4 border-b border-border">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-foreground">
              Letzte Operationen
            </h3>
            <Link
              to="/operations"
              className="text-sm text-primary hover:text-primary/80"
            >
              Alle anzeigen
            </Link>
          </div>
        </div>
        <div className="divide-y divide-border">
          {recentOperations.length === 0 ? (
            <div className="px-6 py-8 text-center text-muted-foreground">
              Keine Operationen vorhanden
            </div>
          ) : (
            recentOperations.map((op) => (
              <div
                key={op.id}
                className="px-6 py-4 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {op.commands.join(', ')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {op.targetHosts.length} Host(s) - {formatDate(op.createdAt)}
                  </p>
                </div>
                <div className="flex items-center space-x-4">
                  {op.status === 'running' && (
                    <div className="w-24">
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${op.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 text-center">
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
