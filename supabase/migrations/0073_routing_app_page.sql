-- Routing sits with User Access under System: deciding who receives the
-- company's work is an access decision, and both pages are org-admin work.
insert into public.app_page (key, module_key, label, route_path, is_public, min_permission)
values ('Routing', 'settings', 'Routing', '/Routing', false, 'admin')
on conflict (key) do update
  set module_key = excluded.module_key, label = excluded.label,
      route_path = excluded.route_path, min_permission = excluded.min_permission;
