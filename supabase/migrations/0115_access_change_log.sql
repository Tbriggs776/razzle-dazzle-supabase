-- ─────────────────────────────────────────────────────────────────────────────
-- 0115 — The access-change audit trail behind the role matrix (spec:
-- razzle-role-matrix). Who changed which role×module cell, flipped which
-- entitlement, cloned or renamed which role — and also the People-tab actions
-- (set_roles, set_active, set_org_admin) that were previously unrecorded.
--
-- A dedicated table rather than a kind='access' row in `log`, for one reason
-- the spec insists on: "Org admin can SELECT. Nobody else." `log` is readable
-- by anyone holding the logs module, and any future role granted logs:view
-- would silently inherit the access history. This table's only policy is
-- is_org_admin().
--
-- Append-only by construction: no INSERT/UPDATE/DELETE policy exists for
-- authenticated at all — writes come exclusively from the userAdmin edge
-- function under the service role, after its caller-JWT org-admin check.
--
-- `target` is jsonb {before, after, roleKey, moduleKey, …} rather than typed
-- columns, because the seven audited actions have seven shapes and the reader
-- is a human tracing "who locked Jordan out", not a report.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.access_change_log (
  id            text primary key default (gen_random_uuid())::text,
  org_id        text not null references public.organization(id),
  actor_user_id text,
  action        text not null,
  target        jsonb not null default '{}'::jsonb,
  created_date  timestamptz not null default now()
);

alter table public.access_change_log enable row level security;

drop policy if exists access_change_log_read on public.access_change_log;
create policy access_change_log_read on public.access_change_log
  for select to authenticated using (public.is_org_admin());

create index if not exists access_change_log_created_idx
  on public.access_change_log (created_date desc);
