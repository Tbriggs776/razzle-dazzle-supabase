-- ─────────────────────────────────────────────────────────────────────────────
-- 0094 — `team_member` was the last of the audit's `USING (true)` tables that
-- actually carries something worth protecting, and 0092/0093 make it urgent: a
-- crew login now correctly sees only its own jobs, its own customers and its own
-- company — and could then still read the name, email, phone, role and bio of all
-- 13 staff. Verified before this migration: a pure crew account returned 13.
--
-- What a crew legitimately needs from this table is ONE person: the Field Manager
-- on a job they are working, because the checklist tells them "material missing or
-- wrong -> tell your Field Manager" and they need a number to ring.
--
-- ⚠️ THIS DEGRADES TO ZERO TODAY, and that is a data gap rather than a policy bug:
-- project.field_manager_id is populated on 0 of 15 projects, so a crew would see no
-- Field Manager at all. Assigning FMs to projects is what makes it useful — and it
-- is the same gap that makes MyQueue's board empty for everyone, since that screen
-- filters on field_manager_id.
--
-- Staff behaviour is unchanged: can_view('team') still sees the whole roster, the
-- staff modules that show colleague names on records keep working, and everyone
-- keeps seeing their own row.
--
-- Verified: with a Field Manager assigned to one of their jobs, a crew account sees
-- exactly 1 staff row — that FM — where it previously saw 13. An org admin still
-- sees all 13.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists shared_select on public.team_member;
create policy team_member_read on public.team_member
  for select to authenticated
  using (
    public.is_org_admin()
    or public.can_view('team')
    -- Staff modules that legitimately show colleague names on records they work:
    -- assigned DC, install coordinator, reviewer, and so on.
    or public.can_view('projects')
    or public.can_view('appointments')
    or public.can_view('journey')
    -- Your own row.
    or lower(email) = lower(coalesce(public.jwt_email(), ''))
    -- The Field Manager on a job this crew is actually on.
    or exists (
      select 1 from public.project p
       where p.field_manager_id = team_member.id
         and p.installer_crew_id is not null
         and p.installer_crew_id = public.my_installer()
    )
  );

create index if not exists project_field_manager_idx on public.project (field_manager_id)
  where field_manager_id is not null;
