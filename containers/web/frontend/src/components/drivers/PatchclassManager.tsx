import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Upload, FileArchive, FolderOpen, ChevronRight,
  Monitor, HardDrive, Send, X, RefreshCw, Cpu, BookOpen, Info,
  Search, Loader2, CheckCircle, AlertTriangle, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { patchclassApi } from '@/api/patchclass';
import type { DriverScanResult, DeployedPostsync } from '@/api/patchclass';
import { hostsApi } from '@/api/hosts';
import { imagesApi } from '@/api/images';
import type {
  Patchclass, PatchclassDetail, DriverSet, DriverMap, DriverMapModel, DriverFile, Host, Image,
} from '@/types';
import { notify } from '@/stores/notificationStore';
import { DriverCatalog } from './DriverCatalog';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex ml-1">
      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 text-xs rounded-md shadow-lg whitespace-normal w-64 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 bg-zinc-900 text-zinc-100 border border-zinc-700">
        {text}
      </span>
    </span>
  );
}

export function PatchclassManager() {
  const [patchclasses, setPatchclasses] = useState<Patchclass[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PatchclassDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [newPcName, setNewPcName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [scanDmi, setScanDmi] = useState<{ sys_vendor: string; product_name: string } | null>(null);

  const fetchPatchclasses = useCallback(async () => {
    try {
      const list = await patchclassApi.listPatchclasses();
      setPatchclasses(list);
    } catch {
      notify.error('Fehler beim Laden der Patchclasses');
    }
  }, []);

  const fetchDetail = useCallback(async (name: string) => {
    setLoading(true);
    try {
      const d = await patchclassApi.getPatchclassDetail(name);
      setDetail(d);
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPatchclasses(); }, [fetchPatchclasses]);
  useEffect(() => { if (selected) fetchDetail(selected); }, [selected, fetchDetail]);

  const handleCreate = async () => {
    if (!newPcName.trim()) return;
    try {
      await patchclassApi.createPatchclass(newPcName.trim());
      notify.success(`Patchclass "${newPcName}" erstellt`);
      setNewPcName('');
      setShowCreate(false);
      await fetchPatchclasses();
      setSelected(newPcName.trim());
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Patchclass "${name}" wirklich loeschen? Alle Treiber werden entfernt.`)) return;
    try {
      await patchclassApi.deletePatchclass(name);
      notify.success(`Patchclass "${name}" geloescht`);
      if (selected === name) { setSelected(null); setDetail(null); }
      await fetchPatchclasses();
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header: Create + List */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center">
            Patchclasses
            <InfoTooltip text="Eine Patchclass gruppiert alle Windows-Treiber fuer eine Geraeteklasse (z.B. alle PCs im Labor). Jede Patchclass enthaelt Treiber-Sets, Matching-Regeln und ein Postsync-Script." />
          </h2>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Neu
          </button>
        </div>

        {showCreate && (
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newPcName}
              onChange={e => setNewPcName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Name (z.B. win11-lab)"
              className="flex-1 px-3 py-1.5 text-sm bg-background border border-border rounded-md"
              autoFocus
            />
            <button onClick={handleCreate} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md">
              Erstellen
            </button>
            <button onClick={() => setShowCreate(false)} className="px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {patchclasses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Patchclasses vorhanden. Erstellen Sie eine neue.</p>
        ) : (
          <div className="space-y-1">
            {patchclasses.map(pc => (
              <div
                key={pc.name}
                onClick={() => setSelected(pc.name)}
                className={cn(
                  'flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors',
                  selected === pc.name ? 'bg-primary/10 border border-primary/30' : 'hover:bg-accent'
                )}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{pc.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {pc.modelCount} Modelle, {pc.driverSetCount} Sets, {formatSize(pc.totalSize)}
                  </span>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(pc.name); }}
                  className="p-1 text-muted-foreground hover:text-destructive"
                  title="Loeschen"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hardware Scan (always visible, patchclass-independent) */}
      <DriverScanCard onFillModel={selected ? (dmi) => setScanDmi(dmi) : undefined} />

      {/* Detail: Driver Sets + Map + Device Rules + Deploy */}
      {selected && detail && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DriverSetsCard
            pcName={selected}
            sets={detail.driverSets}
            onRefresh={() => fetchDetail(selected)}
          />
          <DriverMapCard
            pcName={selected}
            map={detail.driverMap}
            sets={detail.driverSets}
            onRefresh={() => fetchDetail(selected)}
            prefillDmi={scanDmi}
            onPrefillConsumed={() => setScanDmi(null)}
          />
          <DeviceRulesCard
            pcName={selected}
            map={detail.driverMap}
            sets={detail.driverSets}
            onRefresh={() => fetchDetail(selected)}
          />
          <DeployCard pcName={selected} />
        </div>
      )}

      {selected && loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Laden...
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Driver Sets Card
// =============================================================================

function DriverSetsCard({ pcName, sets, onRefresh }: {
  pcName: string; sets: DriverSet[]; onRefresh: () => void;
}) {
  const [newSetName, setNewSetName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedSet, setExpandedSet] = useState<string | null>(null);
  const [files, setFiles] = useState<DriverFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null); // null=idle, 0-100=upload%, 101=extracting
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadFileSize, setUploadFileSize] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const handleCreateSet = async () => {
    if (!newSetName.trim()) return;
    try {
      await patchclassApi.createDriverSet(pcName, newSetName.trim());
      notify.success(`Set "${newSetName}" erstellt`);
      setNewSetName('');
      setShowCreate(false);
      onRefresh();
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    }
  };

  const handleDeleteSet = async (setName: string) => {
    if (!confirm(`Set "${setName}" loeschen?`)) return;
    try {
      await patchclassApi.deleteDriverSet(pcName, setName);
      notify.success(`Set "${setName}" geloescht`);
      if (expandedSet === setName) setExpandedSet(null);
      onRefresh();
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    }
  };

  const loadFiles = async (setName: string) => {
    try {
      const f = await patchclassApi.listDriverSetFiles(pcName, setName);
      setFiles(f);
    } catch { setFiles([]); }
  };

  const toggleExpand = async (setName: string) => {
    if (expandedSet === setName) {
      setExpandedSet(null);
    } else {
      setExpandedSet(setName);
      await loadFiles(setName);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, setName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await patchclassApi.uploadDriverFile(pcName, setName, file);
      notify.success(`"${file.name}" hochgeladen`);
      await loadFiles(setName);
      onRefresh();
    } catch (err: any) {
      notify.error('Upload fehlgeschlagen', err.response?.data?.error?.message || err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleZipExtract = async (e: React.ChangeEvent<HTMLInputElement>, setName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadFileName(file.name);
    setUploadFileSize(file.size);
    setUploadProgress(0);
    try {
      const result = await patchclassApi.extractDriverZip(pcName, setName, file, (pct) => {
        setUploadProgress(pct);
        if (pct >= 100) setUploadProgress(101); // switch to "extracting" phase
      });
      notify.success(`Archiv entpackt: ${result.entryCount} Dateien`);
      await loadFiles(setName);
      onRefresh();
    } catch (err: any) {
      notify.error('Archiv-Fehler', err.response?.data?.error?.message || err.message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setUploadFileName('');
      e.target.value = '';
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <HardDrive className="h-4 w-4" /> Treiber-Sets
          <InfoTooltip text="Ordner mit den eigentlichen Treiber-Dateien (.inf, .sys, .cat). Erstellen Sie ein Set pro Hardware-Typ (z.B. 'Intel_NIC_I219' fuer Intel-Netzwerkkarten). Laden Sie Treiber als Einzeldateien oder ZIP hoch." />
        </h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded"
        >
          <Plus className="h-3 w-3" /> Set
        </button>
      </div>

      {showCreate && (
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newSetName}
            onChange={e => setNewSetName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateSet()}
            placeholder="z.B. Dell_OptiPlex-7090"
            className="flex-1 px-2 py-1 text-sm bg-background border border-border rounded"
            autoFocus
          />
          <button onClick={handleCreateSet} className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded">OK</button>
          <button onClick={() => setShowCreate(false)} className="text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
      )}

      {sets.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Sets. Erstellen Sie ein Set pro Hardware-Modell.</p>
      ) : (
        <div className="space-y-1">
          {sets.map(set => (
            <div key={set.name}>
              <div
                className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                onClick={() => toggleExpand(set.name)}
              >
                <div className="flex items-center gap-2">
                  <ChevronRight className={cn('h-3 w-3 transition-transform', expandedSet === set.name && 'rotate-90')} />
                  <span className="text-sm font-medium">{set.name}</span>
                  <span className="text-xs text-muted-foreground">{set.fileCount} Dateien, {formatSize(set.totalSize)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteSet(set.name); }}
                    className="p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {expandedSet === set.name && (
                <div className="ml-6 mt-1 mb-2 space-y-1">
                  <div className="flex gap-2 mb-2">
                    <input ref={fileInputRef} type="file" className="hidden" onChange={e => handleFileUpload(e, set.name)} />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-accent text-accent-foreground rounded hover:bg-accent/80"
                    >
                      <Upload className="h-3 w-3" /> Datei
                    </button>
                    <input ref={zipInputRef} type="file" accept=".zip,.exe,.7z" className="hidden" onChange={e => handleZipExtract(e, set.name)} />
                    <button
                      onClick={() => zipInputRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-accent text-accent-foreground rounded hover:bg-accent/80"
                    >
                      <FileArchive className="h-3 w-3" /> Archiv
                    </button>
                    {uploading && uploadProgress !== null && (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span className="truncate">
                            {uploadProgress <= 100
                              ? `${uploadFileName} (${formatSize(uploadFileSize)})`
                              : 'Entpacke Archiv...'}
                          </span>
                          {uploadProgress <= 100 && <span>{uploadProgress}%</span>}
                        </div>
                        <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                          {uploadProgress <= 100 ? (
                            <div
                              className="bg-primary rounded-full h-2 transition-all duration-300"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          ) : (
                            <div className="bg-primary rounded-full h-2 w-full animate-pulse" />
                          )}
                        </div>
                      </div>
                    )}
                    {uploading && uploadProgress === null && (
                      <span className="text-xs text-muted-foreground">Hochladen...</span>
                    )}
                  </div>

                  {files.filter(f => !f.isDirectory).length === 0 ? (
                    <p className="text-xs text-muted-foreground">Leer. Laden Sie Treiber-Dateien hoch.</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {files.filter(f => !f.isDirectory).map(f => (
                        <div key={f.path} className="flex items-center justify-between text-xs px-2 py-0.5 rounded hover:bg-accent/50">
                          <span className="truncate" title={f.path}>{f.path}</span>
                          <span className="text-muted-foreground ml-2 flex-shrink-0">{formatSize(f.size)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Driver Map Card
// =============================================================================

function DriverMapCard({ pcName, map, sets, onRefresh, prefillDmi, onPrefillConsumed }: {
  pcName: string; map: DriverMap; sets: DriverSet[]; onRefresh: () => void;
  prefillDmi?: { sys_vendor: string; product_name: string } | null;
  onPrefillConsumed?: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [modelName, setModelName] = useState('');
  const [sysVendor, setSysVendor] = useState('');
  const [productName, setProductName] = useState('');
  const [matchType, setMatchType] = useState<'exact' | 'contains'>('exact');
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([]);
  const [defaultDrivers, setDefaultDrivers] = useState(map.defaultDrivers.join(', '));

  // Stable ref for callback to avoid useEffect re-firing on every render
  const onPrefillConsumedRef = useRef(onPrefillConsumed);
  onPrefillConsumedRef.current = onPrefillConsumed;

  // Auto-fill from scan results
  useEffect(() => {
    if (prefillDmi) {
      setSysVendor(prefillDmi.sys_vendor);
      setProductName(prefillDmi.product_name);
      setModelName(`${prefillDmi.sys_vendor} ${prefillDmi.product_name}`);
      setSelectedDrivers(sets.map(s => s.name));
      setShowAdd(true);
      onPrefillConsumedRef.current?.();
    }
  }, [prefillDmi]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddModel = async () => {
    const missing: string[] = [];
    if (!modelName) missing.push('Name');
    if (!sysVendor) missing.push('sys_vendor');
    if (!productName) missing.push('product_name');
    if (selectedDrivers.length === 0) missing.push('Treiber-Sets');
    if (missing.length > 0) {
      notify.error(`Fehlend: ${missing.join(', ')}`);
      return;
    }

    const model: DriverMapModel = {
      name: modelName,
      match: {
        sys_vendor: sysVendor,
        ...(matchType === 'exact'
          ? { product_name: productName }
          : { product_name_contains: productName }
        ),
      },
      drivers: selectedDrivers,
    };

    try {
      const newMap = {
        ...map,
        models: [...map.models, model],
      };
      await patchclassApi.updateDriverMap(pcName, newMap);
      notify.success(`Modell "${modelName}" hinzugefuegt`);
      setShowAdd(false);
      setModelName(''); setSysVendor(''); setProductName(''); setSelectedDrivers([]);
      onRefresh();
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    }
  };

  const handleRemoveModel = async (name: string) => {
    try {
      const newMap = {
        ...map,
        models: map.models.filter(m => m.name !== name),
      };
      await patchclassApi.updateDriverMap(pcName, newMap);
      notify.success(`Modell "${name}" entfernt`);
      onRefresh();
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    }
  };

  const handleSaveDefaults = async () => {
    try {
      const newMap = {
        ...map,
        defaultDrivers: defaultDrivers.split(',').map(s => s.trim()).filter(Boolean),
      };
      await patchclassApi.updateDriverMap(pcName, newMap);
      notify.success('Default-Treiber gespeichert');
      onRefresh();
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    }
  };

  const toggleDriver = (name: string) => {
    setSelectedDrivers(prev =>
      prev.includes(name) ? prev.filter(d => d !== name) : [...prev, name]
    );
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Monitor className="h-4 w-4" /> Hardware-Modelle
          <InfoTooltip text="Matching nach PC-Modellname (DMI). Der Client liest sys_vendor und product_name aus dem BIOS und erhaelt die zugeordneten Treiber-Sets. Werte ermitteln: 'cat /sys/class/dmi/id/sys_vendor' und 'cat /sys/class/dmi/id/product_name' auf dem Client." />
        </h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded"
        >
          <Plus className="h-3 w-3" /> Modell
        </button>
      </div>

      {/* Default Drivers */}
      <div className="flex items-center gap-2 mb-3 text-sm">
        <span className="text-muted-foreground flex items-center">
          Default:
          <InfoTooltip text="Sets, die IMMER installiert werden — unabhaengig vom Hardware-Matching. Z.B. '_generic' fuer universelle Treiber. Kommagetrennt." />
        </span>
        <input
          type="text"
          value={defaultDrivers}
          onChange={e => setDefaultDrivers(e.target.value)}
          className="flex-1 px-2 py-1 text-sm bg-background border border-border rounded"
          placeholder="_generic"
        />
        <button onClick={handleSaveDefaults} className="px-2 py-1 text-xs bg-accent rounded hover:bg-accent/80">
          Speichern
        </button>
      </div>

      {/* Add Model Form */}
      {showAdd && (
        <div className="border border-border rounded p-3 mb-3 space-y-2">
          <input
            type="text" value={modelName} onChange={e => setModelName(e.target.value)}
            placeholder="Name (z.B. Dell OptiPlex 7090)"
            className="w-full px-2 py-1 text-sm bg-background border border-border rounded"
          />
          <div className="flex items-center gap-1">
            <input
              type="text" value={sysVendor} onChange={e => setSysVendor(e.target.value)}
              placeholder="sys_vendor (z.B. Dell Inc.)"
              className="flex-1 px-2 py-1 text-sm bg-background border border-border rounded"
            />
            <InfoTooltip text="Hersteller aus dem BIOS. Ermitteln mit: cat /sys/class/dmi/id/sys_vendor" />
          </div>
          <div className="flex gap-2">
            <select
              value={matchType} onChange={e => setMatchType(e.target.value as 'exact' | 'contains')}
              className="px-2 py-1 text-sm bg-background border border-border rounded"
              title="Exakt: product_name muss genau uebereinstimmen. Enthaelt: product_name muss den Text nur enthalten."
            >
              <option value="exact">Exakt</option>
              <option value="contains">Enthaelt</option>
            </select>
            <input
              type="text" value={productName} onChange={e => setProductName(e.target.value)}
              placeholder="product_name (z.B. OptiPlex 7090)"
              className="flex-1 px-2 py-1 text-sm bg-background border border-border rounded"
            />
            <InfoTooltip text="Produktname aus dem BIOS. Ermitteln mit: cat /sys/class/dmi/id/product_name" />
          </div>
          <div className="flex flex-wrap gap-1">
            {sets.map(s => (
              <button
                key={s.name}
                onClick={() => toggleDriver(s.name)}
                className={cn(
                  'px-2 py-0.5 text-xs rounded border',
                  selectedDrivers.includes(s.name)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-accent'
                )}
              >
                {s.name}
              </button>
            ))}
            {sets.length === 0 && <span className="text-xs text-muted-foreground">Erstellen Sie zuerst Sets</span>}
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddModel} className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">
              Hinzufuegen
            </button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs text-muted-foreground">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Model List */}
      {map.models.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Modelle konfiguriert. Unbekannte Hardware erhaelt Default-Treiber.</p>
      ) : (
        <div className="space-y-1">
          {map.models.map(m => (
            <div key={m.name} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-accent">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{m.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {m.match.sys_vendor} | {m.match.product_name || `*${m.match.product_name_contains}*`}
                  <span className="ml-2">
                    {m.drivers.join(', ')}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleRemoveModel(m.name)}
                className="p-1 text-muted-foreground hover:text-destructive flex-shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Device Rules Card (PCI/USB-ID Matching)
// =============================================================================

const ALL_CATEGORIES = [
  { id: 'nic', name: 'NIC' },
  { id: 'gpu', name: 'GPU' },
  { id: 'audio', name: 'Audio' },
  { id: 'chipset', name: 'Chipsatz' },
  { id: 'storage', name: 'Speicher' },
  { id: 'wifi', name: 'WLAN' },
  { id: 'usb', name: 'USB' },
  { id: 'bluetooth', name: 'Bluetooth' },
];

function DeviceRulesCard({ pcName, map, sets, onRefresh }: {
  pcName: string; map: DriverMap; sets: DriverSet[]; onRefresh: () => void;
}) {
  const [showCatalog, setShowCatalog] = useState(false);
  const deviceRules = map.deviceRules || [];
  const ignoredCategories = map.ignoredCategories || [];

  const handleRemoveRule = async (ruleName: string) => {
    try {
      await patchclassApi.removeDeviceRule(pcName, ruleName);
      notify.success(`Regel "${ruleName}" entfernt`);
      onRefresh();
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    }
  };

  const handleToggleIgnored = async (categoryId: string) => {
    const newIgnored = ignoredCategories.includes(categoryId)
      ? ignoredCategories.filter(c => c !== categoryId)
      : [...ignoredCategories, categoryId];
    try {
      await patchclassApi.updateDriverMap(pcName, {
        ...map,
        ignoredCategories: newIgnored,
      });
      notify.success('Ignorierte Kategorien aktualisiert');
      onRefresh();
    } catch (err: any) {
      notify.error('Fehler', err.response?.data?.error?.message || err.message);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Cpu className="h-4 w-4" /> PCI/USB-Geraete
          <InfoTooltip text="Matching nach PCI/USB-Chip-ID. Der Client liest beim Boot alle PCI- und USB-IDs aus /sys/bus/ und erhaelt passende Treiber-Sets. Nutzen Sie den Katalog, um bekannte Geraete schnell hinzuzufuegen, oder ermitteln Sie IDs mit 'lspci -nn' auf dem Client." />
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCatalog(!showCatalog)}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded"
          >
            <BookOpen className="h-3 w-3" /> {showCatalog ? 'Schliessen' : 'Katalog'}
          </button>
          <InfoTooltip text="Nachschlagewerk bekannter PCI/USB-Hardware-IDs (Intel, Realtek, AMD, NVIDIA, etc.). Damit koennen Sie Geraete per Klick als Regel hinzufuegen, ohne die IDs manuell nachschlagen zu muessen." />
        </div>
      </div>

      {/* Ignored Categories */}
      <div className="mb-3">
        <div className="text-xs text-muted-foreground mb-1 flex items-center">
          Ignorierte Kategorien:
          <InfoTooltip text="Rot markierte Kategorien werden beim automatischen PCI/USB-Matching uebersprungen. Z.B. 'USB' ignorieren, damit USB-Controller-Treiber nicht unnoetig installiert werden. Die Regeln bleiben erhalten, werden aber nicht angewendet." />
        </div>
        <div className="flex flex-wrap gap-1">
          {ALL_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => handleToggleIgnored(cat.id)}
              className={cn(
                'px-2 py-0.5 text-xs rounded border transition-colors',
                ignoredCategories.includes(cat.id)
                  ? 'bg-destructive/10 text-destructive border-destructive/30'
                  : 'bg-background border-border hover:bg-accent text-foreground'
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog Browser */}
      {showCatalog && (
        <div className="border border-border rounded-md p-3 mb-3">
          <DriverCatalog
            pcName={pcName}
            existingRules={deviceRules}
            availableSets={sets.map(s => s.name)}
            onRuleAdded={onRefresh}
          />
        </div>
      )}

      {/* Rules List */}
      {deviceRules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Keine Device Rules. Oeffnen Sie den Katalog um Geraete nach PCI/USB-ID zuzuordnen.
        </p>
      ) : (
        <div className="space-y-1">
          {deviceRules.map(rule => (
            <div key={rule.name} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-accent">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{rule.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  <span className="font-mono">
                    {rule.match.type}:{rule.match.vendor}:{rule.match.device}
                    {rule.match.subvendor && `:${rule.match.subvendor}:${rule.match.subdevice}`}
                  </span>
                  <span className={cn(
                    'ml-2 px-1.5 py-0 rounded text-[10px]',
                    ignoredCategories.includes(rule.category)
                      ? 'bg-destructive/10 text-destructive line-through'
                      : 'bg-accent'
                  )}>
                    {rule.category}
                  </span>
                  <span className="ml-2">{rule.drivers.join(', ')}</span>
                </div>
              </div>
              <button
                onClick={() => handleRemoveRule(rule.name)}
                className="p-1 text-muted-foreground hover:text-destructive flex-shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Manufacturer Support Link
// =============================================================================

function ManufacturerLink({ vendor, product }: { vendor: string; product: string }) {
  const v = vendor.toUpperCase();
  const p = encodeURIComponent(product);
  let label: string, url: string;

  if (v.includes('LENOVO')) {
    label = 'Lenovo'; url = `https://pcsupport.lenovo.com/us/en/products/${p}`;
  } else if (v.includes('DELL')) {
    label = 'Dell'; url = `https://www.dell.com/support/home/en-us?q=${p}`;
  } else if (v.includes('HP') || v.includes('HEWLETT')) {
    label = 'HP'; url = `https://support.hp.com/us-en/search?q=${p}`;
  } else if (v.includes('ACER')) {
    label = 'Acer'; url = `https://www.acer.com/us-en/support/drivers-and-manuals?q=${p}`;
  } else {
    return null;
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
      <ExternalLink className="h-3 w-3" /> {label} Treiber-Support
    </a>
  );
}

// =============================================================================
// Driver Scan Card (Hardware-Scan)
// =============================================================================

function DriverScanCard({ onFillModel }: { onFillModel?: (dmi: { sys_vendor: string; product_name: string }) => void }) {
  const [hostIp, setHostIp] = useState('');
  const [onlineHosts, setOnlineHosts] = useState<Host[]>([]);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<DriverScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hostsApi.list({ limit: 200, filters: { status: 'online' } })
      .then(res => setOnlineHosts(res.data))
      .catch(() => setOnlineHosts([]));
  }, []);

  const handleScan = async () => {
    if (!hostIp.trim()) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const data = await patchclassApi.scanClient(hostIp.trim());
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

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Search className="h-4 w-4" /> Hardware-Scan
          <InfoTooltip text="Liest DMI-Daten (Hersteller + Modell) per SSH vom Client und prueft, welche Patchclass-Regeln matchen wuerden. Der Client muss online und per SSH erreichbar sein." />
        </h3>
      </div>

      {/* IP Input + Host Picker + Scan Button */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="Client-IP (z.B. 10.0.152.111)"
          value={hostIp}
          onChange={e => setHostIp(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleScan()}
          className="flex-1 px-3 py-1.5 text-sm bg-background border border-border rounded-md"
        />
        {onlineHosts.length > 0 && (
          <select
            value=""
            onChange={e => { if (e.target.value) setHostIp(e.target.value); }}
            className="px-2 py-1.5 text-sm bg-background border border-border rounded-md"
          >
            <option value="">Online-Hosts ({onlineHosts.length})</option>
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
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span>{scanning ? 'Scanne...' : 'Scannen'}</span>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}

      {/* Scanning indicator */}
      {scanning && (
        <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Verbinde mit {hostIp} und lese DMI-Daten...</span>
        </div>
      )}

      {/* Results */}
      {result && !scanning && (
        <div className="space-y-3">
          {/* DMI Info */}
          <div className="p-3 bg-secondary/50 border border-border rounded-md">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-muted-foreground">DMI-Daten von {result.host}</div>
              {onFillModel && (
                <button
                  onClick={() => onFillModel(result.dmi)}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                >
                  <Plus className="h-3 w-3" /> Uebernehmen
                </button>
              )}
            </div>
            <div className="font-mono text-sm">
              <span className="text-foreground">{result.dmi.sys_vendor}</span>
              <span className="text-muted-foreground mx-2">&mdash;</span>
              <span className="text-foreground">{result.dmi.product_name}</span>
            </div>
          </div>

          {/* Matches */}
          {result.matches.length > 0 ? (
            <div className="space-y-2">
              {result.matches.map((m, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
                  <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{m.patchclass}</span>
                    <span className="text-muted-foreground mx-1.5">&rarr;</span>
                    <span className="text-sm text-muted-foreground">Modell "{m.model}"</span>
                    <span className="text-muted-foreground mx-1.5">&rarr;</span>
                    {m.driverSets.map(ds => (
                      <span key={ds} className="inline-block px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded mr-1">
                        {ds}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                <p className="text-sm text-yellow-500">Keine Patchclass-Regel passt zu diesem Geraet</p>
              </div>
            </div>
          )}

          {/* Unmatched patchclasses */}
          {result.unmatched.length > 0 && result.matches.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Kein Match: {result.unmatched.join(', ')}
            </div>
          )}

          {/* Manufacturer support link */}
          <ManufacturerLink vendor={result.dmi.sys_vendor} product={result.dmi.product_name} />
        </div>
      )}

      {/* Empty state */}
      {!result && !scanning && !error && (
        <div className="text-center py-4 text-muted-foreground">
          <Search className="h-6 w-6 mx-auto mb-1.5 opacity-50" />
          <p className="text-sm">Client-IP eingeben um DMI-Daten zu lesen und Patchclass-Matching zu pruefen.</p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Deploy Card
// =============================================================================

function DeployCard({ pcName }: { pcName: string }) {
  const [imageName, setImageName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [availableImages, setAvailableImages] = useState<Image[]>([]);
  const [deployed, setDeployed] = useState<DeployedPostsync[]>([]);

  const fetchDeployed = useCallback(async () => {
    try {
      const list = await patchclassApi.listDeployedPostsyncs(pcName);
      setDeployed(list);
    } catch { setDeployed([]); }
  }, [pcName]);

  useEffect(() => {
    imagesApi.list().then(setAvailableImages).catch(() => setAvailableImages([]));
    fetchDeployed();
  }, [fetchDeployed]);

  const handleDeploy = async () => {
    if (!imageName.trim()) return;
    setDeploying(true);
    try {
      const result = await patchclassApi.deployPostsync(pcName, imageName.trim());
      notify.success(`Postsync "${result.postsync}" deployed`);
      setImageName('');
      await fetchDeployed();
    } catch (err: any) {
      notify.error('Deploy fehlgeschlagen', err.response?.data?.error?.message || err.message);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-semibold flex items-center gap-2 mb-3">
        <Send className="h-4 w-4" /> Postsync deployen
        <InfoTooltip text="Aktiviert die Treiber-Verteilung fuer ein bestimmtes Image. Dabei wird ein Postsync-Script erstellt, das nach jedem Sync auf dem Client automatisch laeuft: Hardware erkennen, passende Treiber vom Server holen, nach C:\\Drivers kopieren und Windows pnputil zur Installation registrieren." />
      </h3>
      <div className="flex gap-2 mb-3">
        <select
          value={imageName}
          onChange={e => setImageName(e.target.value)}
          className="flex-1 px-2 py-1.5 text-sm bg-background border border-border rounded"
        >
          <option value="">Image waehlen...</option>
          {availableImages.map(img => (
            <option key={img.id} value={img.filename}>
              {img.filename} ({formatSize(img.fileSize || img.size || 0)})
            </option>
          ))}
        </select>
        <button
          onClick={handleDeploy}
          disabled={deploying || !imageName}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> Deploy
        </button>
      </div>

      {/* Deployed postsync list */}
      {deployed.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1.5">Aktive Postsyncs:</div>
          <div className="space-y-1">
            {deployed.map(d => (
              <div key={d.path} className="flex items-center justify-between px-2 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                  <span className="text-sm font-medium truncate">{d.image}</span>
                  <span className="text-xs text-muted-foreground">{d.postsync}</span>
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                  {new Date(d.modifiedAt).toLocaleDateString('de-DE')} {new Date(d.modifiedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {deployed.length === 0 && (
        <p className="text-xs text-muted-foreground">Noch kein Postsync deployed.</p>
      )}
    </div>
  );
}
