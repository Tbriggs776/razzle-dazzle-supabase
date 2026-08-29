-- ---------------------------------------------------------------------------
-- 0103 -- Registers the Lead Queue page.
--
-- Worth recording because the registration model has CHANGED and an older note
-- in this repo's history describes three separate systems. It is now two:
--
--   1. This app_page row. my_access() returns only pages that have one, and
--      Layout uses that same set for BOTH the route guard (line ~176) and for
--      filtering the nav (getFilteredNavigation). So one row does both jobs.
--   2. The route + nav entry in App.jsx / Layout.jsx.
--
-- The old role_permissions.accessible_pages path and the Settings ALL_PAGES
-- array it was managed from are gone -- Settings.jsx no longer contains
-- ALL_PAGES at all, and the rolePermissions lookup left in Layout is dead code.
-- Anyone following the old three-step checklist will look for a file that does
-- not exist.
--
-- module_key 'leads' is deliberate: a CSR who can see Leads can see the queue,
-- and the RPCs behind it (0102) independently require can_edit('leads') to
-- claim, log or dispose.
-- ---------------------------------------------------------------------------

insert into public.app_page (key, module_key, label, route_path, is_public, min_permission)
values ('LeadQueue', 'leads', 'Lead Queue', '/LeadQueue', false, 'view')
on conflict (key) do update
  set module_key = excluded.module_key,
      label = excluded.label,
      route_path = excluded.route_path,
      min_permission = excluded.min_permission;
