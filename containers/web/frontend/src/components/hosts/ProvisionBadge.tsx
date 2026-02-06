/**
 * ProvisionBadge - Shows DC provisioning status next to hostname
 *
 * null     → nothing (provisioning not active)
 * pending  → yellow dot + "Queued"
 * running  → blue spinner + "Provisioning..."
 * synced   → green checkmark + "Synced"
 * failed   → red exclamation + "Failed"
 */

interface ProvisionBadgeProps {
  status?: 'pending' | 'running' | 'synced' | 'failed' | null;
  opId?: string | null;
}

export function ProvisionBadge({ status, opId }: ProvisionBadgeProps) {
  if (!status) return null;

  const config: Record<string, { dot: string; text: string; classes: string }> = {
    pending: {
      dot: 'bg-yellow-400',
      text: 'Queued',
      classes: 'text-yellow-700 bg-yellow-50 border-yellow-200',
    },
    running: {
      dot: 'bg-blue-400 animate-pulse',
      text: 'Provisioning...',
      classes: 'text-blue-700 bg-blue-50 border-blue-200',
    },
    synced: {
      dot: 'bg-green-400',
      text: 'Synced',
      classes: 'text-green-700 bg-green-50 border-green-200',
    },
    failed: {
      dot: 'bg-red-400',
      text: 'Failed',
      classes: 'text-red-700 bg-red-50 border-red-200',
    },
  };

  const c = config[status];
  if (!c) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${c.classes}`}
      title={opId ? `Operation: ${opId}` : undefined}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.text}
    </span>
  );
}
