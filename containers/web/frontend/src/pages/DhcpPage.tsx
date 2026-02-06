import { NetworkSettingsForm, DhcpExportCard } from '@/components/dhcp';

export function DhcpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DHCP</h1>
        <p className="text-gray-600">Netzwerk-Einstellungen und DHCP-Konfiguration exportieren</p>
      </div>

      <NetworkSettingsForm />
      <DhcpExportCard />
    </div>
  );
}
