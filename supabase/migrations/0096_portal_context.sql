-- ─────────────────────────────────────────────────────────────────────────────
-- 0096 — One call that tells the CLIENT what my_installer() already tells the
-- database: is this login a subcontractor, which company, and are they its owner.
--
-- Without it the app cannot route. A crew login holds zero staff modules, so
-- my_access() returns an empty module list and every existing surface treats that
-- as "brand new employee, nothing assigned yet" — App.jsx sends `/` to /Dashboard,
-- which for a crew is a page of empty widgets behind a nav with no items in it.
-- The client needs to know the difference between "staff with nothing granted"
-- and "not staff at all", and only the database can answer that.
--
-- Returns a flat `{ is_installer: false }` rather than null for everyone else, so
-- the caller has one shape to handle and never has to distinguish "not an
-- installer" from "the call failed".
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.my_portal_context()
returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select jsonb_build_object(
       'is_installer', true,
       'installer_id', i.id,
       'crew_name',    i.crew_name,
       'member_id',    m.id,
       'member_name',  m.full_name,
       'role',         m.role,
       'is_owner',     (m.role = 'owner')
     )
       from public.installer_member m
       join public.installer i on i.id = m.installer_id
      where m.user_id = (select auth.uid())
        and m.is_active
        and coalesce(i.is_active, true)
      limit 1),
    jsonb_build_object('is_installer', false)
  );
$$;

revoke all on function public.my_portal_context() from public, anon;
grant execute on function public.my_portal_context() to authenticated, service_role;
