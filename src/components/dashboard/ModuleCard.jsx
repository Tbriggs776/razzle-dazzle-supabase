import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

// The primary work-surface wrapper: a header (title + subtitle + right slot for a SyncBadge
// or "View all" link) over a divide-y list of WorkRows. Used across dashboards and lists.
export default function ModuleCard({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  footer,
  className,
  bodyClassName,
}) {
  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-display text-sm font-bold tracking-tight">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            <span className="truncate">{title}</span>
          </div>
          {subtitle && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{subtitle}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={cn('divide-y divide-border', bodyClassName)}>{children}</div>
      {footer && <div className="border-t border-border px-4 py-2.5 text-xs">{footer}</div>}
    </Card>
  );
}
