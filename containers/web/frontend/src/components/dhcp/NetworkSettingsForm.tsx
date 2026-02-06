import { useState, useEffect } from 'react';
import { Input, Button } from '@/components/ui';
import { dhcpApi } from '@/api/dhcp';
import { notify } from '@/stores/notificationStore';
import type { NetworkSettings } from '@/types';

export function NetworkSettingsForm() {
  const [settings, setSettings] = useState<NetworkSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await dhcpApi.getNetworkSettings();
      setSettings(data);
    } catch {
      notify.error('Fehler beim Laden der Netzwerk-Einstellungen');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setIsSaving(true);

    try {
      const { lastExportedAt, updatedAt, ...settingsToSave } = settings;
      const saved = await dhcpApi.saveNetworkSettings(settingsToSave);
      setSettings(saved);
      notify.success('Netzwerk-Einstellungen gespeichert');
    } catch {
      notify.error('Fehler beim Speichern');
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = (field: keyof NetworkSettings, value: string | number) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  if (isLoading) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Netzwerk-Einstellungen</h2>
      <form onSubmit={handleSave}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="DHCP-Server IP"
            value={settings.dhcpServerIp}
            onChange={(e) => updateField('dhcpServerIp', e.target.value)}
            helperText="IP des DHCP-Servers (server-identifier), z.B. 10.0.0.11"
          />
          <Input
            label="TFTP-Server IP"
            value={settings.serverIp}
            onChange={(e) => updateField('serverIp', e.target.value)}
            helperText="IP des TFTP/LINBO-Servers (next-server), z.B. 10.0.0.13"
          />
          <Input
            label="Subnet"
            value={settings.subnet}
            onChange={(e) => updateField('subnet', e.target.value)}
          />
          <Input
            label="Netmask"
            value={settings.netmask}
            onChange={(e) => updateField('netmask', e.target.value)}
          />
          <Input
            label="Gateway"
            value={settings.gateway}
            onChange={(e) => updateField('gateway', e.target.value)}
          />
          <Input
            label="DNS-Server"
            value={settings.dns}
            onChange={(e) => updateField('dns', e.target.value)}
          />
          <Input
            label="Domain"
            value={settings.domain}
            onChange={(e) => updateField('domain', e.target.value)}
          />
          <Input
            label="DHCP Range Start"
            value={settings.dhcpRangeStart}
            onChange={(e) => updateField('dhcpRangeStart', e.target.value)}
            placeholder="z.B. 10.0.100.1"
            helperText="Leer lassen fuer reine Reservierungen"
          />
          <Input
            label="DHCP Range Ende"
            value={settings.dhcpRangeEnd}
            onChange={(e) => updateField('dhcpRangeEnd', e.target.value)}
            placeholder="z.B. 10.0.100.254"
          />
          <Input
            label="Default Lease Time (Sek.)"
            type="number"
            value={settings.defaultLeaseTime}
            onChange={(e) => updateField('defaultLeaseTime', parseInt(e.target.value) || 86400)}
          />
          <Input
            label="Max Lease Time (Sek.)"
            type="number"
            value={settings.maxLeaseTime}
            onChange={(e) => updateField('maxLeaseTime', parseInt(e.target.value) || 172800)}
          />
        </div>
        <div className="flex justify-end mt-6">
          <Button type="submit" loading={isSaving}>
            Speichern
          </Button>
        </div>
      </form>
    </div>
  );
}
