-- The route guard reads app_page; without a row here the page renders
-- "No access to this page" even for an org admin.
--
-- Deliberately under the CORE 'dashboard' module rather than a departmental one:
-- an inbox has to reach every login in the company, and later every crew member
-- in the subcontractor portal. Gating it behind a department would recreate the
-- exact failure it exists to fix — an alert that cannot reach its recipient.
insert into public.app_page (key, module_key, label, route_path, is_public, min_permission)
values ('Inbox', 'dashboard', 'Inbox', '/Inbox', false, 'view')
on conflict (key) do update
  set module_key = excluded.module_key,
      label = excluded.label,
      route_path = excluded.route_path,
      min_permission = excluded.min_permission;
