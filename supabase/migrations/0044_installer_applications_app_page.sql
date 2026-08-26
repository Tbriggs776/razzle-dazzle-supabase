-- Fix: the Installer Applications page had no app_page row, so my_access() never returned it and
-- the module-based route guard in Layout.jsx (line ~147) showed "No access to this page" to
-- EVERYONE — including org admins (org_admin gets 'admin' on every module, but only for pages that
-- actually have an app_page row). Register it like MyAppointmentResults (migration 0037) did.
-- Placed in the 'team' module (managing installer crews is personnel-adjacent); org admins get it
-- regardless, and any role granted the team module + this page can reach it.
insert into public.app_page (key, module_key, label, route_path, is_public, min_permission) values
  ('InstallerApplications', 'team', 'Installer Applications', '/InstallerApplications', false, 'view')
on conflict (key) do update set
  module_key = excluded.module_key, label = excluded.label, route_path = excluded.route_path,
  is_public = excluded.is_public, min_permission = excluded.min_permission;
