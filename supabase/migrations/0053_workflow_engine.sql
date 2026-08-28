-- The workflow engine: tasks, approvals, stage-triggered communications, and
-- the deposit gate. This is the backbone for "nothing gets dropped".
--
-- Governing rule (OPERATING_MODEL.md §5): **data closes tasks; tasks never close
-- stages.** classifyJob() in src/lib/ops/flow.js stays the only thing that decides
-- where a job is. A task is a durable, addressable commitment by a named person
-- saying who moves next and by when. Auto tasks vanish when their condition stops
-- being true — nobody "completes" them.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. task — extended, not replaced.
--
-- MyTasks.jsx, uq_task_followup and backfill_followup_tasks() all depend on the
-- existing shape (id, appointment, assigned_to, due_date, status, type, notes),
-- so every column below is additive and the legacy columns keep working.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.task
  add column if not exists subject_type     text,          -- lead | appointment | sale | project | claim
  add column if not exists subject_id       text,
  add column if not exists rule_key         text,          -- which rule minted it (null = manual)
  add column if not exists stage            text,          -- flow.js stage at creation
  add column if not exists dept             text,          -- owning department
  add column if not exists assigned_role    text,          -- role when no person resolves
  add column if not exists priority         integer not null default 3,  -- 0 = drop everything
  add column if not exists source           text not null default 'manual', -- auto | auto_once | manual
  add column if not exists state            text not null default 'open',  -- open | waiting | done | auto_closed | waived
  add column if not exists waiting_on       text,
  add column if not exists waiting_until    date,
  add column if not exists due_at           timestamptz,
  add column if not exists escalate_after_hours integer,
  add column if not exists escalation_level integer not null default 0,
  add column if not exists resolved_at      timestamptz,
  add column if not exists resolution       text,
  add column if not exists created_reason   jsonb;

-- "Waiting" is only legitimate if it names BOTH a party and a date. Without this
-- constraint "waiting" becomes the place work goes to die quietly.
alter table public.task drop constraint if exists task_waiting_needs_reason;
alter table public.task add constraint task_waiting_needs_reason
  check (state <> 'waiting' or (waiting_on is not null and waiting_until is not null));

-- At most ONE live task per (subject, rule) — the reconciler runs every few
-- minutes and must be idempotent. Same proven pattern as uq_task_followup.
create unique index if not exists uq_task_rule
  on public.task (subject_type, subject_id, rule_key)
  where state in ('open','waiting') and rule_key is not null;

create index if not exists task_subject_idx  on public.task (subject_type, subject_id);
create index if not exists task_open_idx     on public.task (state, due_at) where state in ('open','waiting');
create index if not exists task_assignee_idx on public.task (assigned_to, state);
create index if not exists task_dept_idx     on public.task (dept, state);

-- Keep the legacy `status` column in sync so MyTasks.jsx keeps working untouched.
create or replace function public.trg_task_legacy_status()
returns trigger language plpgsql as $$
begin
  new.status := case
    when new.state in ('done','auto_closed','waived') then 'completed'
    else 'pending'
  end;
  if new.due_at is not null and new.due_date is null then
    new.due_date := (new.due_at at time zone 'America/Phoenix')::date;
  end if;
  return new;
end $$;

drop trigger if exists task_legacy_status_trg on public.task;
create trigger task_legacy_status_trg
  before insert or update on public.task
  for each row execute function public.trg_task_legacy_status();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. task_rule — the SLA catalog lives in DATA, so the team can argue about a
-- number and change it without a deploy.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.task_rule (
  rule_key          text primary key,
  label             text not null,
  description       text,
  subject_type      text not null,
  stage             text,               -- flow.js stage this applies to (null = any)
  dept              text not null,
  assigned_role     text,
  source            text not null default 'auto',   -- auto | auto_once
  priority          integer not null default 3,
  due_in_hours      integer,
  escalate_after_hours integer,
  escalate_to_dept  text,
  is_active         boolean not null default true,
  created_date      timestamptz default now(),
  updated_date      timestamptz default now()
);

comment on table public.task_rule is
  'The SLA catalog. Rules are data so a target can be changed by the business without a deploy. due_in_hours/escalate_after_hours are business-hours intentions applied by the reconciler.';

