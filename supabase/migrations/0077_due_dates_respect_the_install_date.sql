-- ─────────────────────────────────────────────────────────────────────────────
-- 0077 — A pre-install task cannot be due AFTER the install.
--
-- Found by TESTING 0076, not by reading it. For a `scheduled` job, job_stage's
-- stage_since is the INSTALL DATE, which is in the future — so
-- `stage_since + due_in_hours` puts the due date after the install itself.
-- collect_balance ("Collect the balance before install", 48h) came out due 48h
-- PAST the install date, inverting the one money rule the owner is most explicit
-- about: 100% collected before install starts.
--
-- 0069's `least(due_in_hours, 24)` clamp had been masking this by capping
-- everything at now()+24h. Removing that clamp in 0076 was still correct — it was
-- flattening every SLA longer than a day onto a single due date — but it exposed
-- the real defect underneath.
--
-- Two rules added to the due-date calculation:
--   1. While the install is still ahead, no task for that job may be due later
--      than the install.
--   2. Nothing is ever born already overdue (floor of now() + 1 hour).
--
-- Verified in a rolled-back transaction: a sale scheduled to install Sep 03 gets
-- collect_balance due Sep 03 00:00 (previously 48h later), while a to_order sale
-- with no install date keeps its uncapped 24h window.
--
-- KNOWN LIMIT, deliberately not fixed here: stage_since for `scheduled` is the
-- install date rather than the moment scheduling happened, because that moment is
-- not stored. The cap above makes the due dates correct; the underlying model is
-- still approximate, and a `scheduled_at` column would be the real fix.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reconcile_tasks()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_opened int := 0; v_closed int := 0; v_escalated int := 0; v_skipped_hold int := 0;
  j record; r record; t record; v_owners uuid[]; v_owner uuid; v_task text; v_due timestamptz;
  v_subject_type text; v_subject_id text; v_install timestamptz;
begin
  for j in select * from public.job_stage loop
    if j.on_hold then
      v_skipped_hold := v_skipped_hold + 1;
      continue;
    end if;

    v_install := case when j.install_date is not null
                      then (j.install_date::timestamp) at time zone 'America/Phoenix' end;

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

      -- The rule's intent, then the full window if the stage began long ago.
      v_due := greatest(
                 j.stage_since + make_interval(hours => coalesce(r.due_in_hours, 48)),
                 now() + make_interval(hours => coalesce(r.due_in_hours, 48))
               );
      -- Work on a job whose install is still ahead is due BEFORE that install.
      if v_install is not null and v_install > now() then
        v_due := least(v_due, v_install);
      end if;
      -- And never hand over something already overdue.
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
