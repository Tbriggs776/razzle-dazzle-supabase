/**
 * Job flow — the stage + handoff engine, now reading the PUBLISHED graph.
 *
 * What changed at the ops-flow cutover (0118/0119): this file no longer decides
 * what stage a job is in. The `job_stage` SQL view is the ONLY classifier — its
 * CASE is the one copy of the predicates in the system. What this file still
 * does, unchanged:
 *
 *   - blockers: the cross-cutting holds (safety/credit/deposit) and the
 *     per-stage annotations (install date passed, no crew, material short…),
 *     with who can clear each one — the handoff;
 *   - crit-blocker owner reassignment (a Finance hold surfaces on any board);
 *   - stage age + over-SLA, from the same `since` bookkeeping as before.
 *
 * Stage IDENTITY (label, owner, SLA, tone, order) comes from the published
 * ops_stage rows, so an org admin can change an SLA and every board follows
 * without a deploy. There is deliberately NO fallback stage table here: if the
 * view or the published graph is not loaded, buildJobFlow returns null and the
 * page shows an error — it never silently classifies with stale constants.
 */

import { isoDay, today, dayDiff, distribution, money } from './metrics';

// ── Published graph ──────────────────────────────────────────────────────────

/**
 * Shape the published rows (ops_stage / ops_department) for the engine.
 * Returns null unless both are actually loaded — callers must treat null as
 * "cannot classify", not as empty.
 */
