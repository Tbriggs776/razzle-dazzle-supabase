-- CR2b + CR3 schedulers. Each enqueues a durable job the runner (processJobs) picks up on its
-- next tick (same pattern as the reminder/follow-up crons). ~02:00 / 02:30 America/Phoenix
-- (09:00 / 09:30 UTC), off-peak. cron.schedule upserts by name, so re-running is safe.
--   purge_old_recordings     — delete raw consultation audio older than the retention window
--                              (default 365 days; the transcript/analysis is kept).
--   cleanup_calendar_orphans — remove Google Calendar events left behind by cancelled appointments.
select cron.schedule('purge-old-recordings',      '0 9 * * *',  $$ select public.enqueue_job('purge_old_recordings'); $$);
select cron.schedule('cleanup-calendar-orphans',  '30 9 * * *', $$ select public.enqueue_job('cleanup_calendar_orphans'); $$);
