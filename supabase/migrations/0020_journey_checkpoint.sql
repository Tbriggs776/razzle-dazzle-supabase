-- P10: installation-journey checkpoint workflow (submitCheckpoint port).
-- The checkpoint handler inserts new project_checkpoint rows, so id needs a default; and the
-- notification test/customer divert needs email destinations (SMS divert columns exist from 0016).
alter table public.project_checkpoint alter column id set default gen_random_uuid()::text;
alter table public.sms_settings
  add column if not exists test_divert_email text,
  add column if not exists customer_divert_email text;
