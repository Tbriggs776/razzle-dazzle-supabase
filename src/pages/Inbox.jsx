import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CheckCircle2, Loader2, ShieldAlert, Info, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import ModuleCard from '@/components/dashboard/ModuleCard';

const SEV_ICON = { crit: ShieldAlert, warn: TriangleAlert, info: Info };
const SEV_TONE = { crit: 'crit', warn: 'warn', info: 'info' };

/**
 * The in-app inbox.
 *
 * This exists because every other internal channel in this system can fail
 * silently: email needs a Resend key, SMS needs a Twilio from-number, and every
 * alert roster is empty. Those failures are invisible — the job stalls while the
 * board shows green.
 *
 * ACKNOWLEDGE is deliberately separate from read. Read means it rendered.
 * Acknowledged means a named human took responsibility for it, which is the only
 * thing worth measuring.
 */
export default function Inbox() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showDone, setShowDone] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['inbox'],
    // Explicit sort: this table has no created_date, the client default would 400.
    queryFn: () => base44.entities.Notification.list('-created_at', 200),
    refetchInterval: 60000,
  });

  const open = useMemo(() => rows.filter((r) => !r.acknowledged_at), [rows]);
  const done = useMemo(() => rows.filter((r) => r.acknowledged_at), [rows]);
  const unread = useMemo(() => open.filter((r) => !r.read_at), [open]);

  const ack = useMutation({
    mutationFn: async (id) => {
      const { data, error } = await base44.functions.invoke('acknowledgeNotification', { id });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason || 'Could not acknowledge');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      queryClient.invalidateQueries({ queryKey: ['inboxUnread'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not acknowledge'),
  });

  const markRead = useMutation({
    mutationFn: async (ids) => {
      const { error } = await base44.functions.invoke('markNotificationsRead', { ids });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
      queryClient.invalidateQueries({ queryKey: ['inboxUnread'] });
    },
  });

  const openItem = (n) => {
    if (!n.read_at) markRead.mutate([n.id]);
    if (n.route) navigate(n.route);
  };

  const Row = ({ n }) => {
    const Icon = SEV_ICON[n.severity] || Info;
    const isUnread = !n.read_at;
    return (
      <div
        className={cn(
          'flex items-start gap-3 px-4 py-3 transition-colors',
          n.route && 'cursor-pointer hover:bg-muted/60',
          isUnread && 'bg-primary/[0.04]',
        )}
        onClick={() => openItem(n)}
      >
        <Icon
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0',
            n.severity === 'crit' ? 'text-destructive'
              : n.severity === 'warn' ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-sm text-foreground', isUnread ? 'font-semibold' : 'font-medium')}>
              {n.title}
            </span>
            {n.requires_ack && !n.acknowledged_at && (
              <StatusPill tone={SEV_TONE[n.severity] || 'info'}>Needs acknowledgement</StatusPill>
            )}
          </div>
          {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {n.created_at ? formatDistanceToNow(new Date(n.created_at), { addSuffix: true }) : ''}
            {n.acknowledged_at
              ? ` · acknowledged ${formatDistanceToNow(new Date(n.acknowledged_at), { addSuffix: true })}`
              : ''}
          </p>
        </div>
        {!n.acknowledged_at && (() => {
          // ONE mutation object serves every row, so `ack.isPending` alone put all
          // 30 alerts into the spinner and blanked all 30 labels when you
          // acknowledged one. Comparing against the in-flight variables narrows it
          // to the row actually being acted on.
          const busy = ack.isPending && ack.variables === n.id;
          return (
            <Button
              size="sm"
              variant={n.severity === 'crit' ? 'default' : 'outline'}
              className="shrink-0"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); ack.mutate(n.id); }}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              {busy ? '' : 'Acknowledge'}
            </Button>
          );
        })()}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Inbox"
          subtitle={
            open.length === 0
              ? 'Nothing outstanding'
              : `${open.length} outstanding${unread.length ? ` · ${unread.length} unread` : ''}`
          }
          actions={
            unread.length > 0 && (
              <Button variant="outline" onClick={() => markRead.mutate(unread.map((n) => n.id))}>
                Mark all read
              </Button>
            )
          }
        />

        <ModuleCard title="Outstanding" icon={Bell}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : open.length === 0 ? (
            <div className="py-16 text-center">
              <BellOff className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <p className="text-muted-foreground">You're clear</p>
            </div>
          ) : (
            open.map((n) => <Row key={n.id} n={n} />)
          )}
        </ModuleCard>

        {done.length > 0 && (
          <ModuleCard
            title="Acknowledged"
            icon={CheckCircle2}
            subtitle={`${done.length} handled`}
            action={
              <Button variant="ghost" size="sm" onClick={() => setShowDone((v) => !v)}>
                {showDone ? 'Hide' : 'Show'}
              </Button>
            }
          >
            {showDone && done.map((n) => <Row key={n.id} n={n} />)}
          </ModuleCard>
        )}
      </div>
    </div>
  );
}
