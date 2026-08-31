/* FROZEN FIXTURE - flow.js exactly as it sat on main at the ops-flow cutover.
 * Exists ONLY for scripts/ops-flow-parity.mjs, which proves the SQL classifier
 * gives every live job the same stage this file did. Never import from app code.
 */
/**
 * Job flow — the stage + handoff engine.
 *
 * The point of this file: a job's REAL stage is derived from what the data says
 * happened, not from a status label somebody remembered to change. A project can
 * sit at "Materials Ordered" for three weeks after the material actually landed;
 * the label lies, the dates don't.
 *
 * For every live job we answer four questions:
 *   1. What stage is it genuinely in?
 *   2. Which department owns it RIGHT NOW?
 *   3. What is blocking it from advancing?
 *   4. How long has it been sitting, and is that too long?
 *
 * Answering (2) for every job is what turns a pile of dashboards into a set of
 * inboxes — each department can be shown exactly what is waiting on them, and
 * exactly what they are holding up for someone else. That is the handoff.
 */

import { isoDay, today, dayDiff, distribution, money } from '../../src/lib/ops/metrics.js';

// ── Departments ──────────────────────────────────────────────────────────────
export const DEPARTMENTS = {
  sales: 'Sales',
  ordering: 'Ordering',
  scheduling: 'Scheduling',
  install: 'Install',
  cx: 'Customer Experience',
  finance: 'Finance',
};

/**
 * The lifecycle, in order. `sla` is the number of days a job should sit in the
 * stage before it is chasing someone — deliberately conservative defaults; these
 * are the numbers to tune once the team argues about them, which is the point.
 */
export const STAGES = [
  { key: 'to_order',          label: 'To Order',            owner: 'ordering',   sla: 2,    blurb: 'Sold — needs placing in RFMS' },
  { key: 'awaiting_material', label: 'Awaiting Material',   owner: 'ordering',   sla: 14,   blurb: 'Ordered — material not received' },
  { key: 'ready_to_schedule', label: 'Ready to Schedule',   owner: 'scheduling', sla: 3,    blurb: 'Material ready — no install date' },
  { key: 'scheduled',         label: 'Scheduled',           owner: 'install',    sla: null, blurb: 'On the calendar' },
  { key: 'in_progress',       label: 'In Progress',         owner: 'install',    sla: 2,    blurb: 'Crew on site' },
  { key: 'qa',                label: 'QA / Walkthrough',    owner: 'install',    sla: 3,    blurb: 'Installed — needs sign-off' },
  { key: 'cx_followup',       label: 'Customer Follow-up',  owner: 'cx',         sla: 2,    blurb: 'Complete — needs the follow-up call' },
  { key: 'complete',          label: 'Complete',            owner: null,         sla: null, blurb: 'Closed out' },
];

export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]));
export const stageIndex = (key) => STAGES.findIndex((s) => s.key === key);

// Stage → StatusPill tone.
export const STAGE_TONE = {
  to_order: 'warn',
  awaiting_material: 'info',
  ready_to_schedule: 'warn',
  scheduled: 'info',
  in_progress: 'info',
  qa: 'warn',
  cx_followup: 'info',
  complete: 'good',
};

// ── Blockers ─────────────────────────────────────────────────────────────────
// A blocker names the thing standing between this job and its next stage, and
// crucially WHO can clear it. That owner is what makes a handoff visible.
function blocker(code, severity, label, detail, owner) {
  return { code, severity, label, detail, owner };
}

/**
 * Decide a single job's stage, owner, blockers and next action.
 *
 * `material` is the entry from metrics.materialIndex() for this job's invoice,
 * or null when RFMS has never reported on it. Null means UNKNOWN, not "ready" —
 * we must not silently advance a job past a material gate we cannot see, so the
 * material gate only ever *holds* a job when we have real data saying it should.
 */
