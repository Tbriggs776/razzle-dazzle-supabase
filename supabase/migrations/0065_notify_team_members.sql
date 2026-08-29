-- Every existing alert path in this system resolves recipients as team_member
-- rows (alert groups, region install coordinator, project field manager), but a
-- notification is addressed to a LOGIN. This bridges the two, and — critically —
-- reports how many of the intended people were actually reachable.
--
-- Today 11 of 13 team members have no login at all, so "we alerted the Field
-- Manager" would otherwise be false in a way nothing surfaces.
create or replace function public.notify_team_members(
  p_team_member_ids text[],
  p_title        text,
  p_body         text default null,
  p_kind         text default 'alert',
  p_severity     text default 'info',
  p_subject_type text default null,
  p_subject_id   text default null,
  p_route        text default null,
  p_rule_key     text default null,
  p_dedupe_key   text default null,
  p_requires_ack boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_sent int := 0; v_intended int; v_unreachable int; r record;
begin
  v_intended := coalesce(array_length(p_team_member_ids, 1), 0);
  if v_intended = 0 then
    return jsonb_build_object('sent', 0, 'intended', 0, 'unreachable', 0);
  end if;

  for r in
    select au.id
      from public.app_user au
     where au.team_member_id = any(p_team_member_ids)
       and coalesce(au.is_active, true)
  loop
    if public.notify(r.id, p_title, p_body, p_kind, p_severity, p_subject_type,
                     p_subject_id, p_route, p_rule_key, p_dedupe_key, p_requires_ack) is not null then
      v_sent := v_sent + 1;
    end if;
  end loop;

  v_unreachable := greatest(0, v_intended - v_sent);

  -- If some intended person has no login, an org admin is told — otherwise the
  -- gap is invisible and everyone believes the alert landed.
  if v_unreachable > 0 then
    for r in select id from public.app_user where is_org_admin and coalesce(is_active, true) loop
      perform public.notify(r.id,
        'Alert could not reach ' || v_unreachable || ' of ' || v_intended || ' intended recipients',
        'They have no active login. Original alert: ' || p_title,
        'system', 'warn', p_subject_type, p_subject_id, p_route,
        'unreachable_recipient',
        'unreachable:' || coalesce(p_dedupe_key, p_title), false);
    end loop;
  end if;

  return jsonb_build_object('sent', v_sent, 'intended', v_intended, 'unreachable', v_unreachable);
end $$;

revoke all on function public.notify_team_members(text[],text,text,text,text,text,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.notify_team_members(text[],text,text,text,text,text,text,text,text,text,boolean) to service_role;
