-- Tighten the backfill cadence now that each run pulls conversations four at a
-- time instead of one. The first pass finished only 10 threads in a run because
-- it walked them sequentially and started with the busiest ones -- 15,610
-- messages across those 10. With the pool, the limiter is GHL's response time
-- rather than our own serialisation, so running more often actually converts
-- into throughput.
--
-- Still deliberately unhurried: every 2 minutes, 4 in flight, a 60ms gap between
-- calls. Tripping a 429 storm would finish later than never tripping one.
--
-- Unchanged: this needs no turning off when the backfill completes. The cursor
-- reaches the end of the thread list and the same job quietly becomes an
-- incremental sync.
select cron.unschedule('ghl-conversation-sync');
select cron.schedule(
  'ghl-conversation-sync',
  '*/2 * * * *',
  $$select public.post_internal_fn('ghlSync', '{"mode":"both","conversation_limit":200}'::jsonb);$$
);
