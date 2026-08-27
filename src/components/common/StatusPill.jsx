import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Semantic status chip. tone ∈ good | warn | crit | info | neutral.
// Domain labels (Synced, Overdue, Scheduled, Installed, Draft, …) map onto these five
// at the call site — one component replaces every ad-hoc bg-green-100 / bg-red-100 pill.
const TONES = { good: 'good', warn: 'warn', crit: 'crit', info: 'info', neutral: 'neutral' };

export default function StatusPill({ tone = 'neutral', dot = false, className, children }) {
  return (
    <Badge
      variant={TONES[tone] || 'neutral'}
      className={cn(
        'gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase leading-none tracking-wide',
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </Badge>
  );
}
