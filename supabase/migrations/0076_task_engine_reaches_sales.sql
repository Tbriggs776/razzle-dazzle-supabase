-- ─────────────────────────────────────────────────────────────────────────────
-- 0076 — The reconciler reaches SALES, plus four defects the 2026-08-28 audit
--        found in my own 0069.
--
-- 1. reconcile_tasks() filtered `coalesce(subject_type,'project') = 'project'`,
--    so the three sale rules (deposit_confirm, place_rfms_order, collect_balance)
--    were skipped. Verified live: 3 rules, 0 tasks, ever.
--    job_stage ALREADY carries sale_id — it is `sale JOIN project` — so a sale
--    rule needs no new view, only the right subject id off the same row.
--
-- 2. The due-date clamp did not do what its own comment said. The comment reads
--    "give them the full window from now"; the code was
--    `now() + least(due_in_hours, 24)`. A 168h weekly-touch rule was handed over
--    due in 24h, so every task on the board shared one due date and a weekly rule
--    went red the next morning. The storm this clamp was written to prevent is
--    already prevented by the escalation guard below it (a task must also have
--    EXISTED for its window), so the cap was both wrong and redundant.
--
-- 3. job_stage.on_hold was `installation_date_status IS NOT NULL`, but the
--    "Clear Status" button writes '' rather than null. flow.js trims before
--    comparing, so '' reads as NOT on hold and the boards move the job forward,
--    while this view reads '' as STILL on hold and the reconciler skips it
--    forever. Green everywhere, zero tasks. Fixed on the DB side here; the button
--    is fixed in the same commit. Both, or it comes back the next time either
--    side is edited.
--
-- 4. stage_since cast three DATE columns straight to timestamptz. The server is
--    UTC, so midnight-on-a-date became 17:00 the previous day in Phoenix,
--    shifting every due date and escalation window 7 hours early. Only the three
--    genuine `date` columns are touched — qa_in_progress_date, sale_date and
--    created_date are already timestamptz and are left alone.
--
-- Also: complete_task() refused legacy follow-up tasks. Those carry `assigned_to`
-- (a team_member id) rather than `assigned_user` (a login), so v_owner was null
-- and a Design Consultant could not close their own follow-up. Routing MyTasks
-- through the RPC without this would have been a regression, not a fix.
--
-- NOTE: `create or replace view` DROPS reloptions — the 0057 lesson. job_stage is
-- security_invoker=true and MUST be set again below, or the view silently starts
-- running as owner and bypassing RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. job_stage: honest hold predicate, Phoenix-correct stage_since ──────────
create or replace view public.job_stage as
with mat as (
  select r.document_number,
         count(*) filter (where (ls.value #>> '{}') = any (array['None','GenPO','OnOrder'])) as pre_receipt,
         count(*) as total
    from public.rfms_order_status r
    cross join lateral jsonb_array_elements(coalesce(r.line_statuses, '[]'::jsonb)) ls(value)
   group by r.document_number
)
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
join public.project p on p.sale = s.id
left join mat m on m.document_number = nullif(btrim(coalesce(s.invoice_number, '')), '')
where coalesce(s.is_cancelled, false) = false
  and coalesce(p.status, '') <> 'Cancelled'
  and p.cancelled_date is null;

alter view public.job_stage set (security_invoker = true);

-- ── 2. A completed follow-up must not block the next one ─────────────────────
-- The index was unconditional on (appointment) where type='follow_up', so logging
-- a SECOND follow-up on an appointment threw — after the customer note had
-- already committed, leaving the note saved and the task lost.
drop index if exists public.uq_task_followup;
create unique index uq_task_followup
  on public.task (appointment)
  where type = 'follow_up' and completed_at is null;

-- ── 3. complete_task() understands legacy ownership ──────────────────────────
create or replace function public.complete_task(p_task_id text, p_resolution text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text; v_owner uuid; v_legacy text; v_is_owner boolean;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  select assigned_user, assigned_to into v_owner, v_legacy
    from public.task where id = p_task_id;

  -- Ownership has two shapes. Rule tasks carry assigned_user (a login). Legacy
  -- appointment follow-ups carry assigned_to (a team_member row). Both are "this
  -- is my work" and both must be closable by the person holding them.
  v_is_owner := v_owner is not distinct from v_uid
                or (v_legacy is not null and exists (
                      select 1 from public.team_member tm
                       where tm.id = v_legacy
                         and lower(tm.email) = lower(coalesce(public.jwt_email(), ''))
                    ));

  if not (v_is_owner or public.is_org_admin() or public.can_edit('projects')) then
    raise exception 'Not authorized to complete this task';
  end if;

  update public.task
     set completed_at = now(), completed_by = v_uid, status = 'completed',
         state = 'done', resolution = p_resolution, resolved_at = now(), updated_date = now()
   where id = p_task_id and completed_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'missing or already complete'); end if;

  insert into public.task_log (task_id, action, actor, actor_email, detail)
  values (p_task_id, 'completed', v_uid, v_actor,
          coalesce(p_resolution, '') || case when not v_is_owner then ' [closed by another user]' else '' end);

  update public.notification
     set acknowledged_at = now(), acknowledged_by = v_uid
   where dedupe_key = 'task:' || p_task_id and acknowledged_at is null;

  return jsonb_build_object('ok', true);
end $$;

-- Reopening has the same ownership question, so it gets the same answer.
create or replace function public.reopen_task(p_task_id text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text; v_owner uuid; v_legacy text; v_is_owner boolean;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  select assigned_user, assigned_to into v_owner, v_legacy
    from public.task where id = p_task_id;

  v_is_owner := v_owner is not distinct from v_uid
                or (v_legacy is not null and exists (
                      select 1 from public.team_member tm
                       where tm.id = v_legacy
                         and lower(tm.email) = lower(coalesce(public.jwt_email(), ''))
                    ));

  if not (v_is_owner or public.is_org_admin() or public.can_edit('projects')) then
    raise exception 'Not authorized to reopen this task';
  end if;

  update public.task
     set completed_at = null, completed_by = null, status = 'pending',
         state = 'open', resolution = null, resolved_at = null, updated_date = now()
   where id = p_task_id and completed_at is not null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'missing or already open'); end if;

  insert into public.task_log (task_id, action, actor, actor_email, detail)
  values (p_task_id, 'note', v_uid, v_actor, 'Reopened' || coalesce(': ' || p_reason, ''));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.reopen_task(text, text) from public, anon;
grant execute on function public.reopen_task(text, text) to authenticated, service_role;

-- ── 4. The reconciler reaches sales ──────────────────────────────────────────
create or replace function public.reconcile_tasks()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_opened int := 0; v_closed int := 0; v_escalated int := 0; v_skipped_hold int := 0;
  j record; r record; t record; v_owners uuid[]; v_owner uuid; v_task text; v_due timestamptz;
  v_subject_type text; v_subject_id text;
begin
  for j in select * from public.job_stage loop
    if j.on_hold then
      v_skipped_hold := v_skipped_hold + 1;
      continue;
    end if;

    -- One job_stage row is BOTH a project and its sale. A rule says which of the
    -- two it hangs its work on; the stage is the same either way.
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
      -- Never hand someone a task that is already overdue the moment it appears.
      -- If the stage began long ago, the clock starts now and they get the FULL
      -- window — not a 24h stub, which is what this used to do.
      v_due    := greatest(
                    j.stage_since + make_interval(hours => coalesce(r.due_in_hours, 48)),
                    now() + make_interval(hours => coalesce(r.due_in_hours, 48))
                  );
      v_task   := null;

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

  -- Close what the job has moved past. Matched on whichever key the task hangs on.
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
       -- The task must also have EXISTED for its window, or a backlog import
       -- escalates everything on the first run.
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

  return jsonb_build_object('opened', v_opened, 'closed', v_closed,
                            'escalated', v_escalated, 'skipped_on_hold', v_skipped_hold);
end $$;
