-- ─────────────────────────────────────────────────────────────────────────────
-- 0090 — Pillars 1&2 spec, §7 slice 0: "autoprovision is_active with no role".
--
-- handle_new_auth_user() inserted app_user with is_active = true UNCONDITIONALLY,
-- and team_member_id null whenever the signup email matched nobody on the roster.
-- So anyone who completed a signup became an ACTIVE member of the organisation.
--
-- WHAT THAT ACTUALLY BOUGHT THEM, stated accurately rather than dramatically:
-- with no role, current_user_module_permission() returns 'none' for every module,
-- so every module-gated table and page is closed. I checked this rather than
-- assuming — deactivating a live admin inside a rolled-back transaction returned
-- is_org_admin false, can_view false, can_edit false, and 0 visible payments.
-- is_active IS enforced, transitively, through current_user_module_permission.
--
-- What it DID buy them is the tables whose RLS is `USING (true)` for any
-- authenticated role: the installer and team_member contact directories, the four
-- activity logs, and config. In the trades a full list of subcontractor names and
-- mobile numbers is a poaching list. That residual is the reason to close this
-- before CSR logins are invited rather than after.
--
-- THE RULE NOW: you are auto-activated only if you were already on the roster.
-- Someone an admin has added to team_member with that email signs up and lands
-- active — the intended onboarding flow, and 13 roster emails can still do it. A
-- self-signup lands INACTIVE and an admin must turn them on, which is a decision
-- rather than a default.
--
-- The row is still created, deliberately: an admin needs something to activate,
-- and raising here would break the auth trigger for a legitimate hire.
--
-- Verified after applying: both existing users remain active.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare
  v_org text;
  v_tm  text;
begin
  select id into v_org from public.organization order by created_date asc limit 1;
  if new.email is not null then
    select id into v_tm from public.team_member where lower(email) = lower(new.email) limit 1;
  end if;

  insert into public.app_user (id, org_id, team_member_id, is_active, is_org_admin)
  values (
    new.id,
    v_org,
    v_tm,
    -- Active only if this email was already on the roster.
    v_tm is not null,
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
