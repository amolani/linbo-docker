import { Input, Select, Button } from '@/components/ui';
import type { HostFilters as HostFiltersType, Room, HostGroup } from '@/types';

interface HostFiltersProps {
  filters: HostFiltersType;
  rooms: Room[];
  groups: HostGroup[];
  onFilterChange: (key: keyof HostFiltersType, value: string | undefined) => void;
  onClearFilters: () => void;
}

export function HostFilters({
  filters,
  rooms,
  groups,
  onFilterChange,
  onClearFilters,
}: HostFiltersProps) {
  return (
    <div className="bg-white shadow rounded-lg p-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Input
          placeholder="Suche..."
          value={filters.search || ''}
          onChange={(e) => onFilterChange('search', e.target.value || undefined)}
        />
        <Select
          value={filters.status || ''}
          onChange={(e) => onFilterChange('status', e.target.value || undefined)}
          options={[
            { value: '', label: 'Alle Status' },
            { value: 'online', label: 'Online' },
            { value: 'offline', label: 'Offline' },
            { value: 'syncing', label: 'Synchronisiert' },
            { value: 'booting', label: 'Startet' },
          ]}
        />
        <Select
          value={filters.roomId || ''}
          onChange={(e) => onFilterChange('roomId', e.target.value || undefined)}
          options={[
            { value: '', label: 'Alle Räume' },
            ...rooms.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
        <Select
          value={filters.groupId || ''}
          onChange={(e) => onFilterChange('groupId', e.target.value || undefined)}
          options={[
            { value: '', label: 'Alle Gruppen' },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
        <Button variant="secondary" onClick={onClearFilters}>
          Filter zurücksetzen
        </Button>
      </div>
    </div>
  );
}
