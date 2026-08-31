import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Loader2,
  Layers,
  ClipboardList,
  ArrowRightLeft,
  Search,
  X,
  CheckCircle2,
  PencilLine,
  ShieldAlert,
} from 'lucide-react';

import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import SyncBadge from '@/components/common/SyncBadge';
import DataTable from '@/components/common/DataTable';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import AlertRow from '@/components/dashboard/AlertRow';
import PipelineBar from '@/components/dashboard/PipelineBar';
import { Input } from '@/components/ui/input';

import { cn } from '@/lib/utils';
import { buildJobFlow } from '@/lib/ops/flow';
import { usePublishedFlow } from '@/lib/ops/usePublishedFlow';
import { useOpenJob } from '@/lib/ops/openJob';
import { useAuth } from '@/lib/AuthContext';
import FlowEditor from '@/components/ops/FlowEditor';
import { Button } from '@/components/ui/button';
import { useBalances } from '@/lib/ops/useBalances';
import { materialIndex, money, fmtDate, today } from '@/lib/ops/metrics';

// ── Small helpers ────────────────────────────────────────────────────────────
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Worst first, everywhere: crit before warn before info.
const SEV_RANK = { crit: 0, warn: 1, info: 2 };

// The board is a working list, not an archive — long tails get a footer count.
const ROW_CAP = 40;
const BLOCKERS_PER_DEPT = 6;

const norm = (v) => String(v ?? '').toLowerCase();

// Single-select filter chip. Clicking the active chip clears the filter, so the
// board can always be got back to "everything" without hunting for a reset.
function Chip({ active, disabled, onClick, label, count, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={!!active}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
        active
          ? 'border-brand-navy bg-brand-navy text-white'
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-card hover:text-muted-foreground'
      )}
    >
      <span className="tabular-nums">{count}</span>
      <span>{label}</span>
    </button>
  );
}

function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="px-4 py-12 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children && (
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{children}</p>
      )}
    </div>
  );
}

