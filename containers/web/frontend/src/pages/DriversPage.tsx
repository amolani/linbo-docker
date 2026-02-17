import { PatchclassManager } from '@/components/drivers/PatchclassManager';

export function DriversPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Windows-Treiber</h1>
        <p className="text-muted-foreground">
          Automatische Treiber-Verteilung fuer Windows-Clients. LINBO erkennt die Hardware jedes PCs
          (Modellname + PCI/USB-IDs) und installiert beim Sync nur die passenden Treiber.
        </p>
      </div>

      <PatchclassManager />
    </div>
  );
}