export function classifyJob({ sale, project, appointment, customer, material, balance, asOf = today() }) {
  const blockers = [];

  const soldOn = isoDay(sale?.sale_date);
  const invoice = sale?.invoice_number ? String(sale.invoice_number).trim() : null;
  const installDate = project ? isoDay(project.installation_date) || isoDay(project.scheduled_start_date) : null;
  const startedOn = project ? isoDay(project.actual_start_date) : null;
  const completedOn = project ? isoDay(project.actual_completion_date) : null;
  const qaStarted = project ? isoDay(project.qa_in_progress_date) : null;
  const qaDone = project ? isoDay(project.qa_completed_date) : null;
  const status = project?.status || null;

  // Follow-up is "done" if any of the customer-experience touches landed.
  const cxDone = !!(project && (project.check_in_completed_date || project.welcome_call_completed_date));

  // ── Cross-cutting blockers — these travel with the job into ANY stage, which
  // is exactly how a Finance hold becomes visible on the install board.
  //
  // installation_date_status is written by different code paths in different
  // cases: submitCheckpoint's asbestos hard-stop writes 'on hold' (lower), the
  // UI writes 'Hold'. Compare case-insensitively — an exact match missed the
  // asbestos halt entirely, which is the one hold that must never be missed.
  //
  // All FOUR values in the enum stop a job, not just the two that say "hold":
  // 'pending payment' is the deposit gate ordering waits on, and 'pending
  // contract' means we have no signed paper. Treating them as healthy put jobs
  // on the install board that nobody was allowed to touch.
  const HOLD_REASONS = {
    'on hold':            ['Job is flagged on hold — safety or credit stop not cleared', 'sales'],
    'hold':               ['Job is flagged on hold — safety or credit stop not cleared', 'sales'],
    'pending payment':    ['Deposit not collected — ordering cannot begin', 'finance'],
    'pending contract':   ['No signed contract on file', 'sales'],
    'pending cancellation': ['Customer has asked to cancel — not resolved', 'sales'],
  };
  const holdFlag = String(project?.installation_date_status || '').trim().toLowerCase();
  const statusHold = HOLD_REASONS[holdFlag] || null;
  const cancelHold = !!(project?.pending_cancellation_date && !project?.hold_cleared_date);
  const onHold = !!statusHold || cancelHold;
  if (onHold) {
    const [detail, owner] = statusHold || ['Pending cancellation — not cleared', 'sales'];
    blockers.push(blocker('hold', 'crit', 'On hold', detail, owner));
  }
  // An unpriced sale is a blank field on a Design Consultant's form, not a
  // Finance problem — route it to the people who can actually fill it in.
  if (!sale?.sale_amount || Number(sale.sale_amount) <= 0) {
    blockers.push(blocker('sale_unpriced', 'crit', 'Sale has no amount',
      'No sale amount recorded — nothing can be gated or ordered against this', 'sales'));
  }

  // ── Stage resolution, latest-first: the furthest thing that has demonstrably
  // happened wins, so a stale status label can never drag a job backwards.
  let stage;
  let since;

  if (completedOn || status === 'Completed') {
    if (cxDone) {
      stage = 'complete';
      since = isoDay(project?.check_in_completed_date) || completedOn;
    } else {
      stage = 'cx_followup';
      since = completedOn || isoDay(project?.updated_date);
      blockers.push(blocker('cx_call', 'info', 'Follow-up call outstanding', 'Job finished — customer has not been called back', 'cx'));
    }
  } else if (qaStarted || status === 'Quality Checks') {
    stage = 'qa';
    since = qaStarted || isoDay(project?.updated_date);
    if (!qaDone) {
      blockers.push(blocker('qa', 'warn', 'Awaiting QA sign-off', 'Walkthrough not signed off', 'install'));
    }
  } else if (startedOn || status === 'In Progress' || (installDate && installDate <= asOf)) {
    stage = 'in_progress';
    since = startedOn || installDate;
    // Install date has passed with nothing recorded — the single most common
    // way a job silently stalls.
    if (installDate && installDate < asOf && !completedOn) {
      blockers.push(
        blocker('not_closed', 'crit', 'Install date passed', `Scheduled ${installDate}, no completion recorded`, 'install')
      );
    }
  } else if (installDate) {
    stage = 'scheduled';
    since = isoDay(project?.updated_date) || soldOn;
    if (!project?.installer_crew_name && !project?.installer_crew_id) {
      blockers.push(blocker('no_crew', 'warn', 'No crew assigned', `Installing ${installDate} with nobody on it`, 'scheduling'));
    }
    // Material we KNOW is short, with a date already committed.
    if (material && material.total > 0 && material.preReceipt > 0) {
      blockers.push(
        blocker('material_short', 'crit', 'Material not received',
          `${material.preReceipt} line(s) pre-receipt for a job installing ${installDate}`, 'ordering')
      );
    }
  } else if (!invoice) {
    stage = 'to_order';
    since = soldOn;

    // GATE 1 — ordering. Material may not be ordered until Accounting has
    // confirmed the deposit CLEARED, which is the owner's rule that ordering
    // begins once the deposit is actually deposited.
    //
    // Read strictly from the view: `=== false` and never a JS amount comparison,
    // so a missing balance row (not yet loaded) reads as unknown rather than as
    // unpaid, and there is exactly one definition of "satisfied" in the system.
    //
    // Deliberately 'warn', not 'crit': a crit reassigns ownership of the job, and
    // Finance has no board of its own in the flow UI yet. Promote once it does.
    if (balance?.deposit_satisfied === false) {
      const short = Math.max(0, Number(balance.deposit_required || 0) - Number(balance.amount_cleared || 0));
      blockers.push(blocker(
        'deposit_unconfirmed', 'warn', 'Deposit not cleared',
        Number(balance.amount_paid || 0) === 0
          ? 'Nothing collected against this sale yet — ordering is held'
          : `${money(short)} of the deposit has not cleared the bank yet — ordering is held`,
        'finance',
      ));
    } else {
      blockers.push(blocker('not_ordered', 'warn', 'Not in RFMS', 'Sold, but no order has been placed', 'ordering'));
    }
  } else if (material && material.total > 0 && material.preReceipt > 0) {
    stage = 'awaiting_material';
    since = isoDay(sale?.rfms_sync_date) || soldOn;
    blockers.push(
      blocker('material_pending', 'info', 'Material on order',
        `${material.preReceipt} of ${material.total} line(s) not received`, 'ordering')
    );
  } else {
    // Ordered, nothing says material is outstanding, but no date is committed.
    stage = 'ready_to_schedule';
    since = isoDay(sale?.rfms_sync_date) || soldOn;
    blockers.push(blocker('unscheduled', 'warn', 'Not scheduled', 'Ready to go — needs an install date', 'scheduling'));
  }

  const def = STAGE_BY_KEY[stage];
  const ageDays = since ? dayDiff(since, asOf) : null;
  const overSla = def.sla != null && ageDays != null && ageDays > def.sla;

  // The owner is normally the stage's owner — but a critical blocker owned by
  // someone else reassigns it, because that is who has to move first.
  const critical = blockers.find((b) => b.severity === 'crit');
  const owner = critical?.owner || def.owner;

  // Sort by severity, not insertion order. Cross-cutting blockers are pushed
  // first, so taking blockers[0] hid "Install date passed" behind a deposit
  // warning on exactly the jobs most in trouble.
  const SEV_RANK = { crit: 0, warn: 1, info: 2 };
  const ranked = [...blockers].sort(
    (a, b) => (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3),
  );

  const nextAction =
    ranked.length > 0
      ? ranked[0].label
      : def.owner
        ? def.blurb
        : 'Nothing outstanding';

  return {
    id: project?.id || sale?.id,
    projectId: project?.id || null,
    saleId: sale?.id || null,
    invoice,
    customerName: customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() : '—',
    address: project?.location_address || sale?.location_address || '',
    amount: Number(sale?.sale_amount) || 0,
    rep: sale?.assigned_dc || null,
    crew: project?.installer_crew_name || null,
    soldOn,
    installDate,
    completedOn,
    stage,
    stageLabel: def.label,
    owner,
    ownerLabel: owner ? DEPARTMENTS[owner] : null,
    since,
    ageDays,
    sla: def.sla,
    overSla,
    blockers: ranked, // severity-ordered, so any UI taking the first is right
    nextAction,
    onHold,
    materialKnown: !!(material && material.total > 0),
  };
}

