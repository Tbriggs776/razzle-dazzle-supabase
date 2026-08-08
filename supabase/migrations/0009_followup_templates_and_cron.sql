-- Post-appointment follow-up flow: day 1/2/3 lead nurture (email + SMS), a
-- per-consultant "pending follow-ups" SMS, and idempotent internal task backfill.
-- Clean port of base44's sendDay{1,2,3}FollowUpEmails / sendFollowUpReminders /
-- createTasksForFollowUps onto the job/comms rails. Handlers live in processJobs.
--
-- Dedup: the day1/2/3 handlers reuse the existing appointment.dayN_followup_email_sent_at
-- stamps (filter IS NULL to select, set after enqueue) — the same fix that removed
-- the reminder double-send. The DC reminder gets a NEW dc_followup_reminded_at stamp;
-- the task backfill is made idempotent by a partial unique index (base44 had neither).

-- 1) Lead follow-up template columns on sms_settings (same home as the reminder
--    templates from 0008, where the dispatch handlers already read settings).
alter table public.sms_settings
  add column if not exists lead_day1_followup_email_subject text,
  add column if not exists lead_day1_followup_email_template text,
  add column if not exists lead_day1_followup_sms_template text,
  add column if not exists send_lead_day1_followup_email boolean not null default true,
  add column if not exists send_lead_day1_followup_sms boolean not null default true,
  add column if not exists divert_lead_day1_followup_email boolean not null default false,
  add column if not exists lead_day2_followup_email_subject text,
  add column if not exists lead_day2_followup_email_template text,
  add column if not exists lead_day2_followup_sms_template text,
  add column if not exists send_lead_day2_followup_email boolean not null default true,
  add column if not exists send_lead_day2_followup_sms boolean not null default true,
  add column if not exists divert_lead_day2_followup_email boolean not null default false,
  add column if not exists lead_day3_followup_email_subject text,
  add column if not exists lead_day3_followup_email_template text,
  add column if not exists lead_day3_followup_sms_template text,
  add column if not exists send_lead_day3_followup_email boolean not null default true,
  add column if not exists send_lead_day3_followup_sms boolean not null default true,
  add column if not exists divert_lead_day3_followup_email boolean not null default false,
  add column if not exists divert_emails_to text,
  add column if not exists dc_followup_reminder_template text,
  add column if not exists send_dc_followup_reminder_sms boolean not null default true;

