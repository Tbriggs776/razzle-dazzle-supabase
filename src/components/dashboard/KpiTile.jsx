import * as React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

function Sparkline({ data = [], hero }) {
  if (!data || data.length < 2) return null;
  const W = 76, H = 26, pad = 2;
  const max = Math.max(...data), min = Math.min(...data), span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * (W - 2) + 1;
      const y = H - pad - ((v - min) / span) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-6 w-[76px] shrink-0" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={hero ? 'hsl(var(--brand-pink))' : 'hsl(var(--brand-blue))'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// KPI tile. deltaTone ('good' | 'bad' | 'flat') is SEMANTIC and decoupled from the arrow
// direction — an "up" arrow on a bad metric (AR aging, backorders) reads red, not green.
// hero: the single most important tile per view — the only KPI allowed the pink accent.
export default function KpiTile({
  label,
  value,
  delta,
  dir = 'flat',
  deltaTone = 'flat',
  foot,
  spark,
  hero = false,
  onClick,
  className,
}) {
  const Arrow = dir === 'up' ? ArrowUp : dir === 'down' ? ArrowDown : null;
  const dcls = deltaTone === 'good' ? 'text-good' : deltaTone === 'bad' ? 'text-crit' : 'text-muted-foreground';
  return (
    <Card
      onClick={onClick}
      className={cn(
        'relative overflow-hidden p-4',
        hero && 'border-brand-pink/35',
        onClick && 'cursor-pointer transition-shadow hover:shadow-md',
        className
      )}
    >
      {hero && <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand-pink to-brand-pink-bright" />}
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-2 font-display font-extrabold leading-none tabular-nums',
          hero ? 'text-[28px] text-brand-pink' : 'text-[25px]'
        )}
      >
        {value}
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-2">
        {delta ? (
          <span className={cn('inline-flex items-center gap-1 text-[11.5px] font-bold', dcls)}>
            {Arrow && <Arrow className="h-3 w-3" />}
            {delta}
          </span>
        ) : (
          <span />
        )}
        <Sparkline data={spark} hero={hero} />
      </div>
      {foot && <div className="mt-2 text-[11px] leading-snug text-muted-foreground/80">{foot}</div>}
    </Card>
  );
}
