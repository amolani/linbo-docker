import { useState, useEffect } from 'react';
import { ArrowDownTrayIcon, EyeIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { Select, Button, Badge } from '@/components/ui';
import { dhcpApi } from '@/api/dhcp';
import { configsApi } from '@/api/configs';
import { roomsApi } from '@/api/rooms';
import { notify } from '@/stores/notificationStore';
import { DhcpPreviewModal } from './DhcpPreviewModal';
import type { DhcpFormat, DhcpSummary, Config, Room } from '@/types';

const formatOptions = [
  { value: 'isc-dhcp', label: 'ISC DHCP (dhcpd.conf)' },
  { value: 'dnsmasq', label: 'dnsmasq (Full)' },
  { value: 'dnsmasq-proxy', label: 'dnsmasq (Proxy-DHCP)' },
];

export function DhcpExportCard() {
  const [format, setFormat] = useState<DhcpFormat>('isc-dhcp');
  const [configId, setConfigId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [pxeOnly, setPxeOnly] = useState(false);
  const [summary, setSummary] = useState<DhcpSummary | null>(null);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [previewContent, setPreviewContent] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [summaryData, configData, roomData] = await Promise.all([
        dhcpApi.getSummary(),
        configsApi.list(),
        roomsApi.list(),
      ]);
      setSummary(summaryData);
      setConfigs(configData);
      setRooms(roomData);
    } catch {
      notify.error('Fehler beim Laden der DHCP-Daten');
    }
  };

  const handlePreview = async () => {
    setIsLoadingPreview(true);
    try {
      const content = await dhcpApi.previewConfig(format, { configId: configId || undefined, roomId: roomId || undefined, pxeOnly });
      setPreviewContent(content);
      setIsPreviewOpen(true);
      // Refresh summary after export (updates lastExportedAt)
      const newSummary = await dhcpApi.getSummary();
      setSummary(newSummary);
    } catch {
      notify.error('Fehler beim Erstellen der Vorschau');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const blob = await dhcpApi.exportConfig(format, { configId: configId || undefined, roomId: roomId || undefined, pxeOnly });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const filenames: Record<DhcpFormat, string> = {
        'isc-dhcp': 'dhcpd-linbo.conf',
        'dnsmasq': 'dnsmasq-linbo.conf',
        'dnsmasq-proxy': 'dnsmasq-proxy-linbo.conf',
      };
      a.download = filenames[format];
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      // Refresh summary
      const newSummary = await dhcpApi.getSummary();
      setSummary(newSummary);
      notify.success('DHCP-Config heruntergeladen');
    } catch {
      notify.error('Fehler beim Download');
    } finally {
      setIsDownloading(false);
    }
  };

  const configOptions = [
    { value: '', label: 'Alle Konfigurationen' },
    ...configs.map((c) => ({ value: c.id, label: c.name })),
  ];

  const roomOptions = [
    { value: '', label: 'Alle Raeume' },
    ...rooms.map((r) => ({ value: r.id, label: r.name })),
  ];

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-gray-900">DHCP Export</h2>
        <button onClick={loadData} className="text-gray-400 hover:text-gray-600">
          <ArrowPathIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Zusammenfassung</span>
            {summary.isStale ? (
              <Badge variant="warning" size="sm">Veraltet</Badge>
            ) : summary.lastExportedAt ? (
              <Badge variant="success" size="sm">Aktuell</Badge>
            ) : (
              <Badge variant="default" size="sm">Nie exportiert</Badge>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div>
              <span className="text-gray-500">Hosts gesamt:</span>{' '}
              <span className="font-medium">{summary.totalHosts}</span>
            </div>
            <div>
              <span className="text-gray-500">PXE-Hosts:</span>{' '}
              <span className="font-medium">{summary.pxeHosts}</span>
            </div>
            <div>
              <span className="text-gray-500">Statische IP:</span>{' '}
              <span className="font-medium">{summary.staticIpHosts}</span>
            </div>
            <div>
              <span className="text-gray-500">DHCP-IP:</span>{' '}
              <span className="font-medium">{summary.dhcpIpHosts}</span>
            </div>
          </div>
          {summary.configCounts && Object.keys(summary.configCounts).length > 0 && (
            <div className="mt-2 text-sm text-gray-500">
              Configs:{' '}
              {Object.entries(summary.configCounts)
                .map(([name, count]) => `${name} (${count})`)
                .join(', ')}
            </div>
          )}
          {summary.lastExportedAt && (
            <div className="mt-1 text-xs text-gray-400">
              Letzter Export: {new Date(summary.lastExportedAt).toLocaleString('de-DE')}
            </div>
          )}
        </div>
      )}

      {/* Format & Filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Select
          label="Format"
          options={formatOptions}
          value={format}
          onChange={(e) => setFormat(e.target.value as DhcpFormat)}
        />
        <Select
          label="Config-Filter"
          options={configOptions}
          value={configId}
          onChange={(e) => setConfigId(e.target.value)}
        />
        <Select
          label="Raum-Filter"
          options={roomOptions}
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        />
        <div className="flex items-end pb-1">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pxeOnly}
              onChange={(e) => setPxeOnly(e.target.checked)}
              className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Nur PXE-Hosts</span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex space-x-3">
        <Button onClick={handlePreview} loading={isLoadingPreview} variant="secondary">
          <EyeIcon className="h-4 w-4 mr-2" />
          Vorschau
        </Button>
        <Button onClick={handleDownload} loading={isDownloading}>
          <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
          Download
        </Button>
      </div>

      {/* Preview Modal */}
      <DhcpPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        content={previewContent}
        title={`DHCP Config - ${formatOptions.find((f) => f.value === format)?.label}`}
      />
    </div>
  );
}
