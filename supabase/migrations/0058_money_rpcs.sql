-- ─────────────────────────────────────────────────────────────────────────────
-- 0058 — The ledger becomes reachable.
--
-- 0051 and 0053 shipped a payments ledger, a confirmation RPC and a balance view
-- that the frontend has never once read: there is no way to record a second
-- payment anywhere in the product. These two RPCs are that path.
-- ─────────────────────────────────────────────────────────────────────────────

-- Integrity the ledger should have had from the start.
update public.payment set kind = 'deposit' where kind = 'payment' or kind is null;

alter table public.payment
  add column if not exists idempotency_key text;

-- A double-tap in a driveway must not record the final payment twice.
create unique index if not exists payment_idempotency_uq
  on public.payment (idempotency_key) where idempotency_key is not null;

alter table public.payment drop constraint if exists payment_kind_chk;
alter table public.payment add constraint payment_kind_chk
  check (kind in ('deposit', 'progress', 'final', 'refund', 'adjustment'));

-- The DB runs UTC; Arizona is UTC-7 with no DST. Left alone, every collection
-- taken after 5pm Phoenix was stamped with tomorrow's date.
alter table public.payment
  alter column payment_date set default ((now() at time zone 'America/Phoenix')::date);

-- ── record_payment ───────────────────────────────────────────────────────────
-- Design Consultants take deposits at the kitchen table and Field Managers take
-- the balance in the driveway, so 'sales' and 'journey' can both record. Nobody
-- can CONFIRM through this path — that stays Accounting's, via confirm_payment.
create or replace function public.record_payment(
  p_sale            text,
  p_amount          numeric,
  p_method          text default null,
  p_reference       text default null,
  p_kind            text default 'final',
  p_note            text default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_actor text; v_id text; v_customer text; v_row public.sale_balance;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not (public.is_org_admin() or public.can_edit('finance')
          or public.can_edit('sales') or public.can_edit('journey')) then
    raise exception 'Not authorized to record a payment';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'A payment must have a non-zero amount';
  end if;
  if p_kind = 'refund' and p_amount > 0 then
    raise exception 'A refund must be recorded as a negative amount';
  end if;
  if p_kind <> 'refund' and p_amount < 0 then
    raise exception 'Only a refund may be negative';
  end if;
  -- Reversing money out is an Accounting decision, never a field one.
  if p_kind in ('refund', 'adjustment')
     and not (public.is_org_admin() or public.can_edit('finance')) then
    raise exception 'Only Accounting can record a refund or adjustment';
  end if;

  select customer into v_customer from public.sale where id = p_sale;
  if not found then raise exception 'Sale % not found', p_sale; end if;

  v_actor := coalesce(public.jwt_email(), 'system');

  -- Idempotent by key: a retry returns the original row rather than a duplicate.
  if p_idempotency_key is not null then
    select id into v_id from public.payment where idempotency_key = p_idempotency_key;
    if found then
      select * into v_row from public.sale_balance where sale_id = p_sale;
      return jsonb_build_object('ok', true, 'payment_id', v_id, 'duplicate', true,
                                'balance_due', v_row.balance_due,
                                'fully_collected', v_row.fully_collected);
    end if;
  end if;

  insert into public.payment (sale, customer, amount, method, reference, kind, notes,
                              recorded_by, idempotency_key)
  values (p_sale, v_customer, round(p_amount, 2), p_method, p_reference, p_kind, p_note,
          v_actor, p_idempotency_key)
  returning id into v_id;

  select * into v_row from public.sale_balance where sale_id = p_sale;
  return jsonb_build_object(
    'ok', true, 'payment_id', v_id, 'duplicate', false,
    'amount_paid', v_row.amount_paid, 'balance_due', v_row.balance_due,
    'deposit_satisfied', v_row.deposit_satisfied, 'fully_collected', v_row.fully_collected);
end $$;

-- ── confirm_sale_deposit ─────────────────────────────────────────────────────
-- Accounting's "the money actually landed" action, replacing Finance.jsx's
-- button that cleared the project flag while storing nothing.
--
-- It refuses to clear the hold when the cleared total still falls short of the
-- agreed deposit — the old button cleared it blind, for any amount or none.
create or replace function public.confirm_sale_deposit(
  p_sale_id text,
  p_note    text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_actor text; v_n int; v_row public.sale_balance; v_short numeric;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not (public.is_org_admin() or public.can_edit('finance')) then
    raise exception 'Only Accounting can confirm a deposit has cleared';
  end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  -- Serialize against a concurrent payment write on the same sale.
  perform 1 from public.sale where id = p_sale_id for update;
  if not found then raise exception 'Sale % not found', p_sale_id; end if;

  update public.payment
     set confirmed_at = now(), confirmed_by = v_actor,
         confirm_note = coalesce(p_note, confirm_note), updated_date = now()
   where sale = p_sale_id and confirmed_at is null and kind <> 'refund';
  get diagnostics v_n = row_count;

  select * into v_row from public.sale_balance where sale_id = p_sale_id;

  if not v_row.deposit_satisfied then
    v_short := greatest(0, coalesce(v_row.deposit_required, 0) - coalesce(v_row.amount_cleared, 0));
    return jsonb_build_object(
      'ok', false, 'confirmed_count', v_n,
      'reason', 'short',
      'amount_cleared', v_row.amount_cleared,
      'deposit_required', v_row.deposit_required,
      'shortfall', v_short);
  end if;

  -- Only now is it safe to release the ordering hold, and only that hold —
  -- never touch an asbestos or cancellation stop sitting in the same column.
  update public.project
     set installation_date_status = null, updated_date = now()
   where sale = p_sale_id
     and lower(trim(coalesce(installation_date_status, ''))) = 'pending payment';

  return jsonb_build_object(
    'ok', true, 'confirmed_count', v_n,
    'amount_cleared', v_row.amount_cleared,
    'deposit_required', v_row.deposit_required,
    'deposit_satisfied', true);
end $$;

revoke all on function public.record_payment(text, numeric, text, text, text, text, text) from public, anon;
revoke all on function public.confirm_sale_deposit(text, text)                            from public, anon;
grant execute on function public.record_payment(text, numeric, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.confirm_sale_deposit(text, text)                            to authenticated, service_role;
