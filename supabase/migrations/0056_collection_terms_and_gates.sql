-- ─────────────────────────────────────────────────────────────────────────────
-- 0056 — Collection terms: the two money gates, per owner decisions 2026-08-28.
--
--   "We collect 100% before install. 50% at sale appointment, then 50% day of
--    install start."
--
-- The two gates are deliberately ASYMMETRIC:
--   GATE 1 (ordering)      — the deposit must have CLEARED the bank (confirmed).
--   GATE 2 (install start) — the balance need only be RECORDED. Nobody can
--                            confirm a clearing while a crew waits in a driveway.
--
-- Owner decisions encoded here:
--   1. Legacy book is DEEMED SATISFIED at its actual 30%, with the gap to the
--      50% policy reported rather than enforced. Nothing in the book stops.
--   2. Financed jobs are exempt from cash collection but NOT from evidence:
--      the lender's approval reference and a verified signer are required.
--   3. Multi-project sales collect the FULL remaining balance at the first
--      install. Expressed simply as: at any install start, balance_due must be 0.
--      This needs no per-project allocation — later phases are already at zero.
--   4. ZERO short-pay tolerance. No tolerance column exists, by design.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sale
  -- What was ACTUALLY agreed on this sale. Snapshotted, never derived — a later
  -- edit to sale_amount must not retroactively un-satisfy a released gate.
  add column if not exists deposit_pct_required     numeric(5,4),
  add column if not exists deposit_required         numeric(14,2),
  -- Current POLICY, for reporting the gap. Separate from the requirement so
  -- changing policy never re-gates the existing book.
  add column if not exists deposit_pct_target       numeric(5,4),
  add column if not exists collection_terms         text,
  add column if not exists collect_exempt_reason    text,
  -- Financed jobs: the lender funds after the completion certificate, so there
  -- is no cash to collect at 7am. Evidence substitutes for money — never a blank waiver.
  add column if not exists lender_approval_ref      text,
  add column if not exists lender_signer_verified_at timestamptz,
  add column if not exists lender_signer_verified_by text;

comment on column public.sale.deposit_required is
  'SNAPSHOT of the deposit actually agreed, in dollars. Gate 1 compares cleared payments against THIS, never against a percentage recomputed from sale_amount.';
comment on column public.sale.deposit_pct_target is
  'Current policy (0.50). Reporting only — the gap between this and deposit_pct_required is surfaced to Accounting, never enforced against the existing book.';
comment on column public.sale.collect_exempt_reason is
  'Non-null exempts this sale from BOTH gates. Requires a written reason: there is no silent waiver.';

-- Backfill: every live sale carries exactly 30%. Deem it the requirement.
update public.sale set
  deposit_pct_required = coalesce(deposit_pct_required,
                                  round(deposit_amount / nullif(sale_amount, 0), 4)),
  deposit_required     = coalesce(deposit_required, round(coalesce(deposit_amount, 0), 2)),
  deposit_pct_target   = coalesce(deposit_pct_target, 0.50),
  collection_terms     = coalesce(collection_terms, 'cod');

-- Forward default is the 50% policy; the backfill above already pinned history.
alter table public.sale
  alter column deposit_pct_target   set default 0.50,
  alter column deposit_pct_required set default 0.50,
  alter column collection_terms     set default 'cod';

alter table public.sale drop constraint if exists sale_collection_terms_chk;
alter table public.sale add constraint sale_collection_terms_chk
  check (collection_terms is null or collection_terms in
         ('cod', 'financed', 'net_terms', 'insurance', 'warranty', 'no_charge'));

-- The 15 ledger rows were created by the 0051 backfill and never confirmed, so
-- amount_cleared is 0 across the whole book. Without this, "deem satisfied"
-- would still gate every job. Stamped distinctly so it is never mistaken for
-- an Accounting confirmation.
update public.payment
   set confirmed_at = coalesce(confirmed_at, created_date, now()),
       confirmed_by = 'system:migration-0056',
       confirm_note = 'Pre-ledger deposit deemed cleared at migration. NOT an Accounting confirmation.'
 where recorded_by = 'system:migration'
   and confirmed_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- sale_balance v2 — CREATE OR REPLACE, appending only.
