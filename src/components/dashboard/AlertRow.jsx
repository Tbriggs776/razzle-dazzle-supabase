import * as React from 'react';
import { AlertTriangle, Clock, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// "Needs Attention" row: severity icon + title + detail + trailing CTA verb (the whole point).
const SEV = {
  crit: { Icon: AlertTriangle, ic: 'bg-crit/12 text-crit' },
  warn: { Icon: Clock, ic: 'bg-warn/15 text-warn' },
  info: { Icon: Info, ic: 'bg-info/12 text-info' },
};

export default function AlertRow({ severity = 'info', title, detail, cta, onCta, className }) {
  const { Icon, ic } = SEV[severity] || SEV.info;
  return (
    <div className={cn('flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50', className)}>
      <div className={cn('grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg', ic)}>
        <Icon className="h-[15px] w-[15px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold leading-snug">{title}</div>
        {detail && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{detail}</p>}
      </div>
      {cta && (
        <button
          onClick={onCta}
          className="shrink-0 self-center whitespace-nowrap text-[11px] font-bold text-brand-blue hover:underline"
        >
          {cta} →
        </button>
      )}
    </div>
  );
}
