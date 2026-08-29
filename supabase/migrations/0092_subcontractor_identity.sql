-- ─────────────────────────────────────────────────────────────────────────────
-- 0092 — The subcontractor portal, foundation layer.
--
-- The owner's ask, in his words: "Installers/Subcontractors: yes, they get logins.
-- I want them to have a portal. They can manage their crews and employees who will
-- be on our jobs. Each person in their crews get a login as well. They can complete
-- the items required for their assigned jobs, claims, repairs, etc. The main
-- company portal has all jobs and status of jobs and estimated earnings."
--
-- ── WHAT ALREADY EXISTED, and what did not ──────────────────────────────────
-- The application funnel already ends in an installer: InstallerApplications'
-- promote() creates an `installer` row and stamps installer_application.
-- installer_id. That path works and is untouched here.
--
-- What was missing is the identity layer between a LOGIN and a SUBCONTRACTOR:
--   * `installer` has an email but no user account
--   * there is no concept of the individual PEOPLE under a subcontractor
--   * nothing tells a request "this login belongs to that crew"
-- Which is why B3's per-project authorisation could not be written: there was no
-- crew-to-project relationship to check.
--
-- ── DELIBERATELY NOT DONE: backfilling the six demo crews ───────────────────
-- 14 of 15 projects carry installer_crew_name "Crew 1".."Crew 6" and ZERO carry
-- installer_crew_id. It is tempting to mint six installer rows from those names and
-- link them. They are RFMS/demo placeholders, not subcontractors — inventing
-- company records from them would put fiction in the table the portal is built on,
-- and every one would later need finding and deleting.
--
-- The functions below degrade correctly instead: with installer_crew_id null, no
-- installer matches a project, so ONLY staff can act on it. That is the safe
-- direction, and it becomes correct on its own the moment a real installer is
-- assigned.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.installer_member (
  id            text primary key default (gen_random_uuid())::text,
  installer_id  text not null references public.installer(id) on delete cascade,
  -- Null until they actually sign up. A subcontractor owner adds their crew by
  -- name and phone long before those people have accounts, and the roster has to
  -- be usable in that state.
  user_id       uuid references public.app_user(id) on delete set null,
  full_name     text not null,
  email         text,
  phone         text,
  -- owner: manages the roster and sees the company's jobs and earnings.
  -- crew:   sees only the jobs they are on, and completes the checklists.
  role          text not null default 'crew' check (role in ('owner', 'crew')),
  is_active     boolean not null default true,
  invited_at    timestamptz,
  accepted_at   timestamptz,
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

-- One login belongs to at most one crew member per subcontractor.
create unique index if not exists installer_member_user_uniq
  on public.installer_member (installer_id, user_id) where user_id is not null;
create index if not exists installer_member_installer_idx on public.installer_member (installer_id);
create index if not exists installer_member_user_idx on public.installer_member (user_id) where user_id is not null;

alter table public.installer_member enable row level security;

-- ── Who am I, and which subcontractor am I ──────────────────────────────────
-- SECURITY DEFINER and STABLE: called from RLS policies, so it must not itself be
-- filtered by the policies it is used in, and it is evaluated once per statement.
create or replace function public.my_installer()
returns text language sql stable security definer set search_path to 'public'
as $$
  select m.installer_id
    from public.installer_member m
    join public.installer i on i.id = m.installer_id
   where m.user_id = (select auth.uid())
     and m.is_active
     and coalesce(i.is_active, true)
   limit 1;
$$;

create or replace function public.is_installer_owner()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.installer_member m
     where m.user_id = (select auth.uid()) and m.is_active and m.role = 'owner'
  );
$$;

-- The question B3 needed and could not ask: may this login act on this project?
-- False whenever the project has no installer assigned, which is every project
-- today — so this can only ever GRANT access that staff already had, never
-- broaden it accidentally.
create or replace function public.installer_on_project(p_project_id text)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
      from public.project p
     where p.id = p_project_id
       and p.installer_crew_id is not null
       and p.installer_crew_id = public.my_installer()
  );
$$;

revoke all on function public.my_installer() from public, anon;
revoke all on function public.is_installer_owner() from public, anon;
revoke all on function public.installer_on_project(text) from public, anon;
grant execute on function public.my_installer() to authenticated, service_role;
grant execute on function public.is_installer_owner() to authenticated, service_role;
grant execute on function public.installer_on_project(text) to authenticated, service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- A crew member sees the roster of their OWN subcontractor and nobody else's. In
-- the trades a list of other companies' crew names and mobiles is a poaching list,
-- which is the same reason `installer` itself needs tightening below.
drop policy if exists installer_member_read on public.installer_member;
create policy installer_member_read on public.installer_member
  for select to authenticated
  using (
    public.is_org_admin()
    or public.can_view('team')
    or installer_id = public.my_installer()
  );

-- Only the subcontractor's OWNER manages their roster. Staff can too, because
-- someone has to fix it when an owner leaves.
drop policy if exists installer_member_write on public.installer_member;
create policy installer_member_write on public.installer_member
  for all to authenticated
  using (
    public.is_org_admin()
    or public.can_edit('team')
    or (installer_id = public.my_installer() and public.is_installer_owner())
  )
  with check (
    public.is_org_admin()
    or public.can_edit('team')
    or (installer_id = public.my_installer() and public.is_installer_owner())
  );

-- `installer` was shared_select: every authenticated user could read every
-- subcontractor's name, email and phone. Fine with two admin accounts; a poaching
-- list the day crews log in.
drop policy if exists shared_select on public.installer;
create policy installer_read on public.installer
  for select to authenticated
  using (
    public.is_org_admin()
    or public.can_view('team')
    or public.can_view('projects')
    or public.can_view('journey')
    or id = public.my_installer()
  );

create or replace function public.trg_installer_member_updated()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  new.updated_date := now();
  return new;
end $$;

drop trigger if exists installer_member_updated on public.installer_member;
create trigger installer_member_updated before update on public.installer_member
  for each row execute function public.trg_installer_member_updated();
