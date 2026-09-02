-- "Purchased" means a COMPLETED sale, and cancellations get their own bucket.
-- Owner's calls, 2026-09-02: "sales should be completed sales, not sold but
-- cancelled", then "can we add a sold but cancelled status?"
--
-- 28 of the 667 sales carry is_cancelled and the first version counted every one as a
-- purchase, putting $375,133 of cancelled contracts into the revenue figure. A lead
-- who signed and then cancelled is not a customer.
--
-- They are NOT folded into "Appointment, no purchase" either, which was the other
-- obvious option and is worse: there they would be indistinguishable from someone who
-- was pitched and said no. Those are opposite situations for whoever picks up the
-- phone -- one changed their mind after signing, the other never signed.
--
-- PRECEDENCE IS DELIBERATE: a completed sale beats a cancelled one, so a lead who
-- bought twice and cancelled once is a customer, not a cancellation. Only a lead whose
-- sales were ALL cancelled lands in the new bucket.
--
--     No appointment              15,686
--     Appointment, no purchase     1,184
--     Purchased                      629   $7,163,194
--     Sold but cancelled              28     $375,133
--
-- The views are dropped and recreated rather than replaced because CREATE OR REPLACE
-- VIEW cannot insert a column in the middle of the list, and rpt_leads depends on this.
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
         count(*) filter (where not coalesce(is_cancelled, false))             as n,
         sum(sale_amount) filter (where not coalesce(is_cancelled, false))     as amt,
         max(sale_date::text) filter (where not coalesce(is_cancelled, false)) as last_s,
         count(*) filter (where coalesce(is_cancelled, false))                 as cancelled_n,
         sum(sale_amount) filter (where coalesce(is_cancelled, false))         as cancelled_amt
    from sale_lead group by lead_id
)
select
  l.id as lead_id, l.first_name, l.last_name, l.email, l.phone, l.city, l.state,
  l.source_channel, l.created_date::date as lead_created,
  case
    when coalesce(sal.n, 0)           > 0 then 'Purchased'
    when coalesce(sal.cancelled_n, 0) > 0 then 'Sold but cancelled'
    when coalesce(appt.n, 0)          > 0 then 'Appointment, no purchase'
    else 'No appointment'
  end as category,
  coalesce(appt.n, 0) as appointment_count,
  appt.last_a         as last_appointment,
  coalesce(sal.n, 0)  as purchase_count,
  sal.amt             as purchase_total,
  sal.last_s          as last_sale_date,
  coalesce(sal.cancelled_n, 0) as cancelled_purchase_count,
  sal.cancelled_amt            as cancelled_purchase_total,
  d.dnd_blanket, d.dnd_sms, d.dnd_email,
  array_to_string(d.dnd_other, ' / ') as dnd_other_channels,
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
left join public.ghl_contact_dnd d on d.contact_id = l.ghl_contact_id;

comment on view public.founder_lead_buckets is
  'Every lead bucketed as Purchased / Sold but cancelled / Appointment, no purchase / No appointment, with GHL DND. "Purchased" means a COMPLETED sale. security_invoker: RLS decides the rows.';

create view public.rpt_leads with (security_invoker = on) as
select l.id, l.first_name, l.last_name, l.email, l.phone, l.city, l.state,
       l.source_channel, l.source_campaign, l.disposition,
       l.created_date::date as created_on,
       l.queued_at::date    as queued_on,
       b.category           as outcome,
       b.appointment_count, b.purchase_count, b.purchase_total,
       b.cancelled_purchase_count,
       b.contact_status,
       tm.first_name || ' ' || tm.last_name as assigned_csr_name
  from public.lead l
  left join public.founder_lead_buckets b on b.lead_id = l.id
  left join public.team_member tm on tm.id = l.assigned_csr;

revoke all on public.founder_lead_buckets from anon;
grant select on public.founder_lead_buckets to authenticated;
revoke all on public.rpt_leads from anon;
grant select on public.rpt_leads to authenticated;
