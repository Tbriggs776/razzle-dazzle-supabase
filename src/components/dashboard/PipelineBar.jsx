import * as React from 'react';
import { cn } from '@/lib/utils';

// Segmented pipeline / funnel bar. stages: [{ name, count, value?, attention? }].
// Color ramp navy → blue → sky → pink for progression; an at-risk/over-threshold stage
// takes brand-gold — never the pink accent.
const RAMP = ['bg-brand-navy', 'bg-brand-blue', 'bg-brand-sky', 'bg-brand-pink'];

export default function PipelineBar({ stages = [], className }) {
  const max = Math.max(1, ...stages.map((s) => s.count || 0));
  return (
    <div className={cn('space-y-2', className)}>
      {stages.map((s, i) => {
        const pct = Math.max(8, Math.round(((s.count || 0) / max) * 100));
        const color = s.attention ? 'bg-brand-gold' : RAMP[Math.min(i, RAMP.length - 1)];
        return (
          <div key={s.name} className="grid grid-cols-[minmax(96px,130px)_1fr_auto] items-center gap-3">
            <span className="truncate text-xs font-semibold text-muted-foreground">{s.name}</span>
            <div className="h-6 overflow-hidden rounded-md bg-muted">
              <div
                className={cn(
                  'flex h-full items-center rounded-md pl-2.5 text-[11px] font-bold tabular-nums',
                  color,
                  s.attention ? 'text-brand-navy' : 'text-white'
                )}
                style={{ width: `${pct}%` }}
              >
                {s.count}
              </div>
            </div>
            {s.value != null && (
              <span className="w-[76px] text-right font-display text-[13px] font-bold tabular-nums">{s.value}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
