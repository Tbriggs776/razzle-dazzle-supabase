-- The backfill is finished; stop paying backfill prices.
--
-- ghlSync ran every 2 minutes because 18,710 conversations had to be pulled and
-- that cadence was what drained the queue. The queue is now empty -- 0 threads
-- pending, 538,289 messages stored -- and the same schedule keeps doing the work
-- anyway. pg_stat_statements has the receipts:
--
--     ghl_link_conversations_to_leads   467 calls   518 ms mean   242 s total
--     count(*) progress queries         467 calls   171 ms mean    80 s total
--
-- Two problems, and cutting the frequency alone only fixes half.
--
-- 1. THE LINK FUNCTION SCANS EVERYTHING TO FIND NOTHING. Its updates are keyed on
--    `lead_id is null`, and the only index on that column is the INVERSE --
--    `where lead_id is not null` -- so each pass sequentially scans 18,710
--    conversations and 538,289 messages to reach 1,373 and 25,076 rows that will
--    never link, because those contacts have no usable phone or email. It finds
--    the same nothing every two minutes and costs 296 ms doing it.
--
--    Partial indexes on exactly the unlinked sets turn that scan into a lookup.
--    They also stay small on purpose: a row leaves the index the moment it gets
--    linked, so the index shrinks as the work completes, which is the opposite
--    of how the existing one behaves.
--
--    Measured warm, after ANALYZE: 296 ms -> 92 ms.
--
-- 2. THE CADENCE IS A BACKFILL CADENCE. Live messages already arrive by webhook
--    in seconds; the sweep only needs to notice new threads and re-pull anything
--    ghl_flag_stale_conversations() has re-queued, and that detector itself runs
--    every 15 minutes. Matching it means the two are never more than one cycle
--    apart, and 720 wake-ups a day become 96.
--
-- Together: ~213 s/day of CPU spent finding nothing becomes ~9 s/day.
create index if not exists ghl_conversation_unlinked_idx
  on public.ghl_conversation (contact_id)
  where lead_id is null;

create index if not exists ghl_message_unlinked_idx
  on public.ghl_message (conversation_id)
  where lead_id is null;

comment on index public.ghl_conversation_unlinked_idx is
  'Serves ghl_link_conversations_to_leads(), whose updates filter on lead_id IS NULL -- the existing ghl_conversation_lead_idx covers the opposite case and cannot help. Shrinks as conversations get linked.';

select cron.unschedule('ghl-conversation-sync');
select cron.schedule(
  'ghl-conversation-sync',
  '*/15 * * * *',
  $$select public.post_internal_fn('ghlSync', '{"mode":"both","conversation_limit":200}'::jsonb);$$
);

analyze public.ghl_conversation;
analyze public.ghl_message;
