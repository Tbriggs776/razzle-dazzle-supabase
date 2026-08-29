-- ─────────────────────────────────────────────────────────────────────────────
-- 0081 — Audit items A9 and A10. Do this BEFORE the Twilio from-number is
--        provisioned, because arming delivery on top of A9 is unrecoverable.
--
-- ── A9: the reminder backlog ─────────────────────────────────────────────────
-- dispatch_appointment_reminders enqueues a reminder and immediately stamps
-- appointment.reminder_email_sent_at. The queued send is then dropped by the
-- disarm gate and recorded as skipped. Because the selection filter is
-- `reminder_email_sent_at IS NULL`, the appointment is excluded FOREVER — so the
-- day the from-number is provisioned, every already-stamped customer silently
-- gets nothing.
--
-- Live proof before writing this: 62 of 63 outbound communications are skips
-- (58 skipped_unconfigured, 4 skipped_disarmed), 30 of them tied to an
-- appointment, and NOT ONE has ever been delivered.
--
-- TWO TRAPS THE OBVIOUS FIX WALKS INTO, which is why this is a reconciler and
-- not "stamp only on success":
--   1. The stamp is also the DEDUP GUARD. dispatch-appointment-reminders runs
--      every 15 minutes; without the stamp it would re-enqueue on every run.
--   2. The stamp is SHARED by the SMS and the email path. Clearing it because
--      the text was skipped would send a SECOND email.
--
-- So instead: leave the stamp alone, and reclaim it only when we can prove
-- nothing was delivered. Three guards make a double-send impossible —
--   * the appointment must still be in the future,
--   * NO communication for it may have been delivered (anything not 'skipped'),
--   * at least one CONFIG-level skip must exist to explain the gap.
-- Once a reminder really goes out, a non-skipped row exists and the appointment
-- can never be reclaimed again. It is idempotent and it self-heals the moment the
-- provider is configured — no manual backfill, no cutover step to remember.
--
-- 'suppressed' and 'invalid_phone' are deliberately NOT reclaimable: the customer
-- opted out or the number is unusable, and retrying achieves nothing.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.reclaim_unsent_reminders()
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_count int;
begin
  with reclaimable as (
    select a.id
      from public.appointment a
     where a.reminder_email_sent_at is not null
       and a.status in ('Scheduled', 'Rescheduled')
       -- Never resurrect a reminder for an appointment that has already happened.
       and a.appointment_date >= (now() at time zone 'America/Phoenix')::date
       -- Nothing may have actually reached this customer.
       and not exists (
         select 1 from public.communication c
          where c.appointment_id = a.id
            and coalesce(c.status, '') <> 'skipped'
       )
       -- …and we must be able to explain WHY, so we never clear a stamp we do
       -- not understand.
       and exists (
         select 1 from public.communication c
          where c.appointment_id = a.id
            and c.delivery_status in ('skipped_unconfigured', 'skipped_disarmed', 'deferred_quiet_hours')
       )
  )
  update public.appointment a
     set reminder_email_sent_at = null
    from reclaimable r
   where a.id = r.id;

  get diagnostics v_count = row_count;

  -- NOTE: log.details is JSONB, not text — same shape as task.created_reason.
  -- Caught by the test, not by review.
  if v_count > 0 then
    insert into public.log (type, level, function_name, message, details)
    values ('system', 'info', 'reclaim_unsent_reminders',
            v_count || ' appointment reminder(s) reclaimed',
            jsonb_build_object(
              'reclaimed', v_count,
              'why', 'Marked sent but never left the building; eligible again now the provider can deliver.'));
  end if;

  return v_count;
end $$;

revoke all on function public.reclaim_unsent_reminders() from public, anon;
grant execute on function public.reclaim_unsent_reminders() to service_role;

