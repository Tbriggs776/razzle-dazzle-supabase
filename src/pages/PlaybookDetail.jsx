import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { useAuth } from '@/lib/AuthContext';
import PageHeader from '@/components/common/PageHeader';
import ModuleCard from '@/components/dashboard/ModuleCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ArrowLeft, CheckCircle2, History, Send, PenLine, Users } from 'lucide-react';
import { toast } from 'sonner';

/** Loom/Scribe share links embed via their /embed/ path. */
export function embedUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.hostname.endsWith('loom.com')) return u.replace('/share/', '/embed/');
    if (url.hostname.endsWith('scribehow.com')) return u.replace('/shared/', '/embed/');
    return null; // unknown hosts get a plain link, not an iframe
  } catch { return null; }
}

export default function PlaybookDetail() {
  const sopId = new URLSearchParams(window.location.search).get('id');
  const { can } = useAuth();
  const isEditor = can('playbooks', 'edit');
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [loom, setLoom] = useState('');
  const [targets, setTargets] = useState([]);

  const { data: sop, isLoading } = useQuery({
    queryKey: ['sop', sopId],
    queryFn: () => base44.entities.Sop.get(sopId),
    enabled: !!sopId,
  });

  const { data: versions = [] } = useQuery({
    queryKey: ['sopVersions', sopId],
    queryFn: () => base44.entities.SopVersion.filter({ sop_id: sopId }, '-version'),
    enabled: !!sopId,
  });

  // Target-role checkboxes toggle the keys already on the SOP (seeded, or set
  // at creation). Adding a brand-new role key to an SOP is a TrainingAdmin
  // concern; this page deliberately cannot invent role keys.
  const { data: myAssignments } = useQuery({
    queryKey: ['myTraining'],
    queryFn: async () => {
      const res = await base44.functions.invoke('myTraining');
      return res.data;
    },
    retry: false,
  });

  const openAssignment = useMemo(() =>
    (myAssignments?.assignments || []).find((a) => a.sop_id === sopId),
  [myAssignments, sopId]);

  useEffect(() => {
    if (sop) {
      setBody(sop.body_md || '');
      setTargets(sop.target_role_keys || []);
      setLoom('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sop?.id, sop?.current_version]);

  const ack = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('ackSop', { sopId });
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: (d) => {
      toast.success(`Signed — ${d.ack_text}`);
      qc.invalidateQueries({ queryKey: ['myTraining'] });
      qc.invalidateQueries({ queryKey: ['sop', sopId] });
    },
    onError: (e) => toast.error(e?.message || 'Could not record your signature'),
  });

  const publish = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('publishSop', {
        sopId, bodyMd: body, loomUrl: loom.trim() || null,
        targetRoleKeys: targets.length ? targets : null,
      });
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: (d) => {
      toast.success(`Published v${d.version} — assignments opened for the target roles`);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['sop', sopId] });
      qc.invalidateQueries({ queryKey: ['sopVersions', sopId] });
      qc.invalidateQueries({ queryKey: ['myTraining'] });
    },
    onError: (e) => toast.error(e?.message || 'Publish failed'),
  });

  if (!sopId) return <div className="p-8 text-sm text-muted-foreground">No playbook selected.</div>;
  if (isLoading || !sop) {
    return <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const currentLoom = versions.find((v) => v.version === sop.current_version)?.loom_url || null;
  const embed = embedUrl(currentLoom);
  // publish keeps whatever roles were on the SOP; editing shows them as chips
  // with add/remove by typing — v1 keeps it to toggling the seeded keys.
  const knownKeys = Array.from(new Set([...(sop.target_role_keys || []), ...targets]));

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link to="/Playbooks" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Library
        </Link>

        <PageHeader
          eyebrow={sop.key}
          title={sop.title}
          subtitle={
            sop.is_published
              ? `Version ${sop.current_version}${sop.job_stage ? ` · stage ${sop.job_stage}` : ''}${sop.app_page_key ? ` · shown on ${sop.app_page_key}` : ''}`
              : 'Draft — not yet published, assigned to nobody'
          }
          actions={isEditor && !editing && (
            <Button variant="outline" className="gap-1.5" onClick={() => setEditing(true)}>
              <PenLine className="h-4 w-4" /> Edit & publish
            </Button>
          )}
        />

        {editing ? (
          <ModuleCard title={`Publish v${sop.current_version + 1}`} icon={Send} bodyClassName="divide-y-0">
            <div className="space-y-4 px-4 py-4">
              <div className="space-y-1.5">
                <Label>Body (markdown)</Label>
                <Textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)}
                  className="font-mono text-xs" placeholder="## The steps…" />
              </div>
              <div className="space-y-1.5">
                <Label>Recording link for this version (optional, https)</Label>
                <Input value={loom} onChange={(e) => setLoom(e.target.value)} placeholder="https://www.loom.com/share/…" />
              </div>
              <div className="space-y-1.5">
                <Label>Required for</Label>
                <div className="flex flex-wrap gap-3">
                  {knownKeys.length === 0 && (
                    <p className="text-xs text-muted-foreground">No target roles on this SOP yet — set them when seeding or via a manager.</p>
                  )}
                  {knownKeys.map((rk) => (
                    <label key={rk} className="flex items-center gap-1.5 text-sm">
                      <Checkbox checked={targets.includes(rk)}
                        onCheckedChange={(v) => setTargets((t) => v ? [...t, rk] : t.filter((x) => x !== rk))} />
                      <span className="font-mono text-xs">{rk}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-foreground">
                Publishing opens a signed-reading assignment for <b>everyone holding a target role</b>, and
                re-opens it for anyone who signed an earlier version. Their old signatures stay on the old version.
              </div>
              <div className="flex gap-2">
                <Button className="gap-1.5" disabled={publish.isPending || !body.trim()} onClick={() => publish.mutate()}>
                  {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Publish v{sop.current_version + 1}
                </Button>
                <Button variant="ghost" onClick={() => { setEditing(false); setBody(sop.body_md || ''); }}>Cancel</Button>
              </div>
            </div>
          </ModuleCard>
        ) : (
          <ModuleCard title="The playbook" bodyClassName="divide-y-0">
            {embed && (
              <div className="px-4 pt-4">
                <div className="overflow-hidden rounded-lg border border-border" style={{ aspectRatio: '16/9' }}>
                  <iframe src={embed} title="Recording" className="h-full w-full" allowFullScreen />
                </div>
              </div>
            )}
            {!embed && currentLoom && (
              <p className="px-4 pt-4 text-sm">
                <a href={currentLoom} target="_blank" rel="noreferrer" className="text-primary underline">
                  Watch the recording
                </a>
              </p>
            )}
            <div className="sop-body max-w-none space-y-3 px-4 py-4 text-sm leading-relaxed text-foreground [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1">
              {sop.body_md
                ? <ReactMarkdown>{sop.body_md}</ReactMarkdown>
                : <p className="text-sm italic text-muted-foreground">This playbook has no content yet.</p>}
            </div>
            {openAssignment && (
              <div className="border-t border-border px-4 py-4">
                <Button className="min-h-11 gap-2" disabled={ack.isPending} onClick={() => ack.mutate()}>
                  {ack.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  I have read this and I follow it
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Signing records your name against version {sop.current_version}, with a timestamp. That is your training record.
                </p>
              </div>
            )}
          </ModuleCard>
        )}

        {versions.length > 0 && (
          <ModuleCard title="Versions" icon={History} bodyClassName="divide-y divide-border">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-medium text-foreground">v{v.version}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(v.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            ))}
          </ModuleCard>
        )}

        {(sop.target_role_keys || []).length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Required for: {(sop.target_role_keys || []).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
