-- ─────────────────────────────────────────────────────────────────────────────
-- 0080 — 0079's sale revoke did NOTHING. This is the one that works.
--
-- 0079 ran `revoke update (collect_exempt_reason, ...) on public.sale from
-- authenticated` and the privilege check afterwards still returned TRUE. A
-- column-level REVOKE cannot cut a hole in a TABLE-level GRANT, and `sale` carries
-- table-level UPDATE. The revoke was a no-op against a grant that outranks it.
--
-- WHAT MADE THIS EASY TO MISS: information_schema.column_privileges expands a
-- table-level grant into one row per column. Reading it, `sale` looked
-- column-scoped exactly the way `payment` genuinely was — which is why 0079
-- treated them the same way and only one of them took. The reliable check is
-- has_column_privilege(), which is what caught it.
--
-- The correct shape for "everything except these columns" is: revoke the
-- table-level privilege outright, then grant back the columns that remain
-- allowed. Done here with a DO block that derives the allow-list from the live
-- catalogue, so adding a column to `sale` later does not silently leave it
-- ungranted and break a write path.
--
-- ALSO REMOVED, both verified unused by the client first:
--   INSERT on sale — there is no entities.Sale.create anywhere in src/.
--                    convert_to_sale() is SECURITY DEFINER and unaffected.
--   DELETE on sale — there is no entities.Sale.delete anywhere in src/.
--                    Both the Delete and Cancel buttons route through the
--                    cancel_sale() RPC (0031). Deleting a sale row destroys
--                    financial history that sale_financial_log then references
--                    into thin air.
--
-- UPDATE is KEPT, because it is genuinely in use — nine call sites across
-- SaleDetail, ProjectDetail and CancelledProjects. None of them touch a gate
-- column: every reference to the eight gate columns in src/ and
-- supabase/functions/ is a read. So the allow-list costs no working flow.
--
-- sale_amount stays writable on purpose. Editing a contract value is a real
-- business action (a change order), it is covered by sale_financial_log, and it
-- re-runs resolve_cod_hold. It is a smaller and fully-audited surface, unlike an
-- exemption which silently released the gate outright.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_cols text;
  v_gate text[] := array[
    'collect_exempt_reason',
    'collection_terms',
    'deposit_required',
    'deposit_pct_required',
    'deposit_pct_target',
    'lender_approval_ref',
    'lender_signer_verified_at',
    'lender_signer_verified_by'
  ];
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'sale'
     and not (column_name = any (v_gate));

  if v_cols is null then
    raise exception 'refusing to proceed: no grantable sale columns resolved';
  end if;

  -- Table-level UPDATE has to go first; a column revoke cannot dent it.
  execute 'revoke update on public.sale from authenticated';
  execute format('grant update (%s) on public.sale to authenticated', v_cols);
end $$;

revoke insert, delete on public.sale from authenticated;
