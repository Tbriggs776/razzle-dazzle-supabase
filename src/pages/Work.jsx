import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, CheckCircle2, ClipboardList, ShieldCheck, Users, AlertTriangle, Clock, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow, isPast } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import ModuleCard from '@/components/dashboard/ModuleCard';
import KpiTile from '@/components/dashboard/KpiTile';
import { NewTaskDialog, TaskDetailSheet } from '@/components/work/TaskDialogs';

const DEPT_LABEL = {
  sales: 'Sales', ordering: 'Order Processing', scheduling: 'Install Coordination',
  install: 'Field', cx: 'Razzle Dazzle', finance: 'Accounting',
};

/**
 * Work — one screen for "what is on me" and, for managers, "what is happening".
 *
 * A task here is not a to-do: it names a subject, an owner and a due time, and
 * closing it is what advances the job. An approval is the gate between steps —
 * and it always needs a second person, which is enforced server-side.
 */
export default function Work() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [decide, setDecide] = useState(null);   // the approval being decided
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [openTask, setOpenTask] = useState(null);   // the task being managed
  const [note, setNote] = useState('');

  const { data: me } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['workTasks'],
    queryFn: () => base44.entities.Task.filter({ completed_at: null }, '-created_date', 500),
    refetchInterval: 60000,
  });

  const { data: approvals = [] } = useQuery({
    queryKey: ['workApprovals'],
    queryFn: () => base44.entities.Approval.filter({ state: 'pending' }, '-requested_at', 200),
    refetchInterval: 60000,
  });

  const myId = me?.id;
  const mine = useMemo(() => tasks.filter((t) => t.assigned_user === myId), [tasks, myId]);
  const others = useMemo(() => tasks.filter((t) => t.assigned_user !== myId), [tasks, myId]);
  const overdue = useMemo(
    () => mine.filter((t) => t.due_at && isPast(new Date(t.due_at))), [mine],
  );

  // Grouped by department — the "what is happening" view. Empty departments are
  // shown too: a queue with nothing in it is information, not noise.
  const byDept = useMemo(() => {
    const m = {};
    for (const t of others) {
      const k = t.dept || 'unassigned';
      (m[k] ||= []).push(t);
    }
    return m;
  }, [others]);

  const complete = useMutation({
    mutationFn: async ({ id, resolution }) => {
      const { data, error } = await base44.functions.invoke('completeTask', { id, resolution });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason || 'Could not complete');
      return data;
    },
    onSuccess: () => {
      ['workTasks', 'inbox', 'inboxUnread'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }));
      toast.success('Done');
    },
    onError: (e) => toast.error(e?.message || 'Could not complete the task'),
  });

  const decideMutation = useMutation({
    mutationFn: async ({ id, state, decisionNote }) => {
      const { data, error } = await base44.functions.invoke('decideApproval', { id, state, note: decisionNote });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason || 'Could not record the decision');
      return data;
    },
    onSuccess: (d) => {
      ['workApprovals', 'inbox', 'inboxUnread'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }));
      setDecide(null); setNote('');
      toast.success(`Approval ${d?.state}`);
    },
    // The server refuses self-approval; surface that plainly rather than as a failure.
    onError: (e) => toast.error(e?.message || 'Could not record the decision'),
  });

  const TaskRow = ({ t, showOwner }) => {
    const due = t.due_at ? new Date(t.due_at) : null;
    const late = due && isPast(due);
    return (
      <div className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenTask(t)}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {t.created_reason?.title || t.notes || 'Task'}
            </span>
            {late && <StatusPill tone="crit">Overdue</StatusPill>}
            {t.dept && !showOwner && <StatusPill tone="neutral">{DEPT_LABEL[t.dept] || t.dept}</StatusPill>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {due ? `Due ${formatDistanceToNow(due, { addSuffix: true })}` : 'No due date'}
            {t.subject_type ? ` · ${t.subject_type} ${t.subject_id}` : ''}
            {showOwner && t.assigned_role ? ` · ${t.assigned_role}` : ''}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {t.subject_type === 'project' && t.subject_id && (
            <Button size="sm" variant="ghost"
              onClick={() => navigate(`/JourneyProjectDetail?id=${t.subject_id}`)}>
              Open
            </Button>
          )}
          {t.assigned_user === myId && (
            <Button size="sm" variant="outline" disabled={complete.isPending}
              onClick={() => complete.mutate({ id: t.id, resolution: 'Completed from Work' })}>
              {complete.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              Done
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Work"
          subtitle="What is on you, what needs a decision, and what every department is holding"
          actions={
            <Button onClick={() => setNewTaskOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New task
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile hero label="On me" value={String(mine.length)} foot="Open tasks assigned to you" />
          <KpiTile label="Overdue" value={String(overdue.length)}
            foot={overdue.length ? 'Past their due time' : 'Nothing late'} />
          <KpiTile label="Awaiting decision" value={String(approvals.length)} foot="Pending approvals" />
          <KpiTile label="Across the company" value={String(others.length)} foot="Open elsewhere" />
        </div>

        {/* Approvals first — they block someone else's work. */}
        {approvals.length > 0 && (
          <ModuleCard title="Needs a decision" icon={ShieldCheck}
            subtitle="An approval always needs a second person — you cannot decide your own request">
            {approvals.map((a) => {
              const isMine = a.requested_by && me?.email
                && a.requested_by.toLowerCase() === me.email.toLowerCase();
              return (
                <div key={a.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{a.kind}</span>
                      <StatusPill tone="warn">Pending</StatusPill>
                      {isMine && <StatusPill tone="neutral">Your request</StatusPill>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.reason}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {a.requested_by} · {a.requested_at
                        ? formatDistanceToNow(new Date(a.requested_at), { addSuffix: true }) : ''}
                      {a.required_dept ? ` · ${DEPT_LABEL[a.required_dept] || a.required_dept}` : ''}
                    </p>
                  </div>
                  <Button size="sm" className="shrink-0" disabled={isMine}
                    title={isMine ? 'You cannot decide your own request' : undefined}
                    onClick={() => { setDecide(a); setNote(''); }}>
                    Decide
                  </Button>
                </div>
              );
            })}
          </ModuleCard>
        )}

        <ModuleCard title="On me" icon={ClipboardList}
          subtitle={mine.length ? undefined : 'Nothing assigned to you right now'}>
          {isLoading ? (
            <div className="flex items-center justify-center py-14">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : mine.length === 0 ? (
            <div className="py-14 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <p className="text-muted-foreground">You're clear</p>
            </div>
          ) : (
            mine
              .slice()
              .sort((a, b) => (a.due_at || '9999').localeCompare(b.due_at || '9999'))
              .map((t) => <TaskRow key={t.id} t={t} />)
          )}
        </ModuleCard>

        {/* The manager view: every department's open load, side by side. */}
        <ModuleCard title="By department" icon={Users}
          subtitle="Open work across the company — an empty queue is information too">
          {Object.keys(DEPT_LABEL).map((k) => {
            const rows = byDept[k] || [];
            const late = rows.filter((t) => t.due_at && isPast(new Date(t.due_at))).length;
            return (
              <div key={k} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{DEPT_LABEL[k]}</span>
                  <div className="flex items-center gap-2">
                    {late > 0 && <StatusPill tone="crit">{late} overdue</StatusPill>}
                    <span className={cn('text-sm tabular-nums',
                      rows.length ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                      {rows.length}
                    </span>
                  </div>
                </div>
                {rows.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {rows.slice(0, 3).map((t) => (
                      <p key={t.id} className="truncate text-xs text-muted-foreground">
                        {t.due_at && isPast(new Date(t.due_at))
                          ? <AlertTriangle className="mr-1 inline h-3 w-3 text-destructive" />
                          : <Clock className="mr-1 inline h-3 w-3" />}
                        {t.created_reason?.title || t.notes}
                      </p>
                    ))}
                    {rows.length > 3 && (
                      <p className="text-xs text-muted-foreground">+{rows.length - 3} more</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </ModuleCard>
      </div>

      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />

      <TaskDetailSheet
        task={openTask}
        open={!!openTask}
        onOpenChange={(o) => !o && setOpenTask(null)}
        currentUserId={myId}
      />

      <Dialog open={!!decide} onOpenChange={(o) => !o && setDecide(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{decide?.kind}</DialogTitle>
            <DialogDescription>{decide?.reason}</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note — this is recorded against the decision" />
          <DialogFooter>
            <Button variant="outline" disabled={decideMutation.isPending}
              onClick={() => decideMutation.mutate({ id: decide.id, state: 'rejected', decisionNote: note })}>
              Reject
            </Button>
            <Button disabled={decideMutation.isPending}
              onClick={() => decideMutation.mutate({ id: decide.id, state: 'approved', decisionNote: note })}>
              {decideMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
