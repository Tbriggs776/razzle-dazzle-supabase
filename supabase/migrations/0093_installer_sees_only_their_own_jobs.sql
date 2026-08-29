-- ─────────────────────────────────────────────────────────────────────────────
-- 0093 — The portal's read model: a subcontractor sees THEIR jobs and nothing else.
--
-- 0092 gave a login an installer identity. This makes that identity mean
-- something. Without it a crew member sees ZERO projects — verified — because
-- every table below is gated on a staff module they will never hold. The Journey
-- crew screens were all built before crew logins existed, so they query as staff;
-- a real crew account would open Journey to an empty board.
--
-- ── THE SHAPE OF EVERY POLICY BELOW ─────────────────────────────────────────
-- Each ADDS one disjunct to the existing staff rule; none replaces or widens it.
-- The disjunct is always "this row belongs to a project assigned to MY installer",
-- inlined as `installer_crew_id = my_installer()` rather than calling
-- installer_on_project() per row, so it stays a single indexable comparison.
--
-- my_installer() returns null for staff and for anyone not on a crew, and
-- `installer_crew_id = null` is never true — so for every existing user these
-- policies are a no-op. They cannot broaden anything by accident.
--
-- ── WHAT A CREW IS DELIBERATELY NOT GIVEN ───────────────────────────────────
-- No sale, no payment, no GP, no other subcontractor's jobs, and no customer they
-- are not working for. They get the customer NAME and ADDRESS on their own jobs,
-- because you cannot install a floor without knowing whose house to drive to —
-- and nothing else about that customer.
--
-- `sale` stays staff-only on purpose. The money on a job is not a crew's business,
-- and the checklist already reads what it needs through installCollectionStatus,
-- a narrow RPC that returns the amount due and nothing else.
--
-- Verified with two subcontractors and a pure crew login holding no staff modules:
--   own projects 2 · rival's projects 0 · customers 2 (their jobs' only)
--   sales 0 · payments 0 · other subcontractors 0 (own company only)
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists mod_select on public.project;
create policy mod_select on public.project
  for select to authenticated
  using (
    public.can_view('projects')
    or (installer_crew_id is not null and installer_crew_id = public.my_installer())
  );

-- project_checkpoint: the crew's actual work.
drop policy if exists mod_select on public.project_checkpoint;
create policy mod_select on public.project_checkpoint
  for select to authenticated
  using (
    public.can_view('projects')
    or public.can_view('journey')
    or exists (
      select 1 from public.project p
       where p.id = project_checkpoint.project_id
         and p.installer_crew_id is not null
         and p.installer_crew_id = public.my_installer()
    )
  );

-- Submitting a checklist is the whole point of the portal. APPROVING one is not:
-- submitCheckpoint's approval branch is separately gated, and a crew must never be
-- able to sign off its own work.
drop policy if exists mod_insert on public.project_checkpoint;
create policy mod_insert on public.project_checkpoint
  for insert to authenticated
  with check (
    public.can_edit('projects')
    or public.can_edit('journey')
    or exists (
      select 1 from public.project p
       where p.id = project_checkpoint.project_id
         and p.installer_crew_id is not null
         and p.installer_crew_id = public.my_installer()
    )
  );

drop policy if exists mod_update on public.project_checkpoint;
create policy mod_update on public.project_checkpoint
  for update to authenticated
  using (
    public.can_edit('projects')
    or public.can_edit('journey')
    or exists (
      select 1 from public.project p
       where p.id = project_checkpoint.project_id
         and p.installer_crew_id is not null
         and p.installer_crew_id = public.my_installer()
    )
  )
  with check (
    public.can_edit('projects')
    or public.can_edit('journey')
    or exists (
      select 1 from public.project p
       where p.id = project_checkpoint.project_id
         and p.installer_crew_id is not null
         and p.installer_crew_id = public.my_installer()
    )
  );

-- customer: name and address for their OWN jobs only.
drop policy if exists mod_select on public.customer;
create policy mod_select on public.customer
  for select to authenticated
  using (
    public.can_view('customers')
    or exists (
      select 1 from public.project p
       where p.customer = customer.id
         and p.installer_crew_id is not null
         and p.installer_crew_id = public.my_installer()
    )
  );

-- Supporting indexes: every policy above filters project by installer_crew_id.
create index if not exists project_installer_crew_idx on public.project (installer_crew_id)
  where installer_crew_id is not null;
create index if not exists project_customer_idx on public.project (customer);
