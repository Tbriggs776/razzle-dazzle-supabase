## RAZZLE DAZZLE — Workflow & Task Engine build spec

Grounded in: `DECISIONS.md`, `src/lib/ops/flow.js`, `src/lib/ops/metrics.js`, `.claude/skills/rfms-pro/*`, `supabase/migrations/0001,0006,0009,0016,0020,0032,0050,0051`, `supabase/functions/{processJobs,sendMessage,smsDispatch,submitCheckpoint}`, `src/pages/{MyTasks,JobFlow}.jsx`.

---

## 0. The one idea that reconciles derived stage with explicit task

`classifyJob()` is a **total pure function of data**. It says *where a job is and who owns it*. It must stay that way — it is the only thing in the system that cannot lie.

A task is a **durable, addressable commitment by a named person**. It says *who has to move next and by when*.

The rule that prevents double-booking reality:

> **Data closes tasks. Tasks never close stages.**
> A stage never advances because someone ticked a box. An auto task disappears the moment the predicate that created it stops being true — nobody "completes" it.

This forces two task classes and they behave differently:

| Class | `source` | Created by | Closed by | Can a human tick it? |
|---|---|---|---|---|
| **Derived** | `auto` | reconciler, while predicate true | reconciler, when predicate false → `auto_closed / data_satisfied` | **No.** Only snooze-to-`waiting` or `waive` with a reason |
| **Act-and-record** | `auto_once` | one-shot on an event | human, and completion **writes the fact** (`welcome_call_completed_date`, `actual_completion_date`) | Yes — but the write is the point, the tick is a side effect |
| **Discretionary** | `manual` | a person | a person | Yes |

So "call the customer" is not a status flip; it is a recording action whose artifact then satisfies the derived predicate and closes the task on the next reconcile. There is exactly one source of truth and the task list is a *view onto pressure*, not a parallel status model.

The single exception where a task touches ownership — **handoff rejection** — is handled in §5 by pushing a `crit` blocker, reusing flow.js's existing `critical?.owner || def.owner` line. Ownership moves; stage does not. That is honest: the job really is at `awaiting_material`, it is just Sales' problem again.

---

## 1. Task model

### 1.1 Extend the existing `task` table — do not replace it

`MyTasks.jsx`, `uq_task_followup`, and `backfill_followup_tasks()` all depend on it. `0052_task_engine.sql`:

```sql
alter table public.task
  -- subject polymorphism (task.appointment stays, back-compat)
  add column if not exists subject_type text
       check (subject_type in ('lead','appointment','sale','project','claim')),
  add column if not exists subject_id   text,
  add column if not exists rule_key     text,          -- null ⇒ manual
  add column if not exists stage        text,          -- flow.js stage at creation
  add column if not exists dept         text,          -- DEPARTMENTS key: the accountable department
  add column if not exists assigned_role text,         -- role key when no person resolves (an E2 violation)
  add column if not exists priority     smallint not null default 2,  -- 0 crit 1 high 2 normal 3 low
  add column if not exists source       text not null default 'manual'
       check (source in ('auto','auto_once','manual')),
  add column if not exists state        text not null default 'open'
       check (state in ('open','waiting','done','auto_closed','waived','canceled')),
  add column if not exists waiting_on    text,          -- 'customer' | 'supplier' | 'rfms' | 'finance' | free text
  add column if not exists waiting_until date,
  add column if not exists due_at        timestamptz,
  add column if not exists escalate_after_hours int,
  add column if not exists escalation_level smallint not null default 0,
  add column if not exists escalated_at timestamptz,
  add column if not exists resolved_at  timestamptz,
  add column if not exists resolution   text
       check (resolution in ('data_satisfied','completed','waived','superseded','canceled')),
  add column if not exists resolution_note text,
  add column if not exists created_reason jsonb;        -- the blocker snapshot that justified it

-- "Waiting" is only legitimate if it names a party AND a date. This is the constraint
-- that makes the un-droppable invariant provable rather than aspirational.
alter table public.task add constraint task_waiting_needs_reason
  check (state <> 'waiting' or (waiting_on is not null and waiting_until is not null));

-- Idempotency: at most ONE live task per (subject, rule). Same proven pattern as
-- uq_task_followup in 0009 — the reconciler can run every 15 minutes forever.
create unique index if not exists uq_task_rule
  on public.task (subject_type, subject_id, rule_key)
  where state in ('open','waiting') and rule_key is not null;

create index if not exists idx_task_subject  on public.task (subject_type, subject_id);
create index if not exists idx_task_open_due on public.task (due_at) where state in ('open','waiting');
create index if not exists idx_task_dept     on public.task (dept) where state in ('open','waiting');
```

