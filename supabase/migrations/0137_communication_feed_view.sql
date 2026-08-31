-- One feed, two systems.
--
-- The Communication Hub reads `communication` -- what Razzle sends through
-- Twilio and Resend. Most real customer conversation now happens in
-- GoHighLevel and lands in ghl_message, so the Hub has been showing a fraction
-- of the picture: 11,691 rows out of 394,000.
--
-- This is the same shape of gap as lead_attempt_count(), and it gets the same
-- answer: widen the read, do not copy the data. Each message stays in the table
-- that owns it. Copying 380,000 rows into `communication` would double the
-- storage, duplicate every future message, and quietly break the Hub's own
-- actions -- delete, reply, mark-read all operate on rows this system is
-- supposed to own, and a copy is not the original.
--
-- SHAPED AS A DROP-IN. Every column the Hub touches -- type, direction,
-- contact_phone, contact_name, body, sent_by, created_date -- is present with
-- the same meaning, so the component needs a source swap and nothing more.
-- `source` is added so the Hub can badge or filter by system, and so its archive
-- action can tell which messages are actually ours to hide.
--
-- WHAT IS EXCLUDED, AND WHY. GHL's message stream carries activity entries
-- (TYPE_ACTIVITY_OPPORTUNITY when a pipeline stage moves), internal comments,
-- social comment threads and emoji reactions. None of those is a message to a
-- customer. Showing them in an inbox would bury the actual conversation under
-- system noise -- the same reasoning that keeps them out of the attempt count.
--
-- Soft-deleted communications stay hidden, as they are in the Hub today.
--
-- ON PHONE NUMBER: which end of the call is the customer depends on direction.
-- Outbound means they are the `to`; inbound means they are the `from`. Getting
-- this backwards would group every conversation under the company's own number.
create or replace view public.communication_feed as
select
  c.id,
  c.type,
  c.direction,
  c.contact_phone,
  c.contact_email,
  c.contact_name,
  c.body,
  c.subject,
  c.status,
  c.delivery_status,
  c.lead_id,
  c.customer_id,
  c.appointment_id,
  c.project_id,
  c.claim_id,
  c.sent_by,
  c.provider,
  c.visible_to_customer,
  c.created_date,
  'razzle'::text            as source,
  null::text                as ghl_conversation_id
from public.communication c
where c.deleted_at is null

union all

select
  'ghl:' || m.id                                             as id,
  case
    when m.message_type in ('TYPE_SMS','TYPE_SMS_REACTION')          then 'SMS'
    when m.message_type in ('TYPE_EMAIL','TYPE_CUSTOM_EMAIL')        then 'Email'
    when m.message_type = 'TYPE_CALL'                                then 'Call'
    when m.message_type in ('TYPE_INSTAGRAM','TYPE_FACEBOOK',
                            'TYPE_GMB','TYPE_WHATSAPP')              then 'Social'
    else 'Other'
  end                                                        as type,
  m.direction,
  -- The customer is whichever end we are not.
  coalesce(
    case when m.direction = 'outbound' then m.raw->>'to' else m.raw->>'from' end,
    l.phone_e164, l.phone, gc.raw->>'phone'
  )                                                          as contact_phone,
  coalesce(l.email, gc.raw->>'email')                        as contact_email,
  coalesce(
    nullif(btrim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')), ''),
    nullif(btrim(gc.raw->>'fullName'), ''),
    nullif(btrim(gc.raw->>'contactName'), '')
  )                                                          as contact_name,
  m.body,
  null::text                                                 as subject,
  m.status,
  m.status                                                   as delivery_status,
  m.lead_id,
  null::text                                                 as customer_id,
  null::text                                                 as appointment_id,
  null::text                                                 as project_id,
  null::text                                                 as claim_id,
  null::text                                                 as sent_by,
  'gohighlevel'::text                                        as provider,
  false                                                      as visible_to_customer,
  m.sent_at                                                  as created_date,
  'ghl'::text                                                as source,
  m.conversation_id                                          as ghl_conversation_id
from public.ghl_message m
left join public.ghl_conversation gc on gc.id = m.conversation_id
left join public.lead l              on l.id = m.lead_id
where m.message_type is not null
  and m.message_type not like 'TYPE_ACTIVITY%'
  and m.message_type not like 'TYPE_INTERNAL%'
  and m.message_type not like '%_COMMENT'
  and m.sent_at is not null;

comment on view public.communication_feed is
  'Every customer message from both systems: Razzle''s own communication rows plus GoHighLevel messages, in one shape. Read-only and deliberately not a copy -- each message stays in the table that owns it, and the Hub''s reply/delete actions continue to operate on `communication`. GHL activity entries, internal comments and social comment threads are excluded: they are not messages to a customer.';

alter view public.communication_feed set (security_invoker = on);

revoke all on public.communication_feed from anon;
grant select on public.communication_feed to authenticated;
