-- ─────────────────────────────────────────────────────────────────────────────
-- 0069 — The reconciler. Slice 3.
--
-- 21 task rules encode the entire operating model and NOT ONE has ever fired,
-- because nothing anywhere reads task_rule. This is the engine that does.
--
-- ⚠️ KNOWN DEBT, stated plainly: stage derivation now exists TWICE — here, and
-- in src/lib/ops/flow.js classifyJob(). They are ported line-for-line from each
-- other today and MUST be changed together. The right end state is flow.js
-- reading this view so there is one definition; that refactor is deliberately
-- not bundled into this migration. If they drift, the boards and the tasks will
-- disagree about what stage a job is in, which is worse than either being wrong.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.job_stage as
with mat as (
  -- Pre-receipt line count per invoice, mirroring metrics.materialIndex():
  -- PRE_RECEIPT = None | GenPO | OnOrder. rfms_order_status is empty until RFMS
  -- is credentialed, so material NEVER holds a job today — deliberately the same
  -- behaviour as flow.js, which only holds on real data.
  select r.document_number,
         count(*) filter (where ls.value #>> '{}' in ('None','GenPO','OnOrder')) as pre_receipt,
         count(*) as total
    from public.rfms_order_status r
    cross join lateral jsonb_array_elements(coalesce(r.line_statuses, '[]'::jsonb)) as ls(value)
   group by r.document_number
)
select
  s.id  as sale_id,
  p.id  as project_id,
  s.customer,
  s.sale_amount,
  case
    when (p.actual_completion_date is not null or p.status = 'Completed')
      then case
             when (p.check_in_completed_date is not null or p.welcome_call_completed_date is not null)
               then 'complete' else 'cx_followup'
           end
    when (p.qa_in_progress_date is not null or p.status = 'Quality Checks') then 'qa'
    when (p.actual_start_date is not null or p.status = 'In Progress'
          or (coalesce(p.installation_date, p.scheduled_start_date) is not null
              and coalesce(p.installation_date, p.scheduled_start_date)
                  <= (now() at time zone 'America/Phoenix')::date))
      then 'in_progress'
    when coalesce(p.installation_date, p.scheduled_start_date) is not null then 'scheduled'
    when nullif(btrim(coalesce(s.invoice_number, '')), '') is null then 'to_order'
    when coalesce(m.pre_receipt, 0) > 0 then 'awaiting_material'
    else 'ready_to_schedule'
  end as stage,
  coalesce(
    p.actual_completion_date::timestamptz,
    p.qa_in_progress_date::timestamptz,
    p.actual_start_date::timestamptz,
    coalesce(p.installation_date, p.scheduled_start_date)::timestamptz,
    s.sale_date,
    p.created_date
  ) as stage_since,
  coalesce(p.installation_date, p.scheduled_start_date) as install_date,
  -- Every value of installation_date_status stops a job; a held job must not
  -- accrue new work, or the queue fills with things nobody is allowed to do.
  (p.installation_date_status is not null
   or (p.pending_cancellation_date is not null and p.hold_cleared_date is null)) as on_hold
from public.sale s
join public.project p on p.sale = s.id
left join mat m on m.document_number = nullif(btrim(coalesce(s.invoice_number, '')), '')
where coalesce(s.is_cancelled, false) = false
  and coalesce(p.status, '') <> 'Cancelled'
  and p.cancelled_date is null;

comment on view public.job_stage is
  'Server-side stage derivation, ported line-for-line from src/lib/ops/flow.js classifyJob(). THESE TWO MUST CHANGE TOGETHER until flow.js is repointed at this view. Drift means the boards and the task engine disagree about where a job is.';

revoke all on public.job_stage from anon;
grant select on public.job_stage to authenticated, service_role;
alter view public.job_stage set (security_invoker = true);

-- ── The reconciler ───────────────────────────────────────────────────────────
-- Idempotent by construction: one OPEN task per (rule_key, subject). Running it
-- twice changes nothing; running it after a stage change opens the new work and
-- closes the work the stage moved past.
create unique index if not exists task_rule_subject_open_uq
  on public.task (rule_key, subject_type, subject_id)
  where completed_at is null and rule_key is not null;

create or replace function public.reconcile_tasks()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_opened int := 0; v_closed int := 0; v_escalated int := 0; v_skipped_hold int := 0;
  j record; r record; t record; v_owners uuid[]; v_owner uuid; v_task text; v_due timestamptz;
begin
  -- 1. OPEN the work each live job's current stage calls for.
  for j in select * from public.job_stage loop
    if j.on_hold then
      v_skipped_hold := v_skipped_hold + 1;
      continue;   -- a held job accrues no new work
    end if;

    for r in select * from public.task_rule
              where is_active and stage = j.stage
                and coalesce(subject_type, 'project') = 'project'
    loop
      if exists (select 1 from public.task
                  where rule_key = r.rule_key and subject_type = 'project'
                    and subject_id = j.project_id and completed_at is null) then
        continue;
      end if;

      v_owners := public.resolve_owners(r.dept, r.assigned_role);
      v_owner  := v_owners[1];
      -- Never hand someone a task that is already overdue the moment it appears:
      -- if the stage began long ago, give them the full window from now.
      v_due    := greatest(
                    j.stage_since + make_interval(hours => coalesce(r.due_in_hours, 48)),
                    now() + make_interval(hours => least(coalesce(r.due_in_hours, 48), 24))
                  );
      v_task   := null;

      insert into public.task (type, status, state, notes, dept, assigned_role, assigned_user,
                               subject_type, subject_id, due_at, priority, rule_key, stage,
                               source, created_reason, escalate_after_hours)
      values ('work', 'pending', 'open', coalesce(r.description, r.label), r.dept, r.assigned_role,
              v_owner, 'project', j.project_id, v_due, coalesce(r.priority, 3), r.rule_key, r.stage,
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
                                'project', j.project_id, '/Work', r.rule_key,
                                'task:' || v_task, false);
        end loop;
      end if;
    end loop;
  end loop;

  -- 2. CLOSE work whose stage the job has already left. The stage moving on IS
  --    the completion signal — otherwise every board fills with stale work that
  --    nobody can action because the moment for it has passed.
  for t in
    select tk.id, tk.rule_key, tk.subject_id, tr.label, js.stage as current_stage
      from public.task tk
      join public.task_rule tr on tr.rule_key = tk.rule_key
      left join public.job_stage js on js.project_id = tk.subject_id
     where tk.completed_at is null and tk.source = 'rule'
       and tk.subject_type = 'project' and tr.stage is not null
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

  -- 3. ESCALATE what has sat too long. One escalation per task per level, so a
  --    daily run does not re-nag; the level itself is the idempotency key.
  for t in
    select tk.id, tk.subject_id, tk.escalate_after_hours, tk.due_at,
           tr.label, tr.escalate_to_dept, tr.assigned_role
      from public.task tk
      join public.task_rule tr on tr.rule_key = tk.rule_key
     where tk.completed_at is null
       and tk.escalate_after_hours is not null
       and tk.due_at is not null
       and now() > tk.due_at + make_interval(hours => tk.escalate_after_hours)
       -- The task must ALSO have existed for its window. Without this, the first
       -- run against a real backlog escalates everything at once — an alert storm
       -- on day one, which is what makes people stop trusting the system.
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
                            'task', 'warn', 'project', t.subject_id, '/Work',
                            'escalation', 'escalation:' || t.id, true);
    end loop;
  end loop;

  return jsonb_build_object('opened', v_opened, 'closed', v_closed,
                            'escalated', v_escalated, 'skipped_on_hold', v_skipped_hold);
end $$;

revoke all on function public.reconcile_tasks() from public, anon, authenticated;
grant execute on function public.reconcile_tasks() to service_role;