Keep the legacy `status` column alive with a trigger so `MyTasks.jsx` and `backfill_followup_tasks()` do not break on day one:

```sql
create or replace function public.sync_task_legacy_status() returns trigger
language plpgsql as $$ begin
  NEW.status := case when NEW.state in ('open','waiting') then 'pending' else 'completed' end;
  return NEW; end $$;
create trigger trg_task_legacy before insert or update on public.task
  for each row execute function public.sync_task_legacy_status();
```

### 1.2 The rule catalog lives in data, not code

The SLAs in `flow.js` are self-described as "the numbers to tune once the team argues about them." Put them where the argument can be settled without a deploy:

```sql
create table public.task_rule (
  rule_key      text primary key,
  subject_type  text not null,
  stage         text,              -- flow.js stage this rule belongs to (null = cross-cutting)
  blocker_code  text,              -- links to flow.js blocker() codes where one exists
  dept          text not null,     -- DEPARTMENTS key
  title_tpl     text not null,
  assignee_expr text not null,     -- see 1.3
  due_offset_hours   int not null,
  business_hours_only boolean not null default true,
  priority      smallint not null default 2,
  escalate_after_hours int,
  escalation_chain jsonb not null default '["assignee","dept_lead","ops_manager","owner"]'::jsonb,
  source        text not null default 'auto',
  channel       text not null default 'inapp',   -- inapp | email | sms | sms_crit
  customer_comm_key text,          -- sms_settings template key fired alongside, if any
  requires_rfms boolean not null default false,  -- suppressed + downgraded while RFMS is dark
  is_active     boolean not null default true
);

create table public.dept_roster (
  id text primary key default gen_random_uuid()::text,
  dept text not null, team_member_id text not null references public.team_member(id),
  is_primary boolean default false, is_lead boolean default false,
  backup_member_id text references public.team_member(id),
  ooo_until date,
  unique (dept, team_member_id)
);
```

### 1.3 Assignee resolution — a person, or it's a violation

`public.resolve_assignee(p_dept text, p_subject_type text, p_subject_id text) returns text`, in order:

1. **Named person on the row.** `project.install_coordinator_id` (scheduling), `project.field_manager_id` (install), `project.order_entry_id` (ordering), `sale.assigned_dc` (sales), `appointment.assigned_csr` (csr), `project.project_manager`. These columns already exist in `0001_create_schema.sql` and are currently decorative — this is what makes them load-bearing.
2. **Dept roster primary**, skipping anyone with `ooo_until >= today` (use their `backup_member_id`).
3. **Nothing** → the task is created with `assigned_role` set and `assigned_to` null, and the reconciler immediately raises an **E2 UNOWNED** exception. An unassignable task is a management failure surfaced within 15 minutes, not a silent drop.

### 1.4 Materialized stage — so SQL can reason, and so SLAs become evidence-based

The reconciler persists `classifyJob()` output:

```sql
create table public.job_flow_snapshot (           -- one row per active job, upserted
  subject_type text not null, subject_id text not null,
  sale_id text, project_id text, invoice text,
  stage text not null, owner_dept text, owner_person_id text,
  since date, age_days int, sla int, over_sla boolean,
  blockers jsonb not null default '[]'::jsonb,
  material_known boolean not null default false,
  amount numeric(14,2), computed_at timestamptz not null default now(),
  primary key (subject_type, subject_id)
);

create table public.job_flow_transition (         -- append-only; NEVER updated
  id bigserial primary key,
  subject_type text not null, subject_id text not null,
  from_stage text, to_stage text not null,
  from_owner text, to_owner text,
  entered_at timestamptz not null default now(),
  dwell_days_in_from int
);
```

`job_flow_transition` is how the SLA argument gets won: after 90 days you have real p50/p90 dwell per stage per department, and `STAGES[].sla` stops being a guess. Feed it through the existing `distribution()` in `metrics.js`.

---

## 2. Auto-generation rules

Due offsets are business hours (Mon–Sat 07:00–17:00 Phoenix) unless marked ⏱ wall-clock. "Esc" = escalate after, to the next link in the chain.

### Pre-sale — Marketing / CSR / Sales

