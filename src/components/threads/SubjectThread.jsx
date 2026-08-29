import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Loader2, Send, Lock, Home, HardHat, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import ModuleCard from '@/components/dashboard/ModuleCard';
import StatusPill from '@/components/common/StatusPill';

/**
 * Conversation attached to a record.
 *
 * The whole design turns on AUDIENCE. Every message is marked for who may read
 * it, so the homeowner and the subcontractor can take part in the same thread as
 * staff without ever seeing the internal half. The default is 'internal' on
 * purpose — the safe choice has to be the one you get by not thinking.
 *
 * Messages cannot be edited or deleted. A conversation that can be rewritten
 * afterwards is worthless in exactly the dispute it exists for.
 */

const AUDIENCE = [
  { key: 'internal',  label: 'Internal',     icon: Lock,   hint: 'Staff only' },
  { key: 'customer',  label: 'Homeowner',    icon: Home,   hint: 'Visible to the customer' },
  { key: 'installer', label: 'Subcontractor', icon: HardHat, hint: 'Visible to the crew' },
  { key: 'all',       label: 'Everyone',     icon: Globe,  hint: 'Visible to all participants' },
];
const AUD = Object.fromEntries(AUDIENCE.map((a) => [a.key, a]));
const TONE = { internal: 'neutral', customer: 'info', installer: 'warn', all: 'good' };

export default function SubjectThread({ subjectType, subjectId, defaultTopic = 'General' }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('internal');
  const [newTopic, setNewTopic] = useState('');

  const key = ['threads', subjectType, subjectId];

  const { data: threads = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => base44.entities.Thread.filter(
      { subject_type: subjectType, subject_id: subjectId }, '-created_at', 50,
    ),
    enabled: !!subjectId,
  });

  const [activeId, setActiveId] = useState(null);
  const active = useMemo(
    () => threads.find((t) => t.id === activeId) || threads[0] || null,
    [threads, activeId],
  );

  const { data: messages = [] } = useQuery({
    queryKey: ['threadMessages', active?.id],
    queryFn: () => base44.entities.ThreadMessage.filter({ thread_id: active.id }, 'created_at', 500),
    enabled: !!active?.id,
  });

  const openThread = useMutation({
    mutationFn: async (topic) => {
      const { data, error } = await base44.functions.invoke('openThread', {
        subjectType, subjectId, topic,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (id) => {
      setActiveId(id); setNewTopic('');
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e?.message || 'Could not start the thread'),
  });

  const post = useMutation({
    mutationFn: async () => {
      let threadId = active?.id;
      if (!threadId) threadId = await openThread.mutateAsync(defaultTopic);
      const { data, error } = await base44.functions.invoke('postMessage', {
        threadId, body, audience,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason || 'Could not post');
      return data;
    },
    onSuccess: (d) => {
      setBody('');
      queryClient.invalidateQueries({ queryKey: ['threadMessages', active?.id] });
      queryClient.invalidateQueries({ queryKey: ['inboxUnread'] });
      if (d?.notified === 0) toast.info('Posted. Nobody else is on this thread yet.');
    },
    onError: (e) => toast.error(e?.message || 'Could not post the message'),
  });

  return (
    <ModuleCard
      title="Conversation"
      icon={MessageSquare}
      subtitle={active ? active.topic : 'Nothing discussed yet'}
      action={
        threads.length > 1 && (
          <select
            value={active?.id || ''}
            onChange={(e) => setActiveId(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {threads.map((t) => <option key={t.id} value={t.id}>{t.topic}</option>)}
          </select>
        )
      }
    >
      <div className="p-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : messages.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No messages yet. Anything posted here stays with this record.
          </p>
        ) : (
          <div className="mb-3 space-y-2">
            {messages.map((m) => {
              const a = AUD[m.audience] || AUD.internal;
              const Icon = a.icon;
              return (
                <div key={m.id}
                  className={cn('rounded-lg border px-3 py-2',
                    m.audience === 'internal'
                      ? 'border-border bg-muted/40'
                      : 'border-primary/25 bg-primary/[0.04]')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {m.author_label || m.author_kind}
                    </span>
                    <StatusPill tone={TONE[m.audience]}>
                      <Icon className="mr-1 h-3 w-3" />{a.label}
                    </StatusPill>
                    <span className="text-[11px] text-muted-foreground">
                      {m.created_at ? formatDistanceToNow(new Date(m.created_at), { addSuffix: true }) : ''}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{m.body}</p>
                </div>
              );
            })}
          </div>
        )}

        {threads.length === 0 && (
          <div className="mb-3 flex gap-2">
            <Input value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
              placeholder={`Start a thread (e.g. "${defaultTopic}")`} />
            <Button variant="outline" disabled={!newTopic.trim() || openThread.isPending}
              onClick={() => openThread.mutate(newTopic.trim())}>
              Start
            </Button>
          </div>
        )}

        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Write a message…" />

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {/* Audience is chosen every time, and defaults to the safe one. */}
          <div className="flex flex-wrap gap-1">
            {AUDIENCE.map((a) => {
              const Icon = a.icon;
              return (
                <button key={a.key} type="button" title={a.hint}
                  onClick={() => setAudience(a.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                    audience === a.key
                      ? 'border-primary bg-primary/10 font-semibold text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}>
                  <Icon className="h-3 w-3" />{a.label}
                </button>
              );
            })}
          </div>
          <Button size="sm" disabled={!body.trim() || post.isPending} onClick={() => post.mutate()}>
            {post.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Post
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {AUD[audience].hint}. Messages cannot be edited or deleted.
        </p>
      </div>
    </ModuleCard>
  );
}