/**
 * Build the whole flow: every live job classified, then rolled up by stage and
 * by owning department.
 */
export function buildJobFlow({
  sales = [],
  projects = [],
  appointments = [],
  customers = [],
  material = {},
  // sale_balance rows keyed by sale id. The view owns deposit_satisfied and
  // fully_collected; both are non-null there by construction, so a missing entry
  // means UNKNOWN (not yet loaded) and must never be read as "unpaid".
  balances = {},
  asOf = today(),
}) {
  const custById = Object.fromEntries(customers.map((c) => [c.id, c]));
  const apptById = Object.fromEntries(appointments.map((a) => [a.id, a]));
  const projBySale = {};
  for (const p of projects) {
    if (p.sale && !p.cancelled_date && p.status !== 'Cancelled') projBySale[p.sale] = p;
  }

  const jobs = sales
    .filter((s) => !s.is_cancelled)
    .map((sale) => {
      const project = projBySale[sale.id] || null;
      const invoice = sale.invoice_number ? String(sale.invoice_number).trim() : null;
      return classifyJob({
        sale,
        project,
        appointment: sale.appointment ? apptById[sale.appointment] : null,
        customer: sale.customer ? custById[sale.customer] : null,
        material: invoice ? material[invoice] || null : null,
        balance: balances[sale.id] || null,
        asOf,
      });
    });

  const active = jobs.filter((j) => j.stage !== 'complete');

  const byStage = STAGES.map((s) => {
    const rows = jobs.filter((j) => j.stage === s.key);
    return {
      ...s,
      rows,
      count: rows.length,
      value: rows.reduce((a, j) => a + j.amount, 0),
      overSla: rows.filter((j) => j.overSla).length,
    };
  });

  // Per-department inbox: what is waiting on you, worst first.
  const byOwner = {};
  for (const key of Object.keys(DEPARTMENTS)) byOwner[key] = [];
  for (const j of active) {
    if (j.owner && byOwner[j.owner]) byOwner[j.owner].push(j);
  }
  for (const key of Object.keys(byOwner)) {
    byOwner[key].sort(
      (a, b) => Number(b.overSla) - Number(a.overSla) || (b.ageDays ?? 0) - (a.ageDays ?? 0)
    );
  }

  // Every blocker, flattened — the cross-department view. This is the list that
  // says "Ordering is holding up three of Install's jobs".
  const blockers = [];
  for (const j of active) {
    for (const b of j.blockers) blockers.push({ ...b, job: j });
  }

  const ages = active.map((j) => j.ageDays).filter((n) => Number.isFinite(n));

  return {
    asOf,
    jobs,
    active,
    byStage,
    byOwner,
    blockers,
    atRisk: active.filter((j) => j.overSla),
    critical: active.filter((j) => j.blockers.some((b) => b.severity === 'crit')),
    onHold: active.filter((j) => j.onHold),
    activeValue: active.reduce((a, j) => a + j.amount, 0),
    ageStats: distribution(ages),
    materialKnown: jobs.some((j) => j.materialKnown),
  };
}

/**
 * Handoffs: for a given department, what is landing on them versus what they
 * are holding up for somebody else. The second list is the one that changes
 * behaviour — it is hard to argue with "you are blocking four install dates".
 */
export function departmentView(flow, dept) {
  const waitingOnUs = flow.byOwner[dept] || [];
  const weAreBlocking = flow.blockers.filter((b) => b.owner === dept && b.job.owner !== dept);
  const blockedByOthers = flow.active.filter(
    (j) => j.owner !== dept && j.blockers.some((b) => b.owner === dept)
  );
  return {
    dept,
    label: DEPARTMENTS[dept],
    waitingOnUs,
    overSla: waitingOnUs.filter((j) => j.overSla),
    weAreBlocking,
    blockedByOthers,
    value: waitingOnUs.reduce((a, j) => a + j.amount, 0),
  };
}