| rule_key | Trigger (predicate) | Task → assignee | Due | Esc |
|---|---|---|---|---|
| `lead_untouched` | `lead` exists, no `appointment` row, age > 2h | Book or disposition the lead → CSR | 4h | 8h → CSR lead |
| `appt_no_dc` | `appointment.status in (Scheduled,Rescheduled,Awaiting Assignment)`, `assigned_dc is null`, date ≤ tomorrow | Assign a consultant → Sales Manager | 2h ⏱ | 4h → Sales Mgr, then owner |
| `appt_no_outcome` | `appointment_date < today`, status still Scheduled/Rescheduled | Record the appointment outcome → assigned DC | 4h | 24h → Sales Mgr |
| `appt_followup` | `status = 'Follow-Up'` | Follow up → assigned DC | per DC-set date | 48h past due → Sales Mgr |
| `sold_no_contract` | `sale` exists, `contract_file_url is null` | Upload the signed contract → DC | 4h | 24h → Sales Mgr |
| `sold_no_deposit` | `sale.sale_amount > 0`, no `payment` rows (flow.js blocker `deposit`) | Collect/record the deposit → DC, cc Finance | 24h | 48h → Finance Mgr **and** hold the job |
| `sold_no_customer_master` | sale has no `customer` FK | Link/create customer master → CSR | 4h | 24h |

`appt_no_dc` replaces the fire-and-forget `unassigned_dc` SMS in `smsDispatch/index.ts` with something that has an owner and a clock. Keep the SMS as the L2 notification of the same task.

### `to_order` — Ordering (owner: Order Processor named on `project.order_entry_id`)

| rule_key | Trigger | Task → assignee | Due | Esc |
|---|---|---|---|---|
| `not_ordered` | flow blocker `not_ordered` (sold, `invoice_number is null`) | Place the order in RFMS → Order Processor | 1 business day (matches `STAGES.to_order.sla = 2`, tightened; the sale is complete, this is data entry) | 48h → Ops Mgr, 96h → owner |
| `order_no_lines` | invoice exists but RFMS returned 0 lines (`fetch_rfms_order` result `lines: 0`) | Order placed with no lines → Order Processor | 4h | 24h → Ops Mgr |
| `gp_below_threshold` | `fetch_rfms_order` computes GP < `sms_settings.gp_alert_threshold` | Review margin before it ships → Sales Manager | 24h | 48h → owner |

### `awaiting_material` — Ordering

| rule_key | Trigger | Task → assignee | Due | Esc |
|---|---|---|---|---|
| `material_no_po` | `materialIndex[invoice].noPO > 0` (`None` lines) | Raise the PO → Order Processor | 1 day | 48h → Ops Mgr |
| `material_no_eta` | any pre-receipt line, `purchaseorder/find` returned no `promiseDate` | Get an ETA from the supplier → Order Processor | 2 days | 5 days → Ops Mgr |
| `material_eta_slip` | `promiseDate > installation_date − 3d` | Promise date threatens the install → Order Processor **and** Install Coordinator | 4h ⏱, priority 0 | 12h → Ops Mgr |
| `material_stale` | pre-receipt > 14 days (matches `STAGES.awaiting_material.sla = 14`) | Chase the supplier → Order Processor | at day 14 | day 21 → Ops Mgr |
| `material_unverified` | **`materialKnown = false`** and install within 14 days | Confirm material readiness manually (RFMS not reporting) → Order Processor | 1 day | 3 days → Ops Mgr |

`material_unverified` is the pre-connection mode. `classifyJob` already refuses to advance past an unseen material gate; this rule turns that silence into an owned action instead of a job that quietly sits. All the other material rules carry `requires_rfms = true` and are inert until credentials land.

### `ready_to_schedule` — Scheduling (owner: `project.install_coordinator_id`)

| rule_key | Trigger | Task → assignee | Due | Esc |
|---|---|---|---|---|
| `unscheduled` | flow blocker `unscheduled` | Book the install date → Install Coordinator | 2 days (inside `sla = 3`, so the task bites before the board turns red) | 3 days → Ops Mgr |
| `sched_no_crew` | flow blocker `no_crew` | Assign a crew → Install Coordinator | 1 day | 48h → Field Mgr |
| `sched_no_duration` | date set, no `scheduled_end_date` | Set the job duration → Install Coordinator | 1 day | — |
| `sched_push_rfms` | local date/crew set, RFMS job not written | Push schedule to RFMS *(automated; task only on write failure)* → Order Processor | 4h | 24h → Ops Mgr |

### `scheduled` — Install / CX

| rule_key | Trigger | Task → assignee | Due | Esc |
|---|---|---|---|---|
| `preinstall_call` | T−7 days, `pre_install_call_completed_date is null` | Pre-install call → CX / CSR | T−5 | T−3 → CX lead |
| `preinstall_checklist` | T−3, no approved `project_checkpoint` `step_key='pre_install_checklist'` | Complete the pre-install checklist → Install Coordinator | T−2 | T−1 → Field Mgr, priority 0 |
| `material_short_scheduled` | flow blocker `material_short` (crit) | Material short on a dated job → Order Processor *(flow.js already reassigns ownership to `ordering`)* | 4h ⏱, priority 0 | 12h → Ops Mgr, 24h → owner |
| `crew_confirm` | T−2, no `crew_confirmed_at` | Confirm the crew → Field Manager | T−2 17:00 | T−1 08:00 → Ops Mgr, SMS |
| `customer_confirm` | T−1, confirmation comm not `delivered` | Confirm with the customer *(automated SMS; task only if the send failed/suppressed)* → CSR | T−1 12:00 | same day → CSR lead |
| `hold_uncleared` | flow blocker `hold` (crit) | Clear or cancel the hold → Sales | 24h | 72h → owner |

