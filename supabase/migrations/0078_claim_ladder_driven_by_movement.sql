-- ─────────────────────────────────────────────────────────────────────────────
-- 0078 — The repair ladder, driven by MOVEMENT rather than the calendar.
--
-- The 8 claim rules have stage = null: they are a time ladder (8h/32h/56h/80h),
-- not a stage machine, so 0076's stage-matching pass could never reach them.
-- Verified before this change: 8 rules, 0 tasks, ever. The escalation process the
-- ROC position depends on had never produced a single record.
--
-- THE OWNER REDEFINED THE GATE (2026-08-29), and this implements what he said
-- rather than what the rules originally encoded:
--
--   "The ROC is only needed if the customer files a complaint. But daily reminders
--    should be required if there is not follow up communication with the customer
--    and the task is becoming stale. Communication with the installer, field
--    manager, customer... something needs to be moving the claim or repair along."
--
-- So: rungs advance on SILENCE, not on the clock. A claim that is moving generates
-- nothing. A claim that goes quiet gets someone nagged every day, indefinitely.
-- And repair_day4_roc comes OFF the automatic ladder entirely — filing with the
-- ROC is a response to a customer complaint, not something a timer decides.
--
-- ── THE TWO TRAPS THIS AVOIDS ────────────────────────────────────────────────
--
-- 1. SELF-SILENCING. The reconciler writes a task_log row every time it opens a
--    task. If that counted as movement, opening a rung would immediately make the
--    claim look active and the ladder would stop itself after one rung. Only
--    HUMAN activity counts: reconciler rows have actor IS NULL, human rows carry
--    a uuid, verified against live data.
--
-- 2. BLOWING THROUGH THE LADDER. The cron runs hourly. If advancement were gated
--    only on "the claim is quiet", then one minute after opening day 2 the claim
--    would still be quiet and day 3 would open, and the whole ladder would burn
--    down in three hours. Advancement therefore requires BOTH that the claim has
--    been quiet for a day AND that the previous rung has itself been open for a
--    day. The clock starts when someone could first have acted.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. What "moving" means, measured ─────────────────────────────────────────
create or replace view public.claim_activity as
select
  c.id            as claim_id,
  c.project       as project_id,
  c.customer_name,
  c.claim_type,
  c.installer_name,
  c.created_date,
  greatest(
    c.created_date,
    coalesce(c.updated_date, c.created_date),
    -- Any call, text or email logged against this claim. communication already
    -- carries claim_id, so this needs no new plumbing.
    coalesce((select max(cm.created_date) from public.communication cm
               where cm.claim_id = c.id), c.created_date),
    -- Anything said in the claim's thread, to any audience.
    coalesce((select max(tm.created_at) from public.thread_message tm
               join public.thread th on th.id = tm.thread_id
              where th.subject_type = 'claim' and th.subject_id = c.id), c.created_date),
    -- A HUMAN acting on one of the claim's tasks. actor is null for anything the
    -- reconciler writes, which is what keeps the ladder from silencing itself.
    coalesce((select max(tl.created_at) from public.task_log tl
               join public.task tk on tk.id = tl.task_id
              where tk.subject_type = 'claim' and tk.subject_id = c.id
                and tl.actor is not null), c.created_date)
  ) as last_activity_at
from public.project_claim c
where coalesce(c.is_completed, false) = false
  and coalesce(c.is_cancelled,  false) = false;

alter view public.claim_activity set (security_invoker = true);

-- ── 2. The rules the owner's answer changes ──────────────────────────────────
-- ROC comes off the timer. Kept as an inactive row rather than deleted so the
-- rung still exists to be raised by hand when a complaint actually arrives.
update public.task_rule
   set is_active = false, updated_date = now(),
       description = 'Raised by hand when a customer files a complaint. NOT automatic: '
                     || 'the owner is explicit that a ROC filing answers a complaint, '
                     || 'not the passage of four days.'
 where rule_key = 'repair_day4_roc';

-- The recurring nag that carries on past day 3 for as long as nothing moves.
insert into public.task_rule
  (rule_key, label, description, subject_type, stage, dept, assigned_role,
   priority, due_in_hours, escalate_after_hours, escalate_to_dept, is_active)
