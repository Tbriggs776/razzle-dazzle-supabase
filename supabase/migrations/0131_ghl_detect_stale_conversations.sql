-- Notice when a conversation has messages we never stored.
--
-- Two paths fill ghl_message: the live webhook and the backfill. Both can miss.
-- A webhook dropped while the database was down is gone -- GHL retries, then
-- gives up -- and the backfill will NOT recover it, because a thread whose
-- messages_synced_at is already set never gets its messages re-fetched. The
-- sweep updates the conversation's summary and moves on. So a text arriving
-- during an outage, on a thread already backfilled, falls through both paths
-- permanently and nothing anywhere says so.
--
-- The detector is the disagreement between the two things we store: the
-- conversation's own last_message_at (refreshed by every sweep) against the
-- newest message actually in the corpus. If the thread says it was active more
-- recently than anything we hold, we are missing messages.
--
-- Clearing messages_synced_at puts it back on the existing work queue; ghlSync
-- re-pulls it on the next pass and upserts on GHL's message ids, so nothing
-- duplicates.
--
-- WHY IT CANNOT LOOP. For a thread that genuinely has no messages, the fallback
-- compares against messages_synced_at rather than a null max(sent_at) -- after a
-- re-pull that timestamp is now(), which is later than last_message_at, so it
-- stops being flagged. The five-minute tolerance keeps an in-flight write from
-- flagging itself mid-sync.
create or replace function public.ghl_flag_stale_conversations(p_tolerance interval default interval '5 minutes')
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.ghl_conversation gc
     set messages_synced_at = null,
         updated_date = now()
   where gc.messages_synced_at is not null
     and gc.last_message_at is not null
     and gc.last_message_at > coalesce(
           (select max(m.sent_at) from public.ghl_message m where m.conversation_id = gc.id),
           gc.messages_synced_at
         ) + p_tolerance;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.ghl_flag_stale_conversations(interval) is
  'Re-queue conversations whose last_message_at is newer than the newest message stored for them -- the signature of a webhook dropped during an outage, which the backfill would otherwise never recover. Idempotent; cannot loop.';

revoke execute on function public.ghl_flag_stale_conversations(interval) from public, anon;
grant execute on function public.ghl_flag_stale_conversations(interval) to authenticated, service_role;

-- Every 15 minutes: cheap, and it is the only thing standing between a dropped
-- webhook and a permanent hole in the record.
select cron.schedule(
  'ghl-detect-stale-conversations',
  '*/15 * * * *',
  $$select public.ghl_flag_stale_conversations();$$
);
