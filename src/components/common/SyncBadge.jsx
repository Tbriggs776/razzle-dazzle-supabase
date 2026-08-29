import * as React from 'react';
import { RefreshCw, Check, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// The "RFMS says" marker — signals system-of-record state, deliberately distinct from
// StatusPill so "RAZZLE DAZZLE says" and "RFMS says" never blur.
const MAP = {
  synced: { cls: 'bg-good/15 text-good', Icon: Check, spin: false },
  syncing: { cls: 'bg-info/15 text-info', Icon: RefreshCw, spin: true },
  stale: { cls: 'bg-warn/15 text-warn', Icon: AlertTriangle, spin: false },
  error: { cls: 'bg-crit/15 text-crit', Icon: AlertCircle, spin: false },
};

export default function SyncBadge({ status = 'synced', label = 'RFMS', className }) {
  const { cls, Icon, spin } = MAP[status] || MAP.synced;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold',
        cls,
        className
      )}
    >
      <Icon className={cn('h-3 w-3', spin && 'animate-spin')} />
      {label}
    </span>
  );
}
