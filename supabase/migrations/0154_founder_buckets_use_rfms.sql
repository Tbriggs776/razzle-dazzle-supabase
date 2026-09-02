-- Ask RFMS, not just Razzle, whether a lead bought.
--
-- Razzle's `sale` table is not a complete record: 193 live RFMS orders worth
-- $2,424,699 had no sale row, and 188 matched an existing lead. 104 leads were
-- bucketed as non-purchasers when the system of record said otherwise. RFMS is
-- authoritative for orders (DECISIONS.md §1), so where they disagree, RFMS wins.
--
-- Effect, measured:  Purchased 629 -> 769  (+140 found only in RFMS)
--                    Sold but cancelled 28 -> 5 (23 had a live RFMS order, so they
--                    did buy -- a cancelled Razzle sale that was rewritten in RFMS)
--
-- The phone/email match is two joins unioned, not `on (phone = ... or email = ...)`.
-- An OR across two columns cannot use either index, and this runs over 17,500 leads.
--
-- purchase_source rides on every row on purpose. "This lead bought" is a claim
-- someone will eventually question, and the answer should say which system said so --
-- razzle, rfms, or both -- rather than making them re-derive it.
--
-- COVERAGE CAVEAT: rfms_order_summary currently holds 2026-01-01 onward. The earliest
-- Razzle sale is 2026-01-20, so the window covers the book, but a purchase older than
-- that would still be invisible here.
drop view if exists public.rpt_leads;
drop view if exists public.founder_lead_buckets;

create view public.founder_lead_buckets
with (security_invoker = on) as
with appt as (
  select customer as lead_id, count(*) as n, max(appointment_date::text) as last_a
    from public.appointment where customer is not null group by customer
),
sale_lead as (
  select s.lead as lead_id, s.id, s.sale_amount, s.sale_date, s.is_cancelled
    from public.sale s where s.lead is not null
  union
  select c.converted_from_lead, s.id, s.sale_amount, s.sale_date, s.is_cancelled
    from public.sale s join public.customer c on c.id = s.customer
   where c.converted_from_lead is not null
),
sal as (
  select lead_id,
         count(*) filter (where not coalesce(is_cancelled,false))             as n,
         sum(sale_amount) filter (where not coalesce(is_cancelled,false))     as amt,
         max(sale_date::text) filter (where not coalesce(is_cancelled,false)) as last_s,
         count(*) filter (where coalesce(is_cancelled,false))                 as cancelled_n,
         sum(sale_amount) filter (where coalesce(is_cancelled,false))         as cancelled_amt
    from sale_lead group by lead_id
),
rfms_match as (
  select l.id as lead_id, r.document_number, r.order_total
    from public.lead l
    join public.rfms_order_summary r on r.phone_e164 = l.phone_e164
   where not r.voided and coalesce(r.order_total,0) > 0
  union
  select l.id, r.document_number, r.order_total
    from public.lead l
    join public.rfms_order_summary r on r.email_lower = lower(l.email)
   where not r.voided and coalesce(r.order_total,0) > 0
),
rf as (
  select lead_id, count(*) as n, sum(order_total) as amt from rfms_match group by lead_id
)
select
  l.id as lead_id, l.first_name, l.last_name, l.email, l.phone, l.city, l.state,
  l.source_channel, l.created_date::date as lead_created,
  case
    when coalesce(sal.n,0) > 0 or coalesce(rf.n,0) > 0 then 'Purchased'
    when coalesce(sal.cancelled_n,0) > 0               then 'Sold but cancelled'
    when coalesce(appt.n,0) > 0                        then 'Appointment, no purchase'
    else 'No appointment'
  end as category,
  case
    when coalesce(sal.n,0) > 0 and coalesce(rf.n,0) > 0 then 'both'
    when coalesce(rf.n,0)  > 0                          then 'rfms only'
    when coalesce(sal.n,0) > 0                          then 'razzle only'
    else null
  end as purchase_source,
  coalesce(appt.n,0) as appointment_count,
  appt.last_a        as last_appointment,
  coalesce(sal.n,0)  as purchase_count,
  sal.amt            as purchase_total,
  sal.last_s         as last_sale_date,
  coalesce(rf.n,0)   as rfms_order_count,
  rf.amt             as rfms_order_total,
  coalesce(sal.cancelled_n,0) as cancelled_purchase_count,
  sal.cancelled_amt           as cancelled_purchase_total,
  d.dnd_blanket, d.dnd_sms, d.dnd_email,
  array_to_string(d.dnd_other,' / ') as dnd_other_channels,
  case
    when d.contact_id is null      then 'unknown - no GHL contact'
    when d.dnd_blanket             then 'DO NOT CONTACT (all channels)'
    when d.dnd_sms and d.dnd_email then 'no SMS, no email'
    when d.dnd_sms                 then 'no SMS'
    when d.dnd_email               then 'no email'
    else 'contactable'
  end as contact_status,
  l.ghl_contact_id
from public.lead l
left join appt on appt.lead_id = l.id
left join sal  on sal.lead_id  = l.id
left join rf   on rf.lead_id   = l.id
left join public.ghl_contact_dnd d on d.contact_id = l.ghl_contact_id;

comment on view public.founder_lead_buckets is
  'Every lead bucketed as Purchased / Sold but cancelled / Appointment, no purchase / No appointment. A purchase is a completed Razzle sale OR a live RFMS order -- RFMS is the system of record and Razzle''s sale table is demonstrably incomplete. purchase_source says which system said so.';

create view public.rpt_leads with (security_invoker = on) as
select l.id, l.first_name, l.last_name, l.email, l.phone, l.city, l.state,
       l.source_channel, l.source_campaign, l.disposition,
       l.created_date::date as created_on, l.queued_at::date as queued_on,
       b.category as outcome, b.purchase_source,
       b.appointment_count, b.purchase_count, b.purchase_total,
       b.rfms_order_count, b.rfms_order_total,
       b.cancelled_purchase_count, b.contact_status,
       tm.first_name || ' ' || tm.last_name as assigned_csr_name
  from public.lead l
  left join public.founder_lead_buckets b on b.lead_id = l.id
  left join public.team_member tm on tm.id = l.assigned_csr;

revoke all on public.founder_lead_buckets from anon;
grant select on public.founder_lead_buckets to authenticated;
revoke all on public.rpt_leads from anon;
grant select on public.rpt_leads to authenticated;