export function graphFromRows(stageRows, deptRows) {
  if (!Array.isArray(stageRows) || stageRows.length === 0) return null;
  if (!Array.isArray(deptRows) || deptRows.length === 0) return null;
  const stages = [...stageRows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const departments = {};
  for (const d of [...deptRows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    departments[d.key] = d.label;
  }
  return {
    stages,
    // Board lookups go by classifier_key — that is what the view emits.
    byClassifier: Object.fromEntries(
      stages.filter((s) => s.classifier_key).map((s) => [s.classifier_key, s])),
    byKey: Object.fromEntries(stages.map((s) => [s.key, s])),
    departments,
  };
}

// ── Blockers ─────────────────────────────────────────────────────────────────
// A blocker names the thing standing between this job and its next stage, and
// crucially WHO can clear it. That owner is what makes a handoff visible.
function blocker(code, severity, label, detail, owner) {
  return { code, severity, label, detail, owner };
}

/**
 * Annotate a single job. `stageKey` MUST be the job_stage view's verdict for
 * this (sale, project) pair — this function trusts it completely and only adds
 * identity, age and blockers around it. `material` semantics unchanged: null
 * means UNKNOWN, not "ready".
 */
export function classifyJob({
  sale, project, appointment, customer, material, balance, stageKey, graph, asOf = today(),
}) {
  const def = graph?.byClassifier?.[stageKey];
  if (!def) {
    // The view said a stage the published graph does not carry (or the caller
    // never had the graph). Surfaced, never guessed at.
    return {
      id: project?.id || sale?.id, projectId: project?.id || null, saleId: sale?.id || null,
      stage: stageKey || null, unclassified: true,
    };
  }

  const blockers = [];

  const soldOn = isoDay(sale?.sale_date);
  const invoice = sale?.invoice_number ? String(sale.invoice_number).trim() : null;
  const installDate = project ? isoDay(project.installation_date) || isoDay(project.scheduled_start_date) : null;
  const startedOn = project ? isoDay(project.actual_start_date) : null;
  const completedOn = project ? isoDay(project.actual_completion_date) : null;
  const qaStarted = project ? isoDay(project.qa_in_progress_date) : null;
  const qaDone = project ? isoDay(project.qa_completed_date) : null;

  // ── Cross-cutting blockers — these travel with the job into ANY stage, which
  // is exactly how a Finance hold becomes visible on the install board.
  //
  // installation_date_status is written by different code paths in different
  // cases: submitCheckpoint's asbestos hard-stop writes 'on hold' (lower), the
  // UI writes 'Hold'. Compare case-insensitively — an exact match missed the
  // asbestos halt entirely, which is the one hold that must never be missed.
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

  // ── Per-stage bookkeeping: `since` and the stage's own blockers. These are
  // annotations on the view's verdict, copied from the pre-cutover branches so
  // ages and over-SLA booleans did not move at the cutover. The DECISION lives
  // in SQL; only the paperwork lives here.
  let since;
  switch (stageKey) {
    case 'complete':
      since = isoDay(project?.check_in_completed_date) || completedOn;
      break;
    case 'cx_followup':
      since = completedOn || isoDay(project?.updated_date);
      blockers.push(blocker('cx_call', 'info', 'Follow-up call outstanding', 'Job finished — customer has not been called back', 'cx'));
      break;
    case 'qa':
      since = qaStarted || isoDay(project?.updated_date);
      if (!qaDone) {
        blockers.push(blocker('qa', 'warn', 'Awaiting QA sign-off', 'Walkthrough not signed off', 'install'));
      }
      break;
    case 'in_progress':
      since = startedOn || installDate;
      // Install date has passed with nothing recorded — the single most common
      // way a job silently stalls.
      if (installDate && installDate < asOf && !completedOn) {
        blockers.push(
          blocker('not_closed', 'crit', 'Install date passed', `Scheduled ${installDate}, no completion recorded`, 'install')
        );
      }
      break;
    case 'scheduled':
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
      break;
    case 'to_order':
      since = soldOn;
      // GATE 1 — ordering. Material may not be ordered until Accounting has
      // confirmed the deposit CLEARED. Read strictly from the view: `=== false`
      // and never a JS amount comparison, so a missing balance row reads as
      // unknown rather than as unpaid.
      //
      // Deliberately 'warn', not 'crit': a crit reassigns ownership of the job,
      // and Finance has no board of its own in the flow UI yet.
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
      break;
    case 'awaiting_material':
      since = isoDay(sale?.rfms_sync_date) || soldOn;
      blockers.push(
        blocker('material_pending', 'info', 'Material on order',
          `${material?.preReceipt ?? '?'} of ${material?.total ?? '?'} line(s) not received`, 'ordering')
      );
      break;
    case 'ready_to_schedule':
    default:
      since = isoDay(sale?.rfms_sync_date) || soldOn;
      blockers.push(blocker('unscheduled', 'warn', 'Not scheduled', 'Ready to go — needs an install date', 'scheduling'));
      break;
  }

  const ageDays = since ? dayDiff(since, asOf) : null;
  // Published SLAs are CLOCK hours; ages are whole days. hours/24 keeps the
  // pre-cutover boolean exactly for day-multiple SLAs and behaves sanely for
  // any hour value an admin publishes later.
  const slaDays = def.sla_hours == null ? null : def.sla_hours / 24;
  const overSla = slaDays != null && ageDays != null && ageDays > slaDays;

  // The owner is normally the stage's owner — but a critical blocker owned by
  // someone else reassigns it, because that is who has to move first.
  const critical = blockers.find((b) => b.severity === 'crit');
  const owner = critical?.owner || def.owner_dept;

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
      : def.owner_dept
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
    stage: stageKey,
    stageLabel: def.label,
    stageBlurb: def.blurb,
    stageOwner: def.owner_dept,   // pre-reassignment, for "pulled by a blocker" copy
    stageOwnerLabel: def.owner_dept ? graph.departments[def.owner_dept] || def.owner_dept : null,
    tone: def.tone || 'neutral',
    owner,
    ownerLabel: owner ? graph.departments[owner] || owner : null,
    since,
    ageDays,
    sla: slaDays,                 // days, matching the old display (`SLA ${sla}d`)
    slaHours: def.sla_hours ?? null,
    overSla,
    blockers: ranked, // severity-ordered, so any UI taking the first is right
    nextAction,
    onHold,
    materialKnown: !!(material && material.total > 0),
  };
}

/**
 * Build the whole flow: every live job classified BY THE VIEW, then rolled up
 * by stage and by owning department.
 *
 * `stageRows` are job_stage rows; `graph` is graphFromRows(). Returns NULL when
 * either is missing — the page must show an error, not an empty board.
 */
export function buildJobFlow({
  sales = [],
  projects = [],
  appointments = [],
  customers = [],
  material = {},
  // sale_balance rows keyed by sale id. The view owns deposit_satisfied and
  // fully_collected; a missing entry means UNKNOWN and must never read as unpaid.
  balances = {},
  stageRows = null,
  graph = null,
  asOf = today(),
}) {
  if (!graph || !Array.isArray(stageRows)) return null;

  const custById = Object.fromEntries(customers.map((c) => [c.id, c]));
  const apptById = Object.fromEntries(appointments.map((a) => [a.id, a]));
  // One project per sale, same last-wins pick as before the cutover — the view
  // carries a row per live project; the board shows one card per sale.
  const projBySale = {};
  for (const p of projects) {
    if (p.sale && !p.cancelled_date && p.status !== 'Cancelled') projBySale[p.sale] = p;
  }
  const stageByPair = new Map();
  for (const r of stageRows) stageByPair.set(`${r.sale_id}:${r.project_id ?? ''}`, r);

  const jobs = sales
    .filter((s) => !s.is_cancelled)
    .map((sale) => {
      const project = projBySale[sale.id] || null;
      const invoice = sale.invoice_number ? String(sale.invoice_number).trim() : null;
      const viewRow = stageByPair.get(`${sale.id}:${project?.id ?? ''}`);
      return classifyJob({
        sale,
        project,
        appointment: sale.appointment ? apptById[sale.appointment] : null,
        customer: sale.customer ? custById[sale.customer] : null,
        material: invoice ? material[invoice] || null : null,
        balance: balances[sale.id] || null,
        stageKey: viewRow?.stage,
        graph,
        asOf,
      });
    });

  // Jobs the two queries momentarily disagree about (a sale landed between the
  // entity fetch and the view fetch). Never silently dropped.
  const unclassified = jobs.filter((j) => j.unclassified);
  const classified = jobs.filter((j) => !j.unclassified);
  const active = classified.filter((j) => !graph.byClassifier[j.stage]?.is_terminal);

  const byStage = graph.stages.map((s) => {
    const rows = s.classifier_key
      ? classified.filter((j) => j.stage === s.classifier_key)
      : []; // planning-only nodes never hold jobs
    return {
      key: s.classifier_key || s.key,
      nodeKey: s.key,
      label: s.label,
      blurb: s.blurb,
      owner: s.owner_dept,
      tone: s.tone,
      isTerminal: !!s.is_terminal,
      isPlanning: !s.classifier_key,
      sla: s.sla_hours == null ? null : s.sla_hours / 24,
      slaHours: s.sla_hours ?? null,
      rows,
      count: rows.length,
      value: rows.reduce((a, j) => a + j.amount, 0),
      overSla: rows.filter((j) => j.overSla).length,
    };
  });

  // Per-department inbox: what is waiting on you, worst first.
  const byOwner = {};
  for (const key of Object.keys(graph.departments)) byOwner[key] = [];
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
    graph,
    departments: graph.departments,
    stageByKey: Object.fromEntries(byStage.map((s) => [s.key, s])),
    jobs: classified,
    unclassified,
    active,
    byStage,
    byOwner,
    blockers,
    atRisk: active.filter((j) => j.overSla),
    critical: active.filter((j) => j.blockers.some((b) => b.severity === 'crit')),
    onHold: active.filter((j) => j.onHold),
    activeValue: active.reduce((a, j) => a + j.amount, 0),
    ageStats: distribution(ages),
    materialKnown: classified.some((j) => j.materialKnown),
  };
}

/**
 * Handoffs: for a given department, what is landing on them versus what they
 * are holding up for somebody else. Returns null when the flow could not be
 * built (graph/view not loaded) so team pages can show the same error state.
 */
export function departmentView(flow, dept) {
  if (!flow) return null;
  const waitingOnUs = flow.byOwner[dept] || [];
  const weAreBlocking = flow.blockers.filter((b) => b.owner === dept && b.job.owner !== dept);
  const blockedByOthers = flow.active.filter(
    (j) => j.owner !== dept && j.blockers.some((b) => b.owner === dept)
  );
  return {
    dept,
    label: flow.departments[dept] || dept,
    waitingOnUs,
    overSla: waitingOnUs.filter((j) => j.overSla),
    weAreBlocking,
    blockedByOthers,
    value: waitingOnUs.reduce((a, j) => a + j.amount, 0),
  };
}