### `in_progress` — Install / Field

| rule_key | Trigger | Task → assignee | Due | Esc |
|---|---|---|---|---|
| `no_start_stamp` | install date = today, no `actual_start_date` by 10:00 | Confirm the crew is on site → Field Manager | 10:00 ⏱ | 12:00 → Ops Mgr, SMS |
| `not_closed` | flow blocker `not_closed` (crit): install date passed, no completion | **Capture the completion date** → Field Manager | 18:00 same day ⏱, priority 0 | 12h → Ops Mgr SMS, 24h → owner SMS |
| `checkpoint_rejected` | `project_checkpoint.status = 'Rejected'` | Rework and resubmit → Field Manager (→ crew link) | 24h | 48h → Ops Mgr |
| `asbestos_stop` | `submitCheckpoint` asbestos hard-stop fired | Hard stop — do not proceed → Ops Mgr + owner | immediate ⏱, priority 0 | immediate SMS, `bypass_quiet_hours` |
| `change_order_unpriced` | change order recorded, `sale_amount` unchanged | Price the change order → DC *(DECISIONS §3: the GP denominator must stay honest)* | 24h | 48h → Sales Mgr |

`not_closed` is the highest-stakes rule in the system. `DECISIONS.md` §4 makes lifetime-labor warranty entitlement start at **actual completion**, so an uncaptured completion date is a legal exposure, not hygiene. It escalates to the owner within 24 hours and is the only install rule that is never auto-waivable.

**Field capture with no crew logins.** Reuse the `public_token` pattern from `0032_public_tokens.sql` (already on `project`). A texted link `/CrewJobView?t=<project.public_token>` renders a no-login page: Start, Complete, photos, customer signature. Server side, an RPC `crew_stamp_completion(p_token, p_completed_on, p_photos, p_signature)` — anon-callable, token-scoped, writes `actual_completion_date` and a `workflow_event` with the token as actor. This closes `not_closed` from the site instead of an office person typing a date from memory next Tuesday.

### `qa` — Install

| rule_key | Trigger | Task → assignee | Due | Esc |
|---|---|---|---|---|
| `qa_walkthrough` | flow blocker `qa` | Final walkthrough sign-off → Field Manager | 2 days (inside `sla = 3`) | 3 days → Ops Mgr |
| `qa_punchlist` | walkthrough approved with punch items | Close the punch list → Field Manager | 5 days | 10 days → Ops Mgr |
| `qa_no_photos` | completion stamped, `photo_urls` empty | Attach completion photos → Field Manager | 24h | 48h → Ops Mgr |

### `cx_followup` / post-completion — CX, Finance

| rule_key | Trigger | Task → assignee | Due | Esc |
|---|---|---|---|---|
| `cx_call` | flow blocker `cx_call` | Post-install check-in call → CX | 2 days (matches `sla = 2`) | 4 days → CX lead |
| `warranty_stamp` | completion captured, no `warranty_start_date` on the job | Stamp warranty entitlement → CX, priority 0 | 24h | 48h → owner |
| `balance_due` | `balance_due > 0` at completion | Collect the balance → Finance | 3 days | 10 days → Finance Mgr, 30 days → owner |
| `review_ask` | check-in call logged positive | Request the review → CX | 2 days | — |
| `worry_free_11mo` | completion + 335 days (12-month Worry-Free Guarantee) | Proactive 11-month check → CX | on date | 14 days → CX lead |
| `claim_ack` | `project_claim` created | Acknowledge the claim (FD-02 clock) → CX | 24h ⏱ | 48h → Ops Mgr |
| `claim_schedule` | claim acknowledged, no service date | Schedule the cure → Install Coordinator | 5 days | 10 days → Ops Mgr |
| `backcharge_notice` | claim marked `is_back_charge` | Issue notice-and-cure before back-charging → Ops Mgr *(DECISIONS §4: the contractual record must exist first)* | 24h | 48h → owner |

---

## 3. The un-droppable guarantee

### 3.1 The invariant, stated formally

