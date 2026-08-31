import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import ModuleCard from '@/components/dashboard/ModuleCard';
import StatusPill from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  ArrowRight, Plus, Trash2, Send, History, Loader2, ShieldAlert,
  FlaskConical, Inbox, Check, X, PencilLine,
} from 'lucide-react';
import { toast } from 'sonner';

/**
 * Edit flow — the org admin's view of the published stage graph.
 *
 * Everything here edits a LOCAL DRAFT (spec: no draft table in v1); nothing
 * reaches the plant until Publish, which snapshots an immutable version, runs
 * the checker, and rebuilds the relational graph in one transaction. Hard
 * rails, enforced server-side and mirrored here:
 *
 *   - key and classifier_key are immutable; live nodes cannot be deleted;
 *   - new nodes are PLANNING-ONLY (dashed, no classifier) until engineering
 *     binds a predicate in SQL — the UI cannot invent one;
 *   - publish needs a note; crit findings need an explicit acknowledge;
 *   - a live stage with no path to a terminal (dead_end) cannot be published
 *     at all;
 *   - dragging a job never changes its stage — there is nothing here that
 *     touches a job row, by construction.
 */

const SEV_TONE = { crit: 'crit', warn: 'warn', info: 'info' };
const KEY_RE = /^[a-z][a-z0-9_]+$/;

const callRpc = async (name, payload) => {
  const res = await base44.functions.invoke(name, payload);
  const failed = invokeFailure(res);
  if (failed) throw new Error(failed);
  return res.data;
};

