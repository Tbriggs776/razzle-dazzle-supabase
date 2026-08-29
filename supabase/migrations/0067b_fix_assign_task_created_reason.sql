-- ─────────────────────────────────────────────────────────────────────────────
-- 0067b — RECOVERED 2026-08-29 from the live database.
--
-- Applied to production via MCP in an earlier session; the file was never saved,
-- so the repo could not rebuild production. Recovered by dumping
-- pg_get_functiondef(). See the process note at the bottom.
--
-- WHAT IT FIXES: task.created_reason is JSONB, not text. 0067's assign_task wrote
-- a plain string into it and every call raised. Caught by the test, not by review
-- — which is the whole argument for testing an RPC rather than reading it.
-- created_reason now carries a real object: the title, who created it, and the
-- route it came in by. That provenance is what lets a task explain itself later.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_task(
  p_title text,
  p_dept text DEFAULT NULL::text,
  p_assigned_user uuid DEFAULT NULL::uuid,
  p_subject_type text DEFAULT NULL::text,
  p_subject_id text DEFAULT NULL::text,
  p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_priority integer DEFAULT 3,
  p_notes text DEFAULT NULL::text,
  p_role text DEFAULT NULL::text,
  p_rule_key text DEFAULT NULL::text,
  p_route text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor text; v_uid uuid; v_owners uuid[]; v_owner uuid; v_task text; v_n int := 0;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'A task needs a title'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  -- An explicit person wins; otherwise the department's on-call chain decides.
  if p_assigned_user is not null then
    v_owners := array[p_assigned_user];
  else
    v_owners := public.resolve_owners(p_dept, p_role);
  end if;
  v_owner := v_owners[1];

  insert into public.task (type, status, state, notes, dept, assigned_role, assigned_user,
                           subject_type, subject_id, due_at, priority, rule_key, source, created_reason)
  values ('work', 'pending', 'open', coalesce(p_notes, p_title), p_dept, p_role, v_owner,
          p_subject_type, p_subject_id, p_due_at, coalesce(p_priority, 3), p_rule_key,
          'manual',
          jsonb_build_object('title', p_title, 'created_by', v_actor, 'via', 'assign_task'))
  returning id into v_task;

  insert into public.task_log (task_id, action, actor, actor_email, detail)
  values (v_task, 'created', v_uid, v_actor, p_title);

  -- Assigning without telling anyone is not assigning. Notification is not optional.
  foreach v_owner in array v_owners loop
    if public.notify(v_owner, p_title, p_notes, 'task', 'info', p_subject_type, p_subject_id,
                     coalesce(p_route, '/Work'), p_rule_key, 'task:' || v_task, false) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'task_id', v_task,
                            'assigned_to', v_owners[1], 'notified', v_n);
end $function$;

-- ── PROCESS NOTE ─────────────────────────────────────────────────────────────
-- Root cause of this file's absence: apply_migration was called without saving
-- the file in the same turn. Every apply MUST be followed by writing the file
-- before moving on.
-- ─────────────────────────────────────────────────────────────────────────────
