-- Ops team dashboards: Install Team, Ordering Team, Speed to Install.
--
-- A new staff page needs BOTH access models registered or it is unreachable:
--   1. app_page  -> feeds my_access(), which the Layout route guard checks.
--      Without a row here EVERY role (org admins included) gets the
--      "No access to this page" screen, because my_access only ever returns
--      pages that have an app_page row.
--   2. role_permissions.accessible_pages -> drives nav visibility per role
--      (managed from the Settings UI; admins bypass it).
--
-- Module choice decides who inherits access:
--   OrderingTeam   -> order_processing (the ordering desk)
--   InstallTeam    -> journey          (install lifecycle / ops)
--   SpeedToInstall -> reports          (management cycle-time review)

insert into app_page (key, module_key, label, route_path, is_public, min_permission)
values
  ('OrderingTeam',   'order_processing', 'Ordering Team',    '/OrderingTeam',   false, 'view'),
  ('InstallTeam',    'journey',          'Install Team',     '/InstallTeam',    false, 'view'),
  ('SpeedToInstall', 'reports',          'Speed to Install', '/SpeedToInstall', false, 'view')
on conflict (key) do update
  set module_key     = excluded.module_key,
      label          = excluded.label,
      route_path     = excluded.route_path,
      is_public      = excluded.is_public,
      min_permission = excluded.min_permission;

-- Grant the three pages to Admin explicitly so the nav shows them without a
-- Settings round-trip. Other roles are toggled from Settings -> Role Permissions.
update role_permissions
set accessible_pages = (
  select jsonb_agg(distinct p)
  from jsonb_array_elements_text(
    coalesce(accessible_pages, '[]'::jsonb)
    || '["OrderingTeam","InstallTeam","SpeedToInstall"]'::jsonb
  ) as t(p)
)
where role in ('Admin', 'admin');