export default function FlowEditor({ onClose }) {
  const qc = useQueryClient();

  // Published state (the draft's starting point).
  const { data: stages = [], isLoading: l1 } = useQuery({
    queryKey: ['ops', 'editorStages'],
    queryFn: () => base44.entities.OpsStage.list(),
  });
  const { data: edges = [], isLoading: l2 } = useQuery({
    queryKey: ['ops', 'editorEdges'],
    queryFn: () => base44.entities.OpsEdge.list(),
  });
  const { data: departments = [], isLoading: l3 } = useQuery({
    queryKey: ['ops', 'editorDepts'],
    queryFn: () => base44.entities.OpsDepartment.list(),
  });
  const { data: versions = [] } = useQuery({
    queryKey: ['ops', 'editorVersions'],
    queryFn: () => base44.entities.OpsFlowVersion.filter({}, '-version'),
  });
  const { data: proposals = [] } = useQuery({
    queryKey: ['ops', 'openProposals'],
    queryFn: () => base44.entities.OpsChangeProposal.filter({ status: 'open' }, '-created_date'),
  });

  // The local draft. Null until the admin touches something; falls back to the
  // published rows so the strip always shows current truth.
  const [draftStages, setDraftStages] = useState(null);
  const [draftEdges, setDraftEdges] = useState(null);
  const dStages = draftStages ?? stages;
  const dEdges = draftEdges ?? edges;
  const dirty = draftStages !== null || draftEdges !== null;

  const sorted = useMemo(
    () => [...dStages].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [dStages]
  );
  const deptOptions = useMemo(
    () => [...departments].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [departments]
  );

  const [editingKey, setEditingKey] = useState(null);
  const editingStage = sorted.find((s) => s.key === editingKey) || null;
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ key: '', label: '', blurb: '', owner_dept: '', sla_hours: '' });
  const [edgeForm, setEdgeForm] = useState({ from: '', to: '' });
  const [publishOpen, setPublishOpen] = useState(false);
  const [note, setNote] = useState('');
  const [ackCrit, setAckCrit] = useState(false);
  const [findings, setFindings] = useState(null); // last dry run

  const buildGraph = () => ({
    departments: deptOptions.map((d) => ({ key: d.key, label: d.label, sort_order: d.sort_order })),
    stages: sorted.map((s) => ({
      key: s.key, label: s.label, blurb: s.blurb ?? null,
      owner_dept: s.owner_dept ?? null,
      sla_hours: s.sla_hours == null || s.sla_hours === '' ? null : Number(s.sla_hours),
      sort_order: s.sort_order ?? 0,
      is_terminal: !!s.is_terminal, tone: s.tone ?? null,
      classifier_key: s.classifier_key ?? null,
    })),
    edges: dEdges.map((e, i) => ({ from: e.from_key, to: e.to_key, sort_order: e.sort_order ?? i + 1 })),
  });

  const patchStage = (key, patch) =>
    setDraftStages(dStages.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const check = useMutation({
    mutationFn: () => callRpc('checkOpsFlow', { graph: buildGraph() }),
    onSuccess: (rows) => {
      setFindings(rows || []);
      toast.success(rows?.length ? `${rows.length} finding(s)` : 'Checker found nothing');
    },
    onError: (e) => toast.error(e?.message || 'Check failed'),
  });

  const publish = useMutation({
    mutationFn: () => callRpc('publishOpsFlow', { graph: buildGraph(), note, acknowledgeCrit: ackCrit }),
    onSuccess: (d) => {
      toast.success(`Published v${d.version} — every board now follows it`);
      setPublishOpen(false); setNote(''); setAckCrit(false); setFindings(null);
      setDraftStages(null); setDraftEdges(null); setEditingKey(null);
      qc.invalidateQueries({ queryKey: ['ops'] });
    },
    onError: (e) => toast.error(e?.message || 'Publish failed'),
  });

  const revert = useMutation({
    mutationFn: (version) => callRpc('revertOpsFlow', { version }),
    onSuccess: (d) => {
      toast.success(`Reverted — republished as v${d.version}`);
      setDraftStages(null); setDraftEdges(null);
      qc.invalidateQueries({ queryKey: ['ops'] });
    },
    onError: (e) => toast.error(e?.message || 'Revert failed'),
  });

  const resolve = useMutation({
    mutationFn: ({ id, action }) => callRpc('resolveOpsProposal', { id, action }),
    onSuccess: (d) => {
      toast.success(d.status === 'applied' ? 'Applied' : d.status === 'accepted'
        ? 'Accepted — apply it out of band' : 'Rejected');
      qc.invalidateQueries({ queryKey: ['ops'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not resolve'),
  });

  const suggest = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('opsFlowAdvise', {});
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: (d) => {
      toast.success(d?.inserted ? `${d.inserted} suggestion(s) filed as proposals` : 'No suggestions this time');
      qc.invalidateQueries({ queryKey: ['ops', 'openProposals'] });
    },
    onError: (e) => toast.error(e?.message || 'Advisor unavailable'),
  });

  const addNode = () => {
    const key = addForm.key.trim();
    if (!KEY_RE.test(key)) { toast.error('Key must be snake_case (a-z, 0-9, _)'); return; }
    if (sorted.some((s) => s.key === key)) { toast.error('That key already exists'); return; }
    setDraftStages([...dStages, {
      key, label: addForm.label.trim() || key, blurb: addForm.blurb.trim() || null,
      owner_dept: addForm.owner_dept || null,
      sla_hours: addForm.sla_hours === '' ? null : Number(addForm.sla_hours),
      sort_order: Math.max(0, ...sorted.map((s) => s.sort_order ?? 0)) + 1,
      is_terminal: false, tone: 'info',
      classifier_key: null, // planning-only, always — the UI cannot bind predicates
    }]);
    setAddOpen(false);
    setAddForm({ key: '', label: '', blurb: '', owner_dept: '', sla_hours: '' });
  };

  const removePlanningNode = (key) => {
    setDraftStages(dStages.filter((s) => s.key !== key));
    setDraftEdges(dEdges.filter((e) => e.from_key !== key && e.to_key !== key));
    if (editingKey === key) setEditingKey(null);
  };

  const addEdge = () => {
    if (!edgeForm.from || !edgeForm.to || edgeForm.from === edgeForm.to) return;
    if (dEdges.some((e) => e.from_key === edgeForm.from && e.to_key === edgeForm.to)) return;
    setDraftEdges([...dEdges, { from_key: edgeForm.from, to_key: edgeForm.to, sort_order: dEdges.length + 1 }]);
    setEdgeForm({ from: '', to: '' });
  };

  const deadEndBlocks = (findings || []).some((f) => f.kind === 'dead_end');
  const critCount = (findings || []).filter((f) => f.severity === 'crit').length;

  if (l1 || l2 || l3) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* ── The chart ───────────────────────────────────────────────────── */}
      <ModuleCard
        title="The flow"
        subtitle={`v${versions[0]?.version ?? '—'} published${dirty ? ' · unpublished draft changes' : ''} — jobs are classified by data, never by this chart`}
        icon={PencilLine}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add stage (sketch)
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5"
              disabled={check.isPending} onClick={() => check.mutate()}>
              {check.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Check
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => { setFindings(null); setPublishOpen(true); check.mutate(); }}>
              <Send className="h-3.5 w-3.5" /> Publish…
            </Button>
            {onClose && <Button size="sm" variant="ghost" onClick={onClose}>Close editor</Button>}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-y-3 px-4 py-4">
          {sorted.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 && <ArrowRight className="mx-1 h-4 w-4 shrink-0 text-muted-foreground/50" />}
              <button
                type="button"
                onClick={() => setEditingKey((k) => (k === s.key ? null : s.key))}
                className={cn(
                  'rounded-xl border px-3 py-2 text-left transition-colors',
                  s.classifier_key ? 'border-border bg-card' : 'border-dashed border-muted-foreground/40 bg-muted/30',
                  editingKey === s.key && 'ring-2 ring-primary',
                )}
                title={s.classifier_key
                  ? `Bound to predicate "${s.classifier_key}"`
                  : 'Planning-only — no jobs can sit here until engineering binds a predicate'}
              >
                <div className="text-xs font-semibold text-foreground">{s.label}</div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {s.key}{s.is_terminal ? ' · terminal' : ''}{!s.classifier_key ? ' · sketch' : ''}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {s.owner_dept || 'no owner'} · {s.sla_hours == null ? 'no SLA' : `${s.sla_hours}h SLA`}
                </div>
              </button>
            </React.Fragment>
          ))}
        </div>

        {editingStage && (
          <div className="border-t border-border px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Label</Label>
                <Input value={editingStage.label || ''}
                  onChange={(e) => patchStage(editingStage.key, { label: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Owner department</Label>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={editingStage.owner_dept || ''}
                  onChange={(e) => patchStage(editingStage.key, { owner_dept: e.target.value || null })}
                >
                  <option value="">— none —</option>
                  {deptOptions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>SLA (clock hours, blank = none)</Label>
                <Input type="number" min="1" value={editingStage.sla_hours ?? ''}
                  onChange={(e) => patchStage(editingStage.key, {
                    sla_hours: e.target.value === '' ? null : Number(e.target.value),
                  })} />
              </div>
              <div className="space-y-1.5">
                <Label>Blurb</Label>
                <Input value={editingStage.blurb || ''}
                  onChange={(e) => patchStage(editingStage.key, { blurb: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!editingStage.is_terminal}
                  onCheckedChange={(v) => patchStage(editingStage.key, { is_terminal: !!v })} />
                Terminal stage (work ends here)
              </label>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-muted-foreground">
                  key {editingStage.key} · predicate {editingStage.classifier_key || 'none (sketch)'} — immutable
                </span>
                {!editingStage.classifier_key && (
                  <Button size="sm" variant="outline" className="gap-1 text-crit"
                    onClick={() => removePlanningNode(editingStage.key)}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove sketch
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Edges ─────────────────────────────────────────────────────── */}
        <div className="border-t border-border px-4 py-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Arrows — documentation for people and the checker; the classifier never reads them
          </p>
          <div className="flex flex-wrap gap-2">
            {dEdges.map((e) => (
              <span key={`${e.from_key}->${e.to_key}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px]">
                {e.from_key} <ArrowRight className="h-3 w-3" /> {e.to_key}
                <button type="button" aria-label={`Delete edge ${e.from_key} to ${e.to_key}`}
                  onClick={() => setDraftEdges(dEdges.filter((x) => !(x.from_key === e.from_key && x.to_key === e.to_key)))}
                  className="text-muted-foreground hover:text-crit"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <select className="h-9 rounded-md border border-input bg-background px-2 font-mono text-xs"
              value={edgeForm.from} onChange={(e) => setEdgeForm((f) => ({ ...f, from: e.target.value }))}>
              <option value="">from…</option>
              {sorted.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
            </select>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <select className="h-9 rounded-md border border-input bg-background px-2 font-mono text-xs"
              value={edgeForm.to} onChange={(e) => setEdgeForm((f) => ({ ...f, to: e.target.value }))}>
              <option value="">to…</option>
              {sorted.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
            </select>
            <Button size="sm" variant="outline" className="gap-1" onClick={addEdge}
              disabled={!edgeForm.from || !edgeForm.to || edgeForm.from === edgeForm.to}>
              <Plus className="h-3.5 w-3.5" /> Add arrow
            </Button>
          </div>
        </div>

        {/* ── Dry-run findings ──────────────────────────────────────────── */}
        {findings && !publishOpen && (
          <div className="border-t border-border">
            {findings.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Checker found nothing to say.</p>
            ) : findings.map((f, i) => (
              <div key={i} className="flex items-start gap-2 border-b border-border/60 px-4 py-2 last:border-0">
                <StatusPill tone={SEV_TONE[f.severity] || 'neutral'}>{f.kind}</StatusPill>
                <div className="min-w-0 text-sm">
                  <p className="text-foreground">{f.title}</p>
                  {f.body_md && <p className="text-xs text-muted-foreground">{f.body_md}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </ModuleCard>

      {/* ── Proposal inbox ──────────────────────────────────────────────── */}
      <ModuleCard
        title="Proposal inbox"
        subtitle="What the checker (and the advisor) think should change. Nothing here applies itself."
        icon={Inbox}
        action={
          <Button size="sm" variant="outline" className="gap-1.5"
            disabled={suggest.isPending} onClick={() => suggest.mutate()}>
            {suggest.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            Suggest
          </Button>
        }
      >
        {proposals.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Inbox zero — the plant has nothing to report.</p>
        ) : proposals.map((p) => (
          <div key={p.id} className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-0">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill tone={SEV_TONE[p.severity] || 'neutral'}>{p.kind}</StatusPill>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{p.source}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-foreground">{p.title}</p>
              {p.body_md && <p className="text-xs leading-relaxed text-muted-foreground">{p.body_md}</p>}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="outline" className="gap-1"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: p.id, action: 'accept' })}>
                <Check className="h-3.5 w-3.5" /> Accept
              </Button>
              <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: p.id, action: 'reject' })}>
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          </div>
        ))}
      </ModuleCard>

      {/* ── Versions ────────────────────────────────────────────────────── */}
      <ModuleCard title="Versions" subtitle="Immutable history. Revert republishes an old graph as a new version." icon={History}>
        {versions.map((v) => (
          <div key={v.id} className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 last:border-0">
            <div className="min-w-0 text-sm">
              <span className="font-semibold text-foreground">v{v.version}</span>
              <span className="ml-2 text-xs text-muted-foreground">{v.note || '—'}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-muted-foreground">
                {new Date(v.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              {v.version !== versions[0]?.version && (
                <Button size="sm" variant="outline" disabled={revert.isPending}
                  onClick={() => revert.mutate(v.version)}>
                  Revert to v{v.version}
                </Button>
              )}
            </div>
          </div>
        ))}
      </ModuleCard>

      {/* ── Add planning node ───────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a stage sketch</DialogTitle>
            <DialogDescription>
              Drawn dashed. Jobs never land here — engineering binds a predicate in SQL before a
              sketch goes live. This is where warranty / demand get drawn before they get built.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Key (snake_case, permanent)</Label>
              <Input value={addForm.key} placeholder="warranty_active"
                onChange={(e) => setAddForm((f) => ({ ...f, key: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input value={addForm.label} placeholder="Warranty Active"
                onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Owner department</Label>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={addForm.owner_dept}
                onChange={(e) => setAddForm((f) => ({ ...f, owner_dept: e.target.value }))}>
                <option value="">— none —</option>
                {deptOptions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>SLA hours (optional)</Label>
              <Input type="number" min="1" value={addForm.sla_hours}
                onChange={(e) => setAddForm((f) => ({ ...f, sla_hours: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Blurb</Label>
              <Input value={addForm.blurb}
                onChange={(e) => setAddForm((f) => ({ ...f, blurb: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={addNode}>Add sketch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Publish ─────────────────────────────────────────────────────── */}
      <Dialog open={publishOpen} onOpenChange={(v) => { setPublishOpen(v); if (!v) setAckCrit(false); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish this flow</DialogTitle>
            <DialogDescription>
              Snapshots an immutable version and points every board at it. Jobs do not move —
              only their labels, owners and SLA clocks follow the new graph.
            </DialogDescription>
          </DialogHeader>

          {check.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Running the checker…
            </p>
          )}
          {findings && findings.length > 0 && (
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
              {findings.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <StatusPill tone={SEV_TONE[f.severity] || 'neutral'}>{f.kind}</StatusPill>
                  <span className="text-foreground">{f.title}</span>
                </div>
              ))}
            </div>
          )}
          {deadEndBlocks && (
            <p className="flex items-start gap-2 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-foreground">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-crit" />
              A live stage has no path to a terminal stage. This cannot be published — fix the
              arrows first. (There is no override for this one.)
            </p>
          )}

          <div className="space-y-1.5">
            <Label>Publish note (required)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="What changed, and why" />
          </div>
          {critCount > 0 && !deadEndBlocks && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={ackCrit} onCheckedChange={(v) => setAckCrit(!!v)} />
              Publish anyway, acknowledging {critCount} critical finding{critCount === 1 ? '' : 's'}
            </label>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>Cancel</Button>
            <Button className="gap-1.5"
              disabled={publish.isPending || check.isPending || deadEndBlocks || !note.trim()
                || (critCount > 0 && !ackCrit)}
              onClick={() => publish.mutate()}>
              {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Publish v{(versions[0]?.version ?? 0) + 1}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
