import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { BookOpen, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * "How do I work this screen?" — the drawer that puts the published SOP next to
 * the button it explains. Mounted once in Layout; renders NOTHING unless the
 * current page has a published SOP pinned to it, so pages without one pay no
 * cost and show no control.
 *
 * The whole reason playbooks live in Razzle instead of a wiki: the how-to is on
 * the screen where the work happens, and the ack is one tap away.
 */
export default function HelpDrawer({ currentPageName }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: sops = [] } = useQuery({
    queryKey: ['pageSops', currentPageName],
    // RLS keeps drafts from non-editors and everything from crew logins; a
    // query error here just means no Help button, never a broken page.
    queryFn: () => base44.entities.Sop.filter({ app_page_key: currentPageName, is_published: true }),
    enabled: !!currentPageName,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: training } = useQuery({
    queryKey: ['myTraining'],
    queryFn: async () => (await base44.functions.invoke('myTraining')).data,
    enabled: open && sops.length > 0,
    retry: false,
  });

  const openBySop = useMemo(() => {
    const m = {};
    for (const a of training?.assignments || []) m[a.sop_id] = a;
    return m;
  }, [training]);

  const ack = useMutation({
    mutationFn: async (sopId) => {
      const res = await base44.functions.invoke('ackSop', { sopId });
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Signed');
      qc.invalidateQueries({ queryKey: ['myTraining'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not record your signature'),
  });

  if (!sops.length) return null;

  return (
    <>
      {/* Above the admin "Viewing as" widget, which owns the corner itself. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-muted"
        title="How this screen is worked"
      >
        <BookOpen className="h-4 w-4 text-primary" /> How this works
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>How this screen is worked</SheetTitle>
            <SheetDescription>
              The signed playbook{sops.length === 1 ? '' : 's'} for this page. Reading it here counts —
              sign at the bottom.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-6">
            {sops.map((s) => {
              const mine = openBySop[s.id];
              return (
                <div key={s.id} className="rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <p className="font-semibold text-foreground">{s.title}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{s.key} · v{s.current_version}</p>
                  </div>
                  <div className="space-y-3 px-4 py-3 text-sm leading-relaxed text-foreground [&_h1]:text-base [&_h1]:font-bold [&_h2]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_a]:text-primary [&_a]:underline">
                    <ReactMarkdown>{s.body_md || '_No written steps yet._'}</ReactMarkdown>
                  </div>
                  <div className="border-t border-border px-4 py-3">
                    {mine ? (
                      <Button size="sm" className="gap-1.5" disabled={ack.isPending}
                        onClick={() => ack.mutate(s.id)}>
                        {ack.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        I have read this and I follow it
                      </Button>
                    ) : (
                      <Link to={`/PlaybookDetail?id=${s.id}`} className="text-xs text-primary underline"
                        onClick={() => setOpen(false)}>
                        Open the full playbook
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
