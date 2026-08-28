import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, BarChart3, Loader2, TrendingDown, Users } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import DataTable from '@/components/common/DataTable';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';
import { buildCycleReport, fmtDate, today, OUTLIER_DAYS } from '@/lib/ops/metrics';

// Reps under this many completed jobs are shown but never ranked — a median off
// three jobs reads as a league table and isn't one. (GBTN: MIN_JOBS_FOR_RANK.)
const MIN_JOBS_FOR_RANK = 10;

// Only the 40 longest waits are drawn; the count chip carries the true total.
const OUTLIER_ROWS = 40;

const NAVY = 'hsl(var(--brand-navy))';
const BLUE = 'hsl(var(--brand-blue))';
const CRIT = 'hsl(var(--crit))';
const GRID = 'hsl(var(--border))';
const TICK = 'hsl(var(--muted-foreground))';

function ChartTooltip({ active, payload, label, rows }) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0]?.payload || {};
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="font-display text-[12px] font-bold">{label}</div>
      {rows(point).map((r) => (
        <div key={r.label} className="mt-1 flex items-center gap-3 text-muted-foreground">
          <span>{r.label}</span>
          <span className="ml-auto font-semibold tabular-nums text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function SpeedToInstall() {
  const asOf = today();

  const { data: appointments = [], isLoading: apptLoading } = useQuery({
    queryKey: ['ops', 'appointments'],
    queryFn: () => base44.entities.Appointment.list(),
  });
  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['ops', 'sales'],
    queryFn: () => base44.entities.Sale.list(),
  });
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['ops', 'projects'],
    queryFn: () => base44.entities.Project.list(),
  });
  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ['ops', 'customers'],
    queryFn: () => base44.entities.Customer.list(),
  });
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['ops', 'teamMembers'],
    queryFn: () => base44.entities.TeamMember.list(),
  });

  const isLoading = apptLoading || salesLoading || projectsLoading || customersLoading;

  const report = useMemo(
    () => buildCycleReport({ appointments, sales, projects, customers, asOf }),
    [appointments, sales, projects, customers, asOf]
  );

  // id → "First Last"; falls back to whatever the sale actually carried.
  const repName = useMemo(() => {
    const byId = Object.fromEntries(
      teamMembers.map((m) => [m.id, `${m.first_name || ''} ${m.last_name || ''}`.trim()])
    );
    return (value) => {
      if (!value || value === 'Unassigned') return 'Unassigned';
      return byId[value] || String(value);
    };
  }, [teamMembers]);

  // Ranked reps fastest-first; thin reps pushed below, ordered by volume.
  const repRows = useMemo(
    () =>
      (report.byRep || [])
        .map((r) => ({ ...r, name: repName(r.rep), thin: r.jobs < MIN_JOBS_FOR_RANK }))
        .sort((a, b) => {
          if (a.thin !== b.thin) return a.thin ? 1 : -1;
          if (a.thin && b.thin) return b.jobs - a.jobs;
          return (a.median ?? 0) - (b.median ?? 0);
        }),
    [report.byRep, repName]
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const dist = report.measureToInstall;

  if (!dist) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            eyebrow="Ops"
            title="Speed to Install"
            subtitle={`Measure → install cycle time · as of ${fmtDate(report.asOf)}`}
          />
          <ModuleCard title="Nothing to time yet" icon={TrendingDown} bodyClassName="p-0">
            <div className="px-4 py-14 text-center">
              <TrendingDown className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">
                No job yet has both a measure date and a completed install.
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                The clock starts at the measure appointment and stops when the crew finishes —
                jobs still scheduled ahead sit out of this report.
                {report.scheduledAhead > 0
                  ? ` ${report.scheduledAhead} timeable ${report.scheduledAhead === 1 ? 'job is' : 'jobs are'} still scheduled ahead.`
                  : ''}
              </p>
            </div>
          </ModuleCard>
        </div>
      </div>
    );
  }

  const sameDayPct = Math.round(report.sameDaySellPct);
  const worst = report.jobs[0] || null;
  const outlierCount = report.outliers.length;

  // Anchor the median marker to the histogram band that contains it.
  const medianBand = report.histogram.find((b) => dist.median >= b.lo && dist.median < b.hi);

  const medianFoot =
    `measure → install · ${dist.n} completed ${dist.n === 1 ? 'job' : 'jobs'}` +
    (report.scheduledAhead > 0 ? ` · ${report.scheduledAhead} still scheduled` : '');

  const worstFoot = worst
    ? [worst.customerName, worst.invoice ? `Inv #${worst.invoice}` : null].filter(Boolean).join(' · ')
    : '—';

  const repColumns = [
    {
      key: 'rep',
      header: 'Consultant',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{row.name}</span>
          {row.thin && <StatusPill tone="neutral">Thin</StatusPill>}
        </div>
      ),
    },
    { key: 'jobs', header: 'Jobs', numeric: true },
    {
      key: 'median',
      header: 'Median',
      numeric: true,
      render: (row) => <span className="font-semibold">{row.median != null ? `${row.median}d` : '—'}</span>,
    },
    {
      key: 'p90',
      header: 'Slowest 10%',
      numeric: true,
      render: (row) => (row.p90 != null ? `${row.p90}d` : '—'),
    },
    {
      key: 'max',
      header: 'Longest',
      numeric: true,
      render: (row) => (row.max != null ? `${row.max}d` : '—'),
    },
  ];

  const shownOutliers = report.outliers.slice(0, OUTLIER_ROWS);

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Ops"
          title="Speed to Install"
          subtitle={`Measure → install cycle time · ${dist.n} completed ${dist.n === 1 ? 'job' : 'jobs'} · as of ${fmtDate(report.asOf)}`}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiTile label="Median wait" value={`${dist.median}d`} hero foot={medianFoot} />
          <KpiTile label="Slowest 10%" value={`${dist.p90}d`} foot="p90 — the tail customers remember" />
          <KpiTile
            label="Sold same day"
            value={`${sameDayPct}%`}
            foot="measure → order is 0 days"
          />
          <KpiTile
            label={`Over ${OUTLIER_DAYS} days`}
            value={outlierCount}
            delta={outlierCount > 0 ? 'exceptions' : null}
            deltaTone={outlierCount > 0 ? 'bad' : 'flat'}
            foot={outlierCount > 0 ? 'jobs — the exception list' : 'none'}
          />
          <KpiTile label="Longest" value={`${dist.max}d`} foot={worstFoot} />
        </div>

        {/* The editorial thesis, in live numbers. */}
        <ModuleCard title="The sale isn't where the time goes" icon={TrendingDown} bodyClassName="p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">
              {sameDayPct}% of jobs are sold the same day as the measure
            </span>
            {report.measureToOrder ? ` (median ${report.measureToOrder.median} days to order)` : ''} — so
            nearly all of the {dist.median}-day median wait is fulfilment: ordering material, receiving
            it, and getting a crew on site. Cutting the wait means cutting fulfilment, not the sales
            process.
          </p>
        </ModuleCard>

        <ModuleCard
          title="How long customers wait"
          subtitle="Days from the measure appointment to the completed install, one bar per band."
          icon={BarChart3}
          bodyClassName="p-4"
        >
          <div className="w-full overflow-x-auto">
            <div className="h-[240px] min-w-[520px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.histogram} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: TICK }}
                    tickLine={false}
                    axisLine={{ stroke: GRID }}
                  />
                  <YAxis
                    width={34}
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: TICK }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
                    content={
                      <ChartTooltip
                        rows={(p) => [
                          { label: `${p.label} days`, value: `${p.count} ${p.count === 1 ? 'job' : 'jobs'}` },
                        ]}
                      />
                    }
                  />
                  {medianBand && (
                    <ReferenceLine
                      x={medianBand.label}
                      stroke={CRIT}
                      strokeDasharray="4 4"
                      label={{ value: `median ${dist.median}d`, position: 'top', fontSize: 11, fill: CRIT }}
                    />
                  )}
                  <Bar dataKey="count" fill={NAVY} radius={[3, 3, 0, 0]} maxBarSize={46} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </ModuleCard>

        <ModuleCard
          title="Is it getting faster?"
          subtitle="Grouped by the month the install finished — bars are jobs, the line is that month's median wait."
          icon={TrendingDown}
          bodyClassName="p-4"
        >
          {report.byMonth.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Not enough completed installs to trend yet.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <div className="h-[260px] min-w-[520px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={report.byMonth} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: TICK }}
                      tickLine={false}
                      axisLine={{ stroke: GRID }}
                      minTickGap={12}
                    />
                    <YAxis
                      yAxisId="days"
                      width={44}
                      tick={{ fontSize: 11, fill: TICK }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${v}d`}
                    />
                    <YAxis
                      yAxisId="count"
                      orientation="right"
                      width={34}
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: TICK }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
                      content={
                        <ChartTooltip
                          rows={(p) => [
                            { label: 'Median wait', value: p.median != null ? `${p.median}d` : '—' },
                            { label: 'Jobs installed', value: p.jobs },
                          ]}
                        />
                      }
                    />
                    <ReferenceLine
                      yAxisId="days"
                      y={dist.median}
                      stroke={CRIT}
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                    <Bar
                      yAxisId="count"
                      dataKey="jobs"
                      fill={BLUE}
                      fillOpacity={0.28}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={26}
                    />
                    <Line
                      yAxisId="days"
                      type="monotone"
                      dataKey="median"
                      stroke={NAVY}
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: NAVY }}
                      activeDot={{ r: 4 }}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Left axis is days (the median line), right axis is job count (the bars). The dashed line is
            the all-time median — thin months swing hard on very few jobs.
          </p>
        </ModuleCard>

        <ModuleCard
          title="By consultant"
          subtitle="Completed jobs only, ranked by median wait."
          icon={Users}
          bodyClassName="p-4"
          footer={
            <span className="text-muted-foreground">
              Ranked by median. Consultants under {MIN_JOBS_FOR_RANK} completed jobs are marked thin and
              sorted below — a median off three jobs isn't a signal.
            </span>
          }
        >
          <div className="w-full overflow-x-auto">
            <div className="min-w-[560px]">
              <DataTable
                columns={repColumns}
                data={repRows}
                rowKey={(row) => row.rep}
                empty="No completed jobs to attribute yet."
              />
            </div>
          </div>
        </ModuleCard>

        {outlierCount > 0 && (
          <ModuleCard
            title={`Waited over ${OUTLIER_DAYS} days`}
            subtitle="The exception list, longest wait first."
            icon={AlertTriangle}
            action={<StatusPill tone="crit">{outlierCount}</StatusPill>}
            footer={
              outlierCount > shownOutliers.length ? (
                <span className="text-muted-foreground">
                  Showing the {shownOutliers.length} longest of {outlierCount}.
                </span>
              ) : undefined
            }
          >
            {shownOutliers.map((job) => (
              <WorkRow
                key={job.id}
                lead={`${job.days}d`}
                primary={job.customerName}
                meta={[
                  `${fmtDate(job.measure)} → ${fmtDate(job.install)}`,
                  job.invoice ? `Inv #${job.invoice}` : null,
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
                status={`${OUTLIER_DAYS}+ days`}
                tone="crit"
              />
            ))}
          </ModuleCard>
        )}

        <div className="space-y-1.5 text-[11px] leading-snug text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">Measured per job, not per line.</span> The
            clock starts at the measure appointment and stops when the crew finishes, so a phased job's
            wait ends when the first crew arrives.
          </p>
          <p>
            <span className="font-semibold text-foreground">Medians, not averages.</span> The
            distribution has a long right tail. Cancelled jobs are excluded, and jobs missing a measure
            or an install date sit out entirely.
          </p>
          <p>
            <span className="font-semibold text-foreground">Completed installs only.</span>
            {report.scheduledAhead > 0
              ? ` ${report.scheduledAhead} timeable ${report.scheduledAhead === 1 ? 'job is' : 'jobs are'} still scheduled ahead and sit out of every number here — a wait nobody has finished waiting isn't an observation.`
              : " A wait nobody has finished waiting isn't an observation, so forward-scheduled work is excluded."}
          </p>
        </div>
      </div>
    </div>
  );
}