-- 2) Seed default templates on the singleton settings row (idempotent; coalesce
--    never clobbers an admin edit). base44's real bodies lived in its DB and are
--    not recoverable from source, so these are authored Floor Daddy defaults —
--    fully editable in the Integrations/Settings admin. Placeholders are hydrated
--    by the handlers: {lead_first_name} {lead_name} {appointment_date}
--    {appointment_time} {location_address} {lead_tracking_url}.
update public.sms_settings set
  lead_day1_followup_email_subject = coalesce(lead_day1_followup_email_subject,
    $tpl$We're excited to meet you, {lead_first_name}!$tpl$),
  lead_day1_followup_email_template = coalesce(lead_day1_followup_email_template,
    $tpl$Hi {lead_first_name},

Thanks for scheduling your free in-home flooring consultation with Floor Daddy! We're excited to help you find the perfect floors.

Your appointment is set for {appointment_date} during the {appointment_time} window at {location_address}.

You can view or manage your appointment anytime here: {lead_tracking_url}

If you have any questions before then, just reply to this email.

- The Floor Daddy Team$tpl$),
  lead_day1_followup_sms_template = coalesce(lead_day1_followup_sms_template,
    $tpl$Hi {lead_first_name}, thanks for booking with Floor Daddy! Your consultation is set for {appointment_date} ({appointment_time}). Details: {lead_tracking_url}$tpl$),
  lead_day2_followup_email_subject = coalesce(lead_day2_followup_email_subject,
    $tpl$Getting ready for your Floor Daddy appointment$tpl$),
  lead_day2_followup_email_template = coalesce(lead_day2_followup_email_template,
    $tpl$Hi {lead_first_name},

We're looking forward to your flooring consultation on {appointment_date} during the {appointment_time} window.

To make the most of your appointment, it helps to have a few things ready: the rooms you'd like new flooring in, any inspiration photos, and your questions about materials or budget. Our design consultant will handle the rest.

View your appointment details: {lead_tracking_url}

- The Floor Daddy Team$tpl$),
  lead_day2_followup_sms_template = coalesce(lead_day2_followup_sms_template,
    $tpl$Hi {lead_first_name}! Your Floor Daddy consultation is coming up on {appointment_date} ({appointment_time}). Have your rooms & questions ready. {lead_tracking_url}$tpl$),
  lead_day3_followup_email_subject = coalesce(lead_day3_followup_email_subject,
    $tpl$Your Floor Daddy design appointment is almost here$tpl$),
  lead_day3_followup_email_template = coalesce(lead_day3_followup_email_template,
    $tpl$Hi {lead_first_name},

Just a note that your Floor Daddy flooring consultation is scheduled for {appointment_date} during the {appointment_time} window at {location_address}.

Our design consultant will bring samples and provide a no-pressure, in-home estimate. If anything has changed or you need to reschedule, you can manage your appointment here: {lead_tracking_url}

We look forward to seeing you!

- The Floor Daddy Team$tpl$),
  lead_day3_followup_sms_template = coalesce(lead_day3_followup_sms_template,
    $tpl$Hi {lead_first_name}, we look forward to seeing you {appointment_date} ({appointment_time}) for your Floor Daddy consultation. Need to reschedule? {lead_tracking_url}$tpl$),
  dc_followup_reminder_template = coalesce(dc_followup_reminder_template,
    $tpl$Hi {dc_first_name}! You have {count} follow-up appointment(s) pending: {customer_last_names}. View your tasks: {tasks_url}$tpl$),
  divert_emails_to = coalesce(divert_emails_to, '')
where id = 'sms_settings_1';

-- 3) New dedup stamp for the per-consultant follow-up reminder (base44 had none,
--    so a DC was re-texted the same list every run).
alter table public.appointment
  add column if not exists dc_followup_reminded_at timestamptz;

-- 4) Idempotent task backfill. Partial unique index => at most one follow_up task
--    per appointment, so a recurring backfill never re-spawns duplicates and the
--    check-then-insert race is gone.
create unique index if not exists uq_task_followup
  on public.task (appointment) where type = 'follow_up';

create or replace function public.backfill_followup_tasks()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.task (appointment, assigned_to, due_date, status, type, notes)
  select a.id, a.assigned_dc, (now() at time zone 'America/Phoenix')::date, 'pending', 'follow_up',
         'Follow-up task auto-created from Follow-Up appointment'
    from public.appointment a
   where a.status = 'Follow-Up' and a.assigned_dc is not null
  on conflict (appointment) where type = 'follow_up' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.backfill_followup_tasks() from anon, authenticated;
grant execute on function public.backfill_followup_tasks() to service_role;

-- 5) Schedulers. Each daily at ~09:00 America/Phoenix (16:00 UTC), staggered a few
--    minutes so the dispatch jobs enqueue in a predictable order. Each enqueues a
--    job the minute-ticked processJobs runner claims and runs. cron.schedule upserts
--    by jobname, so re-running is safe.
select cron.schedule('dispatch-day1-followups', '0 16 * * *',  $$ select public.enqueue_job('dispatch_day1_followups'); $$);
select cron.schedule('dispatch-day2-followups', '5 16 * * *',  $$ select public.enqueue_job('dispatch_day2_followups'); $$);
select cron.schedule('dispatch-day3-followups', '10 16 * * *', $$ select public.enqueue_job('dispatch_day3_followups'); $$);
select cron.schedule('dispatch-dc-followup-reminders', '15 16 * * *', $$ select public.enqueue_job('dispatch_dc_followup_reminders'); $$);
select cron.schedule('create-followup-tasks', '30 16 * * *', $$ select public.enqueue_job('create_followup_tasks'); $$);
