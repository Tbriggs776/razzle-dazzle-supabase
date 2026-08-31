-- ─────────────────────────────────────────────────────────────────────────────
-- 0123 — One Users screen replaces Team Members + User Access.
--
-- The split was an artifact of the migration: the roster (team_member) came
-- from base44 and the access model (app_user/role) was built here, so managing
-- one person meant two screens in two different menus — and the one an admin
-- would naturally open, "Team Members", could not touch logins or permissions
-- at all. Both pages now redirect into Users, whose detail page carries the
-- profile AND the access rights for a single person.
--
-- The pages live in the `settings` module beside UserAccess (not `team`),
-- because this screen hands out access and should be gated like the rest of
-- System. min_permission 'admin' matches UserAccess: userAdmin refuses a
-- non-org-admin server-side anyway, and the page should not sit in a menu that
-- only leads to a Restricted card.
--
-- The old page keys are deliberately LEFT in place: their components are now
-- redirects, and deleting the rows would strand anyone whose role grants
-- `team` but not `settings` on a blocked route instead of forwarding them.
--
-- WHY THIS FILE EXISTS AT ALL — the 0069b lesson, repeated and caught by
-- review: without an app_page row my_access() never returns the key, and
-- Layout's guard (which has NO org-admin bypass on the page list, only on
-- module permission) shows "No access to this page" to EVERYONE, org admins
-- included. 0044 was written to fix exactly that failure for another page.
-- This migration was first applied straight to the database and the file was
-- not written in the same turn, so production worked while any rebuild from
-- the repo would have dead-ended the entire new screen. Every apply MUST be
-- followed by writing the file.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.app_page (key, module_key, label, min_permission)
values ('Users',      'settings', 'Users',       'admin'),
       ('UserDetail', 'settings', 'User Detail', 'admin')
on conflict (key) do update
  set label = excluded.label,
      module_key = excluded.module_key,
      min_permission = excluded.min_permission;