alter table public.task_rule enable row level security;
drop policy if exists task_rule_read  on public.task_rule;
drop policy if exists task_rule_admin on public.task_rule;
create policy task_rule_read on public.task_rule for select to authenticated using (true);
create policy task_rule_admin on public.task_rule for all to authenticated
  using (public.is_org_admin()) with check (public.is_org_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Approvals — a first-class gate, not a disabled button.
--
-- The Sold gate currently lives in a React button's `disabled` attribute (and is
-- reachable around via an ?action=sold deep link). An approval must be a record.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.approval (
  id             text primary key default gen_random_uuid()::text,
  subject_type   text not null,
  subject_id     text not null,
  kind           text not null,          -- deposit_waiver | material_override | back_charge | discount | schedule_override
  requested_by   text,
  requested_at   timestamptz not null default now(),
  reason         text,
  required_dept  text not null,
  required_role  text,
  state          text not null default 'pending',  -- pending | approved | rejected | withdrawn
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text,
  expires_at     timestamptz,
  created_date   timestamptz default now(),
  updated_date   timestamptz default now()
);

create index if not exists approval_subject_idx on public.approval (subject_type, subject_id);
create index if not exists approval_pending_idx on public.approval (state, required_dept) where state = 'pending';

comment on table public.approval is
  'An override is a record with a named grantor and a reason, never a UI affordance. Anything that bypasses a gate leaves one of these behind.';

