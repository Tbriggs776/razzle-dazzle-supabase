-- RFMS customer orders, as a joinable table, because Razzle's `sale` table is not a
-- complete record of what Floor Daddy has sold.
--
-- Measured against RFMS for 2026-01-01..2026-09-02: 1,100 customer orders in RFMS,
-- 640 distinct invoice numbers in Razzle, 587 matched. Excluding 41 voided and 320
-- zero-value documents, 193 live orders worth $2,424,699 had no Razzle sale -- and
-- 188 matched an existing lead by phone or email. 104 leads were bucketed as
-- non-purchasers when the system of record said they bought.
--
-- 1,100 was checked for being a page cap and is not: Jan-Apr returned 412 and
-- May-Sep 689, summing to 1,101 against 1,100 for the whole range (one boundary
-- order). The round number was a coincidence.
--
-- RFMS is authoritative for orders (DECISIONS.md §1). Where the two disagree about
-- whether someone bought, RFMS wins, and that cannot be settled by a view reading
-- only Razzle.
--
-- SUMMARY, not the full order. find/advanced returns header fields only -- no lines,
-- no costs. Deliberate: the question here is "did this person buy", which needs a
-- document number, a total and a voided flag. Line data has its own endpoint.
create table if not exists public.rfms_order_summary (
  document_number   text primary key,
  order_date        date,
  invoice_date      date,
  order_total       numeric,
  grand_total       numeric,
  balance_due       numeric,
  paid              numeric,
  voided            boolean not null default false,
  store             text,
  job_number        text,
  po_number         text,
  salesperson1      text,
  customer_id       text,
  customer_name     text,
  customer_phone    text,
  customer_email    text,
  customer_city     text,
  customer_state    text,
  -- Match keys, generated so they cannot drift from what they normalise. This is how
  -- an order finds its lead: the same to_e164 every other identity join uses.
  phone_e164        text generated always as (public.to_e164(customer_phone)) stored,
  email_lower       text generated always as (lower(nullif(customer_email,''))) stored,
  synced_at         timestamptz not null default now()
);

comment on table public.rfms_order_summary is
  'Header-level RFMS customer orders, so "did this lead buy" is answered against the system of record rather than Razzle''s sale table alone. From POST /v2/order/find/advanced.';

create index if not exists rfms_order_phone_idx on public.rfms_order_summary (phone_e164) where phone_e164 is not null;
create index if not exists rfms_order_email_idx on public.rfms_order_summary (email_lower) where email_lower is not null;
-- Partial on exactly the set every question asks for: a real, live order.
create index if not exists rfms_order_live_idx  on public.rfms_order_summary (order_date)
  where not voided and coalesce(order_total,0) > 0;

alter table public.rfms_order_summary enable row level security;

drop policy if exists rfms_order_summary_read on public.rfms_order_summary;
create policy rfms_order_summary_read on public.rfms_order_summary
  for select to authenticated
  using ((select public.can_view('sales')) or (select public.is_org_admin()));

revoke all on table public.rfms_order_summary from anon;
grant select on public.rfms_order_summary to authenticated;
