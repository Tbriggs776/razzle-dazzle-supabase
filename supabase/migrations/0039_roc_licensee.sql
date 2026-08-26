-- Installer onboarding, Phase 1: local mirror of the AZ ROC "posting list" (all current active
-- Arizona contractor licenses, ~58k rows) so we can validate a subcontractor's ROC license and
-- auto-fill their business info instantly, with no live scraping of the Cloudflare/Salesforce ROC
-- site. The ingestRocPostingList edge function fetches the official CSV weekly and atomically
-- swaps it in via staging. roc_lookup(license#) is the single validation entry point.

create extension if not exists pg_trgm;

-- Live table (read only via roc_lookup; direct access locked by RLS w/ no policies).
create table if not exists public.roc_licensee (
  id                bigint generated always as identity primary key,
  license_no        text not null,
  business_name     text,
  dba               text,
  class             text,
  class_detail      text,
  class_type        text,
  address           text,
  city              text,
  state             text,
  zip               text,
  qualifying_party  text,
  issued_date       date,
  expiration_date   date,
  status            text,
  ingested_at       timestamptz not null default now()
);
create index if not exists roc_licensee_license_no_idx on public.roc_licensee (license_no);
create index if not exists roc_licensee_business_trgm on public.roc_licensee using gin (business_name gin_trgm_ops);

alter table public.roc_licensee enable row level security;  -- no policies: only service_role + SECURITY DEFINER roc_lookup can read

-- Staging table the edge function loads each run; swap promotes it atomically.
create table if not exists public.roc_licensee_staging (
  license_no        text,
  business_name     text,
  dba               text,
  class             text,
  class_detail      text,
  class_type        text,
  address           text,
  city              text,
  state             text,
  zip               text,
  qualifying_party  text,
  issued_date       date,
  expiration_date   date,
  status            text
);
alter table public.roc_licensee_staging enable row level security;  -- service_role only

-- Clear staging before a fresh load (so a failed prior run can't leave partial rows behind).
create or replace function public.reset_roc_staging()
returns void language plpgsql security definer set search_path = public as $$
begin
  truncate public.roc_licensee_staging;
end $$;

-- Atomically replace the live table from staging. Guards against wiping good data if the fetch
-- failed and staging is suspiciously small (a real posting list is ~58k rows).
create or replace function public.swap_roc_licensee()
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  select count(*) into n from public.roc_licensee_staging;
  if n < 1000 then
    raise exception 'roc_licensee_staging has only % rows; refusing to swap (likely a failed fetch)', n;
  end if;
  truncate public.roc_licensee;
  insert into public.roc_licensee
    (license_no,business_name,dba,class,class_detail,class_type,address,city,state,zip,qualifying_party,issued_date,expiration_date,status)
  select
    license_no,business_name,dba,class,class_detail,class_type,address,city,state,zip,qualifying_party,issued_date,expiration_date,status
  from public.roc_licensee_staging;
  truncate public.roc_licensee_staging;
  return n;
end $$;

-- The one validation entry point. Normalizes the license number (strip non-digits, pad to 6),
-- aggregates a license's multiple classification rows into one record, and flags active status.
-- Returns 0 rows when the license isn't in the current active posting list.
create or replace function public.roc_lookup(p_license text)
returns table (
  license_no        text,
  business_name     text,
  dba               text,
  qualifying_party  text,
  address           text,
  city              text,
  state             text,
  zip               text,
  issued_date       date,
  expiration_date   date,
  status            text,
  classes           jsonb,
  is_active         boolean,
  ingested_at       timestamptz
) language sql stable security definer set search_path = public as $$
  select
    l.license_no,
    max(l.business_name),
    max(l.dba),
    max(l.qualifying_party),
    max(l.address), max(l.city), max(l.state), max(l.zip),
    max(l.issued_date), max(l.expiration_date), max(l.status),
    jsonb_agg(distinct jsonb_build_object('class', l.class, 'detail', l.class_detail, 'type', l.class_type)),
    bool_or(l.status ilike 'Active') and coalesce(max(l.expiration_date) >= current_date, false),
    max(l.ingested_at)
  from public.roc_licensee l
  where l.license_no = lpad(regexp_replace(coalesce(p_license,''), '\D', '', 'g'), 6, '0')
  group by l.license_no;
$$;

-- roc_lookup is public license data → callable by the pre-login apply page (anon) and staff.
grant execute on function public.roc_lookup(text) to anon, authenticated;
-- Load/swap plumbing is service-role only (invoked by the edge function).
revoke execute on function public.reset_roc_staging() from anon, authenticated;
revoke execute on function public.swap_roc_licensee() from anon, authenticated;

-- Weekly ingest (Mondays 10:00 UTC / ~03:00 America/Phoenix, off-peak). post_internal_fn calls the
-- edge function with the Vault CRON_SECRET. cron.schedule upserts by name, so re-running is safe.
select cron.schedule(
  'roc-posting-list-ingest',
  '0 10 * * 1',
  $$ select public.post_internal_fn('ingestRocPostingList', '{}'::jsonb); $$
);
