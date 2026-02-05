import { Input, Select } from '@/components/ui';
import type { LinboSettings } from '@/types';

interface LinboSettingsFormProps {
  settings: LinboSettings;
  onChange: (settings: LinboSettings) => void;
  serverIp?: string;
}

export function LinboSettingsForm({ settings, onChange, serverIp = '10.0.0.1' }: LinboSettingsFormProps) {
  const handleChange = (field: keyof LinboSettings, value: string | number | boolean) => {
    onChange({ ...settings, [field]: value });
  };

  const downloadTypeOptions = [
    { value: 'rsync', label: 'Rsync' },
    { value: 'torrent', label: 'Torrent' },
    { value: 'multicast', label: 'Multicast' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Server"
          value={settings.server || serverIp}
          onChange={(e) => handleChange('server', e.target.value)}
          helperText="IP-Adresse des LINBO-Servers"
        />
        <Input
          label="Cache-Partition"
          value={settings.cache || '/dev/sda4'}
          onChange={(e) => handleChange('cache', e.target.value)}
          helperText="z.B. /dev/sda4 oder /dev/nvme0n1p4"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Gruppenname"
          value={settings.group || ''}
          onChange={(e) => handleChange('group', e.target.value)}
          helperText="Name der Hardwaregruppe"
        />
        <Select
          label="Download-Typ"
          value={settings.downloadType || 'rsync'}
          onChange={(e) => handleChange('downloadType', e.target.value as 'rsync' | 'torrent' | 'multicast')}
          options={downloadTypeOptions}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Root-Timeout (Sek.)"
          type="number"
          value={settings.roottimeout || 600}
          onChange={(e) => handleChange('roottimeout', parseInt(e.target.value) || 600)}
          helperText="Timeout beim Booten"
        />
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Automatische Aktionen</h4>
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
              checked={settings.autopartition || false}
              onChange={(e) => handleChange('autopartition', e.target.checked)}
            />
            <span className="text-sm text-gray-700">Automatisch partitionieren</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
              checked={settings.autoformat || false}
              onChange={(e) => handleChange('autoformat', e.target.checked)}
            />
            <span className="text-sm text-gray-700">Automatisch formatieren</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
              checked={settings.autoinitcache || false}
              onChange={(e) => handleChange('autoinitcache', e.target.checked)}
            />
            <span className="text-sm text-gray-700">Cache automatisch initialisieren</span>
          </label>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Darstellung (Optional)</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            label="Hintergrundfarbe"
            type="color"
            value={settings.backgroundfontcolor || '#000000'}
            onChange={(e) => handleChange('backgroundfontcolor', e.target.value)}
          />
          <Input
            label="Stdout-Farbe"
            type="color"
            value={settings.consolefontcolorsstdout || '#ffffff'}
            onChange={(e) => handleChange('consolefontcolorsstdout', e.target.value)}
          />
          <Input
            label="Stderr-Farbe"
            type="color"
            value={settings.consolefontcolorstderr || '#ff0000'}
            onChange={(e) => handleChange('consolefontcolorstderr', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
