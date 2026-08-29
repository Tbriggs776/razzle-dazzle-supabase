-- ─────────────────────────────────────────────────────────────────────────────
-- 0074 — Managing a task, not just creating one.
--
-- assign_task() shipped in 0067 with no UI, so tasks could only be born from the
-- reconciler. This adds the three things a human needs to actually run work:
-- somebody to pick from, a way to hand it over, and a way to say what happened.
-- ─────────────────────────────────────────────────────────────────────────────

-- Who can a task be given to?
--
-- Deliberately NOT the userAdmin function the Routing page uses — that is
-- org-admin gated, and any user creating a task needs to choose an assignee.
-- Returns a NAME and nothing else: no email, no phone, no roster metadata. A
-- picker needs to identify a person, not expose the directory.
create or replace function public.assignable_users()
returns table (user_id uuid, name text, is_org_admin boolean, depts text[])
language sql stable security definer set search_path to 'public'
as $$
  select au.id,
         nullif(trim(coalesce(tm.first_name, '') || ' ' || coalesce(tm.last_name, '')), ''),
         au.is_org_admin,
         coalesce(array_agg(dm.dept) filter (where dm.dept is not null), '{}')
    from public.app_user au
    left join public.team_member tm on tm.id = au.team_member_id
    left join public.department_member dm on dm.user_id = au.id
   where coalesce(au.is_active, true)
     and (select auth.uid()) is not null
   group by au.id, tm.first_name, tm.last_name, au.is_org_admin
   order by 2 nulls last;
$$;

-- Hand work over. Either to a named person, or back to a department to be
-- re-resolved through the normal on-call chain.
create or replace function public.reassign_task(
  p_task_id text,
  p_user_id uuid default null,
  p_dept    text default null,
  p_note    text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text; t public.task; v_new uuid; v_owners uuid[];
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  select * into t from public.task where id = p_task_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not found'); end if;
  if t.completed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'that task is already complete');
  end if;

  -- The current owner can hand their own work on; otherwise it is a management
  -- action. Anyone can always give work to themselves (picking something up).
  if not (t.assigned_user is not distinct from v_uid
          or p_user_id is not distinct from v_uid
          or public.is_org_admin() or public.can_edit('projects')) then
    raise exception 'Not authorized to reassign this task';
  end if;

  if p_user_id is not null then
    v_new := p_user_id;
  else
    v_owners := public.resolve_owners(coalesce(p_dept, t.dept), t.assigned_role);
    v_new := v_owners[1];
  end if;

  update public.task
     set assigned_user = v_new,
         dept = coalesce(p_dept, dept),
         updated_date = now()
   where id = p_task_id;

  insert into public.task_log (task_id, action, actor, actor_email, detail)
  values (p_task_id, 'reassigned', v_uid, v_actor,
          coalesce(p_note, '') ||
          case when p_dept is not null then ' [re-routed to ' || p_dept || ']' else '' end);

  -- Tell the new owner. Reassignment that nobody is told about is just a silent
  -- change of who is blamed later.
  if v_new is not null and v_new is distinct from v_uid then
    perform public.notify(v_new,
      coalesce(t.created_reason->>'title', t.notes, 'A task was assigned to you'),
      coalesce(p_note, 'Reassigned to you by ' || v_actor),
      'task', 'info', t.subject_type, t.subject_id, '/Work',
      t.rule_key, 'task:' || p_task_id, false);
  end if;

  -- And tell the person it was taken from, unless they did it themselves.
  if t.assigned_user is not null and t.assigned_user is distinct from v_uid
     and t.assigned_user is distinct from v_new then
    perform public.notify(t.assigned_user,
      'Reassigned: ' || coalesce(t.created_reason->>'title', t.notes, 'a task'),
      'This is no longer yours. ' || coalesce(p_note, ''),
      'task', 'info', t.subject_type, t.subject_id, '/Work',
      t.rule_key, 'unassigned:' || p_task_id, false);
    -- Clear their nudge so it leaves their inbox.
    update public.notification set acknowledged_at = now()
     where recipient = t.assigned_user and dedupe_key = 'task:' || p_task_id
       and acknowledged_at is null;
  end if;

  return jsonb_build_object('ok', true, 'assigned_to', v_new);
end $$;

-- Say what happened, without closing it. The log is append-only, so a note is
-- the only way to record a partial step — and it is what makes the history
-- readable later instead of a bare created/completed pair.
create or replace function public.add_task_note(p_task_id text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note needs some text'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  if not exists (select 1 from public.task where id = p_task_id) then
    return jsonb_build_object('ok', false, 'reason', 'not found');
  end if;

  insert into public.task_log (task_id, action, actor, actor_email, detail)
  values (p_task_id, 'note', v_uid, v_actor, p_note);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.assignable_users() from public, anon;
revoke all on function public.reassign_task(text,uuid,text,text) from public, anon;
revoke all on function public.add_task_note(text,text) from public, anon;
grant execute on function public.assignable_users() to authenticated, service_role;
grant execute on function public.reassign_task(text,uuid,text,text) to authenticated, service_role;
grant execute on function public.add_task_note(text,text) to authenticated, service_role;
