-- Drive the GHL conversation backfill on a schedule.
--
-- ghlSync is deliberately incapable of finishing in one call: it works against a
-- cursor until its time budget runs out, then returns. That design only pays off
-- if something calls it repeatedly, which is this.
--
-- Every 5 minutes, matching the cadence of the other sweep jobs. Each run does
-- roughly a minute of work, so this is a slow grind rather than a thundering
-- backfill -- deliberate, because GHL rate-limits and because there is no
-- deadline on history that is already years old.
--
-- IT DOES NOT NEED TURNING OFF WHEN THE BACKFILL FINISHES. Once the cursor
-- reaches the end of the thread list, the same job becomes an incremental sync:
-- the conversation sweep resumes from the saved cursor and picks up only threads
-- that have appeared since, and the message pass finds nothing pending. A
-- completed backfill costs one cheap API call every five minutes and keeps the
-- corpus current, which is what you want anyway once webhooks and history meet.
--
-- conversation_limit is set high enough that the 50s time budget, not the row
-- count, is what ends each run. That keeps throughput at whatever the API will
-- actually sustain instead of a number guessed here.
select cron.schedule(
  'ghl-conversation-sync',
  '*/5 * * * *',
  $$select public.post_internal_fn('ghlSync', '{"mode":"both","conversation_limit":150}'::jsonb);$$
);
