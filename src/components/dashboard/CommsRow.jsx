import * as React from 'react';
import { cn } from '@/lib/utils';

// Live-comms feed row. channel ∈ sms | email | system. Ties to Twilio (sms) / Resend (email)
// / system events. Inbound gets a pink unread dot.
const CH = {
  sms: 'bg-good/15 text-good',
  email: 'bg-info/15 text-info',
  system: 'bg-muted text-muted-foreground',
};
const AV = ['bg-brand-pink', 'bg-brand-navy', 'bg-brand-blue'];

function initials(who = '', channel) {
  if (channel === 'system') return '⚙';
  const p = who
    .replace(/[^A-Za-z ]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
  return p.toUpperCase() || '?';
}

export default function CommsRow({ who, channel = 'system', text, when, inbound = false, index = 0, className }) {
  return (
    <div className={cn('flex gap-3 px-4 py-2.5', className)}>
      <div
        className={cn(
          'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[11px] font-bold text-white',
          AV[index % AV.length]
        )}
      >
        {initials(who, channel)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'text-xs font-semibold',
              inbound &&
                "after:ml-1.5 after:inline-block after:h-1.5 after:w-1.5 after:rounded-full after:bg-brand-pink after:align-middle after:content-['']"
            )}
          >
            {who}
          </span>
          <span className={cn('rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide', CH[channel] || CH.system)}>
            {channel}
          </span>
          <time className="ml-auto shrink-0 text-[10.5px] text-muted-foreground/70">{when}</time>
        </div>
        {text && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{text}</p>}
      </div>
    </div>
  );
}
