import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { unwrapInvoke } from '@/lib/invokeResult';
import PageHeader from '@/components/common/PageHeader';
import ModuleCard from '@/components/dashboard/ModuleCard';
import { Loader2, BookOpen, TriangleAlert, CheckCircle2, GraduationCap, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The signed-in person's training: open acks and course progress. The default
 * landing for the Playbooks module. Reading and signing happens on the SOP
 * itself (PlaybookDetail / the Help drawer) — this page is the list, the
 * clocks, and nothing else.
 */

const fmtDue = (iso) => {
  if (!iso) return { text: 'no deadline', late: false };
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} overdue`, late: true };
  if (days === 0) return { text: 'due today', late: false };
  return { text: `due in ${days} day${days === 1 ? '' : 's'}`, late: false };
};

export default function MyTraining() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['myTraining'],
    queryFn: async () => unwrapInvoke(await base44.functions.invoke('myTraining')),
    retry: false,
  });

  const assignments = data?.assignments || [];
  const courses = data?.courses || [];

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Playbooks"
          title="My Training"
          subtitle={
            isError ? 'Could not be loaded'
              : assignments.length === 0 ? 'Nothing to sign — you are current'
              : `${assignments.length} playbook${assignments.length === 1 ? '' : 's'} to read and sign`
          }
        />

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : isError ? (
          <div className="rounded-xl border border-crit/30 bg-crit/5 p-4 text-sm text-foreground">
            Your training could not be loaded — {error?.message || 'the request failed'}. This is not an all-clear.
          </div>
        ) : (
          <>
            <ModuleCard title="To read and sign" icon={BookOpen} bodyClassName="divide-y divide-border">
              {assignments.length === 0 ? (
                <div className="py-12 text-center">
                  <CheckCircle2 className="mx-auto mb-3 h-9 w-9 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">
                    Every playbook assigned to you is signed at its current version.
                  </p>
                </div>
              ) : assignments.map((a) => {
                const due = fmtDue(a.due_at);
                return (
                  <Link
                    key={a.assignment_id}
                    to={`/PlaybookDetail?id=${a.sop_id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        v{a.version}
                        {a.job_stage ? ` · stage ${a.job_stage}` : ''}
                      </p>
                    </div>
                    <span className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1',
                      due.late ? 'bg-crit/15 text-crit ring-crit/30' : 'bg-muted text-muted-foreground ring-border',
                    )}>
                      {due.late && <TriangleAlert className="h-3 w-3" />} {due.text}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })}
            </ModuleCard>

            {courses.length > 0 && (
              <ModuleCard title="Courses" icon={GraduationCap} bodyClassName="divide-y divide-border">
                {courses.map((c) => {
                  const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
                  const waitingOnManager = c.status === 'in_progress' && c.total > 0
                    && c.done === c.total && c.manager_signoff_required && !c.manager_signed_at;
                  return (
                    <div key={c.enrollment_id} className="px-4 py-3">
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">{c.title}</p>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {c.total === 0 ? 'content coming' : `${c.done}/${c.total}`}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className={cn('h-full rounded-full', c.status === 'complete' ? 'bg-good' : 'bg-primary')}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {c.status === 'complete' ? 'Complete — signed off'
                          : waitingOnManager ? 'All lessons signed — waiting on your manager’s sign-off'
                          : c.total === 0 ? 'The lessons for this course have not been published yet'
                          : 'Open each lesson, read it, and tap “I follow this”'}
                      </p>
                    </div>
                  );
                })}
              </ModuleCard>
            )}
          </>
        )}
      </div>
    </div>
  );
}
