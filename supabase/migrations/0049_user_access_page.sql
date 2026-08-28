-- User Access page registration.
--
-- Module 'settings' controls only who can OPEN the page. The real gate is inside
-- the userAdmin edge function, which requires org admin checked against the
-- caller's own JWT — so a non-admin who reaches the route sees a calm
-- "you need organization admin rights" panel rather than any data.

insert into app_page (key, module_key, label, route_path, is_public, min_permission)
values ('UserAccess', 'settings', 'User Access', '/UserAccess', false, 'view')
on conflict (key) do update
  set module_key     = excluded.module_key,
      label          = excluded.label,
      route_path     = excluded.route_path,
      is_public      = excluded.is_public,
      min_permission = excluded.min_permission;

update role_permissions
set accessible_pages = (
  select jsonb_agg(distinct p)
  from jsonb_array_elements_text(
    coalesce(accessible_pages, '[]'::jsonb) || '["UserAccess"]'::jsonb
  ) as t(p)
)
where role in ('Admin', 'admin');