values
  ('repair_stale',
   'This repair has gone quiet — make contact',
   'Nobody has spoken to the installer, the field manager or the customer about this '
   || 'repair in over a day, and it is not finished. Make contact and log it, or close '
   || 'the claim if it is done. Following the process is what keeps us out of a ROC claim.',
   'claim', null, 'cx', 'Customer Experience Coordinator',
   1, 24, 24, 'cx', true)
on conflict (rule_key) do update
  set label = excluded.label, description = excluded.description,
      subject_type = excluded.subject_type, dept = excluded.dept,
      assigned_role = excluded.assigned_role, priority = excluded.priority,
      due_in_hours = excluded.due_in_hours,
      escalate_after_hours = excluded.escalate_after_hours,
      escalate_to_dept = excluded.escalate_to_dept,
      is_active = true, updated_date = now();

-- ── 3. Opening one rung ──────────────────────────────────────────────────────
-- Returns the new task id, or null when the rung already exists or the rule is
-- inactive. p_due_base lets a ladder rung keep the SOP's absolute-day meaning
-- (measured from the claim) while the recurring nag measures from now.
create or replace function public.open_claim_rung(
  p_claim_id text,
  p_rule_key text,
  p_due_base timestamptz,
  p_allow_repeat boolean default false
) returns text language plpgsql security definer set search_path to 'public'
as $$
declare r record; v_owners uuid[]; v_owner uuid; v_task text; v_due timestamptz;
begin
  select * into r from public.task_rule where rule_key = p_rule_key and is_active;
  if not found then return null; end if;

  if p_allow_repeat then
    -- A recurring rung: only one may be OPEN at a time.
    if exists (select 1 from public.task
                where rule_key = p_rule_key and subject_type = 'claim'
                  and subject_id = p_claim_id and completed_at is null) then
      return null;
    end if;
  else
    -- A ladder rung happens ONCE. If it was opened and completed, we did it —
    -- it must not reappear.
    if exists (select 1 from public.task
                where rule_key = p_rule_key and subject_type = 'claim'
                  and subject_id = p_claim_id) then
      return null;
    end if;
  end if;

  v_owners := public.resolve_owners(r.dept, r.assigned_role);
  v_owner  := v_owners[1];
  -- Never born overdue.
  v_due    := greatest(p_due_base + make_interval(hours => coalesce(r.due_in_hours, 24)),
                       now() + interval '1 hour');

  insert into public.task (type, status, state, notes, dept, assigned_role, assigned_user,
                           subject_type, subject_id, due_at, priority, rule_key,
                           source, created_reason, escalate_after_hours)
  values ('work', 'pending', 'open', coalesce(r.description, r.label), r.dept, r.assigned_role,
          v_owner, 'claim', p_claim_id, v_due, coalesce(r.priority, 2), r.rule_key,
          'rule',
          jsonb_build_object('title', r.label, 'via', 'reconciler', 'ladder', 'repair'),
          r.escalate_after_hours)
  on conflict do nothing
  returning id into v_task;

  if v_task is null then return null; end if;

  insert into public.task_log (task_id, action, actor_email, detail)
  values (v_task, 'created', 'system:reconciler', r.label || ' — repair ladder');

  foreach v_owner in array v_owners loop
    perform public.notify(v_owner, r.label, r.description, 'task',
                          case when coalesce(r.priority, 2) <= 1 then 'warn' else 'info' end,
                          'claim', p_claim_id, '/Work', r.rule_key,
                          'task:' || v_task, false);
  end loop;

  return v_task;
end $$;

revoke all on function public.open_claim_rung(text, text, timestamptz, boolean) from public, anon;

-- ── 4. The ladder ────────────────────────────────────────────────────────────
create or replace function public.reconcile_claim_tasks()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  c record; t record;
  v_opened int := 0; v_closed int := 0; v_quiet_claims int := 0;
  v_hours numeric; v_max_day int; v_last_rung timestamptz; v_next int;
