import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Loader2,
  CalendarRange,
  CalendarDays,
  HardHat,
  AlertTriangle,
  PackageCheck,
  ArrowLeftRight,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import SyncBadge from '@/components/common/SyncBadge';
import DataTable from '@/components/common/DataTable';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';
import AlertRow from '@/components/dashboard/AlertRow';

import {
  buildInstallBoard,
  materialIndex,
  bucketKey,
  addDays,
  fmtDate,
  money,
  today,
  isoDay,
  dayDiff,
  LINE_STATUSES,
  STATUS_HELP,
  STATUS_TONE,
} from '@/lib/ops/metrics';
import { buildJobFlow, departmentView } from '@/lib/ops/flow';
import { usePublishedFlow } from '@/lib/ops/usePublishedFlow';
import { useOpenJob, canOpenJob } from '@/lib/ops/openJob';
import { cn } from '@/lib/utils';
import { useBalances } from '@/lib/ops/useBalances';

// ── Presentation maps ────────────────────────────────────────────────────────
// Domain project stage → StatusPill tone (same vocabulary as ProjectDetail).
const STAGE_TONE = {
  Accepted: 'info',
  'Materials Ordered': 'info',
  Scheduled: 'warn',
  'In Progress': 'warn',
  'Quality Checks': 'info',
  Completed: 'good',
  Cancelled: 'crit',
};
const stageTone = (stage) => STAGE_TONE[stage] || 'neutral';

// readinessLabel() verdicts → pill copy + tone. null (unknown) is never rendered
// as a pill — it shows a muted em dash, because "we don't know" is not "not ready".
const READY_LABEL = { yes: 'Ready', partial: 'Partial', no: 'Not received' };
const READY_TONE = { yes: 'good', partial: 'warn', no: 'crit' };

// The material ramp, drawn with tokens only. Resvd shares the "good" hue with Del
// at reduced alpha — both mean the product is in hand, and they stay distinguishable
// by label rather than by inventing a seventh brand color.
const STATUS_FILL = {
  None: 'hsl(var(--crit))',
  GenPO: 'hsl(var(--warn))',
  OnOrder: 'hsl(var(--brand-blue))',
  Cut: 'hsl(var(--brand-navy))',
  Del: 'hsl(var(--good))',
  Resvd: 'hsl(var(--good) / 0.55)',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// How many handoff rows each half of the card shows before it stops.
const HANDOFF_CAP = 6;

// ISO day → "Today · Aug 27" / "Thu · Aug 28". Local Date built from the parts, so
// no timezone can slide the weekday a day either way.
function dayLabel(iso, asOf) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' });
  return iso === asOf ? `Today · ${fmtDate(iso)}` : `${weekday} · ${fmtDate(iso)}`;
}

function StatusTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      <div className="text-xs font-bold">{d.label}</div>
      <div className="text-[11px] text-muted-foreground">{d.help}</div>
      <div className="mt-1 text-xs font-semibold tabular-nums">{plural(d.count, 'line', 'lines')}</div>
    </div>
  );
}

// Exception codes rendered for humans. Raised by the workflow engine when it can
// neither safely pass nor safely block a job.
const EXCEPTION_LABELS = {
  E9_COD_UNCOLLECTED: 'Balance outstanding',
  E10_COD_WAIVED: 'Collection waived',
  E11_LIVE_PROJECT_ON_CANCELLED_SALE: 'Live job, cancelled sale',
};

