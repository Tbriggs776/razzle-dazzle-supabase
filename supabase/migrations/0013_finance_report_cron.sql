-- P4: daily finance report scheduler.
-- post_internal_fn() is a reusable helper that POSTs to an internal edge function
-- with the Vault CRON_SECRET (same mechanism as tick_jobs) — for cron-triggered
-- edge functions. The financeReport function builds the pending-payment report and
-- enqueues a send_email job to the finance recipient list (sms_settings.finance_report_emails).

create or replace function public.post_internal_fn(p_path text, p_body jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_secret text; v_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'CRON_SECRET';
  select net.http_post(
    url := 'https://zoyvqznftltlitspgdxn.supabase.co/functions/v1/' || p_path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    body := coalesce(p_body, '{}'::jsonb)
  ) into v_id;
  return v_id;
end $$;
revoke execute on function public.post_internal_fn(text, jsonb) from anon, authenticated;

-- Daily finance report at ~08:00 America/Phoenix (15:00 UTC).
select cron.schedule('finance-report-daily', '0 15 * * *', $$ select public.post_internal_fn('financeReport'); $$);