> For every **active** job J (a non-cancelled sale whose derived stage ≠ `complete`):
> 1. J has **exactly one** derived stage — guaranteed structurally: `classifyJob`'s if/else chain is total and terminates in an `else`, so there is no null branch. ✅ already true.
> 2. J has **exactly one accountable person** — `owner_person_id` resolves to an active team member, not merely a department.
> 3. J has **at least one** of: an `open` task, or a `waiting` task whose `waiting_on` and `waiting_until` are both set with `waiting_until >= today`.
>
> Any J violating 2 or 3 is an **exception**, written to `workflow_exception`, surfaced on a page, and digested to the Ops Manager daily. **The target number is zero.**

There is deliberately no "nothing to do right now" escape hatch. A job sitting at `scheduled` with an install date three weeks out still holds a `waiting` task (`waiting_on='calendar'`, `waiting_until=installation_date−7`), which expires into `open` and generates `preinstall_call`. Idle is always *explicitly* idle, with an owner and an expiry.

### 3.2 The reconciler — `reconcile_workflow`, every 15 minutes

A new handler in `supabase/functions/processJobs/index.ts`, six passes, all set-based and bounded:

1. **Classify.** Load active sales/projects/customers + `rfms_order_status`, run `materialIndex()` then `buildJobFlow()` — the *same* module the UI runs (§6.1). Upsert `job_flow_snapshot`; on stage change append `job_flow_transition` with the dwell of the stage just left.
2. **Materialize.** For each active `task_rule` whose predicate holds and which has no live task on that subject: `insert … on conflict (uq_task_rule) do nothing`. Resolve assignee, compute `due_at` in business hours, snapshot the blocker into `created_reason`, append `workflow_event('created')`.
3. **Auto-close.** Every `open`/`waiting` task with `source='auto'` whose predicate is now false → `state='auto_closed'`, `resolution='data_satisfied'`. This is the pass that keeps the task list from becoming a graveyard, and it is why the stage engine and the task engine never disagree.
4. **Reassign.** Where `job_flow_snapshot.owner_person_id` changed (typically a `crit` blocker moving ownership — e.g. `material_short` pulling a scheduled job back to Ordering), reassign live tasks and log `workflow_event('reassigned')`.
5. **Expire waits.** `waiting_until < today` → `state='open'`, `priority = greatest(0, priority-1)`, notify.
6. **Escalate + assert invariant.** Bump `escalation_level` on anything past `due_at + escalate_after_hours`; then evaluate the invariant view and upsert `workflow_exception` rows.

Every mutation writes to an append-only ledger — this is what makes "nothing was lost" provable *retrospectively*, not just as a current-state claim:

```sql
create table public.workflow_event (
  id bigserial primary key,
  task_id text, subject_type text, subject_id text,
  event text not null,        -- created|assigned|reassigned|escalated|snoozed|waived|completed|auto_closed|handoff_rejected
  from_value jsonb, to_value jsonb,
  actor text,                 -- user id, 'system', or 'crew_token:<public_token>'
  reason text,
  created_date timestamptz not null default now()
);
-- log tables are already read-only-by-construction per 0050 §4; apply the same policy here.
```

### 3.3 The exception report

```sql
create or replace view public.workflow_invariant as
select s.subject_type, s.subject_id, s.stage, s.owner_dept, s.owner_person_id,
       count(t.id) filter (where t.state = 'open') as open_tasks,
       count(t.id) filter (where t.state = 'waiting' and t.waiting_until >= current_date) as valid_waits
from public.job_flow_snapshot s
left join public.task t
       on t.subject_type = s.subject_type and t.subject_id = s.subject_id
      and t.state in ('open','waiting')
where s.stage <> 'complete'
group by 1,2,3,4,5;
```

| Code | Condition | Meaning | Fires |
|---|---|---|---|
| **E1 ORPHAN** | `open_tasks = 0 and valid_waits = 0` | The un-droppable violation. Nobody is holding this job. | Immediate: task on Ops Mgr, priority 0 |
| **E2 UNOWNED** | `owner_person_id is null`, or task `assigned_to is null`, or assignee inactive / past `ooo_until` | A department owns it but no human does | Immediate |
| **E3 STALE_WAIT** | `waiting_until < current_date` and untouched > 24h | A "waiting on X" that nobody came back to | Daily digest |
| **E4 CONTRADICTION** | live task whose `stage` ≠ current snapshot stage and `source='auto'` | Reconciler pass 3 failed — an engine bug, not an ops problem | Immediate, engineering |
| **E5 GHOST** | live task on a cancelled/complete subject | Should have been superseded | Daily |
| **E6 UNVERIFIABLE** | `material_known = false` and install ≤ 7 days | We cannot see the material gate — the honest pre-RFMS gap | Daily until credentials land |
| **E7 DEAD_LETTER** | `job.status='failed'` on a notify job, or `communication.delivery_status='failed'` on an escalation | The escalation itself was dropped | Immediate |
| **E8 CLOCK** | `installation_date < today − 2` and `actual_completion_date is null` | Warranty clock unstarted — legal exposure (DECISIONS §4) | Immediate SMS to Ops Mgr + owner |

