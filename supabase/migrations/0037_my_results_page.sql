-- "My Results" — a design consultant's own appointment outcomes (collapsible/sortable table
-- grouped by day/week/month/year/custom, with per-customer text/email + conversation history).
-- It's a personal view keyed off the signed-in user's team_member (assigned_dc), so it lives in
-- the 'appointments' module — every role with appointments access (Design Consultants have edit)
-- sees it in the nav automatically; no separate role grant needed.
insert into public.app_page (key, module_key, label, route_path, is_public, min_permission) values
  ('MyAppointmentResults', 'appointments', 'My Results', '/MyAppointmentResults', false, 'view')
on conflict (key) do update set
  module_key = excluded.module_key, label = excluded.label, route_path = excluded.route_path,
  is_public = excluded.is_public, min_permission = excluded.min_permission;