export default function InstallTeam() {
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['ops', 'installTeam', 'projects'],
    queryFn: () => base44.entities.Project.list(),
    staleTime: 30000,
  });

  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['ops', 'installTeam', 'sales'],
    queryFn: () => base44.entities.Sale.list(),
    staleTime: 30000,
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ['ops', 'installTeam', 'customers'],
    queryFn: () => base44.entities.Customer.list(),
    staleTime: 30000,
  });

  // rfms_order_status is empty (and may be unreadable) until the owner connects
  // RFMS. A failure here must degrade the material sections, never the page.
  const { data: statusRows = [] } = useQuery({
    queryKey: ['ops', 'installTeam', 'rfmsOrderStatus'],
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

  const board = useMemo(
    () =>
      buildInstallBoard({
        projects,
        sales,
        customers,
        material: materialIndex(statusRows),
        asOf: today(),
      }),
    [projects, sales, customers, statusRows]
  );

  // Collection state for Gate 1. A sale missing here is UNKNOWN, not unpaid.
  const { balances } = useBalances();

  // Open workflow exceptions. Explicit sort: this table has no created_date, and
  // the data client's default orderBy would 400 against it.
  const { data: openExceptions = [] } = useQuery({
    queryKey: ['openWorkflowExceptions'],
    queryFn: () => base44.entities.WorkflowException.filter({ resolved_at: null }, '-last_seen_at'),
    staleTime: 60000,
  });

  const nameForSubject = (x) => {
    if (x.subject_type !== 'project') return null;
    const p = projects.find((pr) => pr.id === x.subject_id);
    const c = p ? customers.find((cu) => cu.id === p.customer) : null;
    return c ? `${c.first_name} ${c.last_name}` : null;
  };

  // The same source data run through the stage engine. The board answers "what is
  // on the calendar"; the flow answers "who owns this job right now" — which is
  // what makes the handoff visible in both directions.
  // The published graph + THE classifier (job_stage). No JS fallback exists.
  const { graph, stageRows } = usePublishedFlow();
  const openJob = useOpenJob();

  const flow = useMemo(
    () =>
      buildJobFlow({
        sales,
        projects,
        appointments: [],
        customers,
        material: materialIndex(statusRows),
        balances,
        stageRows,
        graph,
        asOf: today(),
      }),
    [projects, sales, customers, statusRows, balances, stageRows, graph]
  );

  // departmentView returns null while the published graph / classifier view are
  // unavailable; the handoff panels then render empty WITH a banner (below)
  // rather than silently showing a healthy-looking zero.
  const flowUnavailable = !flow;
  const view = useMemo(
    () => departmentView(flow, 'install') ?? {
      dept: 'install', label: 'Install',
      waitingOnUs: [], overSla: [], weAreBlocking: [], blockedByOthers: [], value: 0,
    },
    [flow]
  );

  const handoffBanner = flowUnavailable ? (
    <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-foreground">
      Handoffs unavailable — the published flow graph or the job_stage view could not be
      loaded, and this page will not classify jobs with stale constants. The counts in this
      section read zero until it loads.
    </p>
  ) : null;

  // The board itself: everything scheduled ahead of us, soonest first.
  const futureSorted = useMemo(
    () => board.future.slice().sort((a, b) => a.install.localeCompare(b.install) || b.amount - a.amount),
    [board.future]
  );

  // Forward load per week — the shape behind the two headline tiles.
  const spark = useMemo(() => {
    const byWeek = {};
    for (const r of board.future) {
      const k = bucketKey(r.install, 'week');
      if (!k) continue;
      if (!byWeek[k]) byWeek[k] = { jobs: 0, value: 0 };
      byWeek[k].jobs += 1;
      byWeek[k].value += r.amount;
    }
    const keys = Object.keys(byWeek).sort();
    return {
      jobs: keys.map((k) => byWeek[k].jobs),
      value: keys.map((k) => byWeek[k].value),
    };
  }, [board.future]);

  // Today through the next six days, grouped by install day. Today's jobs sit in
  // neither future (install > asOf) nor overdue (install < asOf), so they are read
  // off board.rows directly rather than being dropped.
  const week = useMemo(() => {
    const end = addDays(board.asOf, 6);
    const inWindow = board.rows.filter(
      (r) => r.install && !r.completed && r.install >= board.asOf && r.install <= end
    );
    const byDay = {};
    for (const r of inWindow) {
      if (!byDay[r.install]) byDay[r.install] = [];
      byDay[r.install].push(r);
    }
    return Object.keys(byDay)
      .sort()
      .map((day) => {
        const rows = byDay[day].slice().sort((a, b) => b.amount - a.amount);
        return { day, rows, value: rows.reduce((a, r) => a + r.amount, 0) };
      });
  }, [board]);

  const weekCount = useMemo(() => week.reduce((a, g) => a + g.rows.length, 0), [week]);

  const alerts = useMemo(() => {
    const out = [];
    const overdue = board.overdue.slice().sort((a, b) => a.install.localeCompare(b.install));
    for (const r of overdue.slice(0, 6)) {
      const late = Math.abs(r.daysOut ?? 0);
      out.push({
        key: `overdue-${r.id}`,
        // Keep the id: an alert that names a job must be able to open it.
        projectId: r.projectId,
        severity: 'crit',
        title: `${r.customerName} — install date has passed`,
        detail: `Scheduled ${fmtDate(r.install)} · ${plural(late, 'day', 'days')} ago · still ${r.stage} · ${money(r.amount)}`,
      });
    }

    const overdueIds = new Set(board.overdue.map((r) => r.id));
    const holds = board.onHold.filter((r) => !overdueIds.has(r.id));
    for (const r of holds.slice(0, 4)) {
      out.push({
        key: `hold-${r.id}`,
        projectId: r.projectId,
        severity: 'warn',
        title: `${r.customerName} — on hold`,
        detail: r.install
          ? `Install date ${fmtDate(r.install)} · ${r.crew || 'no crew'} · ${money(r.amount)}`
          : `No install date set · ${money(r.amount)}`,
      });
    }

    const unscheduled = board.unscheduled.slice().sort((a, b) => b.amount - a.amount);
    for (const r of unscheduled.slice(0, 5)) {
      out.push({
        key: `unsched-${r.id}`,
        projectId: r.projectId,
        severity: 'info',
        title: `${r.customerName} — not on the calendar`,
        detail: `Sold job with no install date · ${r.stage} · ${money(r.amount)}`,
      });
    }

    return {
      rows: out,
      hidden:
        Math.max(0, board.overdue.length - 6) +
        Math.max(0, holds.length - 4) +
        Math.max(0, board.unscheduled.length - 5),
      total: board.overdue.length + holds.length + board.unscheduled.length,
    };
  }, [board]);

  // Material rollup over the forward board. Null whenever RFMS has told us nothing —
  // the section renders an honest empty state instead of a fabricated zero.
  const materialMix = useMemo(() => {
    if (!board.materialKnown) return null;
    const counts = {};
    let orders = 0;
    for (const r of board.future) {
      if (!r.material || !r.material.total) continue;
      orders += 1;
      for (const [status, c] of Object.entries(r.material.counts)) {
        counts[status] = (counts[status] || 0) + c;
      }
    }
    const bars = LINE_STATUSES.map((status) => ({
      status,
      label: status,
      help: STATUS_HELP[status],
      count: counts[status] || 0,
    }));
    return {
      bars,
      orders,
      lines: bars.reduce((a, b) => a + b.count, 0),
      ready: board.future.filter((r) => r.readiness === 'yes').length,
      partial: board.future.filter((r) => r.readiness === 'partial').length,
      none: board.future.filter((r) => r.readiness === 'no').length,
      unknown: board.future.filter((r) => !r.readiness).length,
    };
  }, [board]);

  const columns = useMemo(
    () => [
      {
        key: 'customer',
        header: 'Customer',
        render: (r) => (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{r.customerName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[r.city, r.invoice && `Inv ${r.invoice}`].filter(Boolean).join(' · ') || r.address || '—'}
            </div>
          </div>
        ),
      },
      {
        key: 'install',
        header: 'Install',
        render: (r) => (
          <div className="whitespace-nowrap">
            <div className="text-sm font-semibold tabular-nums">{fmtDate(r.install)}</div>
            <div className="text-xs text-muted-foreground">
              {r.daysOut === 1 ? 'tomorrow' : `in ${plural(r.daysOut, 'day', 'days')}`}
            </div>
          </div>
        ),
      },
      {
        key: 'crew',
        header: 'Crew',
        render: (r) =>
          r.crew ? (
            <span className="whitespace-nowrap text-sm">{r.crew}</span>
          ) : (
            <span className="whitespace-nowrap text-sm text-muted-foreground">Unassigned</span>
          ),
      },
      {
        key: 'stage',
        header: 'Stage',
        render: (r) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone={stageTone(r.stage)}>{r.stage}</StatusPill>
            {r.onHold && <StatusPill tone="warn">Hold</StatusPill>}
          </div>
        ),
      },
      {
        key: 'material',
        header: 'Material',
        render: (r) =>
          r.readiness ? (
            <StatusPill tone={READY_TONE[r.readiness]} dot>
              {READY_LABEL[r.readiness]}
            </StatusPill>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        key: 'amount',
        header: 'Value',
        numeric: true,
        render: (r) => <span className="whitespace-nowrap text-sm font-semibold">{money(r.amount)}</span>,
      },
    ],
    []
  );

  if (projectsLoading || salesLoading || customersLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const rfmsBadge = board.materialKnown ? (
    <SyncBadge status="synced" label="RFMS material" />
  ) : (
    <SyncBadge status="stale" label="RFMS not connected" />
  );

  // Both halves cap at HANDOFF_CAP rows; say so rather than quietly truncating.
  const handoffHidden =
    Math.max(0, view.waitingOnUs.length - HANDOFF_CAP) +
    Math.max(0, view.weAreBlocking.length - HANDOFF_CAP);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Ops"
          title="Install Team"
          subtitle={`What's scheduled ahead of us, and whether the material for it is ready. As of ${fmtDate(board.asOf)}.`}
          actions={rfmsBadge}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <KpiTile
            label="Installing today"
            value={board.todayJobs.length}
            hero
            foot={
              board.todayJobs.length
                ? `${plural(board.todayJobs.filter((r) => r.crew).length, 'crew', 'crews')} out · ${money(
                    board.todayJobs.reduce((a, r) => a + r.amount, 0)
                  )}`
                : 'Nothing on the calendar for today'
            }
          />
          <KpiTile
            label="Work ahead"
            value={board.future.length}
            foot={`Scheduled after ${fmtDate(board.asOf)} · ${plural(board.rows.length, 'active job', 'active jobs')} on the board`}
            spark={spark.jobs}
          />
          <KpiTile
            label="Upcoming value"
            value={money(board.upcomingValue)}
            foot={`Across ${plural(board.future.length, 'scheduled job', 'scheduled jobs')}`}
            spark={spark.value}
          />
          <KpiTile
            label="Installing ≤ 14 days"
            value={board.soon.length}
            foot="The next two weeks of crew load"
          />
          <KpiTile
            label="Past install date"
            value={board.overdue.length}
            delta={board.overdue.length ? 'not completed' : null}
            dir="up"
            deltaTone="bad"
            foot="Install date passed with no completion recorded"
          />
          <KpiTile
            label="Waiting on us"
            value={view.waitingOnUs.length}
            delta={view.overSla.length ? `${view.overSla.length} past SLA` : null}
            dir="up"
            deltaTone="bad"
            foot="Live jobs the stage engine says Install owns right now"
          />
          <KpiTile
            label="Material w/o a PO"
            value={board.materialKnown ? board.noPO.length : '—'}
            delta={board.materialKnown && board.noPO.length ? 'no PO raised' : null}
            dir="up"
            deltaTone="bad"
            foot={
              board.materialKnown
                ? board.noPO.length
                  ? 'Scheduled jobs with an unordered material line'
                  : 'All scheduled material has a PO'
                : 'Needs RFMS connected'
            }
          />
        </div>

        {handoffBanner}
        <ModuleCard
          title="Handoffs"
          subtitle="What's waiting on Install, and what Install is holding up"
          icon={ArrowLeftRight}
          footer={
            handoffHidden > 0 ? (
              <span className="text-muted-foreground">
                {plural(handoffHidden, 'more item', 'more items')} not shown.
              </span>
            ) : null
          }
        >
          <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-2">
            <div className="bg-card">
              <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Waiting on us</span>
                <span className="tabular-nums">
                  {plural(view.waitingOnUs.length, 'job', 'jobs')} · {money(view.value)}
                </span>
              </div>
              <div className="divide-y divide-border">
                {view.waitingOnUs.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <h3 className="text-sm font-semibold text-foreground">Nothing sitting with Install</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No live job currently has this department as its owner.
                    </p>
                  </div>
                ) : (
                  view.waitingOnUs.slice(0, HANDOFF_CAP).map((j) => (
                    <WorkRow
                      key={j.id}
                      lead={j.ageDays != null ? `${j.ageDays}d` : '—'}
                      primary={j.customerName}
                      meta={`${j.stageLabel} · ${j.nextAction}`}
                      status={j.overSla ? 'Past SLA' : 'In stage'}
                      tone={j.overSla ? 'crit' : 'info'}
                      onClick={canOpenJob(j) ? () => openJob(j) : undefined}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="bg-card">
              <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>We&apos;re holding up</span>
                <span className="tabular-nums">
                  {plural(view.weAreBlocking.length, 'blocker', 'blockers')}
                </span>
              </div>
              <div className="divide-y divide-border">
                {view.weAreBlocking.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-semibold text-good">
                      Install isn&apos;t blocking anything right now.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No other department is waiting on this crew to move.
                    </p>
                  </div>
                ) : (
                  view.weAreBlocking.slice(0, HANDOFF_CAP).map((b) => (
                    <AlertRow
                      key={`${b.code}-${b.job.id}`}
                      severity={b.severity}
                      title={`${b.label} — ${b.job.customerName}`}
                      detail={b.detail}
                      onClick={canOpenJob(b.job) ? () => openJob(b.job) : undefined}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </ModuleCard>

        {/* Workflow exceptions — things the engine could neither pass nor block
            safely, so a human has to look. Until this existed, every exception
            the gates raised was written to a table no screen read: the system
            "observed" into a void. */}
        {openExceptions.length > 0 && (
          <ModuleCard
            title="Needs a human"
            subtitle="Raised by the workflow engine — not blocking anything, but not resolving on its own"
            icon={AlertTriangle}
          >
            {openExceptions.map((x) => (
              <div
                key={x.id}
                // subject_id does not say which table it points at, so this only
                // becomes a link when the exception says 'project'.
                onClick={canOpenJob(x) ? () => openJob(x) : undefined}
                role={canOpenJob(x) ? 'button' : undefined}
                tabIndex={canOpenJob(x) ? 0 : undefined}
                onKeyDown={canOpenJob(x) ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJob(x); }
                } : undefined}
                className={cn(
                  'flex items-start justify-between gap-4 px-4 py-3',
                  canOpenJob(x) && 'cursor-pointer transition-colors hover:bg-muted/50'
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={x.severity === 'crit' ? 'crit' : 'warn'}>
                      {EXCEPTION_LABELS[x.code] || x.code}
                    </StatusPill>
                    <span className="text-sm font-medium text-foreground">
                      {nameForSubject(x) || x.subject_id}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{x.detail}</p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {x.first_seen_at ? `${dayDiff(isoDay(x.first_seen_at), today())}d open` : ''}
                </span>
              </div>
            ))}
          </ModuleCard>
        )}

        {board.rows.length === 0 ? (
          <ModuleCard title="Install board" subtitle="Every active project, soonest first" icon={CalendarRange}>
            <div className="px-4 py-14 text-center">
              <CalendarRange className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">No active projects</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Jobs appear here as soon as a sale becomes a project.
              </p>
            </div>
          </ModuleCard>
        ) : (
          <>
            <ModuleCard
              title="Install board"
              subtitle={`${plural(futureSorted.length, 'job', 'jobs')} scheduled ahead · ${money(board.upcomingValue)}`}
              icon={CalendarRange}
              action={rfmsBadge}
            >
              {futureSorted.length === 0 ? (
                <div className="px-4 py-14 text-center">
                  <CalendarRange className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                  <h3 className="text-sm font-semibold text-foreground">Nothing scheduled ahead</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Jobs land on the board once an install date is set.
                  </p>
                </div>
              ) : (
                <DataTable
                  className="rounded-none border-0"
                  columns={columns}
                  data={futureSorted}
                  rowKey={(r) => r.id}
                  onRowClick={openJob}
                />
              )}
            </ModuleCard>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <ModuleCard
                title="This week"
                subtitle={`${plural(weekCount, 'job', 'jobs')} from today through ${fmtDate(addDays(board.asOf, 6))}`}
                icon={CalendarDays}
              >
                {week.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                    <h3 className="text-sm font-semibold text-foreground">Nothing installing this week</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The next seven days are clear on the calendar.
                    </p>
                  </div>
                ) : (
                  week.map((group) => (
                    <React.Fragment key={group.day}>
                      <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <span>{dayLabel(group.day, board.asOf)}</span>
                        <span className="tabular-nums">
                          {plural(group.rows.length, 'job', 'jobs')} · {money(group.value)}
                        </span>
                      </div>
                      {group.rows.map((r) => (
                        <WorkRow
                          key={r.id}
                          lead={money(r.amount)}
                          primary={r.customerName}
                          meta={[r.crew || 'Crew unassigned', r.city, r.invoice && `Inv ${r.invoice}`]
                            .filter(Boolean)
                            .join('  ·  ')}
                          status={r.readiness ? READY_LABEL[r.readiness] : r.stage}
                          tone={r.readiness ? READY_TONE[r.readiness] : stageTone(r.stage)}
                          onClick={canOpenJob(r) ? () => openJob(r) : undefined}
                        />
                      ))}
                    </React.Fragment>
                  ))
                )}
              </ModuleCard>

              <ModuleCard
                title="Crew load"
                subtitle={`${plural(board.crewLoad.length, 'crew', 'crews')} across the forward board`}
                icon={HardHat}
              >
                {board.crewLoad.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <HardHat className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                    <h3 className="text-sm font-semibold text-foreground">No crews on the board</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Crew load fills in once scheduled jobs have a crew.
                    </p>
                  </div>
                ) : (
                  board.crewLoad.map((c) => {
                    const share = board.future.length
                      ? Math.round((c.jobs / board.future.length) * 100)
                      : 0;
                    return (
                      <WorkRow
                        key={c.crew}
                        lead={c.jobs}
                        primary={c.crew}
                        meta={`${share}% of the forward board`}
                        trailing={
                          <span className="whitespace-nowrap font-display text-[13px] font-bold tabular-nums">
                            {money(c.value)}
                          </span>
                        }
                      />
                    );
                  })
                )}
              </ModuleCard>
            </div>

            <ModuleCard
              title="Needs attention"
              subtitle={`${board.overdue.length} past due · ${board.onHold.length} on hold · ${board.unscheduled.length} unscheduled`}
              icon={AlertTriangle}
              footer={
                alerts.hidden > 0 ? (
                  <span className="text-muted-foreground">
                    {plural(alerts.hidden, 'more item', 'more items')} not shown — {alerts.total} in total.
                  </span>
                ) : null
              }
            >
              {alerts.rows.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                  <h3 className="text-sm font-semibold text-foreground">Nothing needs attention</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No past-due installs, no holds, and every sold job has a date.
                  </p>
                </div>
              ) : (
                alerts.rows.map((a) => (
                  <AlertRow
                    key={a.key}
                    severity={a.severity}
                    title={a.title}
                    detail={a.detail}
                    onClick={canOpenJob(a) ? () => openJob(a) : undefined}
                  />
                ))
              )}
            </ModuleCard>

            <ModuleCard
              title="Material readiness"
              subtitle={
                materialMix
                  ? `${plural(materialMix.orders, 'scheduled order', 'scheduled orders')} with RFMS line status · ${plural(materialMix.lines, 'line', 'lines')}`
                  : 'Line status per order, straight from RFMS'
              }
              icon={PackageCheck}
              action={rfmsBadge}
            >
              {!materialMix ? (
                <div className="px-4 py-12 text-center">
                  <PackageCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Material readiness needs RFMS connected
                  </h3>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                    Once RFMS is connected, every job on the board shows whether its material is
                    delivered, on order, or still without a PO. Nothing is estimated here until then.
                  </p>
                  <div className="mt-4 flex justify-center">
                    <SyncBadge status="stale" label="RFMS not connected" />
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
                    {[
                      { label: 'Ready', value: materialMix.ready, tone: 'text-good' },
                      { label: 'Partial', value: materialMix.partial, tone: 'text-warn' },
                      { label: 'Nothing received', value: materialMix.none, tone: 'text-crit' },
                      { label: 'No RFMS data', value: materialMix.unknown, tone: 'text-muted-foreground' },
                    ].map((s) => (
                      <div key={s.label} className="bg-card px-4 py-3">
                        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {s.label}
                        </div>
                        <div className={`mt-1 font-display text-[22px] font-extrabold leading-none tabular-nums ${s.tone}`}>
                          {s.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="px-2 py-3">
                    <div className="h-[200px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={materialMix.bars}
                          layout="vertical"
                          margin={{ top: 4, right: 20, bottom: 4, left: 4 }}
                        >
                          <CartesianGrid
                            horizontal={false}
                            stroke="hsl(var(--border))"
                            strokeDasharray="2 4"
                          />
                          <XAxis
                            type="number"
                            allowDecimals={false}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={68}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} content={<StatusTooltip />} />
                          <Bar dataKey="count" barSize={14} radius={[0, 3, 3, 0]}>
                            {materialMix.bars.map((b) => (
                              <Cell key={b.status} fill={STATUS_FILL[b.status]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="px-2 pt-1 text-[11px] leading-snug text-muted-foreground">
                      Line statuses across scheduled orders, worst to best. {STATUS_HELP.None} ·{' '}
                      {STATUS_HELP.Del}
                    </p>
                  </div>

                  {board.noPO.length > 0 && (
                    <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>Scheduled with no PO</span>
                      <StatusPill tone={STATUS_TONE.None} dot>
                        {plural(board.noPO.length, 'order', 'orders')}
                      </StatusPill>
                    </div>
                  )}
                  {board.noPO
                    .slice()
                    .sort((a, b) => a.install.localeCompare(b.install))
                    .slice(0, 8)
                    .map((r) => (
                      <WorkRow
                        key={r.id}
                        lead={fmtDate(r.install)}
                        primary={r.customerName}
                        meta={`${plural(r.material.noPO, 'line', 'lines')} with no PO · ${r.crew || 'Crew unassigned'} · ${money(r.amount)}`}
                        status="No PO"
                        tone={STATUS_TONE.None}
                      />
                    ))}
                </>
              )}
            </ModuleCard>
          </>
        )}
      </div>
    </div>
  );
}
