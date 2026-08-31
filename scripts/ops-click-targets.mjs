/**
 * Proves every clickable operations row actually resolves to a page.
 *
 * The failure this guards against is silent: a row whose builder does not emit
 * projectId/saleId still renders, still highlights on hover, and then does
 * nothing at all when clicked. Nothing throws and no test fails — the click
 * just dies. So rather than trusting the wiring, this runs the REAL builders
 * over a REAL data snapshot and asserts that each row a board makes clickable
 * has somewhere to go.
 *
 * Run:  node scripts/ops-click-targets.mjs <snapshot.json>
 * The snapshot is the same service-role pull used by ops-flow-parity.mjs.
 */
import { readFileSync } from 'node:fs';
import {
  buildInstallBoard, buildOrderingQueue, buildCycleReport, materialIndex, today,
} from '../src/lib/ops/metrics.js';
import { jobHref } from '../src/lib/ops/openJob.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/ops-click-targets.mjs <snapshot.json>');
  process.exit(2);
}
const snap = JSON.parse(readFileSync(path, 'utf8'));
const { sales, projects, rfms_order_status: statusRows = [], as_of: asOf = today() } = snap;
const customers = snap.customers || [];
const material = materialIndex(statusRows);

let failures = 0;
const check = (label, rows, { expect } = {}) => {
  const dead = rows.filter((r) => jobHref(r) === null);
  const wrong = expect
    ? rows.filter((r) => { const h = jobHref(r); return h && !h.startsWith(expect); })
    : [];
  const sample = jobHref(rows[0]) || '(none)';
  console.log(
    `${dead.length === 0 && wrong.length === 0 ? 'OK  ' : 'FAIL'} ${label.padEnd(34)} ` +
    `${String(rows.length).padStart(4)} rows · ${dead.length} dead · ${wrong.length} misrouted · e.g. ${sample}`
  );
  if (dead.length) {
    failures += 1;
    console.error(`      first dead row: ${JSON.stringify(dead[0]).slice(0, 160)}`);
  }
  if (wrong.length) {
    failures += 1;
    console.error(`      first misrouted: ${jobHref(wrong[0])}`);
  }
};

const board = buildInstallBoard({ projects, sales, customers, material, asOf });
check('install board (future)', board.future, { expect: '/ProjectDetail' });
check('install board (overdue)', board.overdue, { expect: '/ProjectDetail' });
check('install board (on hold)', board.onHold, { expect: '/ProjectDetail' });
check('install board (unscheduled)', board.unscheduled, { expect: '/ProjectDetail' });

const queue = buildOrderingQueue({ sales, customers, projects, asOf });
// Ordering-queue rows are sales with no order placed; a project may or may not
// exist yet, so either destination is correct — only "nowhere" is a bug.
check('ordering queue', queue);

const cycle = buildCycleReport({ appointments: snap.appointments || [], sales, projects, customers, asOf });
check('cycle report (outliers)', cycle.jobs, { expect: '/ProjectDetail' });

// A snapshot only exercises the buckets its own dates happen to fill. Re-running
// the board from an EARLIER vantage point turns the same real installs into
// future ones, so the "future" path is covered by real rows rather than assumed.
const rewound = buildInstallBoard({ projects, sales, customers, material, asOf: '2026-01-01' });
check('install board (future, rewound)', rewound.future, { expect: '/ProjectDetail' });

// The cycle report needs an appointment to date the measure from, which the
// snapshot does not carry. This is the smallest fixture that reaches that code
// path — it is checking the BUILDER's output shape, not the data.
const fx = {
  appointments: [{ id: 'a1', customer: 'c1', appointment_date: '2026-01-05', status: 'Sold' }],
  sales: [{ id: 's1', appointment: 'a1', customer: 'c1', invoice_number: 'CG1',
            sale_amount: 1000, sale_date: '2026-01-06', assigned_dc: 'tm1' }],
  projects: [{ id: 'p1', sale: 's1', customer: 'c1', installation_date: '2026-04-01',
               actual_completion_date: '2026-04-02', status: 'Completed' }],
  customers: [{ id: 'c1', first_name: 'Ada', last_name: 'Lovelace' }],
};
const fxCycle = buildCycleReport({ ...fx, asOf: '2026-08-30' });
check('cycle report (fixture)', fxCycle.jobs, { expect: '/ProjectDetail' });

// A row with nothing behind it must resolve to null, not to a broken URL.
const guards = [
  [null, 'null row'],
  [{}, 'empty row'],
  [{ id: 'x' }, 'id-only row (ambiguous)'],
  [{ subject_type: 'claim', subject_id: 'c1' }, 'non-project exception'],
];
for (const [row, label] of guards) {
  const h = jobHref(row);
  console.log(`${h === null ? 'OK  ' : 'FAIL'} guard: ${label.padEnd(27)} -> ${h}`);
  if (h !== null) failures += 1;
}
// ...and one that must resolve.
const ex = jobHref({ subject_type: 'project', subject_id: 'p1' });
console.log(`${ex === '/ProjectDetail?id=p1' ? 'OK  ' : 'FAIL'} guard: project exception       -> ${ex}`);
if (ex !== '/ProjectDetail?id=p1') failures += 1;

console.log(failures === 0
  ? '\nALL CLICK TARGETS RESOLVE'
  : `\n${failures} PROBLEM(S) — some rows would look clickable and do nothing`);
process.exit(failures === 0 ? 0 : 1);