Surfaces:
- **`src/pages/WorkflowExceptions.jsx`** — the operational page, grouped by code, each row linking to the job.
- **`JobFlow.jsx`** gets one number in the KPI row: **"Unaccounted jobs: 0"**. That single tile is the proof, visible to every department (0047 already grants JobFlow to every role). A non-zero value is the daily standup's first agenda item.
- Daily 07:30 Phoenix digest to the Ops Manager and owner; E1/E8 also fire immediately.

---

## 4. Escalation & notification

### 4.1 The ladder

| Level | Trigger | Channel | Recipient |
|---|---|---|---|
| L0 | task created | in-app only — appears in `MyTasks` and the dept inbox. **No push.** | assignee |
| L1 | `due_at` passed | email, **batched into the 07:00 / 15:00 digest** | assignee |
| L2 | `due_at + escalate_after_hours` | SMS to assignee + email to dept lead | assignee, dept lead |
| L3 | L2 + escalate_after_hours | SMS to dept lead; row appears on the exception report | dept lead, Ops Mgr |
| L4 | `priority = 0` rules only (`not_closed`, `asbestos_stop`, `material_short_scheduled`, `warranty_stamp`, E1/E8) | immediate SMS, `bypass_quiet_hours: true` | Ops Mgr + owner |

Most tasks never leave L0. That is the design: if every task pinged a phone, the pings stop meaning anything and the whole engine gets ignored — the exact failure mode of the existing `past_due` blast.

### 4.2 Respecting the rails already built

`sendMessage/index.ts` is the single choke point and already implements both. Do not add a second gate; feed this one correctly:

- **Arm switch** — `sms_outbound_enabled !== true` fails **closed**. All escalation SMS is inert until Twilio is armed. Degradation must be explicit: while disarmed, L2/L3/L4 downgrade to email + an in-app banner, and the reconciler writes an `E7` row rather than pretending the escalation happened.
- **Quiet hours** — the existing predicate is `customerFacing = !!(p.lead_id || p.customer_id) && !bypass_quiet_hours`. **This is a live trap for this feature:** an internal escalation payload that helpfully includes `lead_id` for context will be silently deferred until 08:00. **Rule: internal task/escalation payloads must never set `lead_id` or `customer_id`.** Carry context in new fields `task_id` / `subject_type` / `subject_id` instead (they are ignored by the quiet-hours check and can be persisted on `communication` for the audit trail). Customer-facing comms triggered *alongside* a task (appointment reminder, install confirmation) keep `lead_id`/`customer_id` and are correctly held.
- **Anti-spam** — `create unique index uq_task_notify on task_notification (task_id, level)`. One notification per task per level, ever. Per-person digest rollup: one email listing N tasks, not N emails.
- **Durability** — every notification goes through `enqueue_job('send_sms'|'send_email')` → `processJobs` → `sendMessage`, inheriting suppression, delivery tracking and retry. Nothing calls Twilio or Resend directly. A `failed` job at `max_attempts` becomes an **E7** — the escalation about the failed escalation.

New job types in `processJobs`: `reconcile_workflow`, `dispatch_task_digest`, `workflow_exception_report`, `rfms_push_schedule`, `rfms_poll_po_eta`.

New crons (`0053_workflow_crons.sql`; note existing files use UTC, Phoenix = UTC−7):

```sql
select cron.schedule('reconcile-workflow',   '*/15 * * * *', $$ select public.enqueue_job('reconcile_workflow'); $$);
select cron.schedule('task-digest-am',       '0 14 * * *',   $$ select public.enqueue_job('dispatch_task_digest', '{"slot":"am"}'::jsonb); $$);
select cron.schedule('task-digest-pm',       '0 22 * * *',   $$ select public.enqueue_job('dispatch_task_digest', '{"slot":"pm"}'::jsonb); $$);
select cron.schedule('workflow-exceptions',  '30 14 * * *',  $$ select public.enqueue_job('workflow_exception_report'); $$);
select cron.schedule('rfms-po-eta',          '0 15 * * 1-6', $$ select public.enqueue_job('rfms_poll_po_eta'); $$);
```

`rfms_poll_po_eta` must be driven from **our** open-job list, one `POST /v2/order/purchaseorder/find` per `(number, lineNumber)` — there is no list-by-supplier/date endpoint, and the shared on-prem `RFMSDataEndpoint` has been DoS'd into a 16-hour outage before. Cap at ~200 calls/run with a stored cursor.

---

## 5. Handoff protocol

### 5.1 The gate is entry criteria, enforced by rejection — not by blocking

