import * as React from 'react';
import { cn } from '@/lib/utils';
import StatusPill from '@/components/common/StatusPill';

// One prop-driven row for installs / orders / leads / quotes / tickets — NOT five components.
// Lives inside a ModuleCard's divide-y list, so the row owns no border itself.
export default function WorkRow({
  lead,
  primary,
  meta,
  status,
  tone = 'neutral',
  trailing,
  onClick,
  className,
}) {
  const Comp = onClick ? 'button' : 'div';
  const hasLead = lead != null && lead !== '';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50',
        className
      )}
    >
      {hasLead && (
        <div className="w-[74px] shrink-0 font-display text-[13px] font-bold leading-tight tabular-nums">
          {lead}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{primary}</div>
        {meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
      </div>
      {trailing != null ? trailing : status ? <StatusPill tone={tone}>{status}</StatusPill> : null}
    </Comp>
  );
}