--
-- Never DROP this view: a recreate re-inherits Supabase's default grants and
-- re-opens it to anon, which is exactly the leak 0054 closed.
-- Columns 1-15 keep their existing names, types and order.
--
-- Two changes inside the existing columns:
--   * days_since_sale moves off CURRENT_DATE (UTC) to Phoenix. Arizona is UTC-7
--     with no DST, so a UTC "today" is wrong for seven hours of every day.
--   * the is_cancelled filter is REMOVED and exposed as a column instead. It hid
--     3 of 18 sales, including one carrying a Scheduled project — a gate reading
--     this view would have got NULL for them and failed open.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.sale_balance as
select
  s.id as sale_id,
  s.customer,
  s.sale_date,
  s.channel,
  coalesce(s.sale_amount, 0::numeric)                                   as gross_amount,
  coalesce(s.tax_amount, 0::numeric)                                    as tax_amount,
  coalesce(s.sale_amount, 0::numeric) - coalesce(s.tax_amount, 0::numeric) as net_amount,
  coalesce(p.paid, 0::numeric)                                          as amount_paid,
  coalesce(p.cleared, 0::numeric)                                       as amount_cleared,
  coalesce(p.paid, 0::numeric) - coalesce(p.cleared, 0::numeric)        as amount_pending_clearance,
  coalesce(s.sale_amount, 0::numeric) - coalesce(p.paid, 0::numeric)    as balance_due,
  p.last_payment_date,
  case
    when (coalesce(s.sale_amount, 0::numeric) - coalesce(p.paid, 0::numeric)) <= 0::numeric then 'paid'::text
    when coalesce(p.paid, 0::numeric) = 0::numeric then 'unpaid'::text
    else 'partial'::text
  end                                                                   as payment_status,
  coalesce(p.cleared, 0::numeric) > 0::numeric                          as deposit_confirmed,
  greatest(0, ((now() at time zone 'America/Phoenix')::date - s.sale_date::date)) as days_since_sale,

  -- ── appended below this line ────────────────────────────────────────────────
  coalesce(s.is_cancelled, false)                                       as is_cancelled,
  s.collection_terms,
  s.deposit_required,
  s.deposit_pct_required,
  s.deposit_pct_target,
  round(coalesce(s.sale_amount, 0) * coalesce(s.deposit_pct_target, 0.50), 2) as deposit_target_amount,
  -- Owner decision 1: report the shortfall against policy, never enforce it.
  greatest(0, round(coalesce(s.sale_amount, 0) * coalesce(s.deposit_pct_target, 0.50), 2)
              - coalesce(s.deposit_required, 0))                        as deposit_policy_gap,
  (s.collect_exempt_reason is not null)                                 as collect_exempt,

  -- GATE 1 — ordering. Never NULL, so SQL, JS and Deno cannot disagree.
  case
    when s.collect_exempt_reason is not null then true
    when s.collection_terms = 'financed'
      then (s.lender_approval_ref is not null and s.lender_signer_verified_at is not null)
    when s.collection_terms in ('net_terms','insurance','warranty','no_charge')
      then (s.collect_exempt_reason is not null)
    when s.deposit_required is null then false
    else coalesce(p.cleared, 0) >= s.deposit_required
  end                                                                   as deposit_satisfied,

  -- GATE 2 — install start. Zero tolerance (owner decision 4): the full
  -- remaining balance, which on a phased sale is the whole thing at phase 1
  -- (owner decision 3) and zero thereafter.
  case
    when s.collect_exempt_reason is not null then true
    when s.collection_terms = 'financed'
      then (s.lender_approval_ref is not null and s.lender_signer_verified_at is not null)
    when s.collection_terms in ('net_terms','insurance','warranty','no_charge')
      then (s.collect_exempt_reason is not null)
    when coalesce(s.sale_amount, 0) <= 0 then false
    else (coalesce(s.sale_amount, 0) - coalesce(p.paid, 0)) <= 0
  end                                                                   as fully_collected

from public.sale s
left join (
  select payment.sale,
         sum(payment.amount)                                                as paid,
         sum(payment.amount) filter (where payment.confirmed_at is not null) as cleared,
         max(payment.payment_date)                                          as last_payment_date
  from public.payment
  group by payment.sale
) p on p.sale = s.id;

comment on view public.sale_balance is
  'security_invoker — callers see only the sales their RLS permits. Do NOT recreate this view with DROP; a recreate re-inherits Supabase default grants and re-opens it to anon. deposit_satisfied and fully_collected are NEVER NULL by construction.';
