-- The money model — payments ledger, tax, the four-component cost model, and
-- ONE gross-profit definition. Implements DECISIONS.md §2 and §3.
--
-- Applied in three parts (money precision, ledger + GP, backfill + change log);
-- recorded here as one file.
--
-- Before this the system stopped dead at a single `deposit_amount` double on the
-- sale row: it could not say who owed money, could never record a second
-- payment, and issued no receipt on the path where a deposit is mandatory.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Money must not be floating point.
--
-- double precision cannot represent 0.1 exactly, so totals drift by cents and
-- will never tie to QuickBooks penny-for-penny. Free to fix at 18 demo sales;
-- expensive once a real book is loaded — which is why it happens now.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.sale
  alter column sale_amount    type numeric(14,2) using round(sale_amount::numeric, 2),
  alter column deposit_amount type numeric(14,2) using round(deposit_amount::numeric, 2);
alter table public.quote
  alter column quote_amount   type numeric(14,2) using round(quote_amount::numeric, 2),
  alter column deposit_amount type numeric(14,2) using round(deposit_amount::numeric, 2);
alter table public.manual_sales_contract
  alter column sale_amount    type numeric(14,2) using round(sale_amount::numeric, 2),
  alter column deposit_amount type numeric(14,2) using round(deposit_amount::numeric, 2);
alter table public.journey_order
  alter column order_total    type numeric(14,2) using round(order_total::numeric, 2);
alter table public.rfms_order_cache
  alter column order_total    type numeric(14,2) using round(order_total::numeric, 2);
alter table public.rfms_item
  alter column item_cost      type numeric(14,4) using round(item_cost::numeric, 4),
  alter column per_unit_cost  type numeric(14,4) using round(per_unit_cost::numeric, 4);
alter table public.rfms_roll
  alter column cut_cost       type numeric(14,4) using round(cut_cost::numeric, 4),
  alter column pad_cost       type numeric(14,4) using round(pad_cost::numeric, 4),
  alter column per_unit_cost  type numeric(14,4) using round(per_unit_cost::numeric, 4);
alter table public.design_mod
  alter column value_added_costs type numeric(14,2) using round(value_added_costs::numeric, 2);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sale: tax, channel, and the four GP cost components.
--
-- sale_amount is GROSS of Arizona TPT (owner decision), so tax must be backed
-- out before margin. Every GP figure in the app today divides by the
-- tax-inclusive number and therefore overstates margin — on a $44k job with a
-- 5.63% effective rate that is roughly 3.6 points of phantom profit.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.sale
  add column if not exists tax_amount       numeric(14,2),
  add column if not exists tax_rate         numeric(7,5),
  add column if not exists tax_treatment    text,
  add column if not exists channel          text,
  add column if not exists cost_material    numeric(14,2),
  add column if not exists cost_labor       numeric(14,2),
  add column if not exists cost_finance_fee numeric(14,2),
  add column if not exists cost_commission  numeric(14,2);

comment on column public.sale.sale_amount is
  'GROSS of Arizona TPT — tax is included in this figure, not added to it. Use net_amount (sale_amount - tax_amount) as the revenue basis for margin.';
comment on column public.sale.tax_treatment is
  'prime_contracting | mrra | exempt. AZ prime contracting taxes a percentage of gross receipts; MRRA taxes materials at purchase. Confirm per-job treatment with the CPA — it decides the taxable base.';
comment on column public.sale.channel is
  'retail | builder | multifamily | repeat. Without this, a $4k bedroom and a 40-unit turn blend into the same average.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The payments ledger — every receipt, not just the first deposit.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.payment (
  id            text primary key default gen_random_uuid()::text,
  sale          text not null references public.sale(id)     on update cascade on delete restrict,
  customer      text          references public.customer(id) on update cascade on delete restrict,
  amount        numeric(14,2) not null,
  payment_date  date not null default current_date,
  method        text,
  reference     text,
  kind          text not null default 'payment',
  notes         text,
  recorded_by   text,
  created_date  timestamptz default now(),
  updated_date  timestamptz default now(),
  created_by    text
);

