-- Grant the Admin role explicit access to the new Installer Applications review page.
-- The nav already shows every page to admins via the admin bypass in Layout.jsx, and the page is
-- adminOnly, but role_permissions.accessible_pages is the authoritative page-access list the nav
-- reads (base44.entities.RolePermissions.list()) — so record it there too, for clarity and for a
-- fresh deploy. Idempotent.
update public.role_permissions
set accessible_pages = accessible_pages || '["InstallerApplications"]'::jsonb,
    updated_date = now()
where role = 'Admin'
  and not (accessible_pages ? 'InstallerApplications');
