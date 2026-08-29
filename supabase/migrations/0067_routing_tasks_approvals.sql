-- ─────────────────────────────────────────────────────────────────────────────
-- 0067 — Slice 2: who owns the work, and who signs it off.
--
-- Tasks here are not a to-do list. They exist to DRIVE a process to completion:
-- each one names a subject, an owner, a due time, and an escalation, and closing
-- it is what advances the job. Approvals are the gates between steps.
--
-- The routing problem this solves: all 21 workflow rules address a ROLE, and
-- zero of the 13 team members hold any of them — two of the five role names
-- ('Install Coordinator', 'Customer Experience Coordinator', carrying 12 of the
-- 21 rules) do not exist in the role table at all. So every rule is currently
-- addressed to nobody. Departments are introduced as the routing unit because
-- the operating model already thinks in them (ordering / scheduling / install /
-- cx / finance) and they survive people changing job titles.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.department (
  key        text primary key,
  name       text not null,
  sort_order int  not null default 100,
  is_active  boolean not null default true
);

insert into public.department (key, name, sort_order) values
  ('sales',      'Sales',                10),
  ('ordering',   'Order Processing',     20),
  ('scheduling', 'Install Coordination', 30),
  ('install',    'Field',                40),
  ('cx',         'Razzle Dazzle',        50),
  ('finance',    'Accounting',           60)
on conflict (key) do nothing;

create table if not exists public.department_member (
  dept       text not null references public.department(key) on update cascade on delete cascade,
  user_id    uuid not null references public.app_user(id)    on delete cascade,
  is_lead    boolean not null default false,   -- escalation target for the dept
  is_on_call boolean not null default false,   -- takes the work right now
  created_date timestamptz not null default now(),
  primary key (dept, user_id)
);

create index if not exists department_member_user_idx on public.department_member (user_id);

alter table public.department        enable row level security;
alter table public.department_member enable row level security;
revoke all on table public.department, public.department_member from anon;

drop policy if exists department_read on public.department;
create policy department_read on public.department for select to authenticated using (true);

drop policy if exists department_member_read on public.department_member;
create policy department_member_read on public.department_member
  for select to authenticated using (true);

-- Only an org admin decides who is in a department. This is an access decision.
drop policy if exists department_member_admin on public.department_member;
create policy department_member_admin on public.department_member
  for all to authenticated
  using (public.is_org_admin()) with check (public.is_org_admin());

drop policy if exists department_admin on public.department;
create policy department_admin on public.department
  for all to authenticated
  using (public.is_org_admin()) with check (public.is_org_admin());

-- ── The resolver ─────────────────────────────────────────────────────────────
-- Ordered fallback, so work is never addressed to nobody:
--   on-call in the dept -> any dept member -> anyone holding the named role
--   -> org admins.
-- Each step is deliberate: an alert that reaches no one is worse than no alert,
-- because it looks like coverage.
create or replace function public.resolve_owners(p_dept text, p_role text default null)
returns uuid[] language plpgsql stable security definer set search_path to 'public'
as $$
declare v uuid[];
begin
  if p_dept is not null then
    select array_agg(dm.user_id) into v
      from public.department_member dm
      join public.app_user au on au.id = dm.user_id and coalesce(au.is_active, true)
     where dm.dept = p_dept and dm.is_on_call;
    if v is not null and array_length(v,1) > 0 then return v; end if;

    select array_agg(dm.user_id) into v
      from public.department_member dm
      join public.app_user au on au.id = dm.user_id and coalesce(au.is_active, true)
     where dm.dept = p_dept;
    if v is not null and array_length(v,1) > 0 then return v; end if;
  end if;

  if p_role is not null then
    select array_agg(distinct au.id) into v
      from public.app_user au
      join public.user_role ur on ur.user_id = au.id
      join public.role ro on ro.id = ur.role_id
     where coalesce(au.is_active, true)
       and lower(trim(ro.name)) = lower(trim(p_role));
    if v is not null and array_length(v,1) > 0 then return v; end if;
  end if;

  select array_agg(id) into v from public.app_user
   where is_org_admin and coalesce(is_active, true);
  return coalesce(v, '{}'::uuid[]);
end $$;

-- ── Tasks ────────────────────────────────────────────────────────────────────
-- assigned_to holds a legacy team_member id. Notifications and RLS key on a
-- LOGIN, so the new column is the one the engine uses; the old one is left
-- alone so existing screens keep working.
alter table public.task
  add column if not exists assigned_user uuid references public.app_user(id) on delete set null,
  add column if not exists completed_at  timestamptz,
  add column if not exists completed_by  uuid;

