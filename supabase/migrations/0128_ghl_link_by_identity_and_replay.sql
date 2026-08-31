-- Two problems, both about conversations that exist but connect to nothing.
--
-- PROBLEM 1 — THE CORPUS IS ORPHANED. ghl_link_conversations_to_leads() matched
-- on ghl_contact_id only. Exactly 7 of 2,101 leads carry one, because the rest
-- were imported from base44 before this integration existed. So 18,700
-- conversations were landing attached to almost nothing: the transcript was
-- there, but not which customer or job it belonged to, which is precisely what
-- makes it useless for analysis. 17,218 conversations carry a phone number and
-- 13,102 carry an email, and 2,100 leads have phone_e164 — the identities were
-- always matchable, the function just was not looking.
--
-- Matching follows the same precedence upsert_lead uses, strongest first:
-- ghl_contact_id, then phone, then email. Phone before email is not arbitrary —
-- the base44 import proved this data set contains junk in the email column
-- ('na', 'sdvsgg', and a phone number typed into an email field), so email is
-- both weaker and likelier to fuse two unrelated customers. It is matched last
-- and only when it actually looks like an address.
--
-- On a successful phone or email match the lead's ghl_contact_id is filled in,
-- so the expensive identity match happens once and every later conversation for
-- that person resolves on the cheap id path.
--
-- PROBLEM 2 — LIVE MESSAGES WERE ARRIVING AND BEING DROPPED. InboundMessage and
-- OutboundMessage were reaching ghlWebhook and falling through to its default
-- branch as 'ignored'. Nothing was lost: the full payload is retained in
-- ghl_webhook_event. ghl_replay_message_webhooks() reads that log and writes the
-- messages that were missed.
--
-- It is deliberately a reconciler rather than a one-off backfill: it is cheap,
-- idempotent, and re-runnable, so it also covers any future gap between what the
-- webhook receiver banked and what actually reached the corpus.

-- ---- linking -----------------------------------------------------------------
-- The return type gains three columns, so the old signature has to go first;
-- CREATE OR REPLACE cannot change a function's OUT parameters.
drop function if exists public.ghl_link_conversations_to_leads();

create or replace function public.ghl_link_conversations_to_leads()
returns table (linked_by_contact_id int, linked_by_phone int, linked_by_email int,
               lead_ids_backfilled int, messages_linked int)
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; m int;
begin
  -- 1. Strongest: GHL's own contact id.
  update public.ghl_conversation gc
     set lead_id = l.id, updated_date = now()
    from public.lead l
   where gc.lead_id is null
     and gc.contact_id is not null
     and l.ghl_contact_id = gc.contact_id;
  get diagnostics a = row_count;

  -- 2. Phone, normalised through the same to_e164 the lead column is generated
  --    with, so both sides key identically.
  update public.ghl_conversation gc
     set lead_id = l.id, updated_date = now()
    from public.lead l
   where gc.lead_id is null
     and l.phone_e164 is not null
     and l.phone_e164 = public.to_e164(nullif(btrim(gc.raw->>'phone'), ''));
  get diagnostics b = row_count;

  -- 3. Email last, and only when it is plausibly an email. The import proved
  --    this column carries junk, and a bad email match merges two customers.
  update public.ghl_conversation gc
     set lead_id = l.id, updated_date = now()
    from public.lead l
   where gc.lead_id is null
     and l.email is not null
     and lower(btrim(l.email)) = lower(btrim(gc.raw->>'email'))
     and gc.raw->>'email' ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
     and l.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$';
  get diagnostics c = row_count;

  -- 4. Teach the lead its GHL id so the next conversation resolves on step 1.
  --    Only fills blanks; never overwrites an id already known.
  update public.lead l
     set ghl_contact_id = gc.contact_id, updated_date = now()
    from public.ghl_conversation gc
   where gc.lead_id = l.id
     and gc.contact_id is not null
     and l.ghl_contact_id is null;
  get diagnostics d = row_count;

  -- 5. Messages inherit their conversation's lead.
  update public.ghl_message gm
     set lead_id = gc.lead_id
    from public.ghl_conversation gc
   where gm.conversation_id = gc.id
     and gm.lead_id is null
     and gc.lead_id is not null;
  get diagnostics m = row_count;

  return query select a, b, c, d, m;