alter table public.approval enable row level security;
drop policy if exists approval_read on public.approval;
drop policy if exists approval_write on public.approval;
create policy approval_read on public.approval for select to authenticated using (true);
create policy approval_write on public.approval for all to authenticated
  using (public.is_org_admin() or public.can_edit('sales') or public.can_edit('projects') or public.can_edit('finance'))
  with check (public.is_org_admin() or public.can_edit('sales') or public.can_edit('projects') or public.can_edit('finance'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Deposit confirmation — Accounting's check mark.
--
-- Tyler: ordering begins only once the deposit is DEPOSITED, not merely recorded.
-- Sales records the payment at the kitchen table; Accounting confirms it cleared.
-- Order Processing's queue gates on confirmed_at, not on the row existing.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.payment
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text,
  add column if not exists confirm_note text;

comment on column public.payment.confirmed_at is
  'Stamped by Accounting when the money has actually cleared. NULL means recorded-but-not-yet-deposited. Material ordering gates on this, never on the payment row alone.';

create index if not exists payment_unconfirmed_idx on public.payment (sale) where confirmed_at is null;

-- Confirming is an Accounting/admin action even though Sales can record payments.
create or replace function public.confirm_payment(p_payment_id text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_actor text;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not (public.is_org_admin() or public.can_edit('finance')) then
    raise exception 'Only Accounting can confirm a deposit has cleared';
  end if;
  v_actor := coalesce(public.jwt_email(), 'system');
  update public.payment
     set confirmed_at = now(), confirmed_by = v_actor,
         confirm_note = coalesce(p_note, confirm_note), updated_date = now()
   where id = p_payment_id and confirmed_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not found or already confirmed');
  end if;
  return jsonb_build_object('ok', true, 'confirmed_by', v_actor);
end $$;

revoke all on function public.confirm_payment(text, text) from public, anon;
grant execute on function public.confirm_payment(text, text) to authenticated, service_role;

-- Balance view gains cleared-vs-recorded so Order Processing can gate correctly.
create or replace view public.sale_balance as
select
  s.id as sale_id, s.customer, s.sale_date, s.channel,
  coalesce(s.sale_amount, 0)                             as gross_amount,
  coalesce(s.tax_amount, 0)                              as tax_amount,
  coalesce(s.sale_amount, 0) - coalesce(s.tax_amount, 0) as net_amount,
  coalesce(p.paid, 0)                                    as amount_paid,
  coalesce(p.cleared, 0)                                 as amount_cleared,
  coalesce(p.paid, 0) - coalesce(p.cleared, 0)           as amount_pending_clearance,
  coalesce(s.sale_amount, 0) - coalesce(p.paid, 0)       as balance_due,
  p.last_payment_date,
  case
    when coalesce(s.sale_amount, 0) - coalesce(p.paid, 0) <= 0 then 'paid'
    when coalesce(p.paid, 0) = 0                              then 'unpaid'
    else 'partial'
  end as payment_status,
  (coalesce(p.cleared, 0) > 0)                           as deposit_confirmed,
  greatest(0, (current_date - s.sale_date::date))        as days_since_sale
from public.sale s
left join (
  select sale,
         sum(amount) as paid,
         sum(amount) filter (where confirmed_at is not null) as cleared,
         max(payment_date) as last_payment_date
  from public.payment group by sale
) p on p.sale = s.id
where coalesce(s.is_cancelled, false) = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Communications that resolve back to the customer.
--
-- communication could attach to lead/customer/appointment but NOT to a project
-- or a claim — which is why nothing rolls up into "what is going on with this
-- job". These columns are what make a customer timeline possible.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.communication
  add column if not exists project_id       text,
  add column if not exists claim_id         text,
  add column if not exists rule_key         text,   -- which comms rule sent it (null = human)
  add column if not exists visible_to_customer boolean not null default false;

create index if not exists communication_project_idx on public.communication (project_id) where project_id is not null;
create index if not exists communication_claim_idx   on public.communication (claim_id)   where claim_id is not null;

comment on column public.communication.visible_to_customer is
  'Whether this message appears in the customer portal timeline. Internal notes and staff alerts stay false; the customer sees a curated thread, not the whole log.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. comms_rule — automated customer messaging, driven by stage transitions.
--
-- Today notifications fire from browser click handlers, so closing a tab means
-- the customer is never told and nobody finds out. Rules live in data and are
-- fired server-side by the reconciler through the durable queue, which already
-- honours the SMS arm switch and quiet hours (migration 0048).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.comms_rule (
  rule_key        text primary key,
  label           text not null,
  trigger_kind    text not null,          -- stage_enter | stage_age | claim_event | manual
  stage           text,
  claim_event     text,
  audience        text not null default 'customer',  -- customer | installer | staff
  channel         text not null default 'sms',       -- sms | email | both
  delay_hours     integer not null default 0,
  subject_template text,
  body_template   text not null,
  visible_to_customer boolean not null default true,
  is_active       boolean not null default false,    -- OFF by default; enable deliberately
  created_date    timestamptz default now(),
  updated_date    timestamptz default now()
);

comment on table public.comms_rule is
  'Stage-triggered customer messaging. is_active defaults FALSE so connecting Twilio does not immediately release a backlog of messages about historical jobs.';

alter table public.comms_rule enable row level security;
drop policy if exists comms_rule_read  on public.comms_rule;
drop policy if exists comms_rule_admin on public.comms_rule;
create policy comms_rule_read on public.comms_rule for select to authenticated using (true);
create policy comms_rule_admin on public.comms_rule for all to authenticated
  using (public.is_org_admin()) with check (public.is_org_admin());

-- Idempotency: one send per (rule, subject) unless the rule is explicitly repeatable.
create table if not exists public.comms_sent (
  id           text primary key default gen_random_uuid()::text,
  rule_key     text not null,
  subject_type text not null,
  subject_id   text not null,
  sent_at      timestamptz not null default now(),
  communication_id text
);
create unique index if not exists uq_comms_sent on public.comms_sent (rule_key, subject_type, subject_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. workflow_exception — the un-droppable invariant, made visible.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.workflow_exception (
  id            text primary key default gen_random_uuid()::text,
  code          text not null,          -- E1..E8
  subject_type  text not null,
  subject_id    text not null,
  detail        text,
  severity      text not null default 'warn',
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz
);

create unique index if not exists uq_workflow_exception
  on public.workflow_exception (code, subject_type, subject_id) where resolved_at is null;
create index if not exists workflow_exception_open_idx on public.workflow_exception (code) where resolved_at is null;

comment on table public.workflow_exception is
  'E1 ORPHAN (nobody holding the job) · E2 UNOWNED · E3 STALE_WAIT · E4 CONTRADICTION · E5 GHOST · E6 UNVERIFIABLE · E7 DEAD_LETTER · E8 CLOCK (install date passed with no completion — the warranty clock never started).';

alter table public.workflow_exception enable row level security;
drop policy if exists workflow_exception_read on public.workflow_exception;
create policy workflow_exception_read on public.workflow_exception
  for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Seed the rules that encode what Tyler described.
--
-- Every task_rule below is derived from the operating model and the repair SOP.
-- comms_rules are seeded INACTIVE — turning customer messaging on is a decision,
-- not a side effect of this migration.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.task_rule (rule_key, label, description, subject_type, stage, dept, assigned_role, source, priority, due_in_hours, escalate_after_hours, escalate_to_dept)
values
  ('deposit_confirm',   'Confirm the deposit cleared', 'Accounting check-marks that the deposit is actually deposited. Material ordering is gated on this.', 'sale', 'to_order', 'finance', 'Finance Manager', 'auto', 2, 24, 48, 'finance'),
  ('place_rfms_order',  'Place the order in RFMS',     'Sold job with no RFMS order number yet.', 'sale', 'to_order', 'ordering', 'Order Processor', 'auto', 2, 24, 48, 'ordering'),
  ('raise_pos',         'Raise vendor POs for material', 'Order exists; material still needs purchasing.', 'project', 'awaiting_material', 'ordering', 'Order Processor', 'auto', 2, 24, 72, 'ordering'),
  ('welcome_call',      'Welcome call to the customer', 'Razzle Dazzle coordinator: welcome call, walk through the construction, confirm the right material was ordered.', 'project', 'awaiting_material', 'cx', 'Customer Experience Coordinator', 'auto_once', 2, 48, 72, 'cx'),
  ('material_update',   'Update the customer on material', 'The quiet stretch between sold and scheduled — keep the customer informed.', 'project', 'awaiting_material', 'cx', 'Customer Experience Coordinator', 'auto', 3, 168, 240, 'cx'),
  ('schedule_install',  'Schedule the install',        'Material is in. Agree a date with the customer and hold a crew.', 'project', 'ready_to_schedule', 'scheduling', 'Operations', 'auto', 1, 48, 72, 'scheduling'),
  ('assign_crew',       'Assign a crew',               'Scheduled with no crew assigned.', 'project', 'scheduled', 'scheduling', 'Operations', 'auto', 1, 24, 48, 'scheduling'),
  ('pre_install_call',  'Pre-install confirmation call', 'Confirm access, expectations and readiness before install day.', 'project', 'scheduled', 'cx', 'Customer Experience Coordinator', 'auto_once', 2, 48, 72, 'cx'),
  ('close_out_install', 'Record completion and walkthrough', 'Install date passed with no completion recorded — this is what starts the lifetime-labor warranty clock.', 'project', 'in_progress', 'install', 'Operations', 'auto', 0, 24, 24, 'install'),
  ('qa_signoff',        'QA sign-off',                 'Final walkthrough submitted and awaiting Field Manager approval. The crew can never approve its own work.', 'project', 'qa', 'install', 'Operations', 'auto', 1, 24, 48, 'install'),
  ('installer_payroll', 'Close out installer payroll', 'Install Coordinator wraps the payroll for this job and submits to Accounting.', 'project', 'qa', 'scheduling', 'Operations', 'auto_once', 3, 72, 120, 'finance'),
  ('cx_followup_call',  'Post-install check-in call',  'Confirm satisfaction and deliver the warranty certificate.', 'project', 'cx_followup', 'cx', 'Customer Experience Coordinator', 'auto', 2, 48, 96, 'cx'),
  ('collect_balance',   'Collect the outstanding balance', 'Job complete with money still owed.', 'sale', null, 'finance', 'Finance Manager', 'auto', 2, 72, 168, 'finance')
on conflict (rule_key) do update set
  label = excluded.label, description = excluded.description, dept = excluded.dept,
  assigned_role = excluded.assigned_role, priority = excluded.priority,
  due_in_hours = excluded.due_in_hours, escalate_after_hours = excluded.escalate_after_hours,
  escalate_to_dept = excluded.escalate_to_dept, updated_date = now();

-- The repair SOP escalation ladder — 2 channels x 3 days, then a decision.
-- This is Floor Daddy's notice-and-cure record; each rung must leave evidence.
insert into public.task_rule (rule_key, label, description, subject_type, dept, assigned_role, source, priority, due_in_hours, escalate_after_hours, escalate_to_dept)
values
  ('repair_triage',      'Triage the repair (small or extensive)', 'Repair Coordinator: take extensive notes, request pictures, then decide small vs extensive.', 'claim', 'cx', 'Customer Experience Coordinator', 'auto', 1, 24, 48, 'cx'),
  ('repair_day1_call',   'Day 1 — call the installer',  'State that there is a repair on a home they are responsible for. Include the address.', 'claim', 'cx', 'Customer Experience Coordinator', 'auto_once', 1, 8,  24, 'cx'),
  ('repair_day1_text',   'Day 1 — text the installer',  'Same message as the call. Include the address.', 'claim', 'cx', 'Customer Experience Coordinator', 'auto_once', 1, 8, 24, 'cx'),
  ('repair_day2_call',   'Day 2 — call again',          'Repeat the Day 1 call verbatim.', 'claim', 'cx', 'Customer Experience Coordinator', 'auto_once', 1, 32, 48, 'cx'),
  ('repair_day2_text',   'Day 2 — text again',          'Repeat the Day 1 text verbatim.', 'claim', 'cx', 'Customer Experience Coordinator', 'auto_once', 1, 32, 48, 'cx'),
  ('repair_day3_call',   'Day 3 — ROC warning voicemail', 'Use the exact script: if you do not wish to warranty your work we will be filing a claim with the ROC if we do not hear back tomorrow.', 'claim', 'cx', 'Customer Experience Coordinator', 'auto_once', 0, 56, 24, 'cx'),
  ('repair_day3_text',   'Day 3 — ROC warning text',    'Use the exact script: we will be filing a claim with the ROC tomorrow.', 'claim', 'cx', 'Customer Experience Coordinator', 'auto_once', 0, 56, 24, 'cx'),
  ('repair_day4_roc',    'Day 4 — ROC claim decision',  'Contact Mike to discuss filing an ROC claim. The ladder is complete and evidenced.', 'claim', 'cx', 'Operations', 'auto_once', 0, 80, 24, 'settings')
on conflict (rule_key) do update set
  label = excluded.label, description = excluded.description, updated_date = now();

-- Customer-facing message templates, seeded OFF.
insert into public.comms_rule (rule_key, label, trigger_kind, stage, audience, channel, delay_hours, subject_template, body_template, is_active)
values
  ('cust_sold_thanks',      'Thanks + what happens next', 'stage_enter', 'to_order', 'customer', 'both', 2,
   'Thanks from Floor Daddy — here''s what happens next',
   'Hi {{first_name}}, thanks for choosing Floor Daddy! We''re ordering your material now. You can follow your project any time here: {{tracker_url}}', false),
  ('cust_material_ordered', 'Material ordered',           'stage_enter', 'awaiting_material', 'customer', 'both', 0,
   'Your flooring is on order',
   'Hi {{first_name}}, your material is on order. We''ll let you know the moment it arrives so we can get you scheduled. Track it here: {{tracker_url}}', false),
  ('cust_ready_to_schedule','Material in — let''s schedule','stage_enter', 'ready_to_schedule', 'customer', 'both', 0,
   'Your flooring has arrived',
   'Great news {{first_name}} — your material is in! We''ll call today to book your installation date.', false),
  ('cust_scheduled',        'Install date confirmed',      'stage_enter', 'scheduled', 'customer', 'both', 0,
   'Your installation is booked',
   'Hi {{first_name}}, your installation is confirmed for {{install_date}}. We''ll send a reminder the day before. {{tracker_url}}', false),
  ('cust_install_tomorrow', 'Day-before reminder',         'stage_age',   'scheduled', 'customer', 'sms', 0,
   null,
   'Hi {{first_name}}, your Floor Daddy install is tomorrow, {{install_date}}. Please clear the rooms and make sure we have access. Questions? Just reply.', false),
  ('cust_complete',         'Install complete + warranty', 'stage_enter', 'cx_followup', 'customer', 'both', 4,
   'Your new floors are in — welcome to the family',
   'Hi {{first_name}}, your installation is complete. Your warranty certificate is attached, and we''ll check in shortly to make sure everything is perfect.', false),
  ('cust_claim_received',   'We''ve got your repair request','claim_event', null, 'customer', 'both', 0,
   'We''ve received your repair request',
   'Hi {{first_name}}, we''ve received your request and our repair coordinator is reviewing it. We''ll be in touch shortly. You can follow it here: {{tracker_url}}', false)
on conflict (rule_key) do update set
  label = excluded.label, subject_template = excluded.subject_template,
  body_template = excluded.body_template, updated_date = now();
