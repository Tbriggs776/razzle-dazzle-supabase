-- The other half of the index pair.
--
-- 0138 indexed the ghl_message side and the feed stayed on a sequential scan at
-- 1.2s. The reason is how Postgres executes a UNION ALL: to answer
-- "newest 500 across both" without reading everything, it needs a Merge Append,
-- and a Merge Append needs EVERY branch to deliver rows already in the sort
-- order. One indexed branch is worth nothing on its own -- the planner falls
-- back to appending both in full and sorting 380,000 rows to return 500.
--
-- So `communication` needs the mirror image: ordered by created_date desc, with
-- the same deleted_at filter the view applies.
--
-- MEASURED OUTCOME, and worth being honest about: even with both indexes the
-- planner still prefers a parallel append plus sort for an UNBOUNDED query,
-- because the GHL branch joins to lead and ghl_conversation and so is not a
-- plain ordered scan. What both indexes DO unlock is the bounded query -- add a
-- date window and the plan switches to index scans on both sides, 1.2s to 182ms.
--
-- That is why the Hub asks for a 30-day window rather than "newest 500 of all
-- time". The indexes are necessary but the window is what makes them pay, and
-- an inbox showing the last 30 days is a better inbox than one showing an
-- arbitrary 500 messages anyway.
create index if not exists communication_feed_idx
  on public.communication (created_date desc)
  where deleted_at is null;

comment on index public.communication_feed_idx is
  'Pairs with ghl_message_feed_idx so a date-bounded communication_feed query can be answered by index scans on both branches rather than sorting both tables in full. Both indexes are required; either alone leaves the feed on a sequential scan.';

analyze public.communication;
analyze public.ghl_message;
