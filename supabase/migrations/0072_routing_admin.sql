-- ─────────────────────────────────────────────────────────────────────────────
-- 0072 — Make routing configurable, and make its gaps visible.
--
-- 0067 shipped department routing with no way to populate it. With
-- department_member empty every task and alert falls through to the org-admin
-- fallback, which means one person receives the entire company's work — the
-- failure the fallback exists to prevent, arriving by a different door.
--
-- routing_health() is the more important half. Every gap in this system so far
-- has been invisible rather than unknown: rules addressed to roles nobody holds,
-- alerts sent to empty groups, people with no login. This reports all of it in
-- one call so it can be fixed rather than discovered.
-- ─────────────────────────────────────────────────────────────────────────────

-- department_member has a composite key, so the generic entity client cannot
-- update or delete it. One gated function is the entry point instead.
create or replace function public.set_department_member(
  p_dept       text,
  p_user_id    uuid,
  p_is_member  boolean default true,
  p_is_on_call boolean default null,
  p_is_lead    boolean default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not public.is_org_admin() then
    raise exception 'Only an org admin can change department membership';
  end if;
  if not exists (select 1 from public.department where key = p_dept) then
    raise exception 'Unknown department %', p_dept;
  end if;

  if not p_is_member then
    delete from public.department_member where dept = p_dept and user_id = p_user_id;
    return jsonb_build_object('ok', true, 'member', false);
  end if;

  -- coalesce against the existing row so toggling one flag never clears the other
  insert into public.department_member (dept, user_id, is_on_call, is_lead)
  values (p_dept, p_user_id, coalesce(p_is_on_call, false), coalesce(p_is_lead, false))
  on conflict (dept, user_id) do update
    set is_on_call = coalesce(p_is_on_call, public.department_member.is_on_call),
        is_lead    = coalesce(p_is_lead,    public.department_member.is_lead);

  return jsonb_build_object('ok', true, 'member', true);
end $$;

-- ── The diagnostic ───────────────────────────────────────────────────────────
create or replace function public.routing_health()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not (public.is_org_admin() or public.can_view('team')) then
    raise exception 'Not authorized';
  end if;

  select jsonb_build_object(
    -- Who is in each department, and whether anyone is actually reachable there.
    'departments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', d.key, 'name', d.name,
               'members', (select count(*) from public.department_member dm
                            join public.app_user au on au.id = dm.user_id and coalesce(au.is_active,true)
                           where dm.dept = d.key),
               'on_call', (select count(*) from public.department_member dm
                            where dm.dept = d.key and dm.is_on_call),
               'open_rules', (select count(*) from public.task_rule tr
                               where tr.is_active and tr.dept = d.key)
             ) order by d.sort_order), '[]'::jsonb)
        from public.department d where d.is_active),

    -- Rules that would route to the org-admin fallback right now.
    'unstaffed_rules', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'rule_key', tr.rule_key, 'label', tr.label,
               'dept', tr.dept, 'assigned_role', tr.assigned_role) order by tr.rule_key), '[]'::jsonb)
        from public.task_rule tr
       where tr.is_active
         and not exists (select 1 from public.department_member dm
                          join public.app_user au on au.id = dm.user_id and coalesce(au.is_active,true)
                         where dm.dept = tr.dept)),

    -- Role names the rules address that do not exist in the role table at all.
    'phantom_roles', (
      select coalesce(jsonb_agg(distinct tr.assigned_role), '[]'::jsonb)
        from public.task_rule tr
       where tr.is_active and tr.assigned_role is not null
         and not exists (select 1 from public.role ro
                          where lower(trim(ro.name)) = lower(trim(tr.assigned_role)))),

    -- People on the roster who cannot receive anything, because a notification
    -- needs a LOGIN and they do not have one.
    'people_without_login', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team_member_id', tm.id,
               'name', trim(coalesce(tm.first_name,'') || ' ' || coalesce(tm.last_name,'')),
               'email', tm.email) order by tm.last_name), '[]'::jsonb)
        from public.team_member tm
       where coalesce(tm.is_active, true)
         and not exists (select 1 from public.app_user au
                          where au.team_member_id = tm.id and coalesce(au.is_active, true))),

    'alert_groups', (select count(*) from public.alert_group),
    'sms_ready', (
      select coalesce((select sms_outbound_enabled from public.sms_settings limit 1), false)
        and exists (select 1 from public.integration
                     where key = 'twilio' and is_enabled
                       and coalesce(config->>'from_number', config->>'messaging_service_sid') is not null))
  ) into v;

  return v;
end $$;

revoke all on function public.set_department_member(text,uuid,boolean,boolean,boolean) from public, anon;
revoke all on function public.routing_health() from public, anon;
grant execute on function public.set_department_member(text,uuid,boolean,boolean,boolean) to authenticated, service_role;
grant execute on function public.routing_health() to authenticated, service_role;
