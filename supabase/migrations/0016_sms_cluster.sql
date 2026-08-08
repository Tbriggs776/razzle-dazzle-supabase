-- P5: Twilio SMS cluster. The base44 SMSSettings entity carried ~31 SMS columns that
-- were never captured in the generated schema (only the follow-up/reminder SMS columns
-- from 0008/0009 + gp_alert_threshold exist). Add them all, seed authored defaults, and
-- add the inbound-webhook plumbing (dedup index + STOP/START + phone-match RPCs).

-- ── sms_settings: per-type customer/consultant/ticket SMS templates + toggles ──────────
alter table public.sms_settings
  add column if not exists lead_appointment_created_template text,
  add column if not exists lead_rescheduled_template text,
  add column if not exists lead_cancelled_template text,
  add column if not exists lead_consultant_assigned_template text,
  add column if not exists lead_not_sold_template text,
  add column if not exists consultant_assigned_template text,
  add column if not exists consultant_rescheduled_template text,
  add column if not exists consultant_cancelled_template text,
  add column if not exists consultant_on_my_way_template text,
  add column if not exists consultant_arrived_template text,
  add column if not exists customer_sale_confirmation_template text,
  add column if not exists customer_project_created_template text,
  add column if not exists requester_new_message_template text,
  add column if not exists dc_new_message_template text,
  add column if not exists send_lead_sms boolean not null default true,
  add column if not exists send_consultant_sms boolean not null default true,
  add column if not exists send_customer_sale_sms boolean not null default true,
  add column if not exists send_customer_project_sms boolean not null default true,
  add column if not exists send_lead_not_sold_sms boolean not null default true,
  add column if not exists send_ticket_message_sms boolean not null default true,
  -- internal alert rosters (jsonb arrays of team_member ids, except *_phones = raw numbers,
  -- and unassigned_dc_alert_phones which — despite the name — holds team_member ids)
  add column if not exists gp_alert_member_ids jsonb not null default '[]'::jsonb,
  add column if not exists gp_alert_include_dc boolean not null default false,
  add column if not exists past_due_alert_member_ids jsonb not null default '[]'::jsonb,
  add column if not exists past_due_alert_phones jsonb not null default '[]'::jsonb,
  add column if not exists pending_cancellation_alert_member_ids jsonb not null default '[]'::jsonb,
  add column if not exists unassigned_dc_alert_phones jsonb not null default '[]'::jsonb,
  add column if not exists inbound_sms_alert_emails jsonb not null default '[]'::jsonb,
  -- SMS divert (send test/customer texts to an override number instead of the real recipient)
  add column if not exists test_divert_enabled boolean not null default false,
  add column if not exists test_divert_phone text,
  add column if not exists customer_divert_enabled boolean not null default false,
  add column if not exists customer_divert_phone text;

