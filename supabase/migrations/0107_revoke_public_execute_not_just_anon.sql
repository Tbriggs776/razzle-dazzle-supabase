-- ─────────────────────────────────────────────────────────────────────────────
-- 0107 — Makes 0106's revokes actually take effect.
--
-- ── THE TRAP, FOR THE THIRD TIME ────────────────────────────────────────────
-- Postgres grants EXECUTE on every new function to PUBLIC by default. `anon`
-- inherits from PUBLIC, so `revoke execute ... from anon` removes a grant anon
-- never had directly and changes nothing. has_function_privilege('anon', …)
-- still returns true, and if you check with anything less precise than proacl
-- you will believe you fixed it.
--
-- The tell is in proacl: `{=X/postgres, postgres=X/postgres, authenticated=X/…}`
-- — that leading `=X` with an empty grantee IS public. Compare lead_queue,
-- written later in this same session, whose acl has no `=X` entry because it
-- was created with `revoke all … from public, anon`, and which correctly
-- reports anon=false.
--
-- This is the function-level twin of the column-level REVOKE trap in 0080
-- (where a column REVOKE cannot cut into a table-level GRANT, and
-- information_schema.column_privileges makes it look like it did). Same lesson:
-- a REVOKE that targets the wrong grantee is silent, and the catalogue view you
-- reach for first will agree with you.
--
-- ── WHAT THESE FOUR ARE, AND WHY ANON HAD THEM ──────────────────────────────
-- Nothing granted them deliberately; they simply never revoked the default.
--   resolve_cod_hold  — releases the COD hold that stops an install starting
--                       before payment. NOT exploitable even from anon: the
--                       function's own WHERE requires sale_balance.fully_collected,
--                       and I verified as anon that an unpaid job stays held. But
--                       one line inside a function is thin cover for an
--                       unauthenticated write path, and a future edit to that
--                       WHERE would remove it with nobody noticing the grant.
--   my_access, is_org_admin, current_user_module_permission
--                     — all return empty/false for anon, so no data leaked.
--                       There is simply no reason for anon to reach them.
--
-- ── WHAT IS DELIBERATELY LEFT OPEN TO ANON ──────────────────────────────────
-- get_public_appointment / get_public_project (the customer tracker links),
-- roc_lookup (public AZ ROC record data), and the five token-gated installer
-- application RPCs. Those are the public surface and each authorises on its own
-- token or id. Verified still reachable after this migration.
--
-- Verified: anon denied on all four; authenticated retains all four; an
-- authenticated user still reads 15 projects through RLS (which calls
-- current_user_module_permission on every policy — the thing most likely to
-- break); my_access() still returns; anon can still open the customer tracker.
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function public.resolve_cod_hold(text) from public, anon;
revoke execute on function public.current_user_module_permission(text) from public, anon;
revoke execute on function public.my_access() from public, anon;
revoke execute on function public.is_org_admin() from public, anon;

-- Re-assert the grants these actually need, so revoking PUBLIC cannot strand them.
grant execute on function public.resolve_cod_hold(text) to authenticated, service_role;
grant execute on function public.current_user_module_permission(text) to authenticated, service_role;
grant execute on function public.my_access() to authenticated, service_role;
grant execute on function public.is_org_admin() to authenticated, service_role;
