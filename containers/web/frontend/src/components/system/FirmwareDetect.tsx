import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Plus,
  Wifi,
  Monitor,
  Cable,
  Bluetooth,
  Package,
  RefreshCw,
} from 'lucide-react';
import { systemApi } from '@/api/system';
import { hostsApi } from '@/api/hosts';
import type { FirmwareDetectionResult, DetectedDriver } from '@/api/system';
import type { Host } from '@/types';

const CATEGORY_ICONS: Record<string, typeof Wifi> = {
  wifi: Wifi,
  ethernet: Cable,
  gpu: Monitor,
  bluetooth: Bluetooth,
};

interface FirmwareDetectProps {
  configuredEntries: Set<string>;
  onEntriesAdded: () => void;
}

export function FirmwareDetect({ configuredEntries, onEntriesAdded }: FirmwareDetectProps) {
  const [hostIp, setHostIp] = useState('');
  const [onlineHosts, setOnlineHosts] = useState<Host[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<FirmwareDetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingEntries, setAddingEntries] = useState<Set<string>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);

  const loadOnlineHosts = useCallback(async () => {
    setLoadingHosts(true);
    try {
      const res = await hostsApi.list({ limit: 200, filters: { status: 'online' } });
      setOnlineHosts(res.data);
    } catch {
      setOnlineHosts([]);
    } finally {
      setLoadingHosts(false);
    }
  }, []);

  useEffect(() => {
    loadOnlineHosts();
  }, [loadOnlineHosts]);

  const handleScan = async () => {
    if (!hostIp.trim()) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const data = await systemApi.detectFirmware(hostIp.trim());
      setResult(data);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
        setError(axiosErr.response?.data?.error?.message || 'Scan fehlgeschlagen');
      } else {
        setError(err instanceof Error ? err.message : 'Scan fehlgeschlagen');
      }
    } finally {
      setScanning(false);
    }
  };

  const handleAddSingle = async (entry: string) => {
    setAddingEntries(prev => new Set(prev).add(entry));
    try {
      await systemApi.addFirmwareEntry(entry);
      onEntriesAdded();
      // Re-scan to update result state
      if (hostIp.trim()) {
        const data = await systemApi.detectFirmware(hostIp.trim());
        setResult(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Hinzufuegen fehlgeschlagen';
      setError(msg);
    } finally {
      setAddingEntries(prev => {
        const next = new Set(prev);
        next.delete(entry);
        return next;
      });
    }
  };

  const handleBulkAdd = async () => {
    if (!result) return;
    const entriesToAdd: string[] = [];
    const seen = new Set<string>();
    for (const driver of result.detectedDrivers) {
      for (const file of driver.firmwareFiles) {
        if (!file.alreadyConfigured && file.availableOnDisk && !seen.has(file.suggestedEntry)) {
          seen.add(file.suggestedEntry);
          entriesToAdd.push(file.suggestedEntry);
        }
      }
    }
    if (entriesToAdd.length === 0) return;

    setBulkAdding(true);
    try {
      await systemApi.bulkAddFirmwareEntries(entriesToAdd);
      onEntriesAdded();
      // Re-scan
      if (hostIp.trim()) {
        const data = await systemApi.detectFirmware(hostIp.trim());
        setResult(data);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bulk-Add fehlgeschlagen';
      setError(msg);
    } finally {
      setBulkAdding(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Scanner Header */}
      <div className="flex items-start space-x-2">
        <Search className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-200 mb-2">
            Fehlende Firmware automatisch erkennen
          </p>

          {/* IP Input + Host Picker */}
          <div className="flex items-center space-x-2 mb-2">
            <input
              type="text"
              placeholder="Client-IP (z.B. 10.0.152.111)"
              value={hostIp}
              onChange={(e) => setHostIp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              className="flex-1 px-3 py-1.5 bg-black/30 border border-amber-500/30 rounded text-sm text-amber-100 placeholder:text-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            />
            {onlineHosts.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) setHostIp(e.target.value);
                }}
                className="px-2 py-1.5 bg-black/30 border border-amber-500/30 rounded text-xs text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              >
                <option value="">
                  {loadingHosts ? 'Lade...' : `Online (${onlineHosts.length})`}
                </option>
                {onlineHosts.map(h => (
                  <option key={h.id} value={h.ipAddress || ''}>
                    {h.hostname} ({h.ipAddress})
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={handleScan}
              disabled={!hostIp.trim() || scanning}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 rounded transition-colors disabled:opacity-50"
            >
              {scanning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              <span>Scannen</span>
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center space-x-1.5 text-xs text-red-400 mb-2">
              <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{error}</span>
              <button
                onClick={handleScan}
                className="ml-1 underline hover:no-underline"
              >
                Erneut versuchen
              </button>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-2">
              {/* Summary */}
              {result.summary.totalMissingFiles === 0 ? (
                <div className="flex items-center space-x-1.5 text-xs text-green-400">
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>Keine fehlende Firmware erkannt.</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-amber-300">
                      {result.summary.totalMissingFiles} fehlende Firmware-Datei{result.summary.totalMissingFiles !== 1 ? 'en' : ''}
                      {result.summary.availableToAdd > 0 && (
                        <>, <span className="text-green-400">{result.summary.availableToAdd} koennen hinzugefuegt werden</span></>
                      )}
                      {result.summary.alreadyConfigured > 0 && (
                        <>, {result.summary.alreadyConfigured} bereits konfiguriert</>
                      )}
                    </span>
                    {result.summary.availableToAdd > 0 && (
                      <button
                        onClick={handleBulkAdd}
                        disabled={bulkAdding}
                        className="flex items-center space-x-1 px-2 py-1 text-xs bg-green-500/20 hover:bg-green-500/30 text-green-300 rounded transition-colors disabled:opacity-50"
                      >
                        {bulkAdding ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        <span>Alle hinzufuegen</span>
                      </button>
                    )}
                  </div>

                  {/* Drivers */}
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {result.detectedDrivers.map((driver) => (
                      <DriverRow
                        key={driver.driver}
                        driver={driver}
                        addingEntries={addingEntries}
                        configuredEntries={configuredEntries}
                        onAdd={handleAddSingle}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Rescan */}
              <button
                onClick={handleScan}
                disabled={scanning}
                className="flex items-center space-x-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
              >
                <RefreshCw className={`h-3 w-3 ${scanning ? 'animate-spin' : ''}`} />
                <span>Erneut scannen</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DriverRow({
  driver,
  addingEntries,
  configuredEntries,
  onAdd,
}: {
  driver: DetectedDriver;
  addingEntries: Set<string>;
  configuredEntries: Set<string>;
  onAdd: (entry: string) => void;
}) {
  const Icon = driver.category ? (CATEGORY_ICONS[driver.category] || Package) : Package;

  return (
    <div className="bg-black/20 rounded px-2.5 py-2">
      <div className="flex items-center space-x-2 mb-1">
        <Icon className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
        <span className="text-xs font-medium text-amber-100">{driver.driver}</span>
        {driver.catalogVendor && (
          <span className="text-xs text-amber-500">({driver.catalogVendor})</span>
        )}
        {driver.category && (
          <span className="px-1.5 py-0.5 text-[10px] bg-amber-500/15 text-amber-400 rounded">
            {driver.category}
          </span>
        )}
      </div>
      <div className="space-y-0.5 ml-5">
        {driver.firmwareFiles.map((file) => {
          const isConfigured = file.alreadyConfigured || configuredEntries.has(file.suggestedEntry);
          const isAdding = addingEntries.has(file.suggestedEntry);

          return (
            <div key={file.filename} className="flex items-center justify-between text-xs group">
              <span className="font-mono text-amber-200/80 truncate">{file.filename}</span>
              <div className="flex items-center space-x-1.5 flex-shrink-0 ml-2">
                {!file.availableOnDisk && (
                  <span className="text-yellow-500 flex items-center space-x-0.5" title="Nicht auf Disk vorhanden">
                    <AlertTriangle className="h-3 w-3" />
                  </span>
                )}
                {isConfigured ? (
                  <span className="text-green-400 flex items-center space-x-0.5">
                    <CheckCircle className="h-3 w-3" />
                  </span>
                ) : file.availableOnDisk ? (
                  <button
                    onClick={() => onAdd(file.suggestedEntry)}
                    disabled={isAdding}
                    className="flex items-center space-x-0.5 px-1.5 py-0.5 bg-green-500/15 hover:bg-green-500/25 text-green-400 rounded opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                  >
                    {isAdding ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                  </button>
                ) : (
                  <span className="text-muted-foreground text-[10px]">n/a</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