Stage is derived from data that has already changed, so the sending department cannot be prevented from "pushing." Instead the receiving department gets a **reject** action with a controlled reason, which:

1. inserts a `handoff_rejection` row (open),
2. causes `classifyJob` to emit a `crit` blocker owned by the **sending** department,
3. which the existing line `const owner = critical?.owner || def.owner;` already turns into an ownership reassignment — **no new ownership logic required**,
4. creates a priority-0 task on the sender with the rejection reason and a 4-hour clock,
5. notifies the sender at L2 immediately (this is rework, it should sting).

The minimal, additive change to `flow.js`:

```js
export function classifyJob({ sale, project, appointment, customer, material, handoff = null, asOf = today() }) {
  // …existing cross-cutting blockers…
  if (handoff && !handoff.resolved_date) {
    blockers.push(blocker('handoff_rejected', 'crit',
      `Rejected by ${DEPARTMENTS[handoff.rejected_by_dept]}`,
      handoff.reason_label, handoff.returned_to_dept));
  }
```

`buildJobFlow` gains a `handoffs = {}` lookup keyed by sale id, hydrated the same way `material` already is. Everything downstream — `byOwner`, `departmentView`, `weAreBlocking` — works unchanged.

### 5.2 The gates

| Handoff | Receiving dept accepts only if | Rejection reasons |
|---|---|---|
| Sales → **Ordering** (`to_order`) | signed contract on file · deposit recorded · product + color selections complete · measure quantities present (**sq ft**; RFMS is **sq yd**, 1 sy = 9 sf) · address validated | `missing_contract`, `missing_deposit`, `incomplete_selection`, `missing_measure`, `bad_address` |
| Ordering → **Scheduling** (`ready_to_schedule`) | every line `Del`/`Resvd`/`Cut`, **or** an explicit waiver with a reason · no finance hold · no open change order | `material_short`, `no_eta`, `finance_hold`, `open_change_order` |
| Scheduling → **Install** (`scheduled`) | crew assigned and confirmed · duration set · work order issued · material located · site access confirmed · pre-install checklist approved | `no_crew`, `no_workorder`, `material_not_located`, `no_access`, `checklist_incomplete` |
| Install → **CX/QA** (`qa`) | `actual_completion_date` captured **at the site** · completion photos present · customer signature captured | `no_completion_stamp`, `no_photos`, `no_signature`, `punchlist_open` |
| CX → **Complete** | check-in call logged · warranty entitlement stamped · balance zero or on a written plan · review requested | `no_checkin`, `no_warranty_record`, `balance_outstanding` |

Stored as `stage_gate(from_stage, to_stage, receiving_dept, required_predicates jsonb, reason_codes jsonb)` so the criteria are inspectable and tunable in Settings rather than buried in a component.

**Ping-pong guard:** the second rejection on the same job within one stage auto-escalates to the Ops Manager with both rejection records attached, and the Ops Manager — not either department — assigns the next owner. Two departments arguing through the app is a management event, not a workflow state.

**Auditability:** every rejection and its resolution lands in `workflow_event`, so `departmentView(flow, dept).weAreBlocking` gains a companion metric — *how often does work you sent come back?* — which is the number that actually changes upstream behaviour.

---

## 6. Where this lives in code

### 6.1 One copy of the stage engine, running in two runtimes

`flow.js` must run in the browser (JobFlow, dept inboxes) **and** in Deno (the reconciler). Two copies will diverge and the whole invariant becomes fiction.

**Primary:** move the module to `supabase/functions/_shared/ops/{flow.js,metrics.js}` and alias it for the app in `vite.config.js`:

```js
resolve: { alias: { '@/lib/ops': path.resolve(__dirname, 'supabase/functions/_shared/ops') } },
server: { fs: { allow: ['..'] } },
```

No import in `src/` changes (`@/lib/ops/flow` still resolves). **Fallback** if the bundler fights it: keep both files and add a `npm run check:flow-parity` byte-comparison to CI — but treat that as debt, not a design.

### 6.2 Migrations

| File | Contents |
|---|---|
| `0052_task_engine.sql` | `task` column adds + constraints + `uq_task_rule` + legacy-status trigger; `task_rule` (+ seed of every rule in §2); `dept_roster`; `task_notification`; `workflow_event`; `workflow_exception`; `handoff_rejection`; `stage_gate`; `job_flow_snapshot`; `job_flow_transition`; RLS (dept-scoped read, service-role write; log tables append-only per `0050` §4) |
| `0053_workflow_crons.sql` | the five `cron.schedule` entries in §4.2 |
| `0054_workflow_rpcs.sql` | `resolve_assignee()`, `workflow_invariant` view, `task_action()` (complete/snooze/waive), `reject_handoff()`, `crew_stamp_completion()`; grants locked down following the `0022_lock_down_function_grants.sql` pattern (`revoke … from anon, authenticated; grant … to service_role`) |
| `0055_workflow_pages.sql` | `app_page` rows + `role_permissions.accessible_pages` grants for `WorkflowExceptions` and `DeptInbox`, following the `0047_job_flow_access.sql` pattern |

