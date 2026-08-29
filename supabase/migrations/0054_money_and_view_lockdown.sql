-- ─────────────────────────────────────────────────────────────────────────────
-- 0054 — Security lockdown. No behaviour change; four verified live defects.
--
-- Found while designing the 50/50 collection gates, all confirmed by probing
-- production as the anon role and independently by the Supabase linter.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. THE AR LEAK. A view without security_invoker executes as its OWNER, so it
--    launders straight past the RLS that correctly protects the base tables.
--    Probed as anon: sale_balance returned 15 rows and $347,795 of balance_due,
--    while `select from sale` under the same role correctly returned 0. The base
--    tables were never the problem — the view was. The anon key ships in the
--    browser bundle, so this was readable by anyone who loaded the site.
alter view public.sale_balance       set (security_invoker = true);

-- Same defect, latent rather than live: duplicate_customers returns 0 rows today
-- only because there are no duplicates. match_value carries emails and phones.
alter view public.duplicate_customers set (security_invoker = true);

revoke all on table public.sale_balance       from anon;
revoke all on table public.duplicate_customers from anon;
grant select on public.sale_balance        to authenticated;
grant select on public.duplicate_customers to authenticated;

-- 2. comms_sent shipped in 0053 with RLS never enabled — my own defect. Empty
--    today, so nothing has leaked; it fills the moment comms are switched on.
alter table public.comms_sent enable row level security;
revoke all on table public.comms_sent from anon;

drop policy if exists comms_sent_view on public.comms_sent;
create policy comms_sent_view on public.comms_sent
  for select to authenticated
  using (public.is_org_admin() or public.can_view('communications') or public.can_view('projects'));

-- Only the job runner writes this table.
drop policy if exists comms_sent_write on public.comms_sent;
create policy comms_sent_write on public.comms_sent
  for all to service_role using (true) with check (true);

-- 3. confirm_payment() was decorative. It raises 'Only Accounting can confirm',
--    but `payment` carried a table-wide UPDATE grant to authenticated, and the
--    payment_write policy admits can_edit('sales') — so a Sales user could PATCH
--    confirmed_at directly through PostgREST and satisfy the deposit gate
--    themselves. Narrow the grant to the columns Sales legitimately edits.
revoke all    on table public.payment from anon;
revoke update on table public.payment from authenticated;
grant  update (amount, payment_date, method, reference, kind, notes, customer, updated_date)
       on table public.payment to authenticated;

-- Defence in depth: even a future wider grant cannot forge a confirmation.
-- Inside confirm_payment (SECURITY DEFINER) current_user is the owner, not the
-- caller, so the legitimate path passes and the PostgREST path cannot.
create or replace function public.trg_payment_confirmation_guard()
returns trigger language plpgsql as $$
begin
  if (new.confirmed_at is distinct from old.confirmed_at
      or new.confirmed_by is distinct from old.confirmed_by)
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception
      'payment.confirmed_at may only be set through confirm_payment()'
      using hint = 'Confirming a deposit has cleared is an Accounting action.';
  end if;
  return new;
end $$;

drop trigger if exists payment_confirmation_guard on public.payment;
create trigger payment_confirmation_guard
  before update on public.payment
  for each row execute function public.trg_payment_confirmation_guard();

-- 4. Trigger functions were RPC-callable, and tick_jobs — which fires the whole
--    job dispatcher — was executable by anon. Cron calls it as postgres, so
--    revoking public execute costs nothing.
revoke execute on function public.tick_jobs()              from anon, authenticated, public;
revoke execute on function public.trg_project_log()        from anon, authenticated, public;
revoke execute on function public.trg_sale_financial_log() from anon, authenticated, public;
revoke execute on function public.trg_sale_rfms_fetch()    from anon, authenticated, public;

comment on view public.sale_balance is
  'security_invoker — callers see only the sales their RLS permits. Do NOT recreate this view with DROP; a recreate re-inherits Supabase default grants and re-opens it to anon.';
