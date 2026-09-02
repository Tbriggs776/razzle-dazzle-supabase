-- Rewrite founder_lead_buckets from correlated subqueries to single-pass aggregates.
--
-- The first version ran four correlated subqueries PER LEAD -- two counts, a sum and
-- a max -- across 17,524 leads. count() cannot short-circuit, so that is four full
-- probes each, and under RLS every probe re-evaluates the policy. It returned a CSV
-- eventually. It timed out immediately the moment a report builder pointed at it,
-- which is how the problem surfaced: `select first_name, outcome from rpt_leads
-- limit 3` cancelled on statement timeout.
--
-- Grouping appointment and sale ONCE and joining gives the same numbers in one pass
-- per table. Measured on the live data: timeout -> 21ms.
--
-- The sale side is a UNION rather than coalesce(s.lead, c.converted_from_lead),
-- because a sale can carry BOTH a direct lead reference and a customer converted from
-- a different lead. coalesce silently picks one and undercounts the other.
--
-- Verified unchanged after the rewrite: No appointment 15,684 | Appointment, no
-- purchase 1,184 | Purchased 657 | $7,538,326.
create or replace view public.founder_lead_buckets
with (security_invoker = on) as
with appt as (
  select customer as lead_id, count(*) as n, max(appointment_date::text) as last_a
    from public.appointment where customer is not null group by customer
),
sale_lead as (
  select s.lead as lead_id, s.id, s.sale_amount, s.sale_date
    from public.sale s where s.lead is not null
  union
  select c.converted_from_lead, s.id, s.sale_amount, s.sale_date
    from public.sale s join public.customer c on c.id = s.customer
   where c.converted_from_lead is not null
),
sal as (
  select lead_id, count(*) as n, sum(sale_amount) as amt, max(sale_date::text) as last_s
    from sale_lead group by lead_id
)
select
  l.id as lead_id, l.first_name, l.last_name, l.email, l.phone, l.city, l.state,
  l.source_channel, l.created_date::date as lead_created,
  case
    when coalesce(sal.n, 0)  > 0 then 'Purchased'
    when coalesce(appt.n, 0) > 0 then 'Appointment, no purchase'
    else 'No appointment'
  end as category,
  coalesce(appt.n, 0) as appointment_count,
  appt.last_a         as last_appointment,
  coalesce(sal.n, 0)  as purchase_count,
  sal.amt             as purchase_total,
  sal.last_s          as last_sale_date,
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