export default function JobFlow() {
  const navigate = useNavigate();

  const [stageFilter, setStageFilter] = useState(null);
  const [deptFilter, setDeptFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);

  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['ops', 'jobFlow', 'sales'],
    queryFn: () => base44.entities.Sale.list(),
    staleTime: 30000,
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['ops', 'jobFlow', 'projects'],
    queryFn: () => base44.entities.Project.list(),
    staleTime: 30000,
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ['ops', 'jobFlow', 'customers'],
    queryFn: () => base44.entities.Customer.list(),
    staleTime: 30000,
  });

  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery({
    queryKey: ['ops', 'jobFlow', 'appointments'],
    queryFn: () => base44.entities.Appointment.list(),
    staleTime: 60000,
  });

  // rfms_order_status is empty (and may be unreadable) until the owner connects
  // RFMS. A failure here must degrade the material gate, never the page.
  const { data: statusRows = [] } = useQuery({
    queryKey: ['ops', 'jobFlow', 'rfmsOrderStatus'],
    queryFn: async () => {
      try {
        return await base44.entities.RFMSOrderStatus.list();
      } catch {
        return [];
      }
    },
    retry: false,
    staleTime: 60000,
  });

  // Collection state for Gate 1. A sale missing here is UNKNOWN, not unpaid.
  const { balances } = useBalances();

  // The published graph + the SQL classifier's verdicts. There is no fallback
  // stage table in JS any more: without these, the board shows an error.
  const { graph, stageRows, isLoading: flowMetaLoading, error: flowError } = usePublishedFlow();
  const { access } = useAuth();
  const isAdmin = access?.user?.is_org_admin === true;

  const flow = useMemo(
    () =>
      buildJobFlow({
        sales,
        projects,
        appointments,
        customers,
        material: materialIndex(statusRows),
        balances,
        stageRows,
        graph,
        asOf: today(),
      }),
    [sales, projects, appointments, customers, statusRows, balances, stageRows, graph]
  );

  // The lifecycle minus the terminal stage — "Complete" is not somewhere a job
  // waits, so it never belongs on a board about where work is stuck.
  const liveStages = useMemo(
    () => (flow?.byStage || []).filter((st) => !st.isTerminal && !st.isPlanning),
    [flow]
  );

  const pipeline = useMemo(
    () =>
      liveStages.map((s) => ({
        name: s.label,
        count: s.count,
        value: money(s.value),
        attention: s.overSla > 0,
      })),
    [liveStages]
  );

  // Filtered board: stage ∧ department ∧ text, then worst-first.
  const filtered = useMemo(() => {
    const q = norm(search).trim();
    const rows = (flow?.active || []).filter((j) => {
      if (stageFilter && j.stage !== stageFilter) return false;
      if (deptFilter && j.owner !== deptFilter) return false;
      if (!q) return true;
      return (
        norm(j.customerName).includes(q) ||
        norm(j.invoice).includes(q) ||
        norm(j.address).includes(q)
      );
    });
    return rows.sort(
      (a, b) =>
        Number(b.overSla) - Number(a.overSla) ||
        (b.ageDays ?? -1) - (a.ageDays ?? -1) ||
        b.amount - a.amount
    );
  }, [flow, stageFilter, deptFilter, search]);

  const visible = useMemo(() => filtered.slice(0, ROW_CAP), [filtered]);
  const filteredValue = useMemo(() => filtered.reduce((a, j) => a + j.amount, 0), [filtered]);
  const anyFilter = !!(stageFilter || deptFilter || search.trim());

  // Who is holding up whom. Grouped by the department that can clear the blocker —
  // which is often NOT the department that owns the job.
  const blockerGroups = useMemo(() => {
    if (!flow) return [];
    const groups = {};
    for (const b of flow.blockers) {
      const key = b.owner || 'unassigned';
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    }
    const order = [...Object.keys(flow.departments), 'unassigned'];
    return order
      .filter((k) => groups[k] && groups[k].length)
      .map((k) => {
        const rows = groups[k]
          .slice()
          .sort(
            (a, b) =>
              (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) ||
              (b.job.ageDays ?? -1) - (a.job.ageDays ?? -1)
          );
        return {
          key: k,
          label: flow.departments[k] || 'Unassigned',
          rows,
          shown: rows.slice(0, BLOCKERS_PER_DEPT),
          hidden: Math.max(0, rows.length - BLOCKERS_PER_DEPT),
          crit: rows.filter((r) => r.severity === 'crit').length,
          // The accountability number: blockers this department owns on someone
          // else's job.
          holdingOthers: rows.filter((r) => r.job.owner !== k).length,
        };
      })
      .sort((a, b) => b.crit - a.crit || b.rows.length - a.rows.length);
  }, [flow]);

  const blockersHidden = useMemo(
    () => blockerGroups.reduce((a, g) => a + g.hidden, 0),
    [blockerGroups]
  );

  // One resolver for every ops board (see lib/ops/openJob.js) — row shapes
  // differ per builder and a hand-rolled copy silently no-ops on the wrong one.
  const openJob = useOpenJob();

  const columns = useMemo(
    () => [
      {
        key: 'customer',
        header: 'Customer',
        render: (j) => (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{j.customerName || '—'}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[j.invoice ? `Inv ${j.invoice}` : 'No invoice', j.address].filter(Boolean).join(' · ')}
            </div>
          </div>
        ),
      },
      {
        key: 'stage',
        header: 'Stage',
        render: (j) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone={j.tone || 'neutral'}>{j.stageLabel}</StatusPill>
            {j.onHold && <StatusPill tone="crit">Hold</StatusPill>}
          </div>
        ),
      },
      {
        key: 'owner',
        header: 'Owner',
        render: (j) => {
          const reassigned = j.stageOwner && j.owner && j.owner !== j.stageOwner;
          return (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{j.ownerLabel || 'Unassigned'}</div>
              <div className="truncate text-xs text-muted-foreground">
                {reassigned
                  ? `Pulled from ${j.stageOwnerLabel || j.stageOwner} by a blocker`
                  : j.stageBlurb || ''}
              </div>
            </div>
          );
        },
      },
      {
        key: 'age',
        header: 'Age',
        render: (j) => (
          <div className="whitespace-nowrap">
            <div
              className={cn(
                'text-sm font-bold tabular-nums',
                j.overSla ? 'text-crit' : 'text-foreground'
              )}
            >
              {j.ageDays == null ? '—' : `${j.ageDays}d`}
            </div>
            <div className={cn('text-xs', j.overSla ? 'text-crit/80' : 'text-muted-foreground')}>
              {j.sla == null ? 'No SLA' : `SLA ${j.sla}d`}
            </div>
          </div>
        ),
      },
      {
        key: 'next',
        header: 'Next action',
        render: (j) => (
          <div className="min-w-0">
            <div className="truncate text-sm">{j.nextAction}</div>
          </div>
        ),
      },
      {
        key: 'amount',
        header: 'Value',
        numeric: true,
        render: (j) => <span className="whitespace-nowrap text-sm font-semibold">{money(j.amount)}</span>,
      },
    ],
    []
  );

  if (salesLoading || projectsLoading || customersLoading || appointmentsLoading || flowMetaLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (flowError || !flow) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        <ShieldAlert className="h-10 w-10 text-crit" />
        <h2 className="text-base font-semibold text-foreground">The published flow could not be loaded</h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Every job on this board is classified by the published stage graph and the
          job_stage view. Rather than guess with stale constants, the board stops here.
          {flowError?.message ? ` (${flowError.message})` : ''}
        </p>
      </div>
    );
  }

  const rfmsBadge = flow.materialKnown ? (
    <SyncBadge status="synced" label="RFMS material" />
  ) : (
    <SyncBadge status="stale" label="RFMS not connected" />
  );

  const atRiskShare = flow.active.length
    ? Math.round((flow.atRisk.length / flow.active.length) * 100)
    : 0;
  const onHoldValue = flow.onHold.reduce((a, j) => a + j.amount, 0);
  const oldest = flow.active.reduce(
    (best, j) => (!best || (j.ageDays ?? -1) > (best.ageDays ?? -1) ? j : best),
    null
  );

  const searchBox = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Customer, invoice, address"
        aria-label="Search jobs"
        className="h-8 w-[168px] pl-8 text-xs sm:w-[240px]"
      />
    </div>
  );

  const boardSubtitle = anyFilter
    ? `${plural(filtered.length, 'job', 'jobs')} · ${money(filteredValue)} — filtered from ${flow.active.length}`
    : `${plural(flow.active.length, 'live job', 'live jobs')} · ${money(flow.activeValue)} · worst first`;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Operations"
          title="Job Flow"
          subtitle={`The true stage of every live job, derived from what the data says actually happened rather than from a status label somebody remembered to change. As of ${fmtDate(flow.asOf)}.`}
          actions={
            <div className="flex items-center gap-2">
              {rfmsBadge}
              {isAdmin && (
                <Button size="sm" variant={editing ? 'default' : 'outline'} className="gap-1.5"
                  onClick={() => setEditing((v) => !v)}>
                  <PencilLine className="h-3.5 w-3.5" /> {editing ? 'Back to board' : 'Edit flow'}
                </Button>
              )}
            </div>
          }
        />

        {editing && isAdmin ? (
          <FlowEditor onClose={() => setEditing(false)} />
        ) : (
        <>
        {flow.unclassified.length > 0 && (
          <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-foreground">
            {flow.unclassified.length} job(s) not classified yet — the classifier and the data
            queries are momentarily out of step. Refresh in a few seconds.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiTile
            label="Active jobs"
            value={flow.active.length}
            hero
            foot={`${money(flow.activeValue)} of work in flight`}
          />
          <KpiTile
            label="Past SLA"
            value={flow.atRisk.length}
            delta={flow.atRisk.length ? `${atRiskShare}% of active` : null}
            dir="up"
            deltaTone="bad"
            foot="Sitting longer than the stage allows"
          />
          <KpiTile
            label="Critical blockers"
            value={flow.critical.length}
            delta={flow.critical.length ? 'needs a decision' : null}
            deltaTone="bad"
            foot={
              flow.critical.length
                ? 'Jobs that cannot move until someone acts'
                : 'Nothing hard-stopped right now'
            }
          />
          <KpiTile
            label="On hold"
            value={flow.onHold.length}
            delta={flow.onHold.length ? money(onHoldValue) : null}
            deltaTone="bad"
            foot="Pending cancellation, not cleared"
          />
          <KpiTile
            label="Median age in stage"
            value={flow.ageStats ? `${flow.ageStats.median}d` : '—'}
            foot={
              flow.ageStats
                ? `Across ${plural(flow.ageStats.n, 'live job', 'live jobs')}`
                : 'No live jobs to measure'
            }
          />
          <KpiTile
            label="Longest"
            value={flow.ageStats ? `${flow.ageStats.max}d` : '—'}
            delta={flow.ageStats && oldest?.overSla ? 'past SLA' : null}
            dir="up"
            deltaTone="bad"
            foot={
              oldest
                ? `${oldest.customerName} · ${oldest.stageLabel}`
                : 'Nothing waiting in a stage'
            }
          />
        </div>

        <ModuleCard
          title="Pipeline by stage"
          subtitle="Every live job, by the stage the data actually puts it in"
          icon={Layers}
          action={rfmsBadge}
        >
          <div className="px-4 py-4">
            {flow.active.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Nothing live to chart — every job is either complete or cancelled.
              </p>
            ) : (
              <PipelineBar stages={pipeline} />
            )}

            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Stage
              </span>
              {liveStages.map((s) => {
                const gated = s.key === 'awaiting_material' && !flow.materialKnown;
                return (
                  <Chip
                    key={s.key}
                    active={stageFilter === s.key}
                    disabled={gated}
                    count={gated ? '—' : s.count}
                    label={s.label}
                    title={gated ? 'Needs RFMS connected' : s.blurb}
                    onClick={() => setStageFilter((cur) => (cur === s.key ? null : s.key))}
                  />
                );
              })}
            </div>

            {!flow.materialKnown && (
              <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
                Awaiting Material is read from RFMS line status. Until RFMS is connected nothing is
                counted in that stage, and no job is advanced past a material gate we cannot see.
              </p>
            )}
          </div>
        </ModuleCard>

        <ModuleCard
          title="Where every job stands"
          subtitle={boardSubtitle}
          icon={ClipboardList}
          action={searchBox}
          footer={
            filtered.length > ROW_CAP ? (
              <span className="text-muted-foreground">
                Showing the {ROW_CAP} jobs that need it most — {filtered.length - ROW_CAP} more match
                these filters.
              </span>
            ) : null
          }
        >
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Department
            </span>
            {Object.entries(flow.departments).map(([key, label]) => (
              <Chip
                key={key}
                active={deptFilter === key}
                count={(flow.byOwner[key] || []).length}
                label={label}
                title={`Jobs sitting with ${label} right now`}
                onClick={() => setDeptFilter((cur) => (cur === key ? null : key))}
              />
            ))}
            {anyFilter && (
              <button
                type="button"
                onClick={() => {
                  setStageFilter(null);
                  setDeptFilter(null);
                  setSearch('');
                }}
                className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold text-brand-blue hover:underline"
              >
                <X className="h-3 w-3" />
                Clear filters
              </button>
            )}
          </div>

          {flow.active.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing live">
              Every sold job is closed out. New work lands here the moment a sale is written.
            </EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState icon={Search} title="No jobs match these filters">
              {[
                stageFilter && flow.stageByKey[stageFilter]?.label,
                deptFilter && flow.departments[deptFilter],
                search.trim() && `“${search.trim()}”`,
              ]
                .filter(Boolean)
                .join(' · ') || 'Try widening the filters.'}
            </EmptyState>
          ) : (
            <DataTable
              className="rounded-none border-0"
              columns={columns}
              data={visible}
              rowKey={(j) => j.id}
              onRowClick={openJob}
            />
          )}
        </ModuleCard>

        <ModuleCard
          title="Who's blocking whom"
          subtitle={`${plural(flow.blockers.length, 'open blocker', 'open blockers')} across ${plural(
            blockerGroups.length,
            'department',
            'departments'
          )} — grouped by who can clear it`}
          icon={ArrowRightLeft}
          footer={
            blockersHidden > 0 ? (
              <span className="text-muted-foreground">
                {plural(blockersHidden, 'more blocker', 'more blockers')} not shown —{' '}
                {flow.blockers.length} in total.
              </span>
            ) : null
          }
        >
          {blockerGroups.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing is blocked">
              No job is waiting on another department. Every live job can move on its own.
            </EmptyState>
          ) : (
            blockerGroups.map((g) => (
              <React.Fragment key={g.key}>
                <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="truncate">{g.label}</span>
                  <span className="whitespace-nowrap tabular-nums">
                    {plural(g.rows.length, 'blocker', 'blockers')}
                    {g.holdingOthers > 0 && ` · holding up ${g.holdingOthers} for another team`}
                  </span>
                </div>
                {g.shown.map((b, i) => (
                  <AlertRow
                    key={`${g.key}-${b.job.id}-${b.code}-${i}`}
                    severity={b.severity}
                    title={b.label}
                    detail={`${b.job.customerName} — ${b.detail}`}
                    cta="Open"
                    onCta={() => openJob(b.job)}
                  />
                ))}
                {g.hidden > 0 && (
                  <div className="px-4 py-2 text-[11px] text-muted-foreground">
                    {plural(g.hidden, 'more blocker', 'more blockers')} owned by {g.label}.
                  </div>
                )}
              </React.Fragment>
            ))
          )}
        </ModuleCard>
        </>
        )}
      </div>
    </div>
  );
}
