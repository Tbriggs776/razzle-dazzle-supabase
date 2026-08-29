-- Like the Inbox, Work sits under the CORE 'dashboard' module: everyone with a
-- login has work assigned to them, and gating it behind a department would mean
-- the people a task routes to cannot open the page it routes them to.
insert into public.app_page (key, module_key, label, route_path, is_public, min_permission)
values ('Work', 'dashboard', 'Work', '/Work', false, 'view')
on conflict (key) do update
  set module_key = excluded.module_key, label = excluded.label,
      route_path = excluded.route_path, min_permission = excluded.min_permission;