-- ── A10, part 1: jobs stuck in 'running' ─────────────────────────────────────
-- claim_jobs() only ever selects status='pending', so a worker killed mid-batch
-- (one real SERVICE_DEGRADED 503 is already in the logs) leaves its rows at
-- 'running' forever with their retries unspent — a deposit receipt or a low-GP
-- alert simply vanishes. No job is stuck right now (all 8277 are 'succeeded'),
-- so this is preventive.
create or replace function public.reap_stuck_jobs(p_stale_minutes int default 10)
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_count int;
begin
  update public.job
     set status = 'pending',
         locked_at = null,
         last_error = coalesce(last_error || ' | ', '')
                      || 'reclaimed after being stuck in running for over '
                      || p_stale_minutes || ' minutes',
         updated_date = now()
   where status = 'running'
     and locked_at is not null
     and locked_at < now() - make_interval(mins => p_stale_minutes)
     -- Respect the retry budget: a job that has exhausted its attempts is a
     -- failure to look at, not something to spin forever.
     and coalesce(attempts, 0) < coalesce(max_attempts, 5);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.reap_stuck_jobs(int) from public, anon;
grant execute on function public.reap_stuck_jobs(int) to service_role;

-- ── A10, part 2: knowing the queue stopped ───────────────────────────────────
-- tick_jobs fires net.http_post and discards the result. pg_net is async, so
-- cron logs success as soon as the request is QUEUED — rotate CRON_SECRET without
-- redeploying and the queue stops draining entirely while every dashboard reads
-- healthy. The first signal today is a customer phoning on Wednesday.
create table if not exists public.system_heartbeat (
  name        text primary key,
  beat_at     timestamptz not null default now(),
  detail      jsonb
);
alter table public.system_heartbeat enable row level security;

drop policy if exists system_heartbeat_read on public.system_heartbeat;
create policy system_heartbeat_read on public.system_heartbeat
  for select to authenticated using (public.is_org_admin());

create or replace function public.record_heartbeat(p_name text, p_detail jsonb default null)
returns void language sql security definer set search_path to 'public'
as $$
  insert into public.system_heartbeat (name, beat_at, detail)
  values (p_name, now(), p_detail)
  on conflict (name) do update set beat_at = now(), detail = excluded.detail;
$$;

revoke all on function public.record_heartbeat(text, jsonb) from public, anon;
grant execute on function public.record_heartbeat(text, jsonb) to service_role;

-- Raises ONE acknowledgement-required inbox notice per stale worker. The
-- dedupe_key is per worker (not per run), so a queue that has been down for two
-- days is one row that refreshes, never a wall of identical alerts.
create or replace function public.check_worker_health(p_stale_minutes int default 20)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare h record; v_admin uuid; v_raised int := 0; v_stale text[] := '{}';
begin
  for h in
    select name, beat_at from public.system_heartbeat
     where beat_at < now() - make_interval(mins => p_stale_minutes)
  loop
    v_stale := v_stale || h.name::text;
    for v_admin in select id from public.app_user
                    where is_org_admin and coalesce(is_active, true) loop
      perform public.notify(
        v_admin,
        'The background worker has stopped',
        h.name || ' last ran ' || to_char(h.beat_at at time zone 'America/Phoenix', 'Mon DD HH24:MI')
          || '. Reminders, follow-ups and outbound messages are not being sent while this is down.',
        'system', 'crit', null, null, '/Settings',
        'worker_health', 'worker_stale:' || h.name, true);
      v_raised := v_raised + 1;
    end loop;
  end loop;

  return jsonb_build_object('stale_workers', v_stale, 'notices_raised', v_raised);
end $$;

revoke all on function public.check_worker_health(int) from public, anon;
grant execute on function public.check_worker_health(int) to service_role;

-- ── Schedules ────────────────────────────────────────────────────────────────
select cron.unschedule('reap-stuck-jobs')    where exists (select 1 from cron.job where jobname = 'reap-stuck-jobs');
select cron.unschedule('check-worker-health') where exists (select 1 from cron.job where jobname = 'check-worker-health');

select cron.schedule('reap-stuck-jobs', '*/5 * * * *', $$ select public.reap_stuck_jobs(); $$);
-- Every 10 minutes, but the notice itself dedupes per worker, so this cannot spam.
select cron.schedule('check-worker-health', '*/10 * * * *', $$ select public.check_worker_health(); $$);
