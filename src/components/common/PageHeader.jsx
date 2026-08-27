import * as React from 'react';
import { cn } from '@/lib/utils';

// Standard page header: eyebrow + title (Archivo) + subtitle, with a right-hand action
// cluster. This is the ONLY sanctioned home for the single pink CTA per view
// (<Button variant="accent">…</Button>) — how the accent stays disciplined across ~70 pages.
export default function PageHeader({ eyebrow, title, subtitle, actions, children, className }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</div>
        )}
        <h1 className="text-balance font-display text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
