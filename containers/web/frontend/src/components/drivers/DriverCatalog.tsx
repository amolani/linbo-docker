import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Cable, Monitor, Volume2, Cpu, HardDrive,
  Wifi, Usb, Bluetooth, X, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { patchclassApi } from '@/api/patchclass';
import type { CatalogEntry, CatalogCategory, CatalogVendor, CatalogDevice, CatalogSearchResult, DeviceRule } from '@/types';
import { notify } from '@/stores/notificationStore';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  nic: <Cable className="h-4 w-4" />,
  gpu: <Monitor className="h-4 w-4" />,
  audio: <Volume2 className="h-4 w-4" />,
  chipset: <Cpu className="h-4 w-4" />,
  storage: <HardDrive className="h-4 w-4" />,
  wifi: <Wifi className="h-4 w-4" />,
  usb: <Usb className="h-4 w-4" />,
  bluetooth: <Bluetooth className="h-4 w-4" />,
};

interface DriverCatalogProps {
  pcName: string;
  existingRules: DeviceRule[];
  availableSets: string[];
  onRuleAdded: () => void;
}

export function DriverCatalog({ pcName, existingRules, availableSets, onRuleAdded }: DriverCatalogProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CatalogSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCatalog = useCallback(async () => {
    try {
      const data = await patchclassApi.getCatalog();
      setCatalog(data.catalog);
      setCategories(data.categories);
      if (data.categories.length > 0 && !activeTab) {
        setActiveTab(data.categories[0].id);
      }
    } catch {
      notify.error('Fehler beim Laden des Katalogs');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await patchclassApi.searchCatalog(q);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const isDeviceConfigured = (vendor: string, device: string): boolean => {
    return existingRules.some(
      r => r.match.vendor.toLowerCase() === vendor.toLowerCase()
        && r.match.device.toLowerCase() === device.toLowerCase()
    );
  };

  const handleAddRule = async (dev: CatalogDevice, vendor: CatalogVendor, driverSet?: string) => {
    const drivers = driverSet ? [driverSet] : (availableSets.length > 0 ? [availableSets[0]] : []);
    if (drivers.length === 0) {
      notify.error('Erstellen Sie zuerst ein Treiber-Set');
      return;
    }

    try {
      await patchclassApi.addDeviceRule(pcName, {
        name: `${vendor.name} ${dev.name}`,
        match: {
          type: vendor.category === 'usb' || vendor.category === 'bluetooth' ? 'usb' : 'pci',
          vendor: dev.vendor,
          device: dev.device,
        },
        drivers,
      });
      notify.success(`Regel fuer "${dev.name}" hinzugefuegt`);
      onRuleAdded();
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      if (msg.includes('already exists')) {
        notify.error('Regel existiert bereits');
      } else {
        notify.error('Fehler', msg);
      }
    }
  };

  const activeCatalog = catalog.find(c => c.category.id === activeTab);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Katalog wird geladen...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Suche nach Name oder PCI-ID (z.B. 8086:15bb)"
          className="w-full pl-9 pr-8 py-1.5 text-sm bg-background border border-border rounded-md"
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); setSearchResults([]); }}
            className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search Results */}
      {searchQuery.length >= 2 && (
        <div className="border border-border rounded-md">
          {searching ? (
            <div className="p-3 text-sm text-muted-foreground">Suche...</div>
          ) : searchResults.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">Keine Ergebnisse</div>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-border">
              {searchResults.map((r, i) => (
                <DeviceRow
                  key={`${r.device.vendor}:${r.device.device}:${i}`}
                  device={r.device}
                  vendor={r.vendor}
                  configured={isDeviceConfigured(r.device.vendor, r.device.device)}
                  onAdd={handleAddRule}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category Tabs */}
      {!searchQuery && (
        <>
          <div className="flex flex-wrap gap-1">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveTab(cat.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors',
                  activeTab === cat.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-accent'
                )}
              >
                {CATEGORY_ICONS[cat.id] || <Cpu className="h-3.5 w-3.5" />}
                {cat.name}
              </button>
            ))}
          </div>

          {/* Vendor Cards */}
          {activeCatalog && (
            <div className="space-y-1">
              {activeCatalog.vendors.map(vendor => (
                <div key={vendor.id} className="border border-border rounded-md">
                  <button
                    onClick={() => setExpandedVendor(expandedVendor === vendor.id ? null : vendor.id)}
                    className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-accent/50 rounded-md"
                  >
                    <div>
                      <span className="text-sm font-medium">{vendor.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {vendor.devices.length} Geraete
                      </span>
                    </div>
                    <ChevronRight className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      expandedVendor === vendor.id && 'rotate-90'
                    )} />
                  </button>

                  {expandedVendor === vendor.id && (
                    <div className="border-t border-border divide-y divide-border">
                      {vendor.devices.map(dev => (
                        <DeviceRow
                          key={`${dev.vendor}:${dev.device}`}
                          device={dev}
                          vendor={vendor}
                          configured={isDeviceConfigured(dev.vendor, dev.device)}
                          onAdd={handleAddRule}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeviceRow({ device, vendor, configured, onAdd }: {
  device: CatalogDevice;
  vendor: CatalogVendor;
  configured: boolean;
  onAdd: (dev: CatalogDevice, vendor: CatalogVendor, set?: string) => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <div className="flex-1 min-w-0">
        <span className="text-sm">{device.name}</span>
        <span className="ml-2 text-xs text-muted-foreground font-mono">
          {device.vendor}:{device.device}
        </span>
        {device.suggestedSet && (
          <span className="ml-2 text-xs text-blue-500">{device.suggestedSet}</span>
        )}
      </div>
      {configured ? (
        <span className="text-xs text-green-500 px-2 py-0.5 bg-green-500/10 rounded">Konfiguriert</span>
      ) : (
        <button
          onClick={() => onAdd(device, vendor, device.suggestedSet)}
          className="flex items-center gap-1 px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          <Plus className="h-3 w-3" /> Regel
        </button>
      )}
    </div>
  );
}
