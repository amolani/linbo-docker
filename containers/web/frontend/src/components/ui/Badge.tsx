import { ReactNode } from 'react';

export interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
  children: ReactNode;
  dot?: boolean;
}

const variants = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-green-600/20 text-green-400',
  warning: 'bg-yellow-600/20 text-yellow-400',
  error: 'bg-destructive/20 text-red-400',
  info: 'bg-primary/20 text-blue-400',
};

const dotColors = {
  default: 'bg-muted-foreground',
  success: 'bg-green-400',
  warning: 'bg-yellow-400',
  error: 'bg-red-400',
  info: 'bg-blue-400',
};

const sizes = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

export function Badge({ variant = 'default', size = 'md', children, dot = false }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${variants[variant]} ${sizes[size]}`}
    >
      {dot && (
        <span className={`w-2 h-2 mr-1.5 rounded-full ${dotColors[variant]}`} />
      )}
      {children}
    </span>
  );
}

export interface StatusBadgeProps {
  status: 'online' | 'offline' | 'syncing' | 'booting' | 'unknown' | string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const statusConfig: Record<string, { variant: BadgeProps['variant']; label: string }> = {
    online: { variant: 'success', label: 'Online' },
    offline: { variant: 'default', label: 'Offline' },
    syncing: { variant: 'info', label: 'Synchronisiert' },
    booting: { variant: 'warning', label: 'Startet' },
    unknown: { variant: 'default', label: 'Unbekannt' },
  };

  const config = statusConfig[status] || { variant: 'default' as const, label: status };

  return (
    <Badge variant={config.variant} dot>
      {config.label}
    </Badge>
  );
}

export interface OperationStatusBadgeProps {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
}

export function OperationStatusBadge({ status }: OperationStatusBadgeProps) {
  const statusConfig: Record<string, { variant: BadgeProps['variant']; label: string }> = {
    pending: { variant: 'default', label: 'Ausstehend' },
    running: { variant: 'info', label: 'Läuft' },
    completed: { variant: 'success', label: 'Abgeschlossen' },
    failed: { variant: 'error', label: 'Fehlgeschlagen' },
    cancelled: { variant: 'warning', label: 'Abgebrochen' },
  };

  const config = statusConfig[status] || { variant: 'default' as const, label: status };

  return (
    <Badge variant={config.variant} dot>
      {config.label}
    </Badge>
  );
}
