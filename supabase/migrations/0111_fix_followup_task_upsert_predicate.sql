-- ---------------------------------------------------------------------------
-- 0111 -- The nightly create-followup-tasks job has been failing every run.
--
-- backfill_followup_tasks() ends with:
--     on conflict (appointment) where type = 'follow_up' do nothing
-- but the index it is trying to infer is:
--     CREATE UNIQUE INDEX uq_task_followup ON task (appointment)
--       WHERE type = 'follow_up' AND completed_at IS NULL
--
-- For ON CONFLICT to use a PARTIAL unique index, its inference predicate must
-- IMPLY the index predicate. `type = 'follow_up'` is weaker than
-- `type = 'follow_up' AND completed_at IS NULL` -- it admits rows the index does
-- not cover -- so Postgres refuses the inference outright:
--
--     42P10: there is no unique or exclusion constraint matching the
--            ON CONFLICT specification
--
-- Confirmed by calling the function directly. It raises before inserting
-- anything, so cron job 7 (`create-followup-tasks`, 16:30 UTC = 9:30am Phoenix)
-- has been erroring nightly for as long as the index and the function have
-- disagreed.
--
-- ---- WHY NOBODY NOTICED --------------------------------------------------
-- This function is a safety net, not the primary path: the UI creates the
-- follow-up task inline when an appointment is set to Follow-Up. Checked
-- against live data -- 6 appointments are eligible and all 6 already have an
-- open follow-up task, so nothing is currently missing. The net was simply
-- down, and would have stayed down until an appointment slipped through the UI
-- path.
--
-- Verified after the fix: the function runs, and a second consecutive run
-- creates 0, so the conflict clause now does what it was written to do.
-- ---------------------------------------------------------------------------

create or replace function public.backfill_followup_tasks()
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  insert into public.task (appointment, assigned_to, due_date, status, type, notes)
  select a.id, a.assigned_dc, (now() at time zone 'America/Phoenix')::date, 'pending', 'follow_up',
         'Follow-up task auto-created from Follow-Up appointment'
    from public.appointment a
   where a.status = 'Follow-Up' and a.assigned_dc is not null
  -- The inference predicate must MATCH uq_task_followup exactly:
  --   CREATE UNIQUE INDEX uq_task_followup ON task (appointment)
  --     WHERE type = 'follow_up' AND completed_at IS NULL
  -- Omitting `completed_at is null` makes the predicate weaker than the index's,
  -- which Postgres cannot use for inference — it raised 42P10 on every run.
  on conflict (appointment) where type = 'follow_up' and completed_at is null do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;
