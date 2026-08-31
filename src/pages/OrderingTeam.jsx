import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import {
  Loader2,
  BarChart3,
  ClipboardList,
  TableProperties,
  Boxes,
  CheckCircle2,
  ArrowLeftRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import SyncBadge from '@/components/common/SyncBadge';
import DataTable from '@/components/common/DataTable';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';
import AlertRow from '@/components/dashboard/AlertRow';
import PipelineBar from '@/components/dashboard/PipelineBar';

import {
  buildOrdersPipeline,
  buildOrderingQueue,
  materialIndex,
  LINE_STATUSES,
  STATUS_HELP,
  STATUS_TONE,
  money,
  shortMoney,
  fmtDate,
  today,
} from '@/lib/ops/metrics';
import { buildJobFlow, departmentView } from '@/lib/ops/flow';
import { usePublishedFlow } from '@/lib/ops/usePublishedFlow';
import { useOpenJob, canOpenJob } from '@/lib/ops/openJob';
import { useBalances } from '@/lib/ops/useBalances';

// ── Local presentation helpers ───────────────────────────────────────────────
const GRAINS = [
  { value: 'day', label: 'Day', word: 'day' },
  { value: 'week', label: 'Week', word: 'week' },
  { value: 'month', label: 'Month', word: 'month' },
];

// Averages here run over tens of jobs, not thousands of RFMS lines — rounding
// 0.6 to "1" would overstate the desk's throughput, so keep a decimal until the
// number is big enough that the decimal is noise.
function avgFmt(n) {
  const v = Number(n) || 0;
  if (v >= 10) return Math.round(v).toLocaleString('en-US');
  return String(Math.round(v * 10) / 10);
}

// The queue's only clock is age: nothing has been ordered yet, so how long the
// customer has been sold-but-unordered is the whole story.
function queueTone(ageDays) {
  if (ageDays == null) return 'neutral';
  if (ageDays > 14) return 'crit';
  if (ageDays > 7) return 'warn';
  return 'info';
}

// Handoffs are capped so the card stays a glance, not a backlog. The cap only
// works if the worst thing is guaranteed to be inside it — hence the sort.
const HANDOFF_CAP = 6;
const SEV_RANK = { crit: 0, warn: 1, info: 2 };

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const b = payload[0]?.payload;
  if (!b) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 flex items-center gap-2 font-display text-[12px] font-bold">
        {b.label}
        {b.kind === 'ahead' && <StatusPill tone="info">Scheduled</StatusPill>}
        {b.kind === 'partial' && <StatusPill tone="warn">Partial</StatusPill>}
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Ordered</span>
        <span className="font-semibold tabular-nums">
          {b.ordered} · {money(b.orderedValue)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Installing</span>
        <span className="font-semibold tabular-nums">
          {b.installing} · {money(b.installingValue)}
        </span>
      </div>
    </div>
  );
}

