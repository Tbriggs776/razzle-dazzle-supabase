-- Make the unified feed fast enough to be an inbox.
--
-- communication_feed ordered by created_date took 1.5s on a sequential scan of
-- ghl_message, and the backfill is only halfway -- it would roughly double. The
-- existing ghl_message_sent_idx cannot be used, because the view also filters
-- out activity entries, internal comments and comment threads, and the planner
-- will not combine that filter with an ordered index scan.
--
-- The fix is a partial index whose predicate is character-for-character the
-- view's. Postgres will only use a partial index when it can prove the query's
-- predicate implies the index's, so this has to match rather than merely
-- resemble -- if the view's exclusions ever change, this index must change with
-- them or it silently stops being used and the Hub silently gets slow again.
create index if not exists ghl_message_feed_idx
  on public.ghl_message (sent_at desc)
  where message_type is not null
    and message_type not like 'TYPE_ACTIVITY%'
    and message_type not like 'TYPE_INTERNAL%'
    and message_type not like '%_COMMENT'
    and sent_at is not null;

comment on index public.ghl_message_feed_idx is
  'Serves communication_feed ordered by date. Its predicate must stay identical to the view''s exclusions -- a mismatch does not break correctness, it just stops the index being used and the inbox goes back to a sequential scan.';