begin
  -- Close whatever is still open on claims that are finished. A completed repair
  -- must not keep nagging, and the closure is recorded rather than silent.
  for t in
    select tk.id, tk.subject_id
      from public.task tk
      join public.project_claim pc on pc.id = tk.subject_id
     where tk.subject_type = 'claim' and tk.source = 'rule' and tk.completed_at is null
       and (coalesce(pc.is_completed, false) or coalesce(pc.is_cancelled, false))
  loop
    update public.task
       set completed_at = now(), status = 'completed', state = 'done',
           resolution = 'Closed automatically: the claim is no longer open.',
           resolved_at = now(), updated_date = now()
     where id = t.id;
    v_closed := v_closed + 1;
    insert into public.task_log (task_id, action, actor_email, detail)
    values (t.id, 'completed', 'system:reconciler', 'Claim closed; this step no longer applies.');
    update public.notification set acknowledged_at = now()
     where dedupe_key = 'task:' || t.id and acknowledged_at is null;
  end loop;

  for c in select * from public.claim_activity loop
    v_hours := extract(epoch from (now() - c.last_activity_at)) / 3600.0;

    -- Day 1 is the day the claim opens: triage it, and reach the installer on
    -- BOTH channels. These do not wait for silence — they ARE the first contact.
    if public.open_claim_rung(c.claim_id, 'repair_triage',    c.created_date) is not null
      then v_opened := v_opened + 1; end if;
    if public.open_claim_rung(c.claim_id, 'repair_day1_call', c.created_date) is not null
      then v_opened := v_opened + 1; end if;
    if public.open_claim_rung(c.claim_id, 'repair_day1_text', c.created_date) is not null
      then v_opened := v_opened + 1; end if;

    -- Everything past day 1 is a response to SILENCE.
    if v_hours < 24 then
      continue;
    end if;
    v_quiet_claims := v_quiet_claims + 1;

    select coalesce(max((regexp_match(rule_key, '^repair_day(\d)_'))[1]::int), 0),
           max(created_date)
      into v_max_day, v_last_rung
      from public.task
     where subject_type = 'claim' and subject_id = c.claim_id
       and rule_key ~ '^repair_day\d_';

    -- The previous rung must itself have been open for a day. Without this the
    -- hourly cron would walk the whole ladder in three hours.
    if v_last_rung is not null and now() < v_last_rung + interval '24 hours' then
      continue;
    end if;

    v_next := coalesce(v_max_day, 0) + 1;

    if v_next between 2 and 3 then
      -- Both channels again, same as day 1. The two-channel record is the point.
      if public.open_claim_rung(c.claim_id, 'repair_day' || v_next || '_call', c.created_date) is not null
        then v_opened := v_opened + 1; end if;
      if public.open_claim_rung(c.claim_id, 'repair_day' || v_next || '_text', c.created_date) is not null
        then v_opened := v_opened + 1; end if;
    else
      -- Past the scripted ladder and still nothing moving. Keep nagging, daily,
      -- for as long as it stays quiet. This is the owner's "daily reminders
      -- should be required" — there is no day on which the system gives up.
      if public.open_claim_rung(c.claim_id, 'repair_stale', now(), true) is not null
        then v_opened := v_opened + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('claim_tasks_opened', v_opened,
                            'claim_tasks_closed', v_closed,
                            'claims_quiet_over_24h', v_quiet_claims);
end $$;

revoke all on function public.reconcile_claim_tasks() from public, anon;
grant execute on function public.reconcile_claim_tasks() to service_role;

-- ── 5. One reconciler, one cron ──────────────────────────────────────────────
-- reconcile_tasks() keeps its project/sale passes verbatim from 0077 and now runs
-- the claim ladder too, so the existing hourly job covers both and the counts come
-- back together.
create or replace function public.reconcile_tasks()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_opened int := 0; v_closed int := 0; v_escalated int := 0; v_skipped_hold int := 0;
  j record; r record; t record; v_owners uuid[]; v_owner uuid; v_task text; v_due timestamptz;
  v_subject_type text; v_subject_id text; v_install timestamptz; v_claims jsonb;
begin
  for j in select * from public.job_stage loop
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
      left join public.job_stage js
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
