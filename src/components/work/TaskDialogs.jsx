import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, CheckCircle2, UserRound, ShieldCheck, MessageSquarePlus, History, ExternalLink, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow, isPast, format } from 'date-fns';
import StatusPill from '@/components/common/StatusPill';

export const DEPTS = [
  { key: 'sales', label: 'Sales' },
  { key: 'ordering', label: 'Order Processing' },
  { key: 'scheduling', label: 'Install Coordination' },
  { key: 'install', label: 'Field' },
  { key: 'cx', label: 'Razzle Dazzle' },
  { key: 'finance', label: 'Accounting' },
];
const DEPT_LABEL = Object.fromEntries(DEPTS.map((d) => [d.key, d.label]));

const selectCls =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

/** People who can hold work. Names only — a picker identifies a person, it does
 *  not expose the directory. Available to any signed-in user, unlike the
 *  org-admin-gated roster the Routing page uses. */
export function useAssignableUsers() {
  const { data = [] } = useQuery({
    queryKey: ['assignableUsers'],
    queryFn: async () => {
      const { data, error } = await base44.functions.invoke('assignableUsers', {});
      if (error) throw error;
      return data || [];
    },
    staleTime: 300000,
  });
  return data;
}

/* ── Create ─────────────────────────────────────────────────────────────── */

