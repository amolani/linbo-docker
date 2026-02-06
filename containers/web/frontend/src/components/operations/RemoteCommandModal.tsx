import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  X,
  Play,
  Clock,
  Monitor,
  Building2,
  Settings,
} from 'lucide-react';
import { Modal, Button, Input, Select } from '@/components/ui';
import { operationsApi, LINBO_COMMANDS, DirectCommandRequest, ScheduleCommandRequest } from '@/api/operations';
import { hostsApi } from '@/api/hosts';
import { roomsApi } from '@/api/rooms';
import { configsApi } from '@/api/configs';
import { notify } from '@/stores/notificationStore';
import type { Host, Room, Config } from '@/types';

interface RemoteCommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedHostIds?: string[];
}

type TargetType = 'hosts' | 'room' | 'config';
type ExecutionType = 'direct' | 'scheduled';

interface CommandItem {
  id: string;
  command: string;
  arg?: string;
}

export function RemoteCommandModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedHostIds = [],
}: RemoteCommandModalProps) {
  const [targetType, setTargetType] = useState<TargetType>('hosts');
  const [executionType, setExecutionType] = useState<ExecutionType>('direct');
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>(preselectedHostIds);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [wakeOnLan, setWakeOnLan] = useState(false);
  const [wolDelay, setWolDelay] = useState(30);
  const [isLoading, setIsLoading] = useState(false);

  const [hosts, setHosts] = useState<Host[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [hostsLoading, setHostsLoading] = useState(true);

  // Load options on mount
  useEffect(() => {
    const loadOptions = async () => {
      setHostsLoading(true);
      try {
        const [hostsData, roomsData, configsData] = await Promise.all([
          hostsApi.list({ limit: 500 }),
          roomsApi.list(),
          configsApi.list(),
        ]);
        setHosts(hostsData.data);
        setRooms(roomsData);
        setConfigs(configsData);
      } catch {
        notify.error('Fehler beim Laden der Optionen');
      } finally {
        setHostsLoading(false);
      }
    };
    if (isOpen) {
      loadOptions();
    }
  }, [isOpen]);

  // Reset on open with preselected hosts
  useEffect(() => {
    if (isOpen && preselectedHostIds.length > 0) {
      setSelectedHostIds(preselectedHostIds);
      setTargetType('hosts');
    }
  }, [isOpen, preselectedHostIds]);

  const handleClose = useCallback(() => {
    setSelectedHostIds([]);
    setSelectedRoomId('');
    setSelectedConfigId('');
    setCommands([]);
    setWakeOnLan(false);
    setWolDelay(30);
    setExecutionType('direct');
    onClose();
  }, [onClose]);

  const addCommand = useCallback(() => {
    setCommands((prev) => [
      ...prev,
      { id: crypto.randomUUID(), command: '', arg: '' },
    ]);
  }, []);

  const removeCommand = useCallback((id: string) => {
    setCommands((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const updateCommand = useCallback((id: string, field: 'command' | 'arg', value: string) => {
    setCommands((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  }, []);

  const commandString = useMemo(() => {
    return commands
      .filter((c) => c.command)
      .map((c) => {
        const cmdDef = LINBO_COMMANDS.find((def) => def.value === c.command);
        if (cmdDef?.hasArg && c.arg) {
          return `${c.command}:${c.arg}`;
        }
        return c.command;
      })
      .join(',');
  }, [commands]);

  const targetCount = useMemo(() => {
    switch (targetType) {
      case 'hosts':
        return selectedHostIds.length;
      case 'room':
        return selectedRoomId
          ? hosts.filter((h) => h.roomId === selectedRoomId).length
          : 0;
      case 'config':
        return selectedConfigId
          ? hosts.filter((h) => h.configId === selectedConfigId).length
          : 0;
      default:
        return 0;
    }
  }, [targetType, selectedHostIds, selectedRoomId, selectedConfigId, hosts]);

  const isValid = useMemo(() => {
    if (commands.length === 0) return false;
    if (commands.some((c) => !c.command)) return false;
    if (targetCount === 0) return false;
    return true;
  }, [commands, targetCount]);

  const handleSubmit = async () => {
    if (!isValid) return;

    setIsLoading(true);
    try {
      const baseData = {
        commands: commandString,
        options: {
          wakeOnLan,
          ...(wakeOnLan && { wolDelay }),
        },
      };

      let requestData: DirectCommandRequest | ScheduleCommandRequest;

      switch (targetType) {
        case 'hosts':
          requestData = { ...baseData, hostIds: selectedHostIds };
          break;
        case 'room':
          requestData = { ...baseData, roomId: selectedRoomId };
          break;
        case 'config':
          requestData = { ...baseData, configId: selectedConfigId };
          break;
      }

      if (executionType === 'direct') {
        await operationsApi.direct(requestData);
        notify.success(
          'Befehle gesendet',
          `${targetCount} Host(s) werden ausgeführt`
        );
      } else {
        const result = await operationsApi.schedule(requestData);
        notify.success(
          'Befehle geplant',
          `${result.scheduled} Host(s) für nächsten Boot`
        );
      }

      onSuccess();
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fehler bei der Ausführung';
      notify.error('Fehler', message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleHostSelection = useCallback((hostId: string) => {
    setSelectedHostIds((prev) =>
      prev.includes(hostId) ? prev.filter((id) => id !== hostId) : [...prev, hostId]
    );
  }, []);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Remote-Befehl" size="xl">
      <div className="space-y-6">
        {/* Execution Type Toggle */}
        <div className="flex rounded-lg overflow-hidden border border-border">
          <button
            type="button"
            onClick={() => setExecutionType('direct')}
            className={`flex-1 py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 ${
              executionType === 'direct'
                ? 'bg-primary text-white'
                : 'bg-card text-foreground hover:bg-muted/50'
            }`}
          >
            <Play className="h-4 w-4" />
            Sofort ausführen
          </button>
          <button
            type="button"
            onClick={() => setExecutionType('scheduled')}
            className={`flex-1 py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 ${
              executionType === 'scheduled'
                ? 'bg-primary text-white'
                : 'bg-card text-foreground hover:bg-muted/50'
            }`}
          >
            <Clock className="h-4 w-4" />
            Bei nächstem Boot
          </button>
        </div>

        {/* Target Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground">Ziel auswählen</label>

          {/* Target Type Tabs */}
          <div className="flex rounded-lg overflow-hidden border border-border">
            <button
              type="button"
              onClick={() => setTargetType('hosts')}
              className={`flex-1 py-2 px-3 text-sm flex items-center justify-center gap-2 ${
                targetType === 'hosts'
                  ? 'bg-secondary font-medium'
                  : 'bg-card text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <Monitor className="h-4 w-4" />
              Hosts
            </button>
            <button
              type="button"
              onClick={() => setTargetType('room')}
              className={`flex-1 py-2 px-3 text-sm flex items-center justify-center gap-2 ${
                targetType === 'room'
                  ? 'bg-secondary font-medium'
                  : 'bg-card text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <Building2 className="h-4 w-4" />
              Raum
            </button>
            <button
              type="button"
              onClick={() => setTargetType('config')}
              className={`flex-1 py-2 px-3 text-sm flex items-center justify-center gap-2 ${
                targetType === 'config'
                  ? 'bg-secondary font-medium'
                  : 'bg-card text-muted-foreground hover:bg-muted/50'
              }`}
            >
              <Settings className="h-4 w-4" />
              Konfiguration
            </button>
          </div>

          {/* Target Selection Content */}
          {targetType === 'hosts' && (
            <div className="border border-border rounded-lg max-h-48 overflow-y-auto">
              {hostsLoading ? (
                <div className="p-4 text-center text-muted-foreground">Laden...</div>
              ) : hosts.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">Keine Hosts vorhanden</div>
              ) : (
                <div className="divide-y divide-border">
                  {hosts.map((host) => (
                    <label
                      key={host.id}
                      className="flex items-center px-4 py-2 hover:bg-muted/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedHostIds.includes(host.id)}
                        onChange={() => toggleHostSelection(host.id)}
                        className="rounded border-border text-primary focus:ring-ring"
                      />
                      <span className="ml-3 text-sm">
                        <span className="font-medium">{host.hostname}</span>
                        <span className="text-muted-foreground ml-2">
                          {host.ipAddress || host.macAddress}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {targetType === 'room' && (
            <Select
              value={selectedRoomId}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              options={[
                { value: '', label: 'Raum auswählen...' },
                ...rooms.map((r) => ({
                  value: r.id,
                  label: `${r.name} (${hosts.filter((h) => h.roomId === r.id).length} Hosts)`,
                })),
              ]}
            />
          )}

          {targetType === 'config' && (
            <Select
              value={selectedConfigId}
              onChange={(e) => setSelectedConfigId(e.target.value)}
              options={[
                { value: '', label: 'Konfiguration auswählen...' },
                ...configs.map((c) => ({
                  value: c.id,
                  label: `${c.name} (${hosts.filter((h) => h.configId === c.id).length} Hosts)`,
                })),
              ]}
            />
          )}

          <div className="text-sm text-muted-foreground">
            {targetCount} Host(s) ausgewählt
          </div>
        </div>

        {/* Command Builder */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-foreground">Befehle</label>
            <Button size="sm" variant="secondary" onClick={addCommand}>
              <Plus className="h-4 w-4 mr-1" />
              Befehl hinzufügen
            </Button>
          </div>

          {commands.length === 0 ? (
            <div className="text-center py-6 border-2 border-dashed border-border rounded-lg">
              <p className="text-muted-foreground text-sm">Keine Befehle ausgewählt</p>
              <Button size="sm" variant="secondary" onClick={addCommand} className="mt-2">
                <Plus className="h-4 w-4 mr-1" />
                Befehl hinzufügen
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {commands.map((cmd, idx) => {
                const cmdDef = LINBO_COMMANDS.find((c) => c.value === cmd.command);
                return (
                  <div key={cmd.id} className="flex items-start gap-2">
                    <span className="text-muted-foreground text-sm pt-2 w-6">{idx + 1}.</span>
                    <div className="flex-1">
                      <Select
                        value={cmd.command}
                        onChange={(e) => updateCommand(cmd.id, 'command', e.target.value)}
                        options={[
                          { value: '', label: 'Befehl auswählen...' },
                          ...LINBO_COMMANDS.map((c) => ({
                            value: c.value,
                            label: `${c.label} - ${c.description}`,
                          })),
                        ]}
                      />
                    </div>
                    {cmdDef?.hasArg && (
                      <div className="w-32">
                        {cmdDef.argOptions ? (
                          <Select
                            value={cmd.arg || ''}
                            onChange={(e) => updateCommand(cmd.id, 'arg', e.target.value)}
                            options={[
                              { value: '', label: cmdDef.argLabel || 'Argument' },
                              ...cmdDef.argOptions.map((opt) => ({
                                value: opt,
                                label: opt,
                              })),
                            ]}
                          />
                        ) : (
                          <Input
                            placeholder={cmdDef.argLabel || '#'}
                            value={cmd.arg || ''}
                            onChange={(e) => updateCommand(cmd.id, 'arg', e.target.value)}
                          />
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeCommand(cmd.id)}
                      className="p-2 text-muted-foreground hover:text-red-400"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {commandString && (
            <div className="bg-secondary rounded p-3">
              <p className="text-xs text-muted-foreground mb-1">Befehlsstring:</p>
              <code className="text-sm font-mono text-foreground">{commandString}</code>
            </div>
          )}
        </div>

        {/* Options */}
        <div className="space-y-3 border-t border-border pt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={wakeOnLan}
              onChange={(e) => setWakeOnLan(e.target.checked)}
              className="rounded border-border text-primary focus:ring-ring"
            />
            <span className="text-sm text-foreground">Wake-on-LAN vor Ausführung senden</span>
          </label>

          {wakeOnLan && (
            <div className="ml-6">
              <Input
                type="number"
                label="Wartezeit nach WoL (Sekunden)"
                value={wolDelay}
                onChange={(e) => setWolDelay(parseInt(e.target.value) || 0)}
                min={0}
                max={300}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-border">
          <Button variant="secondary" onClick={handleClose}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid} loading={isLoading}>
            {executionType === 'direct' ? 'Ausführen' : 'Planen'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