### 6.3 `src/lib/ops/flow.js` — additive only

- `classifyJob({ …, handoff })` → the `handoff_rejected` crit blocker (§5.1).
- `buildJobFlow({ …, handoffs })` → hydrate the lookup.
- Export `ownerPersonOf(job, rosters)` so the UI shows a **name**, not a department, everywhere the board currently shows `ownerLabel`.
- Export a `RULE_PREDICATES` map — one named pure predicate per `rule_key`, taking the same `classifyJob` inputs. Both the reconciler and the UI evaluate the identical function, so "why is this task here?" and "why is this job red?" can never give different answers.
- Do **not** change `STAGES`, `DEPARTMENTS`, or the stage-resolution chain. The vocabulary is correct.

### 6.4 Edge functions

- `supabase/functions/processJobs/index.ts` — add the five handlers from §4.2 to the `handle()` switch, importing `_shared/ops/flow.js`.
- `supabase/functions/taskAction/index.ts` (**new**) — complete / snooze-to-waiting / waive / reject-handoff, authenticated-user gated, writes `workflow_event` with the real actor. Keeps every state change server-side and auditable rather than letting the browser `Task.update()` directly (which is how `MyTasks.jsx` works today).
- `supabase/functions/submitCheckpoint/index.ts` — on `approve_final`, write `actual_completion_date` if absent, so the walkthrough approval itself starts the warranty clock.
- `supabase/functions/rfmsQuery` / `_shared/rfms.ts` — add `pushJobToRfms()`: `GET /v2/crews` (crew by **name** — no endpoint takes a crew id) → `POST /v2/job/create` from the order, or `POST /v2/job` upsert **always carrying `jobId`** (a dropped `jobId` silently creates a duplicate job); implement the `jobChecks` override protocol including the PascalCase→camelCase rename. `POST /v2/job/status` on confirm/complete using the vocabulary from `GET /v2/statuses`. **Never** call `DELETE /v2/job/:id` from automation — it is Plus-tier while create is Enterprise, so it can destroy work the integration cannot rebuild.

### 6.5 Pages

| Page | Change |
|---|---|
| `src/pages/MyTasks.jsx` | Rewrite for subject polymorphism — it currently hardcodes `task.appointment` and links only to `AppointmentDetail`. Add state chips (open / waiting / done), the waiting-until date, escalation-level badge, priority sort ahead of due date, and route by `subject_type`. |
| `src/pages/JobFlow.jsx` | Add the **"Unaccounted jobs"** KPI tile; per-department open-task counts beside the existing blocker counts; a Reject Handoff action on each row. |
| `src/pages/WorkflowExceptions.jsx` | **New.** The E1–E8 report, grouped by code. |
| `src/components/ops/DeptInbox.jsx` | **New** shared component (dept tasks + `departmentView().weAreBlocking`), mounted inside the existing `InstallTeam.jsx`, `OrderingTeam.jsx`, `ClaimsDashboard.jsx`, and a new `Sales`/`CX` tab — rather than building yet another standalone board. |
| `src/pages/CrewJobView.jsx` | **New**, public-token (`0032`) — the no-login crew page that captures the completion date at the site. |
| `src/pages/Settings.jsx` | Task-rule editor (SLA, escalation chain, channel per rule), dept roster + OOO/backup, stage-gate criteria. |
| `SaleDetail.jsx`, `ProjectDetail.jsx`, `Journey.jsx` | Task strip + handoff history from `workflow_event`. |

### 6.6 Build order

1. `0052` + reconciler passes 1–3 + `job_flow_snapshot`/`transition`. **Value on day one with zero notifications:** the exception report immediately shows how many live jobs currently have nobody holding them.
2. Assignment + `dept_roster` + `MyTasks` rewrite + `DeptInbox`. Work becomes addressable.
3. Escalation + digests (email only — SMS stays disarmed).
4. Handoff rejection + `stage_gate`.
5. `CrewJobView` + warranty stamp. *(Do this before cutover regardless of RFMS — it is the legal exposure and it depends on nothing external.)*
6. RFMS writes: schedule push, PO ETA polling. Gated on Web API entitlement + Enterprise tier, both currently absent.

Steps 1–5 need **no RFMS credentials at all**. Only the material-freshness rules (`requires_rfms = true`) and step 6 wait on the entitlement — which means the un-droppable guarantee ships before the integration does.