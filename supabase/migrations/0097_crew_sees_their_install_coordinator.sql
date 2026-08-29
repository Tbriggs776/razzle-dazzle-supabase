-- ─────────────────────────────────────────────────────────────────────────────
-- 0097 — 0094 let a crew read exactly one staff row: the Field Manager on a job
-- they are working. That was reasoned from the checklist's escalation rule
-- ("material missing or wrong -> tell your Field Manager") — but the screen the
-- crew actually opens is the Job Brief, whose heading is "Your Floor Daddy
-- Support Team" and which shows TWO cards: the Field Manager and the Install
-- Coordinator. The second one rendered blank, on the one screen that exists to
-- tell a crew who to call.
--
-- Same shape as 0094's rule, one more column. Still scoped to a project the
-- caller's own installer is assigned to, so it grants nothing on any other job
-- and nothing at all to a login that is not on a crew.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists team_member_read on public.team_member;
create policy team_member_read on public.team_member
  for select to authenticated
  using (
    public.is_org_admin()
    or public.can_view('team')
    -- Staff modules that legitimately show colleague names on records they work.
    or public.can_view('projects')
    or public.can_view('appointments')
    or public.can_view('journey')
    -- Your own row.
    or lower(email) = lower(coalesce(public.jwt_email(), ''))
    -- The Field Manager or Install Coordinator on a job this crew is on.
    or exists (
      select 1 from public.project p
       where (p.field_manager_id = team_member.id
              or p.install_coordinator_id = team_member.id)
         and p.installer_crew_id is not null
         and p.installer_crew_id = public.my_installer()
    )
  );

create index if not exists project_install_coordinator_idx
  on public.project (install_coordinator_id) where install_coordinator_id is not null;
