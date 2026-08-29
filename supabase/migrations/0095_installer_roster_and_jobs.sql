-- ─────────────────────────────────────────────────────────────────────────────
-- 0095 — The portal's WRITE model. 0092 gave a login an installer identity and
-- 0093 gave that identity a read model; neither gave anyone a way to CREATE one.
-- Until this migration the only route onto a crew roster was a staff member
-- hand-inserting a row, which makes "they can manage their crews" untrue.
--
-- Three pieces:
--
-- 1. SIGNUP CLAIMS AN INVITE. handle_new_auth_user() previously matched a new
--    signup against `team_member` only, and left everyone else inactive. It now
--    also matches an `installer_member` row that has an email, no user_id, and is
--    active — stamping user_id/accepted_at and activating the login. This is what
--    makes an invite an invite rather than a note in a table.
--
--    ⚠️ The match is on EMAIL, which is the same trust model staff already use.
--    An invite is therefore only as good as the address the owner typed. Rows
--    with a null email never match anything (`user_id is null` plus an email
--    equality test), so an owner can roster a crew member by name alone — which
--    they will, since crews get added before they have addresses — without that
--    name-only row ever granting anybody a login.
--
-- 2. THE OWNER MANAGES THEIR OWN ROSTER, AND ONLY THEIR OWN. Both RPCs derive
--    installer_id from my_installer() and never accept it as an argument, so a
--    caller cannot name someone else's company. set_installer_member_active()
--    refuses to deactivate the last active owner, because doing so would lock the
--    company out of its own roster with no self-service way back in.
--
-- 3. THE JOB LIST WITH EARNINGS. my_installer_jobs() is SECURITY DEFINER for one
--    specific reason: the owner asked for "estimated earnings", which lives in
--    sale.cost_labor, and 0093 deliberately keeps `sale` staff-only — the money
--    on a job is not a crew's business. A definer function returns THAT ONE
--    COLUMN without granting any read on the table. Verified: a crew login gets
--    its jobs from this function and still reads 0 rows from `sale` directly.
--
-- ── DATA GAPS THIS SITS ON, both real and neither a bug here ────────────────
--  * sale.cost_labor is populated on 1 of 18 sales. Earnings will be blank for
--    almost every job. The UI must say "not set" — rendering a null as $0 would
--    tell a crew the job pays nothing.
--  * project.installer_crew_id is 0 of 15 (see 0092 on why the six demo crew
--    names were NOT backfilled). Every portal screen therefore shows nothing
--    until a real subcontractor is assigned to a real job, which is correct.
--
-- `project` has no address column of its own — the address lives on
-- sale.location_address, with the customer's own address as the fallback.
--
-- Verified by impersonation: owner invites crew OK · duplicate email refused ·
-- last-owner deactivation refused · own jobs 2 · direct sale reads 0.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare
  v_org text;
  v_tm  text;
  v_member text;
begin
  select id into v_org from public.organization order by created_date asc limit 1;

  if new.email is not null then
    select id into v_tm from public.team_member where lower(email) = lower(new.email) limit 1;
    select id into v_member
      from public.installer_member
     where lower(email) = lower(new.email)
       and user_id is null
       and is_active
     order by invited_at desc nulls last
     limit 1;
  end if;

  insert into public.app_user (id, org_id, team_member_id, is_active, is_org_admin)
  values (
    new.id,
    v_org,
    v_tm,
    (v_tm is not null or v_member is not null),
    false
  )
  on conflict (id) do nothing;

  if v_member is not null then
    update public.installer_member
       set user_id = new.id, accepted_at = now(), updated_date = now()
     where id = v_member;
  end if;

  return new;
end;
$$;

