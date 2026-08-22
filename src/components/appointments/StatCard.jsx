import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

// Renders a single summary stat card with an optional vs-previous-period delta.
// `prev` is the prior-period value (number). For percentage cards pass prevSuffix="%".
export default function StatCard({ label, value, prev, prevSuffix = '', color = 'text-foreground', sub, invertTrend = false }) {
  // For close-rate (percentage) the value is a string like "48%", so parse for delta math
  const numericValue = typeof value === 'string' ? parseFloat(value) : value;
  const numericPrev = typeof prev === 'number' ? prev : null;
  const realDelta = numericPrev != null && numericPrev !== 0 ? numericValue - numericPrev : null;

  const up = realDelta != null && realDelta > 0;
  const down = realDelta != null && realDelta < 0;
  const flat = realDelta != null && realDelta === 0;

  // For inverted metrics (e.g. Cancelled), a decrease is good (green) and an increase is bad (red)
  const goodIsUp = invertTrend ? down : up;
  const badIsDown = invertTrend ? up : down;

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className={cn('text-2xl font-bold', color)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</p>}
      {realDelta != null && (
        <div className="flex items-center gap-1 mt-1.5 text-[11px]">
          {goodIsUp && !invertTrend && <TrendingUp className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
          {goodIsUp && invertTrend && <TrendingDown className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
          {badIsDown && !invertTrend && <TrendingDown className="w-3 h-3 text-red-600 dark:text-red-400" />}
          {badIsDown && invertTrend && <TrendingUp className="w-3 h-3 text-red-600 dark:text-red-400" />}
          {flat && <Minus className="w-3 h-3 text-muted-foreground/70" />}
          <span
            className={cn(
              'font-medium',
              goodIsUp ? 'text-emerald-600 dark:text-emerald-400' : badIsDown ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground/70'
            )}
          >
            {up ? '+' : ''}{realDelta}{prevSuffix} vs last period
          </span>
        </div>
      )}
    </div>
  );
}
