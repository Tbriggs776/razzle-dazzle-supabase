-- One channel, one label.
--
-- GHL names message types differently depending on how you learn about them.
-- The REST history endpoint says TYPE_SMS and TYPE_CALL; the live webhook says
-- SMS and CALL. Both land in ghl_message, so the same text message is recorded
-- under two different labels depending on which path happened to catch it.
--
-- That is quietly poisonous for the thing this corpus exists for. "How many
-- texts did we send before that job stalled" silently misses every message
-- captured by the other path, and the split is invisible unless you happen to
-- group by message_type and notice two rows that mean the same thing.
--
-- Fixed with a trigger rather than in the writers, because there are three of
-- them -- ghlSync's backfill, ghlWebhook's live handler, and
-- ghl_replay_message_webhooks -- and a fourth will eventually be written by
-- someone who does not know this rule. Normalising at the table means no caller
-- has to remember.
--
-- Canonical form is TYPE_*, matching the 45,000 rows already stored and GHL's
-- own REST vocabulary. Anything already prefixed is left alone; a bare label is
-- prefixed; case is normalised upward because both sources shout it anyway.
create or replace function public.ghl_message_canonical_type()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.message_type is not null then
    new.message_type := upper(btrim(new.message_type));
    if new.message_type <> '' and new.message_type not like 'TYPE\_%' then
      new.message_type := 'TYPE_' || new.message_type;
    end if;
    if new.message_type = '' then
      new.message_type := null;
    end if;
  end if;
  return new;
end $$;

comment on function public.ghl_message_canonical_type() is
  'Normalise ghl_message.message_type to GHL''s TYPE_* vocabulary. The live webhook says SMS where the REST history says TYPE_SMS; without this the same channel is stored under two labels and any count over message_type is wrong.';

drop trigger if exists trg_ghl_message_canonical_type on public.ghl_message;
create trigger trg_ghl_message_canonical_type
  before insert or update of message_type on public.ghl_message
  for each row execute function public.ghl_message_canonical_type();

-- Repair what was written before the trigger existed. Small today (40 rows, all
-- from the first hours of live capture) and it would only ever grow.
update public.ghl_message
   set message_type = 'TYPE_' || upper(btrim(message_type))
 where message_type is not null
   and btrim(message_type) <> ''
   and upper(btrim(message_type)) not like 'TYPE\_%';
