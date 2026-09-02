-- Every lead, bucketed by outcome, with GHL do-not-contact state. Built for the
-- founder's request: leads with purchases / leads with appointments but no purchase /
-- leads with no appointments.
--
-- THE THREE BUCKETS ARE GENUINELY EXCLUSIVE, which is worth stating because the
-- request as phrased could overlap: a lead who bought without ever booking would
-- satisfy both "no appointments" and "with purchases". Measured against real data
-- that set is EMPTY -- every one of the 657 purchasers had an appointment first -- so
-- the categories partition the book cleanly. If that stops being true, the CASE below
-- resolves purchase-first, which matches how the question was asked.
--
-- A purchase counts from either side of the conversion: sale.lead pointing at the
-- lead directly, OR a sale against a customer whose converted_from_lead is this lead.
-- Checking only one side misses roughly half of them.
--
-- contact_status IS NULL-SAFE ON PURPOSE. 194 leads have no GHL contact record, and
-- "we do not know" is a different fact from "contactable". Flattening those to false
-- would hand someone 194 people to call who may have opted out.
create or replace view public.founder_lead_buckets
with (security_invoker = on) as
with outcome as (
  select l.id,
         (select count(*) from public.appointment a where a.customer = l.id)          as appointment_count,
         (select max(a.appointment_date::text) from public.appointment a where a.customer = l.id) as last_appointment,
         (select count(*) from public.sale s
            where s.lead = l.id
               or s.customer in (select c.id from public.customer c where c.converted_from_lead = l.id)) as purchase_count,
         (select sum(s.sale_amount) from public.sale s
            where s.lead = l.id
               or s.customer in (select c.id from public.customer c where c.converted_from_lead = l.id)) as purchase_total,
         (select max(s.sale_date::text) from public.sale s
            where s.lead = l.id
               or s.customer in (select c.id from public.customer c where c.converted_from_lead = l.id)) as last_sale_date
    from public.lead l
)
select
  l.id as lead_id, l.first_name, l.last_name, l.email, l.phone, l.city, l.state,
  l.source_channel, l.created_date::date as lead_created,
  case
    when o.purchase_count    > 0 then 'Purchased'
    when o.appointment_count > 0 then 'Appointment, no purchase'
    else 'No appointment'
  end as category,
  o.appointment_count, o.last_appointment, o.purchase_count, o.purchase_total, o.last_sale_date,
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
join outcome o on o.id = l.id
left join public.ghl_contact_dnd d on d.contact_id = l.ghl_contact_id;

comment on view public.founder_lead_buckets is
  'Every lead bucketed as Purchased / Appointment, no purchase / No appointment, with GHL DND state. security_invoker -- RLS on lead decides who may read it. contact_status is NULL-safe: "unknown - no GHL contact" is a different fact from "contactable".';

revoke all on public.founder_lead_buckets from anon;
grant select on public.founder_lead_buckets to authenticated;
