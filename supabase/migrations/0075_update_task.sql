-- ─────────────────────────────────────────────────────────────────────────────
-- 0075 — A task the system created is a STARTING POINT, not a verdict.
--
-- The reconciler picks an owner from the on-call chain and a due date from
-- (stage entered + the rule's SLA). Both are guesses made without knowing what
-- is actually happening on the job. If the only options are "accept it" or
-- "close it", people close things that are not done — which is exactly how a
-- task system stops meaning anything.
--
-- Every change is written to the append-only task_log with its old and new
-- value, so adjusting a system decision is transparent rather than silent.
--
-- The reconciler does NOT overwrite these edits: it only OPENS tasks that do not
-- exist and CLOSES ones whose stage has moved on. It never updates a live task's
-- assignee, due date or priority. A human's change therefore sticks — verified
-- by editing a rule-created task and re-running reconcile_tasks().
--
-- NOTE: `text[] || 'literal'` makes Postgres parse the untyped literal AS AN
-- ARRAY. Every append below needs an explicit ::text so it is treated as one
-- element.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.update_task(
  p_task_id   text,
  p_title     text default null,
  p_notes     text default null,
  p_due_at    timestamptz default null,
  p_priority  int default null,
  p_clear_due boolean default false   -- explicit, since null means "leave alone"
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid; v_actor text; t public.task;
  v_changes text[] := '{}'; v_old text; v_new text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  select * into t from public.task where id = p_task_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not found'); end if;
  if t.completed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'that task is already complete');
  end if;

  -- The person holding the work can adjust it; otherwise it is a management act.
  if not (t.assigned_user is not distinct from v_uid
          or public.is_org_admin() or public.can_edit('projects')) then
    raise exception 'Not authorized to change this task';
  end if;

  if p_priority is not null and p_priority not between 1 and 4 then
    raise exception 'Priority must be 1-4';
  end if;

  if p_clear_due then
    if t.due_at is not null then
      v_changes := v_changes || ('due date cleared (was '
        || to_char(t.due_at at time zone 'America/Phoenix', 'Mon DD HH24:MI') || ')')::text;
    end if;
    update public.task set due_at = null, updated_date = now() where id = p_task_id;
  elsif p_due_at is not null and p_due_at is distinct from t.due_at then
    v_old := coalesce(to_char(t.due_at at time zone 'America/Phoenix', 'Mon DD HH24:MI'), 'none');
    v_new := to_char(p_due_at at time zone 'America/Phoenix', 'Mon DD HH24:MI');
    v_changes := v_changes || ('due ' || v_old || ' -> ' || v_new)::text;
    update public.task set due_at = p_due_at, updated_date = now() where id = p_task_id;
  end if;

  if p_priority is not null and p_priority is distinct from t.priority then
    v_changes := v_changes || ('priority ' || coalesce(t.priority::text, '-') || ' -> ' || p_priority)::text;
    update public.task set priority = p_priority, updated_date = now() where id = p_task_id;
  end if;

  -- Title lives inside created_reason so the reconciler's provenance
  -- (via / stage / rule) survives an edit.
  if p_title is not null and btrim(p_title) <> ''
     and btrim(p_title) is distinct from (t.created_reason->>'title') then
    v_changes := v_changes || ('renamed from "' || coalesce(t.created_reason->>'title', '-') || '"')::text;
    update public.task
       set created_reason = coalesce(created_reason, '{}'::jsonb)
                            || jsonb_build_object('title', btrim(p_title), 'edited_by', v_actor),
           updated_date = now()
     where id = p_task_id;
  end if;

  if p_notes is not null and p_notes is distinct from coalesce(t.notes, '') then
    v_changes := v_changes || 'detail updated'::text;
    update public.task set notes = p_notes, updated_date = now() where id = p_task_id;
  end if;

  if array_length(v_changes, 1) is null then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  insert into public.task_log (task_id, action, actor, actor_email, detail)
  values (p_task_id, 'edited', v_uid, v_actor, array_to_string(v_changes, '; '));

  -- If someone ELSE moved your deadline, you need to know. A due date that
  -- changes silently is worse than no due date.
  if t.assigned_user is not null and t.assigned_user is distinct from v_uid
     and (p_clear_due or (p_due_at is not null and p_due_at is distinct from t.due_at)) then
    perform public.notify(t.assigned_user,
      'Due date changed: ' || coalesce(t.created_reason->>'title', t.notes, 'a task'),
      array_to_string(v_changes, '; ') || ' - by ' || v_actor,
      'task', 'info', t.subject_type, t.subject_id, '/Work',
      t.rule_key, 'task_edited:' || p_task_id, false);
  end if;

  return jsonb_build_object('ok', true, 'changed', true,
                            'changes', array_to_string(v_changes, '; '));
end $$;

revoke all on function public.update_task(text,text,text,timestamptz,int,boolean) from public, anon;
grant execute on function public.update_task(text,text,text,timestamptz,int,boolean) to authenticated, service_role;
