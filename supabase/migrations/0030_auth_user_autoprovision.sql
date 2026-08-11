-- NO3: auto-provision an app_user whenever a Supabase Auth user is created.
--
-- my_access() (auth.me) INNER JOINs app_user, so any staffer with an auth login but no app_user
-- row hits UserNotRegisteredError and the app is unusable for them. Today only the seeded admin
-- has an app_user, so every new hire would need a manual SQL insert. This AFTER INSERT trigger
-- creates the row automatically (active, non-admin, no roles yet — the admin then grants roles),
-- and links a team_member with the SAME email if one already exists. Bulk-provisioning the
-- existing roster is still the owner's step (they hold the team list), but new logins never lock
-- out. Idempotent: on conflict do nothing.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
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
  values (new.id, v_org, v_tm, true, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
