-- ─────────────────────────────────────────────────────────────────────────────
-- 0084 — I made the SAME mistake as 0079, one migration after documenting it.
--
-- 0083 ran `revoke update (deleted_at, deleted_by, delete_reason) on
-- communication from authenticated` and has_column_privilege() still returned
-- TRUE, because `communication` carries a TABLE-level UPDATE grant and a
-- column-level revoke cannot cut into one. Same trap, same table shape, and it was
-- caught the same way: by checking with has_column_privilege() rather than
-- trusting the revoke to have done anything.
--
-- Writing it down in 0080 was not enough to stop it happening again, so:
--
--   RULE. To make "everything except these columns" writable, you must
--   REVOKE THE TABLE-LEVEL PRIVILEGE and then GRANT BACK the allow-list.
--   A column-level REVOKE against a table-level GRANT is silently a no-op, and
--   information_schema.column_privileges will still show one row per column,
--   which makes it look like it worked. has_column_privilege() is the only
--   check that tells the truth.
--
-- The archive flag matters because it IS the audit trail. Left directly writable,
-- anyone could un-archive or re-archive a thread without going through
-- archive_conversation(), which is the only thing that records who did it and why.
--
-- The allow-list is derived from the live catalogue so a column added to
-- `communication` later is not silently left ungranted and breaking a write path.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_cols text;
  v_protected text[] := array['deleted_at', 'deleted_by', 'delete_reason'];
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'communication'
     and not (column_name = any (v_protected));

  if v_cols is null then
    raise exception 'refusing to proceed: no grantable communication columns resolved';
  end if;

  execute 'revoke update on public.communication from authenticated';
  execute format('grant update (%s) on public.communication to authenticated', v_cols);
end $$;
