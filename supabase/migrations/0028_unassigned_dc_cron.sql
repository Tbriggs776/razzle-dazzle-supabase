-- CR1: schedule the daily "unassigned DC" alert. The smsDispatch handler (type=unassigned_dc)
-- already exists with Friday->Sunday look-ahead logic proving a daily cadence, but no cron ever
-- invoked it. Mirrors the finance-report scheduler (post_internal_fn -> internal edge call with
-- the Vault CRON_SECRET). ~08:00 America/Phoenix (15:00 UTC). cron.schedule upserts by name.
select cron.schedule(
  'unassigned-dc-alert-daily',
  '0 15 * * *',
  $$ select public.post_internal_fn('smsDispatch', '{"type":"unassigned_dc"}'::jsonb); $$
);