-- ── Roster management, owner-scoped ─────────────────────────────────────────
-- installer_id is DERIVED, never an argument. That is the whole security model
-- of these two functions: there is no parameter through which a caller could
-- name a company that is not theirs.
create or replace function public.invite_installer_member(
  p_full_name text,
  p_email     text default null,
  p_phone     text default null,
  p_role      text default 'crew'
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_installer text; v_id text;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'A crew member needs a name';
  end if;
  if p_role not in ('owner', 'crew') then
    raise exception 'Role must be owner or crew';
  end if;

  v_installer := public.my_installer();
  if v_installer is null or not public.is_installer_owner() then
    raise exception 'Only the subcontractor owner can add crew members';
  end if;

  if p_email is not null and btrim(p_email) <> '' then
    if exists (select 1 from public.installer_member
                where installer_id = v_installer and lower(email) = lower(btrim(p_email))) then
      return jsonb_build_object('ok', false, 'reason', 'that person is already on your crew');
    end if;
  end if;

  insert into public.installer_member (installer_id, full_name, email, phone, role, invited_at)
  values (v_installer, btrim(p_full_name), nullif(btrim(coalesce(p_email,'')), ''),
          nullif(btrim(coalesce(p_phone,'')), ''), p_role, now())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'member_id', v_id,
    'note', case when p_email is null or btrim(p_email) = ''
                 then 'Added. Give them an email address when you have one so they can get a login.'
                 else 'Added. They get access when they sign up with that email.' end);
end $$;

-- Deactivate rather than delete: a crew member who worked a job stays on the
-- record of that job. Removing the last active owner is refused — it would strand
-- the company with no one able to manage its roster.
create or replace function public.set_installer_member_active(p_member_id text, p_active boolean)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_installer text; v_role text;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  v_installer := public.my_installer();
  if v_installer is null or not public.is_installer_owner() then
    raise exception 'Only the subcontractor owner can change crew members';
  end if;

  select role into v_role from public.installer_member
   where id = p_member_id and installer_id = v_installer;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not on your crew'); end if;

  if not p_active and v_role = 'owner'
     and (select count(*) from public.installer_member
           where installer_id = v_installer and role = 'owner' and is_active) <= 1 then
    return jsonb_build_object('ok', false, 'reason', 'that is your only active owner');
  end if;

  update public.installer_member set is_active = p_active, updated_date = now()
   where id = p_member_id and installer_id = v_installer;

  return jsonb_build_object('ok', true);
end $$;

-- ── The company job list ────────────────────────────────────────────────────
-- SECURITY DEFINER purely to reach sale.cost_labor. Everything else it returns
-- is already readable under 0093; the definer boundary buys exactly one column.
create or replace function public.my_installer_jobs()
returns table (
  project_id text,
  customer_name text,
  address text,
  install_date date,
  status text,
  stage text,
  estimated_labor numeric
) language sql stable security definer set search_path to 'public'
as $$
  select
    p.id,
    nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''),
    coalesce(
      nullif(btrim(coalesce(s.location_address, '')), ''),
      nullif(btrim(coalesce(c.address_line1,'') || ', ' || coalesce(c.city,'')), ', ')
    ),
    coalesce(p.installation_date, p.scheduled_start_date),
    p.status,
    js.stage,
    s.cost_labor
  from public.project p
  left join public.customer c on c.id = p.customer
  left join public.sale s     on s.id = p.sale
  left join public.job_stage js on js.project_id = p.id
  where p.installer_crew_id is not null
    and p.installer_crew_id = public.my_installer()
  order by coalesce(p.installation_date, p.scheduled_start_date) desc nulls last;
$$;

revoke all on function public.invite_installer_member(text,text,text,text) from public, anon;
revoke all on function public.set_installer_member_active(text,boolean) from public, anon;
revoke all on function public.my_installer_jobs() from public, anon;
grant execute on function public.invite_installer_member(text,text,text,text) to authenticated, service_role;
grant execute on function public.set_installer_member_active(text,boolean) to authenticated, service_role;
grant execute on function public.my_installer_jobs() to authenticated, service_role;
