import { Button } from '@/components/ui';

interface HostActionsProps {
  selectedCount: number;
  onBulkWakeOnLan: () => void;
  onBulkSync: () => void;
  onDeselectAll: () => void;
  isLoading: boolean;
}

export function HostActions({
  selectedCount,
  onBulkWakeOnLan,
  onBulkSync,
  onDeselectAll,
  isLoading,
}: HostActionsProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 flex items-center justify-between">
      <span className="text-primary-700">
        {selectedCount} Host(s) ausgewählt
      </span>
      <div className="flex space-x-2">
        <Button size="sm" onClick={onBulkWakeOnLan} loading={isLoading}>
          Wake-on-LAN
        </Button>
        <Button size="sm" onClick={onBulkSync} loading={isLoading}>
          Sync
        </Button>
        <Button size="sm" variant="secondary" onClick={onDeselectAll}>
          Auswahl aufheben
        </Button>
      </div>
    </div>
  );
}