export default function OrderingTeam() {
  const [grain, setGrain] = useState('week');

  // asOf is pinned once per mount so every builder and every label agree.
  const asOf = useMemo(() => today(), []);

  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['ops', 'sales'],
    queryFn: () => base44.entities.Sale.list('-sale_date'),
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['ops', 'projects'],
    queryFn: () => base44.entities.Project.list(),
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ['ops', 'customers'],
    queryFn: () => base44.entities.Customer.list(),
  });

  // rfms_order_status is empty (and may be RLS-blocked) until the owner connects
  // RFMS. A failure here must never take the page down — it degrades to [] and
  // the material section renders its honest empty state instead.
  const { data: statusRows = [], isError: rfmsError } = useQuery({
    queryKey: ['ops', 'rfmsOrderStatus'],
    queryFn: async () => {
      try {
        return (await base44.entities.RFMSOrderStatus.list()) || [];
      } catch (err) {
        console.warn('[OrderingTeam] RFMS order status unavailable:', err);
        return [];
      }
    },
    retry: false,
  });

  const material = useMemo(() => materialIndex(statusRows), [statusRows]);

  const pipeline = useMemo(
    () => buildOrdersPipeline({ sales, projects, grain, asOf }),
    [sales, projects, grain, asOf]
  );

  const queue = useMemo(
    () => buildOrderingQueue({ sales, customers, projects, asOf }),
    [sales, customers, projects, asOf]
  );

  // Roll the material index into the readiness ramp. materialKnown is true only
  // once RFMS has actually reported a line status — a zero is never faked.
  const materialRamp = useMemo(() => {
    const counts = Object.fromEntries(LINE_STATUSES.map((s) => [s, 0]));
    let totalLines = 0;
    const entries = Object.entries(material);
    for (const [, entry] of entries) {
      for (const s of LINE_STATUSES) counts[s] += entry.counts?.[s] || 0;
      totalLines += entry.total || 0;
    }
    const liveInvoices = new Set(
      sales
        .filter((s) => !s.is_cancelled && s.invoice_number)
        .map((s) => String(s.invoice_number).trim())
    );
    return {
      counts,
      totalLines,
      orders: entries.length,
      matched: entries.filter(([k]) => liveInvoices.has(k)).length,
      known: totalLines > 0,
    };
  }, [material, sales]);

  // Collection state for Gate 1 — ordering is held until the deposit clears.
  const { balances } = useBalances();

  // ── Handoffs ───────────────────────────────────────────────────────────────
  // The same rows this page already loads, run through the stage engine so the
  // desk can see both directions of the handoff: what has landed on Ordering,
  // and what Ordering is holding up for somebody downstream. No appointments are
  // needed here — nothing Ordering owns turns on one.
  // The published graph + THE classifier (job_stage). No JS fallback exists.
  const { graph, stageRows } = usePublishedFlow();
  const openJob = useOpenJob();

  const flow = useMemo(
    () => buildJobFlow({ sales, projects, appointments: [], customers, material, balances, stageRows, graph, asOf }),
    [sales, projects, customers, material, balances, stageRows, graph, asOf]
  );

  // departmentView returns null while the published graph / classifier view are
  // unavailable; the handoff panels then render empty WITH a banner (below)
  // rather than silently showing a healthy-looking zero.
  const flowUnavailable = !flow;
  const view = useMemo(
    () => departmentView(flow, 'ordering') ?? {
      dept: 'ordering', label: 'Ordering',
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

  // Worst first, so the cap can never hide a crit. A committed install date with
  // material still short is the sharpest signal this page can raise.
  const blocking = useMemo(
    () =>
      view.weAreBlocking
        .slice()
        .sort(
          (a, b) =>
            (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3) ||
            (b.job?.amount || 0) - (a.job?.amount || 0)
        ),
    [view.weAreBlocking]
  );

  const grainWord = GRAINS.find((g) => g.value === grain)?.word || 'week';
  const completePeriods = pipeline.series.filter((b) => b.kind === 'complete').length;
  const hasPartial = pipeline.series.some((b) => b.kind === 'partial');
  const aheadPeriods = pipeline.series.filter((b) => b.kind === 'ahead').length;

  const queueValue = queue.reduce((a, q) => a + q.amount, 0);
  const queueStale = queue.filter((q) => (q.ageDays ?? 0) > 14).length;
  const queueScheduled = queue.filter((q) => q.installDate).length;

  const orderedSpark = pipeline.series.map((b) => b.ordered);
  const installingSpark = pipeline.series.map((b) => b.installing);

  // Chart rows only need a floor width so day grain stays legible; the container scrolls.
  const chartMinWidth = Math.max(560, pipeline.series.length * (grain === 'day' ? 26 : 48));

  // Empty gap-filled periods belong on the axis but not in the table.
  const tableRows = useMemo(
    () => pipeline.series.filter((b) => b.ordered > 0 || b.installing > 0).slice().reverse(),
    [pipeline.series]
  );

  const periodHeader = grain === 'month' ? 'Month' : grain === 'week' ? 'Week of' : 'Day';

  if (salesLoading || projectsLoading || customersLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const columns = [
    {
      key: 'label',
      header: periodHeader,
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-semibold">{row.label}</span>
          {row.kind === 'ahead' && <StatusPill tone="info">Sched</StatusPill>}
          {row.kind === 'partial' && <StatusPill tone="warn">Partial</StatusPill>}
        </div>
      ),
    },
    {
      key: 'ordered',
      header: 'Ordered',
      numeric: true,
      render: (row) => (row.ordered ? row.ordered : <span className="text-muted-foreground/50">·</span>),
    },
    {
      key: 'orderedValue',
      header: 'Ordered value',
      numeric: true,
      render: (row) =>
        row.orderedValue ? money(row.orderedValue) : <span className="text-muted-foreground/50">·</span>,
    },
    {
      key: 'installing',
      header: 'Installing',
      numeric: true,
      render: (row) => (row.installing ? row.installing : <span className="text-muted-foreground/50">·</span>),
    },
    {
      key: 'installingValue',
      header: 'Installing value',
      numeric: true,
      render: (row) =>
        row.installingValue ? money(row.installingValue) : <span className="text-muted-foreground/50">·</span>,
    },
  ];

  const waitingShown = view.waitingOnUs.slice(0, HANDOFF_CAP);
  const waitingMore = view.waitingOnUs.length - waitingShown.length;
  const blockingShown = blocking.slice(0, HANDOFF_CAP);
  const blockingMore = blocking.length - blockingShown.length;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Ops"
          title="Ordering Team"
          subtitle={`Demand in vs capacity out, and what still has to be ordered · as of ${fmtDate(pipeline.asOf)}`}
          actions={
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
              {GRAINS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGrain(g.value)}
                  aria-pressed={grain === g.value}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                    grain === g.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiTile
            label={`Avg ordered / ${grainWord}`}
            value={avgFmt(pipeline.avgOrdered)}
            hero
            spark={orderedSpark}
            foot={`${completePeriods} complete ${grainWord}${completePeriods === 1 ? '' : 's'}${
              hasPartial ? ` · this ${grainWord} still open` : ''
            }`}
          />
          <KpiTile
            label={`Avg installing / ${grainWord}`}
            value={avgFmt(pipeline.avgInstalling)}
            spark={installingSpark}
            foot="the capacity actually consumed"
          />
          <KpiTile
            label={`Peak install ${grainWord}`}
            value={pipeline.peak && pipeline.peak.installing > 0 ? pipeline.peak.installing : '—'}
            foot={
              pipeline.peak && pipeline.peak.installing > 0
                ? `${pipeline.peak.label} · jobs installing`
                : 'No installs bucketed yet'
            }
          />
          <KpiTile
            label="Scheduled ahead"
            value={pipeline.scheduledAhead}
            foot={`Jobs installing after ${fmtDate(pipeline.asOf)}${
              pipeline.scheduledAheadValue ? ` · ${shortMoney(pipeline.scheduledAheadValue)}` : ''
            }`}
          />
          <KpiTile
            label="Waiting to be ordered"
            value={queue.length}
            delta={queueStale > 0 ? `${queueStale} over 14 days` : undefined}
            dir={queueStale > 0 ? 'up' : 'flat'}
            deltaTone="bad"
            foot={
              queue.length
                ? `Sold, no RFMS invoice number yet · ${money(queueValue)}`
                : 'Every live sale has an RFMS invoice number'
            }
          />
          <KpiTile
            label="Waiting on us"
            value={view.waitingOnUs.length}
            delta={view.overSla.length > 0 ? `${view.overSla.length} past SLA` : undefined}
            dir="up"
            deltaTone="bad"
            foot={
              view.waitingOnUs.length
                ? `Jobs Ordering owns right now · ${money(view.value)}`
                : 'Nothing is sitting with Ordering'
            }
          />
        </div>

        {handoffBanner}
        <ModuleCard
          title="Handoffs"
          subtitle="What's waiting on Ordering, and what Ordering is holding up"
          icon={ArrowLeftRight}
          action={
            view.overSla.length > 0 || !flow?.materialKnown ? (
              <div className="flex items-center gap-2">
                {view.overSla.length > 0 && (
                  <StatusPill tone="crit" dot>
                    {view.overSla.length} past SLA
                  </StatusPill>
                )}
                {!flow?.materialKnown && <SyncBadge status="stale" label="RFMS not connected" />}
              </div>
            ) : null
          }
          footer={
            <span className="text-muted-foreground">
              Left is Ordering's own inbox — jobs whose next move belongs to this desk, worst first. Right
              is what Ordering is holding up for another department. A committed install date with material
              still short is the sharpest signal either side can carry.
              {!flow?.materialKnown && ' Material-gated handoffs cannot appear until RFMS is connected.'}
            </span>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <section className="min-w-0">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
                <h3 className="font-display text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Waiting on us
                </h3>
                <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                  {view.waitingOnUs.length}
                </span>
              </div>
              {view.waitingOnUs.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-good/70" />
                  <p className="text-xs text-muted-foreground">
                    Nothing is sitting with Ordering right now.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {waitingShown.map((job) => (
                    <WorkRow
                      key={job.id}
                      onClick={canOpenJob(job) ? () => openJob(job) : undefined}
                      lead={job.ageDays != null ? `${job.ageDays}d` : '—'}
                      primary={job.customerName || '—'}
                      meta={`${job.stageLabel} · ${job.nextAction}`}
                      status={
                        job.overSla
                          ? `Past ${job.sla}d SLA`
                          : job.sla != null
                            ? `${job.sla}d SLA`
                            : 'No SLA'
                      }
                      tone={job.overSla ? 'crit' : 'info'}
                    />
                  ))}
                  {waitingMore > 0 && (
                    <div className="px-4 py-2 text-[11px] text-muted-foreground">
                      +{waitingMore} more waiting on Ordering
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="min-w-0 border-t border-border lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
                <h3 className="font-display text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  We're holding up
                </h3>
                <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                  {blocking.length}
                </span>
              </div>
              {blocking.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-good/70" />
                  <p className="text-xs text-muted-foreground">
                    Ordering isn't blocking anything right now.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {blockingShown.map((b) => (
                    <AlertRow
                      key={`${b.job?.id}-${b.code}`}
                      severity={b.severity}
                      title={`${b.label} — ${b.job?.customerName || '—'}`}
                      detail={b.detail}
                      onClick={canOpenJob(b.job) ? () => openJob(b.job) : undefined}
                    />
                  ))}
                  {blockingMore > 0 && (
                    <div className="px-4 py-2 text-[11px] text-muted-foreground">
                      +{blockingMore} more held up by Ordering
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </ModuleCard>

        <ModuleCard
          title="Ordered vs installing"
          subtitle={`Two clocks, one chart · by ${grainWord}`}
          icon={BarChart3}
          footer={
            <span className="text-muted-foreground">
              Every job is counted twice — once on the {grainWord} it was <strong>ordered</strong> (demand in) and again
              on the {grainWord} it is <strong>installing</strong> (capacity out).
              {aheadPeriods > 0 && ` Everything after ${fmtDate(pipeline.asOf)} is forward schedule.`}
              {hasPartial && ' The period containing today is partial and is excluded from the averages.'}
            </span>
          }
        >
          {pipeline.series.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <BarChart3 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">Nothing to plot yet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Sales need a sale date, and jobs need an install date, before the two clocks can be drawn.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto p-4">
              <div style={{ minWidth: chartMinWidth }}>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={pipeline.series} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                    <XAxis
                      dataKey="label"
                      interval="preserveStartEnd"
                      minTickGap={grain === 'day' ? 28 : 8}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                    />
                    <YAxis
                      width={36}
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.5 }} />
                    <Legend verticalAlign="top" height={30} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="ordered"
                      name="Ordered (demand in)"
                      fill="hsl(var(--brand-navy))"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={grain === 'day' ? 8 : 28}
                    >
                      {pipeline.series.map((b) => (
                        <Cell
                          key={b.key}
                          fillOpacity={b.kind === 'ahead' ? 0.4 : b.kind === 'partial' ? 0.7 : 1}
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone"
                      dataKey="installing"
                      name="Installing (load out)"
                      stroke="hsl(var(--brand-pink))"
                      strokeWidth={2}
                      dot={grain === 'month' ? { r: 2.5 } : false}
                      activeDot={{ r: 4 }}
                    />
                    {pipeline.avgInstalling > 0 && (
                      <ReferenceLine
                        y={pipeline.avgInstalling}
                        stroke="hsl(var(--brand-blue))"
                        strokeDasharray="4 4"
                        strokeOpacity={0.8}
                        label={{
                          value: `avg ${avgFmt(pipeline.avgInstalling)}`,
                          position: 'insideTopRight',
                          fill: 'hsl(var(--muted-foreground))',
                          fontSize: 11,
                        }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </ModuleCard>

        <ModuleCard
          title="Waiting to be ordered"
          subtitle={
            queue.length
              ? `${queue.length} sold ${queue.length === 1 ? 'job' : 'jobs'} · ${money(queueValue)} · oldest first`
              : 'The desk is clear'
          }
          icon={ClipboardList}
          action={
            queueStale > 0 ? (
              <StatusPill tone="crit" dot>
                {queueStale} over 14 days
              </StatusPill>
            ) : null
          }
          footer={
            queue.length ? (
              <span className="text-muted-foreground">
                These are live sales with no RFMS invoice number — nothing has been ordered for them yet.
                {queueScheduled > 0 && ` ${queueScheduled} already ${queueScheduled === 1 ? 'has' : 'have'} an install date on the calendar.`}
              </span>
            ) : null
          }
        >
          {queue.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-good/70" />
              <h3 className="text-sm font-semibold text-foreground">Nothing waiting to be ordered</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Every live sale carries an RFMS invoice number.
              </p>
            </div>
          ) : (
            queue.map((row) => {
              const meta = [
                row.soldOn ? `Sold ${fmtDate(row.soldOn)}` : 'No sold date',
                row.ageDays != null ? `${row.ageDays}d old` : null,
                row.installDate ? `Installs ${fmtDate(row.installDate)}` : null,
                row.address,
              ]
                .filter(Boolean)
                .join('  ·  ');
              return (
                <WorkRow
                  key={row.id}
                  onClick={canOpenJob(row) ? () => openJob(row) : undefined}
                  lead={money(row.amount)}
                  primary={row.customerName || '—'}
                  meta={meta}
                  status={row.ageDays != null ? `${row.ageDays}d waiting` : 'No sold date'}
                  tone={queueTone(row.ageDays)}
                />
              );
            })
          )}
        </ModuleCard>

        <ModuleCard
          title="Period detail"
          subtitle={`${tableRows.length} ${tableRows.length === 1 ? 'period' : 'periods'} with activity · newest first`}
          icon={TableProperties}
        >
          <DataTable
            columns={columns}
            data={tableRows}
            rowKey={(row) => row.key}
            className="rounded-none border-0"
            empty="No periods with orders or installs yet."
          />
        </ModuleCard>

        <ModuleCard
          title="Material status pipeline"
          subtitle={
            materialRamp.known
              ? `${materialRamp.totalLines} lines across ${materialRamp.orders} ${
                  materialRamp.orders === 1 ? 'order' : 'orders'
                } · ${materialRamp.matched} matched to a live sale`
              : 'Where the material sits on the readiness ramp'
          }
          icon={Boxes}
          action={
            <SyncBadge
              status={rfmsError ? 'error' : materialRamp.known ? 'synced' : 'stale'}
              label={
                rfmsError
                  ? 'RFMS unavailable'
                  : materialRamp.known
                    ? 'RFMS connected'
                    : 'RFMS not connected'
              }
            />
          }
        >
          {materialRamp.known ? (
            <div className="space-y-4 p-4">
              <PipelineBar
                stages={LINE_STATUSES.map((s) => ({
                  name: s,
                  count: materialRamp.counts[s],
                  value: materialRamp.totalLines
                    ? `${Math.round((100 * materialRamp.counts[s]) / materialRamp.totalLines)}%`
                    : null,
                  // "None" is the ordering desk's own risk: no PO raised yet.
                  attention: s === 'None' && materialRamp.counts[s] > 0,
                }))}
              />
              <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
                {LINE_STATUSES.map((s) => (
                  <div key={s} className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <StatusPill tone={STATUS_TONE[s] || 'neutral'}>{s}</StatusPill>
                    <span className="truncate">{STATUS_HELP[s]}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-4 py-12 text-center">
              <Boxes className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">Material readiness needs RFMS connected</h3>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                {rfmsError
                  ? 'RFMS order status could not be read, so no PO or receipt state is available. Nothing is shown here rather than a zero that would read as "all clear".'
                  : 'PO status, on-order lines and delivery state all come from RFMS. Until it is connected there is no material data to show — and a zero here would read as "all clear", which it is not.'}
              </p>
            </div>
          )}
        </ModuleCard>
      </div>
    </div>
  );
}
