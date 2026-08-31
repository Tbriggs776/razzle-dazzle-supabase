/**
 * Ops-flow parity test — REQUIRED before the classifier cutover merges.
 * (razzle-ops-flow-spec.md, "Parity test (required)")
 *
 * Proves, on a snapshot of live data, that for every (sale, live project) pair
 * and every project-less sale:
 *
 *   1. job_stage.stage (the SQL classifier, post-cutover)
 *        == classifyJob().stage from the FROZEN pre-cutover flow.js
 *   2. the published graph's identity row for that stage carries the same
 *        label / owner / tone the old STAGES array carried
 *   3. sla_hours == old sla_days × 24, so the over-SLA boolean is unchanged
 *        (ageDays is computed the same way on both sides)
 *
 * Run:  node scripts/ops-flow-parity.mjs <snapshot.json>
 * The snapshot is produced by a service-role SQL pull (see scripts/README or
 * the PR description); it contains sales, projects, rfms_order_status and the
 * post-cutover job_stage rows, plus the Phoenix "today" the view used.
 *
 * Exit 0 with "PARITY OK" only when every row agrees. Any diff prints and
 * exits 1 — per the spec: stop and fix the seed, do not "correct" the job.
 */
import { readFileSync } from 'node:fs';
import {
  classifyJob, buildJobFlow, STAGE_BY_KEY, STAGE_TONE, DEPARTMENTS,
} from './fixtures/flow-v1-freeze.js';
import { materialIndex } from '../src/lib/ops/metrics.js';

const path = process.argv[2];
if (!path) { console.error('usage: node scripts/ops-flow-parity.mjs <snapshot.json>'); process.exit(2); }
const snap = JSON.parse(readFileSync(path, 'utf8'));

const { sales, projects, rfms_order_status: statusRows, job_stage: viewRows, as_of: asOf } = snap;
const material = materialIndex(statusRows || []);

// View rows keyed exactly as the new board looks them up.
const viewByPair = new Map();
for (const r of viewRows) viewByPair.set(`${r.sale_id}:${r.project_id ?? ''}`, r);

const liveProjectsBySale = new Map();
for (const p of projects) {
  if (!p.sale || p.cancelled_date || p.status === 'Cancelled') continue;
  if (!liveProjectsBySale.has(p.sale)) liveProjectsBySale.set(p.sale, []);
  liveProjectsBySale.get(p.sale).push(p);
}

let pairs = 0;
const diffs = [];
const check = (sale, project) => {
  pairs += 1;
  const invoice = sale.invoice_number ? String(sale.invoice_number).trim() : null;
  const old = classifyJob({
    sale, project, appointment: null, customer: null,
    material: invoice ? material[invoice] || null : null,
    balance: null, asOf,
  });
  const view = viewByPair.get(`${sale.id}:${project?.id ?? ''}`);
  if (!view) { diffs.push(`${sale.id}/${project?.id ?? '—'}: NO VIEW ROW (old stage ${old.stage})`); return; }

  if (view.stage !== old.stage) {
    diffs.push(`${sale.id}/${project?.id ?? '—'}: stage view=${view.stage} old=${old.stage}`);
  }
  const def = STAGE_BY_KEY[old.stage];
  if (view.owner_dept !== def.owner) {
    diffs.push(`${sale.id}/${project?.id ?? '—'}: owner_dept view=${view.owner_dept} old=${def.owner}`);
  }
  if (view.stage_label !== def.label) {
    diffs.push(`${sale.id}/${project?.id ?? '—'}: label view=${view.stage_label} old=${def.label}`);
  }
  if (view.tone !== STAGE_TONE[old.stage]) {
    diffs.push(`${sale.id}/${project?.id ?? '—'}: tone view=${view.tone} old=${STAGE_TONE[old.stage]}`);
  }
  const wantSla = def.sla == null ? null : def.sla * 24;
  if ((view.sla_hours ?? null) !== wantSla) {
    diffs.push(`${sale.id}/${project?.id ?? '—'}: sla_hours view=${view.sla_hours} old=${wantSla}`);
  }
};

for (const sale of sales) {
  if (sale.is_cancelled) continue;
  const live = liveProjectsBySale.get(sale.id) || [];
  if (live.length === 0) check(sale, null);
  else for (const p of live) check(sale, p);
}

// Board-count parity: the old board, byStage, exactly as JobFlow computed it.
// The new board picks the same one-project-per-sale and reads the same stages,
// so equal per-pair stages ⇒ equal counts; this prints the old numbers so the
// PR record shows what "unchanged" meant on this snapshot.
const flow = buildJobFlow({ sales, projects, material, balances: {}, asOf });
const counts = flow.byStage.map((s) => `${s.key}=${s.count}`).join(' ');

console.log(`pairs checked: ${pairs}  (view rows: ${viewRows.length})`);
console.log(`old board counts: ${counts}`);
console.log(`departments (frozen): ${Object.keys(DEPARTMENTS).join(',')}`);
if (diffs.length) {
  console.error(`PARITY FAILED — ${diffs.length} diff(s):`);
  for (const d of diffs) console.error('  ' + d);
  process.exit(1);
}
console.log('PARITY OK — every pair classifies identically; identity columns match the freeze.');