create index if not exists task_assigned_user_open_idx
  on public.task (assigned_user, due_at) where completed_at is null;
create index if not exists task_dept_open_idx
  on public.task (dept, due_at) where completed_at is null;

-- You can always see and act on work assigned to YOU, whatever modules you hold.
-- Permissive, so it widens the existing module policy rather than replacing it.
drop policy if exists task_assignee_read on public.task;
create policy task_assignee_read on public.task
  for select to authenticated
  using (assigned_user = (select auth.uid()));

-- Append-only history. MyTasks currently HARD-DELETES tasks with no trace, which
-- is the opposite of accountability: a deleted repair-ladder rung leaves no
-- evidence the step was skipped.
create table if not exists public.task_log (
  id          text primary key default gen_random_uuid()::text,
  task_id     text not null,
  action      text not null,          -- created | assigned | reassigned | completed | reopened | note
  actor       uuid,
  actor_email text,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists task_log_task_idx on public.task_log (task_id, created_at);

alter table public.task_log enable row level security;
revoke all on table public.task_log from anon;
revoke update, delete on table public.task_log from authenticated;

drop policy if exists task_log_read on public.task_log;
create policy task_log_read on public.task_log
  for select to authenticated
  using (public.is_org_admin() or public.can_view('projects') or public.can_view('appointments'));

drop policy if exists task_log_service on public.task_log;
create policy task_log_service on public.task_log
  for all to service_role using (true) with check (true);

-- assign_task: create work, give it an owner, and TELL them. The notification is
-- not optional — an assignment nobody is told about is the failure this whole
-- slice exists to fix. NOTE task.created_reason is JSONB, not text.
create or replace function public.assign_task(
  p_title         text,
  p_dept          text default null,
  p_assigned_user uuid default null,
  p_subject_type  text default null,
  p_subject_id    text default null,
  p_due_at        timestamptz default null,
  p_priority      int default 3,
  p_notes         text default null,
  p_role          text default null,
  p_rule_key      text default null,
  p_route         text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_actor text; v_uid uuid; v_owners uuid[]; v_owner uuid; v_task text; v_n int := 0;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'A task needs a title'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

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

  foreach v_owner in array v_owners loop
    if public.notify(v_owner, p_title, p_notes, 'task', 'info', p_subject_type, p_subject_id,
                     coalesce(p_route, '/Work'), p_rule_key, 'task:' || v_task, false) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'task_id', v_task,
                            'assigned_to', v_owners[1], 'notified', v_n);
end $$;

create or replace function public.complete_task(p_task_id text, p_resolution text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text; v_owner uuid;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  select assigned_user into v_owner from public.task where id = p_task_id;
  -- The assignee closes their own work; a manager may close on their behalf,
  -- and the log records which of those happened.
  if not (v_owner is not distinct from v_uid or public.is_org_admin()
          or public.can_edit('projects')) then
    raise exception 'Not authorized to complete this task';
  end if;

  update public.task
     set completed_at = now(), completed_by = v_uid, status = 'completed',
         state = 'done', resolution = p_resolution, resolved_at = now(), updated_date = now()
   where id = p_task_id and completed_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'missing or already complete'); end if;

  insert into public.task_log (task_id, action, actor, actor_email, detail)
  values (p_task_id, 'completed', v_uid, v_actor,
          coalesce(p_resolution, '')
            || case when v_owner is distinct from v_uid then ' [closed by another user]' else '' end);

  -- Clear the nudge so the inbox reflects reality.
  update public.notification
     set acknowledged_at = now(), acknowledged_by = v_uid
   where dedupe_key = 'task:' || p_task_id and acknowledged_at is null;

  return jsonb_build_object('ok', true);
end $$;

-- ── Approvals ────────────────────────────────────────────────────────────────
-- The table shipped in 0053 with zero code and `for all` write access, so anyone
-- could decide any approval — including their own request. These two functions
-- are the only way in, and self-approval is refused.
drop policy if exists approval_write on public.approval;
drop policy if exists approval_read  on public.approval;

create policy approval_read on public.approval
  for select to authenticated
  using (
    public.is_org_admin()
    or requested_by = coalesce(public.jwt_email(), '')
    or public.can_view('projects') or public.can_view('finance')
  );

create policy approval_service on public.approval
  for all to service_role using (true) with check (true);

-- If the ONLY person the resolver finds is the requester, the request would
-- notify nobody and sit pending forever while looking like a control — the same
-- silent-failure shape as an alert with no recipient. Fall back to other org
-- admins, and report `unreachable` so the UI can tell the requester.
create or replace function public.request_approval(
  p_subject_type  text,
  p_subject_id    text,
  p_kind          text,
  p_reason        text,
  p_required_dept text default null,
  p_required_role text default null,
  p_route         text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text; v_id text; v_owners uuid[]; v_o uuid; v_n int := 0;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'An approval request needs a reason'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  insert into public.approval (subject_type, subject_id, kind, requested_by, reason,
                               required_dept, required_role, state)
  values (p_subject_type, p_subject_id, p_kind, v_actor, p_reason,
          p_required_dept, p_required_role, 'pending')
  returning id into v_id;

  v_owners := public.resolve_owners(p_required_dept, p_required_role);
  foreach v_o in array v_owners loop
    if v_o is distinct from v_uid then   -- never ask someone to approve their own
      if public.notify(v_o, 'Approval needed: ' || p_kind, p_reason, 'approval', 'warn',
                       p_subject_type, p_subject_id, coalesce(p_route, '/Work'),
                       'approval_request', 'approval:' || v_id, true) is not null then
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  if v_n = 0 then
    for v_o in select id from public.app_user
                where is_org_admin and coalesce(is_active, true) and id <> v_uid loop
      if public.notify(v_o, 'Approval needed: ' || p_kind,
                       p_reason || ' [No eligible approver was found for '
                         || coalesce(p_required_dept, p_required_role, 'this request') || '.]',
                       'approval', 'warn', p_subject_type, p_subject_id, coalesce(p_route, '/Work'),
                       'approval_request', 'approval:' || v_id, true) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'approval_id', v_id, 'notified', v_n,
                            'unreachable', v_n = 0);
end $$;

create or replace function public.decide_approval(
  p_id    text,
  p_state text,               -- approved | rejected
  p_note  text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text; a public.approval; v_req uuid;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_state not in ('approved', 'rejected') then raise exception 'Decision must be approved or rejected'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  select * into a from public.approval where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not found'); end if;
  if a.state <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already ' || a.state);
  end if;

  -- NO SELF-APPROVAL. The whole point of an approval is a second person.
  if a.requested_by = v_actor then
    raise exception 'You cannot decide your own approval request';
  end if;

  if not (public.is_org_admin()
          or (a.required_dept is not null and v_uid = any(public.resolve_owners(a.required_dept, a.required_role)))
          or (a.required_role is not null and v_uid = any(public.resolve_owners(null, a.required_role)))) then
    raise exception 'Not authorized to decide this approval';
  end if;

  update public.approval
     set state = p_state, decided_by = v_actor, decided_at = now(),
         decision_note = p_note, updated_date = now()
   where id = p_id;

  -- Tell the requester what happened. An approval nobody hears back on is a
  -- stall dressed up as a control.
  select au.id into v_req from public.app_user au
    join public.team_member tm on tm.id = au.team_member_id
   where lower(tm.email) = lower(a.requested_by) limit 1;
  if v_req is not null then
    perform public.notify(v_req, 'Approval ' || p_state || ': ' || a.kind,
                          coalesce(p_note, a.reason), 'approval',
                          case when p_state = 'approved' then 'info' else 'warn' end,
                          a.subject_type, a.subject_id, '/Work',
                          'approval_decided', 'approval_result:' || p_id, false);
  end if;

  -- Close the pending-approval nudges for everyone else.
  update public.notification set acknowledged_at = now(), acknowledged_by = v_uid
   where dedupe_key = 'approval:' || p_id and acknowledged_at is null;

  return jsonb_build_object('ok', true, 'state', p_state, 'decided_by', v_actor);
end $$;

revoke all on function public.resolve_owners(text,text) from public, anon;
grant execute on function public.resolve_owners(text,text) to authenticated, service_role;

revoke all on function public.assign_task(text,text,uuid,text,text,timestamptz,int,text,text,text,text) from public, anon;
revoke all on function public.complete_task(text,text) from public, anon;
revoke all on function public.request_approval(text,text,text,text,text,text,text) from public, anon;
revoke all on function public.decide_approval(text,text,text) from public, anon;
grant execute on function public.assign_task(text,text,uuid,text,text,timestamptz,int,text,text,text,text) to authenticated, service_role;
grant execute on function public.complete_task(text,text) to authenticated, service_role;
grant execute on function public.request_approval(text,text,text,text,text,text,text) to authenticated, service_role;
grant execute on function public.decide_approval(text,text,text) to authenticated, service_role;