export function NewTaskDialog({ open, onOpenChange, subjectType, subjectId }) {
  const qc = useQueryClient();
  const people = useAssignableUsers();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dept, setDept] = useState('');
  const [userId, setUserId] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('3');

  const reset = () => {
    setTitle(''); setNotes(''); setDept(''); setUserId(''); setDue(''); setPriority('3');
  };

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await base44.functions.invoke('assignTask', {
        title: title.trim(),
        notes: notes.trim() || null,
        dept: dept || null,
        assignedUser: userId || null,
        dueAt: due ? new Date(due).toISOString() : null,
        priority: Number(priority) || 3,
        subjectType: subjectType || null,
        subjectId: subjectId || null,
        route: subjectType === 'project' && subjectId
          ? `/JourneyProjectDetail?id=${subjectId}` : '/Work',
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason || 'Could not create the task');
      return data;
    },
    onSuccess: (d) => {
      ['workTasks', 'inbox', 'inboxUnread'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false); reset();
      // Say who it landed on. An assignment whose owner is a mystery is the
      // failure this whole layer exists to fix.
      const who = people.find((p) => p.user_id === d?.assigned_to)?.name;
      toast.success(who ? `Assigned to ${who}` : 'Task created',
        { description: d?.notified ? `${d.notified} person notified` : 'Nobody was notified' });
    },
    onError: (e) => toast.error(e?.message || 'Could not create the task'),
  });

  // Either a department or a person — not both, so it is never ambiguous who owns it.
  const canSave = title.trim().length > 0 && (dept || userId);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Give it to a person, or to a department and let the on-call rota decide.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="t-title">What needs doing</Label>
            <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Confirm the subfloor moisture reading" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="t-dept">Department</Label>
              <select id="t-dept" className={selectCls} value={dept}
                onChange={(e) => { setDept(e.target.value); if (e.target.value) setUserId(''); }}>
                <option value="">—</option>
                {DEPTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="t-user">Or a specific person</Label>
              <select id="t-user" className={selectCls} value={userId}
                onChange={(e) => { setUserId(e.target.value); if (e.target.value) setDept(''); }}>
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.user_id} value={p.user_id}>{p.name || 'Unnamed account'}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="t-due">Due</Label>
              <Input id="t-due" type="datetime-local" value={due}
                onChange={(e) => setDue(e.target.value)} className="bg-background text-foreground" />
            </div>
            <div>
              <Label htmlFor="t-pri">Priority</Label>
              <select id="t-pri" className={selectCls} value={priority}
                onChange={(e) => setPriority(e.target.value)}>
                <option value="1">1 — urgent</option>
                <option value="2">2 — high</option>
                <option value="3">3 — normal</option>
                <option value="4">4 — low</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="t-notes">Detail</Label>
            <Textarea id="t-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the person picking this up needs to know" />
          </div>

          {!canSave && title.trim() && (
            <p className="text-xs text-muted-foreground">
              Choose a department or a person — work with no owner is how things get dropped.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSave || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create and assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Open / manage ──────────────────────────────────────────────────────── */

export function TaskDetailSheet({ task, open, onOpenChange, currentUserId }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const people = useAssignableUsers();

  const [note, setNote] = useState('');

  // Seeded from the task, and re-seeded when a different task is opened — the
  // sheet is reused, so without this you would edit task B with task A's values.
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editPriority, setEditPriority] = useState('3');
  const [seededFor, setSeededFor] = useState(null);
  if (task && seededFor !== task.id) {
    setSeededFor(task.id);
    setEditTitle(task.created_reason?.title || task.notes || '');
    setEditNotes(task.notes || '');
    setEditDue(toLocalInput(task.due_at));
    setEditPriority(String(task.priority ?? 3));
  }

  const [reassignTo, setReassignTo] = useState('');
  const [reassignDept, setReassignDept] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [approvalDept, setApprovalDept] = useState('');

  const refresh = () => ['workTasks', 'taskLog', 'workApprovals', 'inbox', 'inboxUnread']
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const { data: history = [] } = useQuery({
    queryKey: ['taskLog', task?.id],
    queryFn: () => base44.entities.TaskLog.filter({ task_id: task.id }, 'created_at', 200),
    enabled: !!task?.id && open,
  });

  const doReassign = useMutation({
    mutationFn: async () => {
      const { data, error } = await base44.functions.invoke('reassignTask', {
        id: task.id,
        userId: reassignTo || null,
        dept: reassignTo ? null : (reassignDept || null),
        note: note.trim() || null,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data;
    },
    onSuccess: (d) => {
      refresh(); setReassignTo(''); setReassignDept(''); setNote('');
      const who = people.find((p) => p.user_id === d?.assigned_to)?.name;
      toast.success(who ? `Now with ${who}` : 'Reassigned');
    },
    onError: (e) => toast.error(e?.message || 'Could not reassign'),
  });

  const dirty = !!task && (
    editTitle !== (task.created_reason?.title || task.notes || '')
    || editNotes !== (task.notes || '')
    || editDue !== toLocalInput(task.due_at)
    || editPriority !== String(task.priority ?? 3)
  );

  const update = useMutation({
    mutationFn: async ({ clearDue }) => {
      const { data, error } = await base44.functions.invoke('updateTask', {
        id: task.id,
        title: clearDue ? null : editTitle.trim() || null,
        notes: clearDue ? null : editNotes,
        dueAt: clearDue || !editDue ? null : new Date(editDue).toISOString(),
        priority: clearDue ? null : Number(editPriority),
        clearDue: !!clearDue,
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data;
    },
    onSuccess: (d) => {
      refresh();
      setSeededFor(null);   // re-seed from the saved row
      toast.success(d?.changed ? 'Updated' : 'Nothing to change',
        d?.changes ? { description: d.changes } : undefined);
    },
    onError: (e) => toast.error(e?.message || 'Could not update the task'),
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const { data, error } = await base44.functions.invoke('addTaskNote', { id: task.id, note: note.trim() });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data;
    },
    onSuccess: () => { refresh(); setNote(''); toast.success('Noted'); },
    onError: (e) => toast.error(e?.message || 'Could not add the note'),
  });

  const requestApproval = useMutation({
    mutationFn: async () => {
      const { data, error } = await base44.functions.invoke('requestApproval', {
        subjectType: task.subject_type || 'task',
        subjectId: task.subject_id || task.id,
        kind: 'task_approval',
        reason: approvalReason.trim(),
        requiredDept: approvalDept || null,
        route: '/Work',
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      refresh(); setApprovalReason(''); setApprovalDept('');
      // Surface the unreachable case rather than letting it sit pending forever.
      if (d?.unreachable) {
        toast.warning('Approval raised, but nobody could be found to decide it', {
          description: 'Staff that department in Routing, or it will sit pending.',
        });
      } else {
        toast.success(`Approval requested — ${d?.notified} person notified`);
      }
    },
    onError: (e) => toast.error(e?.message || 'Could not request approval'),
  });

  const complete = useMutation({
    mutationFn: async () => {
      const { data, error } = await base44.functions.invoke('completeTask', {
        id: task.id, resolution: note.trim() || 'Completed',
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason);
      return data;
    },
    onSuccess: () => { refresh(); onOpenChange(false); toast.success('Done'); },
    onError: (e) => toast.error(e?.message || 'Could not complete'),
  });

  const title = task?.created_reason?.title || task?.notes || 'Task';
  const owner = people.find((p) => p.user_id === task?.assigned_user);
  const due = task?.due_at ? new Date(task.due_at) : null;
  const late = due && isPast(due);
  const isMine = task?.assigned_user === currentUserId;

  if (!task) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-6 text-left">{title}</SheetTitle>
          <SheetDescription className="text-left">
            {task.notes && task.notes !== title ? task.notes : null}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Who has it, and by when */}
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={late ? 'crit' : 'info'}>
                {late ? 'Overdue' : due ? 'Open' : 'No due date'}
              </StatusPill>
              {task.dept && <StatusPill tone="neutral">{DEPT_LABEL[task.dept] || task.dept}</StatusPill>}
              {task.source === 'rule' && <StatusPill tone="neutral">Automatic</StatusPill>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Assigned to</dt>
                <dd className="text-foreground">
                  {owner?.name || (task.assigned_user ? 'Unnamed account' : 'Nobody')}
                  {isMine && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Due</dt>
                <dd className={cn('text-foreground', late && 'text-destructive')}>
                  {due ? format(due, 'MMM d, h:mm a') : '—'}
                </dd>
              </div>
            </dl>
            {task.subject_type === 'project' && task.subject_id && (
              <Button variant="ghost" size="sm" className="mt-2 -ml-2"
                onClick={() => navigate(`/JourneyProjectDetail?id=${task.subject_id}`)}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open the job
              </Button>
            )}
          </div>

          {/* Adjust what the system chose.
              The reconciler picks an owner from the on-call rota and a due date
              from (stage entered + the rule's SLA) — both guesses made without
              knowing what is actually happening on the job. If the only options
              were accept or close, people would close things that are not done. */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Pencil className="h-4 w-4 text-muted-foreground" />Adjust
            </h3>
            {task.source === 'rule' && (
              <p className="mb-2 text-xs text-muted-foreground">
                This was raised automatically for the{' '}
                <span className="text-foreground">{task.created_reason?.stage || 'current'}</span>{' '}
                stage. The owner and due date are the system's starting point — change them.
              </p>
            )}
            <div className="space-y-2">
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title" />
              <Textarea rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Detail" />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Due</Label>
                  <Input type="datetime-local" value={editDue}
                    onChange={(e) => setEditDue(e.target.value)}
                    className="bg-background text-foreground" />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Priority</Label>
                  <select className={selectCls} value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value)}>
                    <option value="1">1 — urgent</option>
                    <option value="2">2 — high</option>
                    <option value="3">3 — normal</option>
                    <option value="4">4 — low</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!dirty || update.isPending}
                  onClick={() => update.mutate({})}>
                  {update.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save changes
                </Button>
                {task.due_at && (
                  <Button size="sm" variant="ghost" disabled={update.isPending}
                    onClick={() => update.mutate({ clearDue: true })}>
                    Remove due date
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Changes are recorded in the history below with their old and new values, and the
                reconciler will not overwrite them.
              </p>
            </div>
          </section>

          {/* Hand it over */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <UserRound className="h-4 w-4 text-muted-foreground" />Assign
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select className={selectCls} value={reassignTo}
                onChange={(e) => { setReassignTo(e.target.value); if (e.target.value) setReassignDept(''); }}>
                <option value="">To a person…</option>
                {people.map((p) => (
                  <option key={p.user_id} value={p.user_id}>{p.name || 'Unnamed account'}</option>
                ))}
              </select>
              <select className={selectCls} value={reassignDept}
                onChange={(e) => { setReassignDept(e.target.value); if (e.target.value) setReassignTo(''); }}>
                <option value="">Or a department…</option>
                {DEPTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>
            <Button size="sm" variant="outline" className="mt-2"
              disabled={(!reassignTo && !reassignDept) || doReassign.isPending}
              onClick={() => doReassign.mutate()}>
              {doReassign.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Reassign
            </Button>
          </section>

          {/* Ask someone to sign off */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />Request approval
            </h3>
            <Textarea rows={2} value={approvalReason} onChange={(e) => setApprovalReason(e.target.value)}
              placeholder="What are you asking someone to approve, and why?" />
            <div className="mt-2 flex gap-2">
              <select className={selectCls} value={approvalDept}
                onChange={(e) => setApprovalDept(e.target.value)}>
                <option value="">Who decides…</option>
                {DEPTS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <Button size="sm" variant="outline" className="shrink-0"
                disabled={!approvalReason.trim() || requestApproval.isPending}
                onClick={() => requestApproval.mutate()}>
                {requestApproval.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Request
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              You cannot decide your own request — an approval always needs a second person.
            </p>
          </section>

          {/* Say what happened */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />Note
            </h3>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Progress, a blocker, who you spoke to…" />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!note.trim() || addNote.isPending}
                onClick={() => addNote.mutate()}>
                {addNote.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Add note
              </Button>
              {!task.completed_at && (
                <Button size="sm" disabled={complete.isPending} onClick={() => complete.mutate()}>
                  {complete.isPending
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                  Mark done
                </Button>
              )}
            </div>
          </section>

          {/* The record. Append-only — nothing here can be edited or removed. */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <History className="h-4 w-4 text-muted-foreground" />History
            </h3>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ol className="space-y-2 border-l border-border pl-3">
                {history.map((h) => (
                  <li key={h.id} className="text-xs">
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span className="font-medium text-foreground">{h.action}</span>
                      <span className="text-muted-foreground">
                        {h.actor_email || 'system'} ·{' '}
                        {h.created_at ? formatDistanceToNow(new Date(h.created_at), { addSuffix: true }) : ''}
                      </span>
                    </div>
                    {h.detail && <p className="mt-0.5 text-muted-foreground">{h.detail}</p>}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              This history is append-only. Nothing here can be edited or deleted.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