end $$;

comment on function public.ghl_link_conversations_to_leads() is
  'Attach conversations to leads by contact id, then phone, then email (email last and pattern-guarded, because the imported data carries junk in that column). Backfills lead.ghl_contact_id on a successful identity match so later conversations resolve on the cheap path. Safe and cheap to re-run.';

revoke execute on function public.ghl_link_conversations_to_leads() from public, anon;
grant execute on function public.ghl_link_conversations_to_leads() to authenticated, service_role;

-- ---- replaying banked message webhooks ---------------------------------------
create or replace function public.ghl_replay_message_webhooks()
returns table (conversations_created int, messages_written int)
language plpgsql security definer set search_path = public as $$
declare conv int; msg int;
begin
  -- A message needs its conversation to exist first (FK). Create stubs only for
  -- conversations the corpus has never seen; an existing row keeps its richer
  -- `raw` from the thread sweep rather than being flattened by a message event.
  with src as (
    select distinct on (payload->>'conversationId')
           payload->>'conversationId' as conv_id,
           payload->>'locationId'     as location_id,
           payload->>'contactId'      as contact_id,
           payload                    as raw
      from public.ghl_webhook_event
     where event_type in ('InboundMessage','OutboundMessage')
       and nullif(payload->>'conversationId','') is not null
     order by payload->>'conversationId', received_at desc
  )
  insert into public.ghl_conversation (id, location_id, contact_id, raw)
  select conv_id, coalesce(location_id, 'unknown'), contact_id, raw from src
  on conflict (id) do nothing;
  get diagnostics conv = row_count;

  -- messageId, not id: the webhook names it differently from the REST payload.
  with src as (
    select distinct on (payload->>'messageId')
           payload->>'messageId'      as id,
           payload->>'conversationId' as conversation_id,
           payload->>'locationId'     as location_id,
           payload->>'contactId'      as contact_id,
           payload->>'direction'      as direction,
           coalesce(payload->>'messageType', payload->>'messageTypeString') as message_type,
           payload->>'status'         as status,
           payload->>'body'           as body,
           coalesce(
             nullif(payload->>'dateAdded','')::timestamptz,
             nullif(payload->>'timestamp','')::timestamptz
           )                          as sent_at,
           payload                    as raw
      from public.ghl_webhook_event
     where event_type in ('InboundMessage','OutboundMessage')
       and nullif(payload->>'messageId','') is not null
       and nullif(payload->>'conversationId','') is not null
     order by payload->>'messageId', received_at desc
  )
  insert into public.ghl_message (id, conversation_id, location_id, contact_id,
                                  direction, message_type, status, body, sent_at, raw)
  select s.id, s.conversation_id, s.location_id, s.contact_id,
         s.direction, s.message_type, s.status, s.body, s.sent_at, s.raw
    from src s
   where exists (select 1 from public.ghl_conversation gc where gc.id = s.conversation_id)
  on conflict (id) do update set
    status       = excluded.status,
    body         = coalesce(excluded.body, public.ghl_message.body),
    message_type = coalesce(excluded.message_type, public.ghl_message.message_type),
    raw          = excluded.raw;
  get diagnostics msg = row_count;

  return query select conv, msg;
end $$;

comment on function public.ghl_replay_message_webhooks() is
  'Write ghl_message rows from message webhooks banked in ghl_webhook_event. Idempotent and re-runnable: a reconciler between what the receiver recorded and what reached the corpus, not a one-time backfill.';

revoke execute on function public.ghl_replay_message_webhooks() from public, anon;
grant execute on function public.ghl_replay_message_webhooks() to authenticated, service_role;
