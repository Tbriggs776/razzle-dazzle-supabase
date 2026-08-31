import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/common/PageHeader';
import ModuleCard from '@/components/dashboard/ModuleCard';
import KpiTile from '@/components/dashboard/KpiTile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, GraduationCap, Inbox as InboxIcon, ShieldCheck, TriangleAlert, Video } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The manager's side: who is behind, the capture review queue, and course
 * sign-off. Requires playbooks EDIT — enforced server-side by every RPC; the
 * in-page gate below only spares a viewer a page of failing buttons.
 */

export default function TrainingAdmin() {
  const { can } = useAuth();
  const isEditor = can('playbooks', 'edit');
  const qc = useQueryClient();
  const [reviewing, setReviewing] = useState(null);   // capture row
  const [newKey, setNewKey] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [waiving, setWaiving] = useState(null);       // assignment row
  const [waiveReason, setWaiveReason] = useState('');

  const { data: assignments = [], isError: aErr } = useQuery({
    queryKey: ['allAssignments'],
    queryFn: () => base44.entities.TrainingAssignment.filter({ status: { $in: ['open', 'overdue'] } }, '-created_date', 500),
    enabled: isEditor, retry: false,
  });
  const { data: captures = [], isError: cErr } = useQuery({
    queryKey: ['sopCaptures'],
    queryFn: () => base44.entities.SopCapture.filter({ status: 'submitted' }, '-created_date'),
    enabled: isEditor, retry: false,
  });
  const { data: enrollments = [], isError: eErr } = useQuery({
    queryKey: ['allEnrollments'],
    queryFn: () => base44.entities.CourseEnrollment.list('-started_at', 200),
    enabled: isEditor, retry: false,
  });
  const { data: courses = [] } = useQuery({
    queryKey: ['courses'],
    queryFn: () => base44.entities.Course.list('key'),
    enabled: isEditor, retry: false,
  });
  const { data: sops = [] } = useQuery({
    queryKey: ['sops'],
    queryFn: () => base44.entities.Sop.list('key'),
    enabled: isEditor, retry: false,
  });

  const sopById = useMemo(() => Object.fromEntries(sops.map((s) => [s.id, s])), [sops]);
  const courseById = useMemo(() => Object.fromEntries(courses.map((c) => [c.id, c])), [courses]);
  const overdue = useMemo(() => assignments.filter((a) => a.due_at && new Date(a.due_at) < new Date()), [assignments]);
  const anyError = aErr || cErr || eErr;

  const review = useMutation({
    mutationFn: async ({ status }) => {
      const res = await base44.functions.invoke('reviewSopCapture', {
        captureId: reviewing.id, status,
        newSopKey: status === 'accepted' && !reviewing.sop_id ? newKey.trim() : null,
        newSopTitle: status === 'accepted' && !reviewing.sop_id ? newTitle.trim() : null,
      });
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: (d, v) => {
      toast.success(v.status === 'accepted' ? 'Accepted into a draft — publish it from its page' : 'Rejected');
      setReviewing(null); setNewKey(''); setNewTitle('');
      qc.invalidateQueries({ queryKey: ['sopCaptures'] });
      qc.invalidateQueries({ queryKey: ['sops'] });
    },
    onError: (e) => toast.error(e?.message || 'Review failed'),
  });

  const signoff = useMutation({
    mutationFn: async (enrollmentId) => {
      const res = await base44.functions.invoke('signoffCourse', { enrollmentId });
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      if (res.data?.ok === false) throw new Error(res.data.reason);
      return res.data;
    },
    onSuccess: () => { toast.success('Signed off'); qc.invalidateQueries({ queryKey: ['allEnrollments'] }); },
    onError: (e) => toast.error(e?.message || 'Sign-off failed'),
  });

  const waive = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('waiveAssignment', {
        assignmentId: waiving.id, reason: waiveReason.trim(),
      });
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Waived, with the reason on record');
      setWaiving(null); setWaiveReason('');
      qc.invalidateQueries({ queryKey: ['allAssignments'] });
    },
    onError: (e) => toast.error(e?.message || 'Waive failed'),
  });

  if (!isEditor) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
          <ShieldCheck className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <p className="font-medium text-foreground">Training administration needs the edit permission on Playbooks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader eyebrow="Playbooks" title="Training Admin"
          subtitle="Who is behind, what was captured, and what needs your signature" />

        {anyError && (
          <div className="rounded-xl border border-crit/30 bg-crit/5 px-4 py-3 text-sm text-foreground">
            Part of this page failed to load — the numbers below may be incomplete, not zero.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile hero label="Open assignments" value={anyError ? '—' : String(assignments.length)}
            foot={anyError ? 'unknown' : 'Awaiting a signature'} />
          <KpiTile label="Overdue" value={anyError ? '—' : String(overdue.length)}
            foot={anyError ? 'unknown' : overdue.length ? 'Chase these' : 'Nobody is late'} />
          <KpiTile label="Captures to review" value={anyError ? '—' : String(captures.length)}
            foot={anyError ? 'unknown' : 'Raw Looms from the floor'} />
        </div>

        <ModuleCard title="Capture inbox" icon={Video} bodyClassName="divide-y divide-border">
          {captures.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <InboxIcon className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" />
              Nothing waiting. Staff submit captures from the Playbooks library.
            </div>
          ) : captures.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {c.loom_url
                    ? <a href={c.loom_url} target="_blank" rel="noreferrer" className="text-primary underline">Recording</a>
                    : 'Notes only'}
                  {c.sop_id && sopById[c.sop_id] ? ` · for ${sopById[c.sop_id].title}` : ' · unfiled'}
                </p>
                {c.notes_md && <p className="truncate text-xs text-muted-foreground">{c.notes_md}</p>}
              </div>
              <Button size="sm" variant="outline" onClick={() => setReviewing(c)}>Review</Button>
            </div>
          ))}
        </ModuleCard>

        <ModuleCard title="Overdue signatures" icon={TriangleAlert} bodyClassName="divide-y divide-border">
          {overdue.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Nobody is overdue.</div>
          ) : overdue.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {sopById[a.sop_id]?.title || a.sop_id} <span className="text-muted-foreground">v{a.required_version}</span>
                </p>
                <p className="text-xs text-crit">
                  due {new Date(a.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' · '}user {String(a.app_user_id).slice(0, 8)}…
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setWaiving(a)}>Waive</Button>
            </div>
          ))}
        </ModuleCard>

        <ModuleCard title="Course enrollments" icon={GraduationCap} bodyClassName="divide-y divide-border">
          {enrollments.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Enrollments appear when someone is given a role with an onboarding course.
            </div>
          ) : enrollments.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{courseById[e.course_id]?.title || e.course_id}</p>
                <p className="text-xs text-muted-foreground">
                  user {String(e.app_user_id).slice(0, 8)}… · {e.status}
                  {e.manager_signed_at ? ' · signed off' : ''}
                </p>
              </div>
              {e.status === 'in_progress' && (
                <Button size="sm" variant="outline" disabled={signoff.isPending}
                  onClick={() => signoff.mutate(e.id)}>
                  Sign off
                </Button>
              )}
            </div>
          ))}
        </ModuleCard>

        <p className="text-xs text-muted-foreground">
          Publishing and editing playbooks happens on each playbook&apos;s own page —{' '}
          <Link to="/Playbooks" className="text-primary underline">open the library</Link>.
        </p>
      </div>

      {/* Review a capture */}
      <Dialog open={!!reviewing} onOpenChange={(v) => !v && setReviewing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold">Review this capture</DialogTitle>
            <DialogDescription>
              Accepting files it under a playbook draft (creating one if needed). Publishing is a separate,
              deliberate step on the playbook page.
            </DialogDescription>
          </DialogHeader>
          {reviewing?.loom_url && (
            <a href={reviewing.loom_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
              Watch the recording
            </a>
          )}
          {reviewing?.notes_md && (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs text-foreground">
              {reviewing.notes_md}
            </pre>
          )}
          {!reviewing?.sop_id && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>New playbook title (if accepting)</Label>
                <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="How we …" />
              </div>
              <div className="space-y-1.5">
                <Label>New playbook key</Label>
                <Input value={newKey} onChange={(e) => setNewKey(e.target.value.toLowerCase())}
                  placeholder="csr.some_process" className="font-mono" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={review.isPending} onClick={() => review.mutate({ status: 'rejected' })}>
              Reject
            </Button>
            <Button disabled={review.isPending || (!reviewing?.sop_id && (!newKey.trim() || !newTitle.trim()))}
              onClick={() => review.mutate({ status: 'accepted' })}>
              {review.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Accept into draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waive */}
      <Dialog open={!!waiving} onOpenChange={(v) => !v && setWaiving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold">Waive this signature</DialogTitle>
            <DialogDescription>
              The reason goes on the training record. This is not a self-serve skip — it is you accepting
              responsibility for them not signing it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)}
              placeholder="Covered in person on 3 Sep; process owner" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaiving(null)}>Cancel</Button>
            <Button disabled={waive.isPending || !waiveReason.trim()} onClick={() => waive.mutate()}>
              {waive.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Waive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
