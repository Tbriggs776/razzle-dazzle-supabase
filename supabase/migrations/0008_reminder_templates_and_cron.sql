-- Appointment reminder templates + dispatch scheduler.
-- Adds the lead reminder message templates to sms_settings and schedules the
-- every-15-min dispatch that enqueues a `dispatch_appointment_reminders` job
-- (handled in the processJobs Edge Function).

alter table public.sms_settings
  add column if not exists send_reminders boolean not null default true,
  add column if not exists lead_reminder_template text,
  add column if not exists lead_reminder_email_subject text,
  add column if not exists lead_reminder_email_template text;

-- Seed default templates on the singleton settings row. coalesce() keeps this
-- idempotent and never clobbers a value an admin has already customized.
update public.sms_settings set
  lead_reminder_template = coalesce(lead_reminder_template,
    $tpl$Reminder: Your Floor Daddy appointment is tomorrow, {appointment_date} during the {appointment_time} window. We look forward to seeing you! Track it: {lead_tracking_url}$tpl$),
  lead_reminder_email_subject = coalesce(lead_reminder_email_subject,
    $tpl$Reminder: Your Floor Daddy Appointment Tomorrow - {lead_name}$tpl$),
  lead_reminder_email_template = coalesce(lead_reminder_email_template,
    $tpl$Hi {lead_first_name},

This is a friendly reminder that your Floor Daddy appointment is scheduled for {appointment_date} during the {appointment_time} window.

Track your appointment here: {lead_tracking_url}

We look forward to seeing you!

- Floor Daddy$tpl$)
where id = 'sms_settings_1';

-- Every 15 minutes, enqueue the dispatch job. The processJobs handler finds
-- tomorrow's Scheduled/Rescheduled appointments not yet reminded (filtering on
-- reminder_email_sent_at is what fixes base44's every-tick double-send), renders
-- the templates above, and enqueues send_sms/send_email jobs through the comms
-- pipeline. cron.schedule upserts by jobname, so re-running is safe.
select cron.schedule('dispatch-appointment-reminders', '*/15 * * * *', $$ select public.enqueue_job('dispatch_appointment_reminders'); $$);
