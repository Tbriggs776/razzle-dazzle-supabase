-- Comms pipeline: delivery tracking on the communication log + a suppression list.
alter table public.communication
  add column if not exists provider text,
  add column if not exists provider_message_id text,
  add column if not exists delivery_status text,
  add column if not exists status_updated_at timestamptz,
  add column if not exists error text;
create index if not exists idx_comm_provider_msg on public.communication(provider_message_id);
create index if not exists idx_comm_delivery_status on public.communication(delivery_status);

create table if not exists public.suppression (
  id text primary key default gen_random_uuid()::text,
  channel text not null check (channel in ('sms','email')),
  value text not null,
  reason text not null,
  created_date timestamptz not null default now(),
  unique (channel, value)
);
alter table public.suppression enable row level security;
drop policy if exists suppression_admin_read on public.suppression;
create policy suppression_admin_read on public.suppression for select to authenticated using (public.is_org_admin());

create or replace function public.normalize_contact(p_channel text, p_value text)
returns text language sql immutable as $$
  select case when p_channel = 'email' then lower(trim(p_value))
              else regexp_replace(coalesce(p_value,''), '\D', '', 'g') end;
$$;

create or replace function public.is_suppressed(p_channel text, p_value text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.suppression where channel = p_channel and value = public.normalize_contact(p_channel, p_value));
$$;

create or replace function public.add_suppression(p_channel text, p_value text, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into public.suppression (channel, value, reason)
  values (p_channel, public.normalize_contact(p_channel, p_value), coalesce(p_reason, 'manual'))
  on conflict (channel, value) do nothing;
$$;

create or replace function public.apply_delivery_status(p_provider_message_id text, p_status text, p_error text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.communication
     set delivery_status = p_status, error = p_error, status_updated_at = now()
   where provider_message_id = p_provider_message_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.add_suppression(text,text,text) from anon, authenticated;
grant execute on function public.add_suppression(text,text,text) to service_role;
revoke execute on function public.apply_delivery_status(text,text,text) from anon, authenticated;
grant execute on function public.apply_delivery_status(text,text,text) to service_role;
revoke execute on function public.is_suppressed(text,text) from anon, authenticated;
grant execute on function public.is_suppressed(text,text) to service_role;
