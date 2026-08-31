/**
 * Ops metrics — the shared engine behind the team dashboards (Install, Ordering,
 * Speed to Install).
 *
 * Ported from the Floor Daddy ops reports originally built in the GBTN portal,
 * where they run over a manually uploaded RFMS CSV export. Here the same rules
 * run over live Postgres rows, so ONE deliberate divergence applies:
 *
 *   asOf = TODAY (wall clock), not max(order_date).
 *
 * GBTN needs a snapshot date because its data is a point-in-time file — "last
 * 90 days" from the wall clock would silently return nothing on a stale export.
 * Our rows are live, so today is genuinely today.
 *
 * Everything else keeps the original semantics on purpose: CG-level (an order,
 * not a line) rollups, canceled excluded / held included, material-only receipt
 * logic, nearest-rank percentiles, and medians rather than means.
 */

// ── Material readiness vocabulary (RFMS line status ramp) ────────────────────
// Ordered worst → best. Mirrors rfms_order_status.line_statuses.
export const LINE_STATUSES = ['None', 'GenPO', 'OnOrder', 'Cut', 'Del', 'Resvd'];

export const STATUS_HELP = {
  None: 'No PO raised yet',
  GenPO: 'PO generated, not sent',
  OnOrder: 'On order with the supplier',
  Cut: 'Cut / allocated from stock',
  Del: 'Delivered — ready to install',
  Resvd: 'Reserved stock',
};

// Map the readiness ramp onto our semantic status tones.
export const STATUS_TONE = {
  None: 'crit',
  GenPO: 'warn',
  OnOrder: 'info',
  Cut: 'info',
  Del: 'good',
  Resvd: 'good',
};

// Pre-receipt statuses — the floor is down but the product was never received.
export const PRE_RECEIPT = ['None', 'GenPO', 'OnOrder'];
const PRE_RECEIPT_RANK = { None: 0, GenPO: 1, OnOrder: 2 };

/**
 * Every value `project.installation_date_status` can hold, lowercased. All of
 * them stop the job — the enum has no benign member. 'hold' is not in the base44
 * enum but the UI writes it, so it stays.
 */
export const HOLD_STATUSES = new Set([
  'on hold', 'hold', 'pending payment', 'pending contract', 'pending cancellation',
]);

/** Worst (earliest-stage) pre-receipt status present. Lowest rank wins. */
export function worstStatus(statuses = []) {
  const pre = statuses.filter((s) => s in PRE_RECEIPT_RANK);
  if (!pre.length) return null;
  return pre.reduce((a, b) => (PRE_RECEIPT_RANK[a] <= PRE_RECEIPT_RANK[b] ? a : b));
}

// ── Dates ────────────────────────────────────────────────────────────────────
// All date work is string surgery on 'YYYY-MM-DD' or local-midnight Date math,
// deliberately timezone-proof (the original reports were bitten by UTC drift).