comment on table public.payment is
  'Money actually received against a sale. Negative amounts are refunds/chargebacks. QuickBooks remains the accounting system of record; this is the operational view of what has been collected.';
comment on column public.payment.kind is 'deposit | progress | final | refund | adjustment';

create index if not exists payment_sale_idx     on public.payment (sale);
create index if not exists payment_date_idx     on public.payment (payment_date);
create index if not exists payment_customer_idx on public.payment (customer) where customer is not null;

alter table public.payment enable row level security;
drop policy if exists payment_view  on public.payment;
drop policy if exists payment_write on public.payment;

-- Design consultants take deposits at the kitchen table, so 'sales' can record
-- payments; finance can too. Reading is deliberately wider than writing.
create policy payment_view on public.payment
  for select to authenticated
  using (public.is_org_admin() or public.can_view('sales') or public.can_view('finance') or public.can_view('order_processing'));
create policy payment_write on public.payment
  for all to authenticated
  using (public.is_org_admin() or public.can_edit('sales') or public.can_edit('finance'))
  with check (public.is_org_admin() or public.can_edit('sales') or public.can_edit('finance'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Balance + aging.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.sale_balance as
select
  s.id as sale_id, s.customer, s.sale_date, s.channel,
  coalesce(s.sale_amount, 0)                             as gross_amount,
  coalesce(s.tax_amount, 0)                              as tax_amount,
  coalesce(s.sale_amount, 0) - coalesce(s.tax_amount, 0) as net_amount,
  coalesce(p.paid, 0)                                    as amount_paid,
  coalesce(s.sale_amount, 0) - coalesce(p.paid, 0)       as balance_due,
  p.last_payment_date,
  case
    when coalesce(s.sale_amount, 0) - coalesce(p.paid, 0) <= 0 then 'paid'
    when coalesce(p.paid, 0) = 0                              then 'unpaid'
    else 'partial'
  end as payment_status,
  greatest(0, (current_date - s.sale_date::date)) as days_since_sale
from public.sale s
left join (
  select sale, sum(amount) as paid, max(payment_date) as last_payment_date
  from public.payment group by sale
) p on p.sale = s.id
where coalesce(s.is_cancelled, false) = false;

comment on view public.sale_balance is
  'Operational AR: what each open sale is worth, what has been collected, and what is still owed. Balance is against the GROSS amount, because that is what the customer actually pays.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The ONE gross-profit definition.
--   revenue (net of TPT) − (material + contract labor + finance dealer fees +
--   sales commission).
-- Four different formulas exist across the app today; every surface must call
-- this instead of computing its own.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sale_gross_profit(p_sale_id text)
returns jsonb language sql stable security invoker set search_path to 'public'
as $$
  select jsonb_build_object(
    'sale_id',          s.id,
    'gross_amount',     coalesce(s.sale_amount, 0),
    'tax_amount',       coalesce(s.tax_amount, 0),
    'net_amount',       coalesce(s.sale_amount, 0) - coalesce(s.tax_amount, 0),
    'cost_material',    coalesce(s.cost_material, 0),
    'cost_labor',       coalesce(s.cost_labor, 0),
    'cost_finance_fee', coalesce(s.cost_finance_fee, 0),
    'cost_commission',  coalesce(s.cost_commission, 0),
    'cost_total',       coalesce(s.cost_material,0) + coalesce(s.cost_labor,0)
                          + coalesce(s.cost_finance_fee,0) + coalesce(s.cost_commission,0),
    'gross_profit',     (coalesce(s.sale_amount,0) - coalesce(s.tax_amount,0))
                          - (coalesce(s.cost_material,0) + coalesce(s.cost_labor,0)
                             + coalesce(s.cost_finance_fee,0) + coalesce(s.cost_commission,0)),
    'gp_percent',       case when (coalesce(s.sale_amount,0) - coalesce(s.tax_amount,0)) > 0 then
                          round((((coalesce(s.sale_amount,0) - coalesce(s.tax_amount,0))
                            - (coalesce(s.cost_material,0) + coalesce(s.cost_labor,0)
                               + coalesce(s.cost_finance_fee,0) + coalesce(s.cost_commission,0)))
                           / (coalesce(s.sale_amount,0) - coalesce(s.tax_amount,0))) * 100, 2)
                        else null end,
    'costs_complete',   (s.cost_material is not null and s.cost_labor is not null
                         and s.cost_finance_fee is not null and s.cost_commission is not null)
  )
  from public.sale s where s.id = p_sale_id;
$$;

comment on function public.sale_gross_profit(text) is
  'THE gross-profit definition. Revenue is NET of TPT because sale_amount is gross. costs_complete says whether every component is known — a GP computed from partial costs flatters the job and must be labelled provisional.';

revoke all on function public.sale_gross_profit(text) from public, anon;
grant execute on function public.sale_gross_profit(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Backfill: the deposit already on each sale becomes its first ledger entry,
-- so money does not live in two places and immediately disagree. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.payment (sale, customer, amount, payment_date, method, reference, kind, notes, recorded_by)
select s.id, s.customer, round(s.deposit_amount::numeric, 2),
       coalesce(s.check_date, s.sale_date::date, current_date),
       s.deposit_payment_method, s.check_number, 'deposit',
       'Backfilled from sale.deposit_amount when the payments ledger was introduced.',
       'system:migration'
from public.sale s
where coalesce(s.deposit_amount, 0) > 0
  and coalesce(s.is_cancelled, false) = false
  and not exists (select 1 from public.payment p where p.sale = s.id);

comment on column public.sale.deposit_amount is
  'LEGACY / first-deposit convenience field. The payments ledger (public.payment) is the source of truth for money received — read sale_balance.amount_paid, not this.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Financial change log — who moved the money.
-- A sales editor could previously rewrite a closed sale's amount with nothing to
-- show it happened, and delete the log that would.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.sale_financial_log (
  id         text primary key default gen_random_uuid()::text,
  sale       text not null,
  field      text not null,
  old_value  text,
  new_value  text,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists sale_financial_log_sale_idx on public.sale_financial_log (sale, changed_at desc);

alter table public.sale_financial_log enable row level security;
drop policy if exists sale_financial_log_select on public.sale_financial_log;
create policy sale_financial_log_select on public.sale_financial_log
  for select to authenticated
  using (public.is_org_admin() or public.can_view('sales') or public.can_view('finance'));

-- Append-only: writes come from the trigger (definer), never from users.
revoke insert, update, delete on table public.sale_financial_log from authenticated, anon;

create or replace function public.trg_sale_financial_log()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_actor text := coalesce(public.jwt_email(), 'system');
begin
  if new.sale_amount is distinct from old.sale_amount then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'sale_amount', old.sale_amount::text, new.sale_amount::text, v_actor);
  end if;
  if new.tax_amount is distinct from old.tax_amount then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'tax_amount', old.tax_amount::text, new.tax_amount::text, v_actor);
  end if;
  if new.deposit_amount is distinct from old.deposit_amount then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'deposit_amount', old.deposit_amount::text, new.deposit_amount::text, v_actor);
  end if;
  if coalesce(new.is_cancelled,false) is distinct from coalesce(old.is_cancelled,false) then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'is_cancelled', old.is_cancelled::text, new.is_cancelled::text, v_actor);
  end if;
  return new;
end;
$$;

drop trigger if exists sale_financial_log_trg on public.sale;
create trigger sale_financial_log_trg
  after update on public.sale
  for each row execute function public.trg_sale_financial_log();

comment on table public.sale_financial_log is
  'Append-only record of changes to a sale''s money fields. Written by trigger only; users cannot insert, edit or delete rows.';