-- Seed authored default templates on the singleton row (coalesce; admin-editable). Kept
-- short (single-segment where possible). base44 shipped defaults for only a couple of these.
update public.sms_settings set
  lead_appointment_created_template = coalesce(lead_appointment_created_template,
    $t$Hi {lead_first_name}! Your Floor Daddy consultation is set for {appointment_date} ({appointment_time}) at {appointment_address}. Details: {lead_tracking_url}$t$),
  lead_rescheduled_template = coalesce(lead_rescheduled_template,
    $t$Hi {lead_first_name}, your Floor Daddy appointment has been moved to {appointment_date} ({appointment_time}). Details: {lead_tracking_url}$t$),
  lead_cancelled_template = coalesce(lead_cancelled_template,
    $t$Hi {lead_first_name}, your Floor Daddy appointment for {appointment_date} has been cancelled. Reply here if you would like to reschedule.$t$),
  lead_consultant_assigned_template = coalesce(lead_consultant_assigned_template,
    $t$Hi {lead_first_name}! {consultant_first_name} will be your Floor Daddy design consultant for your {appointment_date} appointment. Details: {lead_tracking_url}$t$),
  lead_not_sold_template = coalesce(lead_not_sold_template,
    $t$Hi {lead_first_name}, thanks for your time today! If you have any questions about your flooring project, just reply here.$t$),
  consultant_assigned_template = coalesce(consultant_assigned_template,
    $t$Hi {consultant_first_name}, you have a new appointment with {lead_name} on {appointment_date} ({appointment_time}) at {appointment_address}. Details: {consultant_tracking_url}$t$),
  consultant_rescheduled_template = coalesce(consultant_rescheduled_template,
    $t$Hi {consultant_first_name}, your appointment with {lead_name} was rescheduled to {appointment_date} ({appointment_time}). Details: {consultant_tracking_url}$t$),
  consultant_cancelled_template = coalesce(consultant_cancelled_template,
    $t$Hi {consultant_first_name}, your appointment with {lead_name} on {appointment_date} has been cancelled.$t$),
  consultant_on_my_way_template = coalesce(consultant_on_my_way_template,
    $t$Hi {lead_first_name}, your Floor Daddy consultant {consultant_first_name} is on the way to your {appointment_time} appointment!$t$),
  consultant_arrived_template = coalesce(consultant_arrived_template,
    $t$Hi {lead_first_name}, your Floor Daddy consultant {consultant_first_name} has arrived for your appointment.$t$),
  customer_sale_confirmation_template = coalesce(customer_sale_confirmation_template,
    $t$Hi {customer_first_name}, thank you for choosing Floor Daddy! Track your project here: {project_tracker_url}$t$),
  customer_project_created_template = coalesce(customer_project_created_template,
    $t$Hi {customer_first_name}, your Floor Daddy project is underway! Follow along here: {project_tracker_url}$t$),
  requester_new_message_template = coalesce(requester_new_message_template,
    $t$Hi {requester_first_name}! You have a new message on ticket for Order #{order_number} from {sender_name}: "{message}" View ticket: {requester_ticket_url}$t$),
  dc_new_message_template = coalesce(dc_new_message_template,
    $t$Hi {dc_first_name}! You have a new message on ticket for Order #{order_number} from {sender_name}: "{message}" View ticket: {ticket_url}$t$)
where id = 'sms_settings_1';

-- ── Inbound webhook plumbing ───────────────────────────────────────────────────────────
-- Idempotency: Twilio may retry an inbound POST. Outbound rows use provider_message_id and
-- never set it on inbound, so a partial unique index on inbound rows dedupes on MessageSid.
create unique index if not exists uq_comm_inbound_msgid
  on public.communication(provider_message_id)
  where direction = 'inbound' and provider_message_id is not null;

-- START/UNSTOP: reverse an opt-out. (add_suppression already exists for STOP.)
create or replace function public.remove_suppression(p_channel text, p_value text)
returns void language sql security definer set search_path = public as $$
  delete from public.suppression
  where channel = p_channel and value = public.normalize_contact(p_channel, p_value);
$$;
revoke execute on function public.remove_suppression(text, text) from anon, authenticated;
grant execute on function public.remove_suppression(text, text) to service_role;

-- Match an inbound phone to a lead/customer by last-10-digits (prefer the newest lead, else
-- the newest customer) — a DB query instead of base44's load-500-rows-and-scan-in-memory.
create or replace function public.find_contact_by_phone(p_phone text)
returns table(lead_id text, customer_id text, contact_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  p10 text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  r record;
begin
  if p10 = '' then return; end if;
  select id, first_name, last_name into r from public.lead
    where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = p10
    order by created_date desc limit 1;
  if found then
    lead_id := r.id; customer_id := null;
    contact_name := nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), '');
    return next; return;
  end if;
  select id, first_name, last_name into r from public.customer
    where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = p10
    order by created_date desc limit 1;
  if found then
    lead_id := null; customer_id := r.id;
    contact_name := nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), '');
    return next; return;
  end if;
  return;
end;
$$;
revoke execute on function public.find_contact_by_phone(text) from anon, authenticated;
grant execute on function public.find_contact_by_phone(text) to service_role;