/** Normalize any date-ish value to an ISO 'YYYY-MM-DD' day string, or null. */
export function isoDay(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today, in the shop's local time. This is our asOf. */
export function today() {
  return isoDay(new Date());
}

function toLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from ISO a → ISO b (b - a). Negative when b precedes a. */
export function dayDiff(a, b) {
  if (!a || !b) return null;
  return Math.round((toLocalDate(b) - toLocalDate(a)) / 86400000);
}

export function addDays(iso, n) {
  const d = toLocalDate(iso);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Earliest non-null ISO day in a list (lexicographic — safe for ISO). */
export function earliest(list = []) {
  const vals = list.map(isoDay).filter(Boolean).sort();
  return vals[0] ?? null;
}

// ── Statistics ───────────────────────────────────────────────────────────────
// Nearest-rank percentiles: value at index min(n-1, max(0, floor(q*n))).
// For even n the "median" is the UPPER of the two middle values — matching the
// original engine exactly, so numbers reconcile between the two systems.

export function percentile(sortedAsc, q) {
  const n = sortedAsc.length;
  if (!n) return null;
  const i = Math.min(n - 1, Math.max(0, Math.floor(q * n)));
  return sortedAsc[i];
}

/** {n, min, median, p90, max} over a numeric array, or null when empty. */
export function distribution(nums = []) {
  const s = nums.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  return {
    n: s.length,
    min: s[0],
    median: percentile(s, 0.5),
    p90: percentile(s, 0.9),
    max: s[s.length - 1],
  };
}

// ── Buckets (day / week / month) ─────────────────────────────────────────────
// Weeks start Sunday, matching the calendar view in the original reports.

export function bucketKey(iso, grain) {
  const day = isoDay(iso);
  if (!day) return null;
  if (grain === 'month') return day.slice(0, 7) + '-01';
  if (grain === 'week') {
    const d = toLocalDate(day);
    d.setDate(d.getDate() - d.getDay()); // back to Sunday
    return isoDay(d);
  }
  return day;
}

/** Last day covered by a bucket — decides complete vs partial vs ahead. */
export function periodEnd(key, grain) {
  if (grain === 'month') {
    const [y, m] = key.split('-').map(Number);
    return isoDay(new Date(y, m, 0));
  }
  if (grain === 'week') return addDays(key, 6);
  return key;
}

/** complete = fully in the past · partial = contains today · ahead = future. */
export function periodKind(key, grain, asOf) {
  const end = periodEnd(key, grain);
  if (end <= asOf) return 'complete';
  if (key <= asOf) return 'partial';
  return 'ahead';
}

export function bucketLabel(key, grain) {
  const d = toLocalDate(key);
  if (grain === 'month') return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  if (grain === 'week') return `wk ${d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`;
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

// ── Formatting ───────────────────────────────────────────────────────────────
export const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
export const shortMoney = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return '$' + Math.round(v / 1000) + 'K';
  return money(v);
};
export const fmtDate = (iso) => {
  const day = isoDay(iso);
  if (!day) return '—';
  return toLocalDate(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Material readiness ───────────────────────────────────────────────────────
/**
 * Roll rfms_order_status rows into a lookup keyed by document/invoice number.
 * line_statuses is a jsonb blob; tolerate an array of statuses, an array of
 * {status} objects, or a {status: count} map. Empty until RFMS is connected —
 * every caller must degrade gracefully.
 */
export function materialIndex(statusRows = []) {
  const idx = {};
  for (const row of statusRows) {
    const key = String(row.document_number ?? '').trim();
    if (!key) continue;
    const counts = {};
    const raw = row.line_statuses;
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const s = typeof entry === 'string' ? entry : entry?.status ?? entry?.line_status;
        if (s) counts[s] = (counts[s] || 0) + 1;
      }
    } else if (raw && typeof raw === 'object') {
      for (const [s, c] of Object.entries(raw)) {
        const n = Number(c);
        if (Number.isFinite(n)) counts[s] = (counts[s] || 0) + n;
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const delivered = (counts.Del || 0) + (counts.Resvd || 0) + (counts.Cut || 0);
    idx[key] = {
      counts,
      total,
      delivered,
      readiness: total ? delivered / total : null,
      hasOnOrder: !!row.has_on_order,
      noPO: counts.None || 0,
      preReceipt: PRE_RECEIPT.reduce((a, s) => a + (counts[s] || 0), 0),
      worst: worstStatus(Object.keys(counts)),
      checkedAt: row.checked_at || null,
    };
  }
  return idx;
}

/** Readiness verdict for one order: 'yes' | 'partial' | 'no' | null (unknown). */
export function readinessLabel(entry) {
  if (!entry || !entry.total) return null;
  if (entry.readiness >= 1) return 'yes';
  if (entry.readiness > 0) return 'partial';
  return 'no';
}

// ── Install board ────────────────────────────────────────────────────────────
/**
 * One row per project — the install team's board. Canceled projects are
 * excluded; holds are kept (a held job whose date has passed is exactly what
 * ops needs to see).
 */
export function buildInstallBoard({ projects = [], sales = [], customers = [], material = {}, asOf = today() }) {
  const saleById = Object.fromEntries(sales.map((s) => [s.id, s]));
  const custById = Object.fromEntries(customers.map((c) => [c.id, c]));

  const rows = projects
    .filter((p) => !p.cancelled_date && p.status !== 'Cancelled')
    .map((p) => {
      const sale = p.sale ? saleById[p.sale] : null;
      const cust = p.customer ? custById[p.customer] : null;
      const install = isoDay(p.installation_date) || isoDay(p.scheduled_start_date);
      const done = isoDay(p.actual_completion_date);
      const invoice = sale?.invoice_number ? String(sale.invoice_number).trim() : null;
      const mat = invoice ? material[invoice] : null;
      const daysOut = install ? dayDiff(asOf, install) : null;
      return {
        id: p.id,
        // Explicit ids so a row can be opened by the shared resolver. `id`
        // alone is ambiguous across builders — here it is a project, on the
        // ordering queue below it is a sale.
        projectId: p.id,
        saleId: p.sale || null,
        invoice,
        customerName: cust ? `${cust.first_name || ''} ${cust.last_name || ''}`.trim() : '—',
        city: cust?.city || '',
        address: p.location_address || sale?.location_address || cust?.address_line1 || '',
        stage: p.status || '—',
        crew: p.installer_crew_name || p.rfms_crew_name || null,
        install,
        completed: done,
        daysOut,
        // Case-insensitive on purpose: submitCheckpoint's asbestos hard-stop
        // writes 'on hold' while the UI writes 'Hold'. An exact match silently
        // missed every asbestos halt on this board. Every value in the
        // installation_date_status enum stops the job — 'pending payment' is
        // the deposit gate, 'pending contract' means no signed paper.
        onHold: !!p.pending_cancellation_date || HOLD_STATUSES.has(
          String(p.installation_date_status || '').trim().toLowerCase(),
        ),
        amount: Number(sale?.sale_amount) || 0,
        material: mat || null,
        readiness: readinessLabel(mat),
      };
    });

  const future = rows.filter((r) => r.install && r.install > asOf && !r.completed);
  const soon = future.filter((r) => r.install <= addDays(asOf, 14));
  const unscheduled = rows.filter((r) => !r.install && !r.completed);
  // Past its install date but never marked complete — the board's exception set.
  const overdue = rows.filter((r) => r.install && r.install < asOf && !r.completed);
  // Installing TODAY. The original report ran off a snapshot, where asOf was the
  // export date and this set was noise; on a live board it is the crew's day.
  const todayJobs = rows.filter((r) => r.install === asOf && !r.completed);
  const noPO = future.filter((r) => r.material && r.material.noPO > 0);

  const crews = {};
  for (const r of future) {
    const key = r.crew || 'Unassigned';
    crews[key] = crews[key] || { crew: key, jobs: 0, value: 0 };
    crews[key].jobs += 1;
    crews[key].value += r.amount;
  }

  return {
    asOf,
    rows,
    future,
    soon,
    overdue,
    todayJobs,
    unscheduled,
    noPO,
    onHold: rows.filter((r) => r.onHold && !r.completed),
    crewLoad: Object.values(crews).sort((a, b) => b.jobs - a.jobs),
    upcomingValue: future.reduce((a, r) => a + r.amount, 0),
    // True once RFMS has ever reported a line status for anything on the board.
    materialKnown: rows.some((r) => r.material && r.material.total > 0),
  };
}

// ── Orders pipeline ──────────────────────────────────────────────────────────
/**
 * Two clocks, one chart: every job is counted once when it is ORDERED (sale
 * date) and again when it is INSTALLING (install date), typically weeks apart.
 * Demand in vs capacity out.
 */
export function buildOrdersPipeline({ sales = [], projects = [], grain = 'week', asOf = today(), weeks = 16 }) {
  const projBySale = {};
  for (const p of projects) if (p.sale) projBySale[p.sale] = p;

  const buckets = {};
  const touch = (key) => {
    if (!key) return null;
    buckets[key] = buckets[key] || {
      key, grain,
      ordered: 0, orderedValue: 0,
      installing: 0, installingValue: 0,
    };
    return buckets[key];
  };

  for (const s of sales) {
    if (s.is_cancelled) continue;
    const amount = Number(s.sale_amount) || 0;

    const ob = touch(bucketKey(s.sale_date, grain));
    if (ob) { ob.ordered += 1; ob.orderedValue += amount; }

    const p = projBySale[s.id];
    const installDay = p ? (isoDay(p.installation_date) || isoDay(p.scheduled_start_date)) : null;
    const ib = touch(bucketKey(installDay, grain));
    if (ib) { ib.installing += 1; ib.installingValue += amount; }
  }

  const all = Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
  const series = all
    .map((b) => ({ ...b, kind: periodKind(b.key, grain, asOf), label: bucketLabel(b.key, grain) }))
    .slice(-weeks);

  // Averages use COMPLETE periods only — a partial period would drag them down.
  const complete = series.filter((b) => b.kind === 'complete');
  const avg = (sel) => (complete.length ? complete.reduce((a, b) => a + sel(b), 0) / complete.length : 0);
  const ahead = series.filter((b) => b.kind === 'ahead');
  const peak = series.reduce((best, b) => (!best || b.installing > best.installing ? b : best), null);

  return {
    asOf, grain, series,
    avgOrdered: avg((b) => b.ordered),
    avgInstalling: avg((b) => b.installing),
    peak,
    scheduledAhead: ahead.reduce((a, b) => a + b.installing, 0),
    scheduledAheadValue: ahead.reduce((a, b) => a + b.installingValue, 0),
    totalOrdered: series.reduce((a, b) => a + b.ordered, 0),
    totalOrderedValue: series.reduce((a, b) => a + b.orderedValue, 0),
  };
}

/** Sold jobs that never got an RFMS invoice number — the ordering desk's queue. */
export function buildOrderingQueue({ sales = [], customers = [], projects = [], asOf = today() }) {
  const custById = Object.fromEntries(customers.map((c) => [c.id, c]));
  const projBySale = {};
  for (const p of projects) if (p.sale) projBySale[p.sale] = p;

  return sales
    .filter((s) => !s.is_cancelled && !s.invoice_number)
    .map((s) => {
      const cust = s.customer ? custById[s.customer] : null;
      const sold = isoDay(s.sale_date);
      return {
        id: s.id,
        // Here `id` is a sale, not a project — the project may not exist yet.
        saleId: s.id,
        projectId: projBySale[s.id]?.id || null,
        customerName: cust ? `${cust.first_name || ''} ${cust.last_name || ''}`.trim() : '—',
        soldOn: sold,
        ageDays: sold ? dayDiff(sold, asOf) : null,
        amount: Number(s.sale_amount) || 0,
        address: s.location_address || '',
        installDate: projBySale[s.id] ? isoDay(projBySale[s.id].installation_date) : null,
      };
    })
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
}

// ── Speed to install (cycle time) ────────────────────────────────────────────
/**
 * How long a customer waits from their measure appointment to the crew showing
 * up. Measured per JOB (a customer experiences one job, not twenty lines) over
 * COMPLETED installs only — forward-scheduled work belongs on the install board.
 */
export const OUTLIER_DAYS = 90;
const BANDS = [0, 7, 14, 21, 28, 35, 42, 60, 90];

export function buildCycleReport({ appointments = [], sales = [], projects = [], customers = [], asOf = today() }) {
  const apptById = Object.fromEntries(appointments.map((a) => [a.id, a]));
  const custById = Object.fromEntries(customers.map((c) => [c.id, c]));
  const saleById = Object.fromEntries(sales.map((s) => [s.id, s]));

  const jobs = [];
  const measureToOrder = [];
  let scheduledAhead = 0;

  for (const p of projects) {
    if (p.cancelled_date || p.status === 'Cancelled') continue;
    const sale = p.sale ? saleById[p.sale] : null;
    if (!sale || sale.is_cancelled) continue;

    const appt = sale.appointment ? apptById[sale.appointment] : null;
    const measure = isoDay(appt?.appointment_date) || isoDay(sale.appointment_date);
    const order = isoDay(sale.sale_date);
    // Prefer the date the crew actually finished; fall back to the scheduled day.
    const install = isoDay(p.actual_completion_date) || isoDay(p.installation_date) || isoDay(p.scheduled_start_date);

    if (measure && order) {
      const gap = dayDiff(measure, order);
      if (gap != null && gap >= 0) measureToOrder.push(gap);
    }
    if (!measure || !install) continue;
    if (install > asOf) { scheduledAhead += 1; continue; } // not finished yet

    const days = dayDiff(measure, install);
    if (days == null || days < 0) continue;

    const cust = p.customer ? custById[p.customer] : null;
    jobs.push({
      id: p.id,
      projectId: p.id,
      saleId: sale.id,
      invoice: sale.invoice_number || null,
      customerName: cust ? `${cust.first_name || ''} ${cust.last_name || ''}`.trim() : '—',
      rep: sale.assigned_dc || null,
      measure, order, install, days,
      amount: Number(sale.sale_amount) || 0,
    });
  }

  jobs.sort((a, b) => b.days - a.days);
  const measureToInstall = distribution(jobs.map((j) => j.days));
  const m2o = distribution(measureToOrder);
  const sameDaySellPct = measureToOrder.length
    ? (100 * measureToOrder.filter((g) => g === 0).length) / measureToOrder.length
    : 0;

  const histogram = BANDS.map((lo, i) => {
    const hi = BANDS[i + 1] ?? Infinity;
    const label = hi === Infinity ? `${lo}+` : `${lo}–${hi - 1}`;
    return { lo, hi, label, count: jobs.filter((j) => j.days >= lo && j.days < hi).length };
  });

  const byMonthMap = {};
  for (const j of jobs) {
    const key = j.install.slice(0, 7);
    byMonthMap[key] = byMonthMap[key] || { month: key, days: [], jobs: 0 };
    byMonthMap[key].days.push(j.days);
    byMonthMap[key].jobs += 1;
  }
  const byMonth = Object.values(byMonthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      month: m.month,
      label: bucketLabel(m.month + '-01', 'month'),
      jobs: m.jobs,
      median: distribution(m.days)?.median ?? null,
    }));

  const byRepMap = {};
  for (const j of jobs) {
    const key = j.rep || 'Unassigned';
    byRepMap[key] = byRepMap[key] || { rep: key, days: [], jobs: 0 };
    byRepMap[key].days.push(j.days);
    byRepMap[key].jobs += 1;
  }
  const byRep = Object.values(byRepMap)
    .map((r) => {
      const d = distribution(r.days);
      return { rep: r.rep, jobs: r.jobs, median: d?.median ?? null, p90: d?.p90 ?? null, max: d?.max ?? null };
    })
    .sort((a, b) => (b.median ?? 0) - (a.median ?? 0));

  return {
    asOf,
    jobs,
    measureToInstall,
    measureToOrder: m2o,
    sameDaySellPct,
    scheduledAhead,
    histogram,
    byMonth,
    byRep,
    outliers: jobs.filter((j) => j.days > OUTLIER_DAYS),
  };
}

// ── Status hygiene ───────────────────────────────────────────────────────────
/**
 * Material installed but never marked received: the floor is down, yet the line
 * still sits pre-receipt. Material only — labor is never purchased, so a labor
 * line at None forever is correct, not stale. Requires RFMS line statuses.
 */
export const HYGIENE_BANDS = [
  { label: '1–7 days', lo: 1, hi: 8 },
  { label: '8–30 days', lo: 8, hi: 31 },
  { label: '31–60 days', lo: 31, hi: 61 },
  { label: '61–90 days', lo: 61, hi: 91 },
  { label: '90+ days', lo: 91, hi: Infinity },
];

export function buildHygiene({ board, asOf = today() }) {
  const stale = (board?.rows || [])
    .filter((r) => r.material && r.material.preReceipt > 0 && r.install && r.install < asOf)
    .map((r) => ({
      ...r,
      daysSince: dayDiff(r.install, asOf),
      staleLines: r.material.preReceipt,
      worst: r.material.worst,
    }))
    .sort((a, b) => b.daysSince - a.daysSince);

  const age = distribution(stale.map((s) => s.daysSince));
  return {
    asOf,
    stale,
    staleLines: stale.reduce((a, s) => a + s.staleLines, 0),
    staleValue: stale.reduce((a, s) => a + s.amount, 0),
    age,
    bands: HYGIENE_BANDS.map((b) => ({
      ...b,
      count: stale.filter((s) => s.daysSince >= b.lo && s.daysSince < b.hi).length,
    })),
  };
}
