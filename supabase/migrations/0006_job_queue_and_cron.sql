-- Async job queue + scheduler. Replaces base44's cron-job.org dependency and the
-- in-request polling loops. Handlers run in the processJobs Edge Function.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.job (
  id text primary key default gen_random_uuid()::text,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed','canceled')),
  run_at timestamptz not null default now(),
  priority int not null default 0,
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  result jsonb,
  locked_at timestamptz,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);
create index if not exists idx_job_due on public.job (run_at) where status = 'pending';
create index if not exists idx_job_status on public.job (status);

alter table public.job enable row level security;
drop policy if exists job_admin_read on public.job;
create policy job_admin_read on public.job for select to authenticated using (public.is_org_admin());

create or replace function public.enqueue_job(p_type text, p_payload jsonb default '{}'::jsonb, p_run_at timestamptz default now(), p_max_attempts int default 5)
returns text language sql security definer set search_path = public as $$
  insert into public.job (type, payload, run_at, max_attempts)
  values (p_type, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_at, now()), coalesce(p_max_attempts, 5))
  returning id;
$$;

create or replace function public.admin_enqueue_job(p_type text, p_payload jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin() then raise exception 'not authorized'; end if;
  return public.enqueue_job(p_type, p_payload, now(), 5);
end $$;

create or replace function public.claim_jobs(p_limit int default 10)
returns setof public.job language sql security definer set search_path = public as $$
  update public.job j
     set status = 'running', locked_at = now(), attempts = attempts + 1, updated_date = now()
   where j.id in (
     select id from public.job where status = 'pending' and run_at <= now()
      order by priority desc, run_at asc limit p_limit for update skip locked
   )
  returning j.*;
$$;

create or replace function public.complete_job(p_id text, p_result jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  update public.job set status = 'succeeded', result = coalesce(p_result, '{}'::jsonb), locked_at = null, last_error = null, updated_date = now() where id = p_id;
$$;

create or replace function public.fail_job(p_id text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare j public.job;
begin
  select * into j from public.job where id = p_id;
  if j.attempts >= j.max_attempts then
    update public.job set status = 'failed', last_error = p_error, locked_at = null, updated_date = now() where id = p_id;
  else
    update public.job set status = 'pending', last_error = p_error, locked_at = null,
      run_at = now() + (power(2, j.attempts)::text || ' minutes')::interval, updated_date = now() where id = p_id;
  end if;
end $$;

revoke execute on function public.enqueue_job(text,jsonb,timestamptz,int) from anon, authenticated;
grant execute on function public.enqueue_job(text,jsonb,timestamptz,int) to service_role;
revoke execute on function public.claim_jobs(int) from anon, authenticated;
grant execute on function public.claim_jobs(int) to service_role;
revoke execute on function public.complete_job(text,jsonb) from anon, authenticated;
grant execute on function public.complete_job(text,jsonb) to service_role;
revoke execute on function public.fail_job(text,text) from anon, authenticated;
grant execute on function public.fail_job(text,text) to service_role;
revoke execute on function public.admin_enqueue_job(text,jsonb) from anon;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'CRON_SECRET') then
    perform vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'CRON_SECRET', 'job scheduler tick auth');
  end if;
end $$;

create or replace function public.tick_jobs()
returns void language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'CRON_SECRET';
  perform net.http_post(
    url := 'https://zoyvqznftltlitspgdxn.supabase.co/functions/v1/processJobs',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
end $$;

select cron.schedule('tick-jobs', '* * * * *', $$ select public.tick_jobs(); $$);
