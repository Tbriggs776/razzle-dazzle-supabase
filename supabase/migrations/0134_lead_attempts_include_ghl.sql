-- An attempt is an attempt, whichever system made it.
--
-- lead_attempt_count() counted outbound rows in `communication` -- everything
-- Razzle sends through Twilio and Resend. Since the GHL integration landed, a
-- large share of real contact happens in GoHighLevel instead, and those land in
-- ghl_message. So a customer who had been called twice and texted three times
-- showed "0 attempts" in the CSR queue.
--
-- That is not cosmetic. lead_disposition.min_attempts gates how a lead may be
-- closed out -- no_contact_exhausted needs 7 attempts over 14 days -- so an
-- undercount blocks a CSR from closing a lead they have genuinely worked, and
-- tells them to keep calling someone who has already been called five times.
--
-- Fixed by widening the definition rather than copying GHL messages into
-- `communication`. One record of a message, in the table that owns it; one
-- definition of "how many times have we reached out", reading both.
--
-- WHAT COUNTS. Outbound contact on a real channel. GHL's message stream also
-- carries system entries -- TYPE_ACTIVITY_OPPORTUNITY when a pipeline stage
-- moves, internal comments, emoji reactions, comment threads on social posts --
-- and none of those is somebody trying to reach a customer. Counting them would
-- inflate the number and let a lead be closed as "exhausted" on the strength of
-- a stage change nobody saw.
--
-- Outcome is deliberately ignored: a call that rang out is still an attempt.
-- Whether it connected is a different question from whether we tried.
--
-- No double-count risk: Razzle sends via Twilio/Resend directly, GHL sends via
-- GHL, and neither writes into the other's table.
create or replace function public.lead_attempt_count(p_lead_id text)
returns int language sql stable security definer set search_path = public as $$
  select (
    select count(*) from public.communication
     where lead_id = p_lead_id and direction = 'outbound' and deleted_at is null
  ) + (
    select count(*) from public.ghl_message
     where lead_id = p_lead_id
       and direction = 'outbound'
       and message_type is not null
       and message_type not like 'TYPE_ACTIVITY%'
       and message_type not like 'TYPE_INTERNAL%'
       and message_type not like '%_COMMENT'
       and message_type not like '%_REACTION'
  );
$$;

comment on function public.lead_attempt_count(text) is
  'How many times we have reached out to this lead, across both systems: outbound `communication` (Twilio/Resend) plus outbound ghl_message on a real channel. GHL activity entries, internal comments, social comments and reactions are excluded -- they are not somebody trying to reach a customer, and counting them would let a lead be closed as exhausted on the strength of a pipeline stage change.';
