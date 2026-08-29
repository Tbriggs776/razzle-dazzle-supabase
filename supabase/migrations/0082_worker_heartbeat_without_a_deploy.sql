-- ─────────────────────────────────────────────────────────────────────────────
-- 0082 — Wire up 0081 entirely in the database, so neither piece depends on an
--        edge-function deploy.
--
-- The obvious wiring was to add a record_heartbeat() call and a
-- reclaim_unsent_reminders() call to processJobs/index.ts. Doing it here instead
-- is better on the merits, not just cheaper:
--
--   * THE HEARTBEAT BELONGS IN claim_jobs(). The worker calls it every minute,
--     and that call ARRIVING AT THE DATABASE is the real liveness signal — it
--     proves the whole chain (cron -> tick_jobs -> pg_net -> the function -> the
--     database) is intact. A heartbeat written inside the function body only
--     proves the function started. It also cannot drift out of sync with the
--     code, because claiming a job and recording that you are alive are now the
--     same statement.
--
--   * THE RECLAIM BELONGS ON ITS OWN SCHEDULE. If it lived inside the reminder
--     dispatcher, then a broken worker would mean the backlog is never reclaimed
--     either — the failure and its repair would share a single point of failure.
--
-- A data-modifying CTE is guaranteed by Postgres to execute exactly once and to
-- completion whether or not the primary query reads its output, so the heartbeat
-- lands even on a tick that claims no jobs — which is the overwhelmingly common
-- case and precisely when you still need to know the worker is alive.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.claim_jobs(p_limit integer default 10)
returns setof job language sql security definer set search_path to 'public'
as $$
  with beat as (
    insert into public.system_heartbeat (name, beat_at)
    values ('processJobs', now())
    on conflict (name) do update set beat_at = now()
    returning 1
  )
  update public.job j
     set status = 'running', locked_at = now(), attempts = attempts + 1, updated_date = now()
   where j.id in (
     select id from public.job
      where status = 'pending' and run_at <= now()
      order by priority desc, run_at asc
      limit p_limit
      for update skip locked
   )
  returning j.*;
$$;

-- Independent of the worker, so a dead worker cannot also block its own recovery.
select cron.unschedule('reclaim-unsent-reminders')
 where exists (select 1 from cron.job where jobname = 'reclaim-unsent-reminders');

select cron.schedule('reclaim-unsent-reminders', '*/10 * * * *',
                     'select public.reclaim_unsent_reminders();');
