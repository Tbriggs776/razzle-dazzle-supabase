-- Reconciliation fix: 12 sms_settings columns were added to base44 (and to 0001_create_schema.sql
-- + the frontend) AFTER 0001 had already been applied to the live DB, so they never got created.
-- The settings UI (NotificationTemplates.jsx) and the ticket/appointment pages read & write these,
-- so without them saving those settings would fail at runtime. This ALTER brings the live DB in line
-- with 0001. Idempotent (add column if not exists) — safe to run on any environment.
--
-- Three features these back:
--   • Ticket SMS notifications  (dc_ticket_assigned / requester_category_resolved / dc_resolution_denied / dc_ticket_reminder)
--   • Lead reminder EMAIL send + divert toggles
--   • Appointment photo-capture requirements (folder photo / yard-sign photo)

alter table public.sms_settings
  add column if not exists "send_lead_reminder_email"          boolean default true,
  add column if not exists "divert_lead_reminder_email"        boolean default false,
  add column if not exists "dc_ticket_assigned_template"       text,
  add column if not exists "requester_category_resolved_template" text,
  add column if not exists "dc_resolution_denied_template"     text,
  add column if not exists "dc_ticket_reminder_template"       text,
  add column if not exists "send_dc_ticket_sms"                boolean default true,
  add column if not exists "send_requester_resolved_sms"       boolean default true,
  add column if not exists "send_dc_resolution_denied_sms"     boolean default true,
  add column if not exists "send_dc_ticket_reminder_sms"       boolean default true,
  add column if not exists "require_folder_photo"              boolean default true,
  add column if not exists "require_yard_sign_photo"           boolean default true;
