-- Job Flow — the cross-department stage board.
--
-- Module choice is deliberate: 'dashboard' is the one module every role holds,
-- so every department sees the SAME board. That is the entire point of this
-- page — Ordering and Install arguing over one shared picture of where a job
-- actually is, rather than each team reading its own slice.
--
-- (Row-level access still applies underneath; this only decides who can open
-- the page. See 0046 for the two-access-model note.)

insert into app_page (key, module_key, label, route_path, is_public, min_permission)
values ('JobFlow', 'dashboard', 'Job Flow', '/JobFlow', false, 'view')
on conflict (key) do update
  set module_key     = excluded.module_key,
      label          = excluded.label,
      route_path     = excluded.route_path,
      is_public      = excluded.is_public,
      min_permission = excluded.min_permission;

-- Nav visibility: grant to every role that already has a permissions row, since
-- the board is only useful if the whole company is looking at it.
update role_permissions
set accessible_pages = (
  select jsonb_agg(distinct p)
  from jsonb_array_elements_text(
    coalesce(accessible_pages, '[]'::jsonb) || '["JobFlow"]'::jsonb
  ) as t(p)
);
