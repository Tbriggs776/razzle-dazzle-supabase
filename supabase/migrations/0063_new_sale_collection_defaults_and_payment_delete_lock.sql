-- ─────────────────────────────────────────────────────────────────────────────
-- 0063 — Two money defects found by the ERP audit, both verified live.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. GATE 1 WAS INOPERATIVE ON ALL NEW BUSINESS — a regression introduced in
--    0056. That migration backfilled deposit_required across the existing book
--    but left the column with no default and no writer, so every sale created
--    from then on got NULL. sale_balance reads
--        when s.deposit_required is null then false
--    so deposit_satisfied was permanently FALSE: the sale would sit in Finance's
--    queue forever, "Deposit Cleared" would return {ok:false, reason:'short'}
--    and refuse to release the ordering hold, and the only way to order material
--    would be an Order Processor hand-flipping installation_date_status — which
--    is exactly the un-audited behaviour the gate was built to replace.
--
--    Fixed with a TRIGGER rather than by patching convert_to_sale, because that
--    RPC is not the only way a sale can be born and a future path would
--    reintroduce this silently.
create or replace function public.trg_sale_collection_defaults()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  new.collection_terms     := coalesce(new.collection_terms, 'cod');
  new.deposit_pct_target   := coalesce(new.deposit_pct_target, 0.50);
  new.deposit_pct_required := coalesce(new.deposit_pct_required, 0.50);

  -- Only ever FILL a null. Never recompute: deposit_required is a snapshot of
  -- what was agreed, and re-deriving it on an edit would retroactively
  -- un-satisfy a gate on a job that has already been released.
  if new.deposit_required is null and coalesce(new.sale_amount, 0) > 0 then
    new.deposit_required := round(new.sale_amount * new.deposit_pct_required, 2);
  end if;

  return new;
end $$;

drop trigger if exists sale_collection_defaults on public.sale;
create trigger sale_collection_defaults
  before insert or update on public.sale
  for each row execute function public.trg_sale_collection_defaults();

-- Repair any row already in this state (the trigger only fires on write, so a
-- sale sitting untouched would stay null).
update public.sale
   set deposit_pct_required = coalesce(deposit_pct_required, 0.50),
       deposit_pct_target   = coalesce(deposit_pct_target, 0.50),
       collection_terms     = coalesce(collection_terms, 'cod'),
       deposit_required     = coalesce(deposit_required,
                                       case when coalesce(sale_amount,0) > 0
                                            then round(sale_amount * 0.50, 2) end)
 where deposit_required is null
    or deposit_pct_required is null
    or collection_terms is null;

-- 2. A CONFIRMED, CLEARED PAYMENT COULD BE HARD-DELETED.
--    payment_write was FOR ALL — which includes DELETE — for anyone holding
--    can_edit('sales'), and the confirmation guard only protects confirmed_at /
--    confirmed_by on UPDATE. So money that had actually landed in the bank could
--    vanish from the ledger with no record it ever existed, silently moving the
--    balance and both gates.
--
--    Money is never deleted in accounting; it is reversed. record_payment
--    already supports kind='refund' (negative, Accounting-only), which leaves
--    the audit trail intact.
revoke delete on table public.payment from authenticated, anon;

drop policy if exists payment_write on public.payment;
create policy payment_write on public.payment
  for insert to authenticated
  with check (public.is_org_admin() or public.can_edit('sales') or public.can_edit('finance'));

drop policy if exists payment_update on public.payment;
create policy payment_update on public.payment
  for update to authenticated
  using (public.is_org_admin() or public.can_edit('sales') or public.can_edit('finance'))
  with check (public.is_org_admin() or public.can_edit('sales') or public.can_edit('finance'));

comment on table public.payment is
  'Money actually received against a sale. APPEND-AND-CORRECT ONLY: DELETE is revoked from authenticated — reverse with kind=''refund'' (negative amount, Accounting only) so the trail survives. QuickBooks remains the accounting system of record.';
