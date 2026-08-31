import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/common/PageHeader';
import ModuleCard from '@/components/dashboard/ModuleCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, BookOpen, Search, Video, Plus, ChevronRight, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * The library: every published SOP, filterable, plus the capture inbox door —
 * "I just did this, here is the Loom." Editors also see unpublished drafts
 * (greyed) and can start a new one.
 */

export default function Playbooks() {
  const { can } = useAuth();
  const isEditor = can('playbooks', 'edit');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capLoom, setCapLoom] = useState('');
  const [capNotes, setCapNotes] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newTitle, setNewTitle] = useState('');

  const { data: sops = [], isLoading, isError, error } = useQuery({
    queryKey: ['sops'],
    queryFn: () => base44.entities.Sop.list('key'),
    retry: false,
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sops;
    return sops.filter((s) =>
      s.title.toLowerCase().includes(q) || s.key.toLowerCase().includes(q)
      || (s.job_stage || '').includes(q) || (s.app_page_key || '').toLowerCase().includes(q)
      || (s.target_role_keys || []).some((r) => r.includes(q)));
  }, [sops, search]);

  const submitCapture = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('submitSopCapture', {
        loomUrl: capLoom.trim() || null, notesMd: capNotes.trim() || null,
      });
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Captured — a manager will review it and turn it into a playbook');
      setCaptureOpen(false); setCapLoom(''); setCapNotes('');
      qc.invalidateQueries({ queryKey: ['sopCaptures'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not save the capture'),
  });

  const createSop = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('createSop', { key: newKey.trim(), title: newTitle.trim() });
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['sops'] });
      setNewOpen(false); setNewKey(''); setNewTitle('');
      navigate(`/PlaybookDetail?id=${d.sop_id}`);
    },
    onError: (e) => toast.error(e?.message || 'Could not create the draft'),
  });

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          eyebrow="Playbooks"
          title="Playbooks"
          subtitle="How Floor Daddy actually does the work — next to the screen where the work happens"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" className="gap-1.5" onClick={() => setCaptureOpen(true)}>
                <Video className="h-4 w-4" /> I just did this
              </Button>
              {isEditor && (
                <Button className="gap-1.5" onClick={() => setNewOpen(true)}>
                  <Plus className="h-4 w-4" /> New playbook
                </Button>
              )}
            </div>
          }
        />

        <ModuleCard
          title="Library"
          icon={BookOpen}
          bodyClassName="divide-y divide-border"
          action={
            <div className="relative w-44 sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search title, role, stage, page…" value={search}
                onChange={(e) => setSearch(e.target.value)} className="h-9 border-border bg-card pl-9" />
            </div>
          }
        >
          {isLoading ? (
            <div className="flex justify-center py-14"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : isError ? (
            <div className="flex items-start gap-2 px-4 py-6 text-sm text-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-crit" />
              The library could not be loaded — {error?.message || 'the request failed'}.
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 px-4 text-center text-sm text-muted-foreground">
              {search ? 'Nothing matches that search.' : 'No playbooks yet — capture the first one.'}
            </div>
          ) : visible.map((s) => (
            <Link key={s.id} to={`/PlaybookDetail?id=${s.id}`}
              className={cn('flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50',
                !s.is_published && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{s.title}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {s.key}
                  {s.is_published ? ` · v${s.current_version}` : ' · draft, unpublished'}
                  {s.job_stage ? ` · ${s.job_stage}` : ''}
                  {s.app_page_key ? ` · on ${s.app_page_key}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {(s.target_role_keys || []).map((rk) => (
                  <span key={rk} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
                    {rk}
                  </span>
                ))}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </ModuleCard>
      </div>

      {/* "I just did this" — the capture inbox. Deliberately tiny: a link and a
          few sentences, typed in the minute after doing the real work. */}
      <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold">Capture how you just did it</DialogTitle>
            <DialogDescription>
              Record a Loom or Scribe of the work, paste the link, add a few steps. A manager turns it into
              the playbook everyone signs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cap-loom">Recording link (https)</Label>
              <Input id="cap-loom" value={capLoom} onChange={(e) => setCapLoom(e.target.value)}
                placeholder="https://www.loom.com/share/…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap-notes">The steps, roughly</Label>
              <Textarea id="cap-notes" rows={5} value={capNotes} onChange={(e) => setCapNotes(e.target.value)}
                placeholder={'1. Open the lead\n2. …'} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCaptureOpen(false)}>Cancel</Button>
            <Button disabled={submitCapture.isPending || (!capLoom.trim() && !capNotes.trim())}
              onClick={() => submitCapture.mutate()}>
              {submitCapture.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Submit capture
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-extrabold">New playbook draft</DialogTitle>
            <DialogDescription>Starts unpublished. Nothing is assigned until you publish it with a real body.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="np-title">Title</Label>
              <Input id="np-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Booking through Checklist 2.0" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-key">Key</Label>
              <Input id="np-key" value={newKey} onChange={(e) => setNewKey(e.target.value.toLowerCase())}
                placeholder="csr.book_from_checklist" className="font-mono" />
              <p className="text-xs text-muted-foreground">Permanent. Lowercase, dots and underscores.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button disabled={createSop.isPending || !newKey.trim() || !newTitle.trim()}
              onClick={() => createSop.mutate()}>
              {createSop.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
