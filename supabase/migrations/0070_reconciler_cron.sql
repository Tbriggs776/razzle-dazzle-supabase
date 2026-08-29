-- Hourly. The rules carry hour-granularity SLAs, and the function is idempotent
-- by construction, so a missed or repeated run costs nothing.
--
-- Runs in-database rather than through the HTTP job queue: there is no external
-- call to make, and keeping it out of processJobs means a Twilio/Resend outage
-- cannot stop work from being assigned.
select cron.unschedule('reconcile-tasks')
 where exists (select 1 from cron.job where jobname = 'reconcile-tasks');

select cron.schedule(
  'reconcile-tasks',
  '7 * * * *',            -- offset off the hour, away from the other 13 jobs
  $$select public.reconcile_tasks()$$
);
