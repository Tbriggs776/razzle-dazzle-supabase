-- ─────────────────────────────────────────────────────────────────────────
-- 0119 — Ops Flow seed (the v1 freeze) + the classifier cutover.
--
-- 1. Publishes graph v1 for org_fd: a VERBATIM freeze of src/lib/ops/flow.js
--    STAGES/DEPARTMENTS/STAGE_TONE as they sit on HEAD. Not OPERATING_MODEL,
--    not a cleaned-up spine. sla_hours = sla_days x 24 CLOCK hours (the spec's
--    documented v1 choice; no business-hours calendar exists to convert with).
-- 2. Rewrites job_stage so stage IDENTITY (label, owner, SLA, tone, sort,
--    terminal) comes from ops_stage, while the PREDICATES stay in this view's
--    CASE — the only copy anywhere. The 0069 "two copies must change together"
--    debt ends here: flow.js's CASE is deleted in the same PR.
--
-- POPULATION FIX, measured not assumed: 0069/0076 joined sale INNER JOIN
-- project, but the JS board classifies every non-cancelled sale — and live data
-- has 6 sales with no live project. Line-for-line was never true at the
-- population level. The view now LEFT JOINs live projects, which classifies
-- project-less sales EXACTLY as flow.js did (all p.* predicates read null and
-- the CASE falls through to the invoice/material tests — identical semantics to
-- classifyJob's null project). The CASE itself is byte-identical to 0076.
--
-- WHAT DID NOT CHANGE: the reconciler's input. reconcile_tasks() is regenerated
-- from the live 0078 body (md5-verified against production before patching)
-- with `project_id is not null` filters on both of its job_stage reads, so the
-- task engine sees the same rows it saw yesterday. Letting the engine reach
-- project-less sales is a real decision about opening new tasks on live jobs —
-- deliberately NOT bundled into a freeze whose contract is "nothing moves".
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Seed: publish v1 (the freeze) ────────────────────────────────────
do $seed$
declare
  v_graph jsonb;
  v_flow_id text;
begin
  v_graph := jsonb_build_object(
    'departments', jsonb_build_array(
      jsonb_build_object('key','sales',      'label','Sales',               'sort_order',1),
      jsonb_build_object('key','ordering',   'label','Ordering',            'sort_order',2),
      jsonb_build_object('key','scheduling', 'label','Scheduling',          'sort_order',3),
      jsonb_build_object('key','install',    'label','Install',             'sort_order',4),
      jsonb_build_object('key','cx',         'label','Customer Experience', 'sort_order',5),
      jsonb_build_object('key','finance',    'label','Finance',             'sort_order',6)),
    'stages', jsonb_build_array(
      jsonb_build_object('key','to_order','label','To Order','owner_dept','ordering','sla_hours',48,'sort_order',1,'is_terminal',false,'tone','warn','classifier_key','to_order','blurb','Sold — needs placing in RFMS'),
      jsonb_build_object('key','awaiting_material','label','Awaiting Material','owner_dept','ordering','sla_hours',336,'sort_order',2,'is_terminal',false,'tone','info','classifier_key','awaiting_material','blurb','Ordered — material not received'),
      jsonb_build_object('key','ready_to_schedule','label','Ready to Schedule','owner_dept','scheduling','sla_hours',72,'sort_order',3,'is_terminal',false,'tone','warn','classifier_key','ready_to_schedule','blurb','Material ready — no install date'),
      jsonb_build_object('key','scheduled','label','Scheduled','owner_dept','install','sla_hours',null,'sort_order',4,'is_terminal',false,'tone','info','classifier_key','scheduled','blurb','On the calendar'),
      jsonb_build_object('key','in_progress','label','In Progress','owner_dept','install','sla_hours',48,'sort_order',5,'is_terminal',false,'tone','info','classifier_key','in_progress','blurb','Crew on site'),
      jsonb_build_object('key','qa','label','QA / Walkthrough','owner_dept','install','sla_hours',72,'sort_order',6,'is_terminal',false,'tone','warn','classifier_key','qa','blurb','Installed — needs sign-off'),
      jsonb_build_object('key','cx_followup','label','Customer Follow-up','owner_dept','cx','sla_hours',48,'sort_order',7,'is_terminal',false,'tone','info','classifier_key','cx_followup','blurb','Complete — needs the follow-up call'),
      jsonb_build_object('key','complete','label','Complete','owner_dept',null,'sla_hours',null,'sort_order',8,'is_terminal',true,'tone','good','classifier_key','complete','blurb','Closed out')),
    'edges', jsonb_build_array(
      jsonb_build_object('from','to_order','to','awaiting_material','sort_order',1),
      jsonb_build_object('from','awaiting_material','to','ready_to_schedule','sort_order',2),
      jsonb_build_object('from','ready_to_schedule','to','scheduled','sort_order',3),
      jsonb_build_object('from','scheduled','to','in_progress','sort_order',4),
      jsonb_build_object('from','in_progress','to','qa','sort_order',5),
      jsonb_build_object('from','qa','to','cx_followup','sort_order',6),
      jsonb_build_object('from','cx_followup','to','complete','sort_order',7)));

  -- Not publish_ops_flow(): that RPC demands an org-admin JWT and a migration
  -- has none. Same steps, done directly, published_by null (system).
  insert into public.ops_flow (org_id, current_version, published_at, published_by)
  values ('org_fd', 1, now(), null)
  returning id into v_flow_id;

  insert into public.ops_flow_version (flow_id, version, graph, note, published_by)
  values (v_flow_id, 1, v_graph, 'v1 freeze of flow.js STAGES on 2026-08-30', null);

  perform public.ops_rebuild_from_graph('org_fd', v_graph);

  insert into public.ops_flow_audit (org_id, actor, action, detail)
  values ('org_fd', null, 'publish',
          jsonb_build_object('version', 1, 'note', 'v1 freeze of flow.js STAGES on 2026-08-30', 'via', 'migration 0119'));
end $seed$;

-- ── 2. job_stage: one classifier, identity from the published graph ──────────
-- CASE byte-identical to 0076. LEFT JOIN per the header. Existing columns keep
-- their exact names/types/positions; identity columns are appended.
-- Single-org note: sale/project carry no org_id, so the identity join is on
-- classifier_key alone — ops_stage(org_id, classifier_key) is unique and one
-- org exists. Multi-org needs org on the operational tables first (spec: one
-- graph per org until location exists).

create or replace view public.job_stage as
with mat as (
  select r.document_number,
         count(*) filter (where (ls.value #>> '{}') = any (array['None','GenPO','OnOrder'])) as pre_receipt,
         count(*) as total
    from public.rfms_order_status r
    cross join lateral jsonb_array_elements(coalesce(r.line_statuses, '[]'::jsonb)) ls(value)
   group by r.document_number
), base as (
select
  s.id as sale_id,
  p.id as project_id,
  s.customer,
  s.sale_amount,
  case
    when p.actual_completion_date is not null or p.status = 'Completed' then
      case
        when p.check_in_completed_date is not null or p.welcome_call_completed_date is not null
          then 'complete'
        else 'cx_followup'
      end
    when p.qa_in_progress_date is not null or p.status = 'Quality Checks' then 'qa'
    when p.actual_start_date is not null
      or p.status = 'In Progress'
      or (coalesce(p.installation_date, p.scheduled_start_date) is not null
          and coalesce(p.installation_date, p.scheduled_start_date)
              <= (now() at time zone 'America/Phoenix')::date)
      then 'in_progress'
    when coalesce(p.installation_date, p.scheduled_start_date) is not null then 'scheduled'
    when nullif(btrim(coalesce(s.invoice_number, '')), '') is null then 'to_order'
    when coalesce(m.pre_receipt, 0::bigint) > 0 then 'awaiting_material'
    else 'ready_to_schedule'
  end as stage,
  -- A local calendar date means midnight IN PHOENIX, not midnight UTC.
  coalesce(
    (p.actual_completion_date::timestamp) at time zone 'America/Phoenix',
    p.qa_in_progress_date,
    (p.actual_start_date::timestamp) at time zone 'America/Phoenix',
    (coalesce(p.installation_date, p.scheduled_start_date)::timestamp) at time zone 'America/Phoenix',
    s.sale_date,
    p.created_date
  ) as stage_since,
  coalesce(p.installation_date, p.scheduled_start_date) as install_date,
  -- '' is not a hold. Parenthesised deliberately: these are two independent
  -- hold kinds, and only the pending-cancellation one is released by
  -- hold_cleared_date.
  (
    nullif(btrim(coalesce(p.installation_date_status, '')), '') is not null
    or (p.pending_cancellation_date is not null and p.hold_cleared_date is null)
  ) as on_hold
from public.sale s
left join public.project p
       on p.sale = s.id
      and coalesce(p.status, '') <> 'Cancelled'
      and p.cancelled_date is null
left join mat m on m.document_number = nullif(btrim(coalesce(s.invoice_number, '')), '')
where coalesce(s.is_cancelled, false) = false
)
select
  b.sale_id, b.project_id, b.customer, b.sale_amount, b.stage, b.stage_since,
  b.install_date, b.on_hold,
  os.label      as stage_label,
  os.owner_dept as owner_dept,
  os.sla_hours  as sla_hours,
  os.tone       as tone,
  os.sort_order as sort_order,
  os.is_terminal as is_terminal
from base b
left join public.ops_stage os on os.classifier_key = b.stage;

comment on view public.job_stage is
  'THE classifier — the only stage derivation in the system (flow.js reads this view; its CASE is deleted). Predicates live in this CASE and nowhere else; identity (label/owner/SLA/tone) joins the published ops_stage graph. Population: every non-cancelled sale, one row per live project, project columns null when a sale has none.';

-- create-or-replace DROPS reloptions (the 0057 lesson) — set it again or the
-- view silently starts running as owner and bypassing RLS.
alter view public.job_stage set (security_invoker = true);

-- ── 3. reconcile_tasks: same input rows as yesterday ─────────────────────
-- Regenerated from the LIVE 0078 body (md5 45255d401ce8a3785adde37efcd445a4,
-- verified file == production before patching). The ONLY changes are the two
-- `project_id is not null` filters described in the header.

create or replace function public.reconcile_tasks()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_opened int := 0; v_closed int := 0; v_escalated int := 0; v_skipped_hold int := 0;
  j record; r record; t record; v_owners uuid[]; v_owner uuid; v_task text; v_due timestamptz;
  v_subject_type text; v_subject_id text; v_install timestamptz; v_claims jsonb;
begin
  for j in select * from public.job_stage where project_id is not null loop
    if j.on_hold then
      v_skipped_hold := v_skipped_hold + 1;
      continue;
    end if;

    v_install := case when j.install_date is not null
                      then (j.install_date::timestamp) at time zone 'America/Phoenix' end;

    for r in select * from public.task_rule
              where is_active and stage = j.stage
                and coalesce(subject_type, 'project') in ('project', 'sale')
    loop
      v_subject_type := coalesce(r.subject_type, 'project');
      v_subject_id   := case when v_subject_type = 'sale' then j.sale_id else j.project_id end;

      if v_subject_id is null then continue; end if;

      if exists (select 1 from public.task
                  where rule_key = r.rule_key and subject_type = v_subject_type
                    and subject_id = v_subject_id and completed_at is null) then
        continue;
      end if;

      v_owners := public.resolve_owners(r.dept, r.assigned_role);
      v_owner  := v_owners[1];

      v_due := greatest(
                 j.stage_since + make_interval(hours => coalesce(r.due_in_hours, 48)),
                 now() + make_interval(hours => coalesce(r.due_in_hours, 48))
               );
      if v_install is not null and v_install > now() then
        v_due := least(v_due, v_install);
      end if;
      v_due := greatest(v_due, now() + interval '1 hour');

      v_task := null;

      insert into public.task (type, status, state, notes, dept, assigned_role, assigned_user,
                               subject_type, subject_id, due_at, priority, rule_key, stage,
                               source, created_reason, escalate_after_hours)
      values ('work', 'pending', 'open', coalesce(r.description, r.label), r.dept, r.assigned_role,
              v_owner, v_subject_type, v_subject_id, v_due, coalesce(r.priority, 3), r.rule_key, r.stage,
              'rule',
              jsonb_build_object('title', r.label, 'via', 'reconciler', 'stage', j.stage),
              r.escalate_after_hours)
      on conflict do nothing
      returning id into v_task;

      if v_task is not null then
        v_opened := v_opened + 1;
        insert into public.task_log (task_id, action, actor_email, detail)
        values (v_task, 'created', 'system:reconciler',
                r.label || ' — opened because the job entered ' || j.stage);
        foreach v_owner in array v_owners loop
          perform public.notify(v_owner, r.label, r.description, 'task', 'info',
                                v_subject_type, v_subject_id, '/Work', r.rule_key,
                                'task:' || v_task, false);
        end loop;
      end if;
    end loop;
  end loop;

  for t in
    select tk.id, tk.rule_key, tk.subject_type, tk.subject_id, tr.label, js.stage as current_stage
      from public.task tk
      join public.task_rule tr on tr.rule_key = tk.rule_key
      left join (select * from public.job_stage where project_id is not null) js
             on (tk.subject_type = 'project' and js.project_id = tk.subject_id)
             or (tk.subject_type = 'sale'    and js.sale_id    = tk.subject_id)
     where tk.completed_at is null and tk.source = 'rule'
       and tk.subject_type in ('project', 'sale') and tr.stage is not null
       and (js.project_id is null or js.stage is distinct from tr.stage)
  loop
    update public.task
       set completed_at = now(), status = 'completed', state = 'done',
           resolution = 'Closed automatically: the job moved to '
                        || coalesce(t.current_stage, 'a closed/cancelled state'),
           resolved_at = now(), updated_date = now()
     where id = t.id;
    v_closed := v_closed + 1;
    insert into public.task_log (task_id, action, actor_email, detail)
    values (t.id, 'completed', 'system:reconciler',
            'Stage advanced to ' || coalesce(t.current_stage, 'closed') || '; work no longer applies.');
    update public.notification set acknowledged_at = now()
     where dedupe_key = 'task:' || t.id and acknowledged_at is null;
  end loop;

  for t in
    select tk.id, tk.subject_type, tk.subject_id, tk.escalate_after_hours, tk.due_at,
           tr.label, tr.escalate_to_dept, tr.assigned_role
      from public.task tk
      join public.task_rule tr on tr.rule_key = tk.rule_key
     where tk.completed_at is null
       and tk.escalate_after_hours is not null
       and tk.due_at is not null
       and now() > tk.due_at + make_interval(hours => tk.escalate_after_hours)
       and now() > tk.created_date + make_interval(hours => tk.escalate_after_hours)
       and coalesce(tk.escalation_level, 0) < 1
  loop
    update public.task
       set escalation_level = coalesce(escalation_level, 0) + 1, updated_date = now()
     where id = t.id;
    v_escalated := v_escalated + 1;
    insert into public.task_log (task_id, action, actor_email, detail)
    values (t.id, 'note', 'system:reconciler',
            'Escalated to ' || coalesce(t.escalate_to_dept, 'management')
            || ' — overdue by more than ' || t.escalate_after_hours || 'h.');
    v_owners := public.resolve_owners(t.escalate_to_dept, t.assigned_role);
    foreach v_owner in array v_owners loop
      perform public.notify(v_owner, 'Overdue: ' || t.label,
                            'This has been open past its escalation window.',
                            'task', 'warn', coalesce(t.subject_type, 'project'), t.subject_id,
                            '/Work', 'escalation', 'escalation:' || t.id, true);
    end loop;
  end loop;

  v_claims := public.reconcile_claim_tasks();

  return jsonb_build_object('opened', v_opened, 'closed', v_closed,
                            'escalated', v_escalated, 'skipped_on_hold', v_skipped_hold)
         || v_claims;
end $$;

revoke all on function public.reconcile_tasks() from public, anon, authenticated;
grant execute on function public.reconcile_tasks() to service_role;
