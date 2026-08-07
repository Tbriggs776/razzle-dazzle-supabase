-- Self-service integrations admin, backed by Supabase Vault.
-- Secrets live in vault.secrets (encrypted, service-role read only). This table
-- holds only non-secret status/config + field definitions that drive the UI.
create table if not exists public.integration (
  key text primary key,
  name text not null,
  category text not null,
  is_enabled boolean not null default false,
  status text not null default 'not_configured' check (status in ('not_configured','configured','verified','error','disabled')),
  last_tested_at timestamptz,
  last_error text,
  config jsonb not null default '{}'::jsonb,
  secret_fields jsonb not null default '[]'::jsonb,
  config_fields jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  updated_date timestamptz not null default now()
);

alter table public.integration enable row level security;
drop policy if exists integration_admin_read on public.integration;
create policy integration_admin_read on public.integration for select to authenticated using (public.is_org_admin());

-- Admin RPCs (gated on is_org_admin). Secrets never leave the DB.
create or replace function public.admin_set_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_org_admin() then raise exception 'not authorized'; end if;
  if p_value is null or length(trim(p_value)) = 0 then raise exception 'empty secret'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then perform vault.create_secret(p_value, p_name, 'integration secret');
  else perform vault.update_secret(v_id, p_value, p_name, 'integration secret'); end if;
end $$;

create or replace function public.admin_clear_secret(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin() then raise exception 'not authorized'; end if;
  delete from vault.secrets where name = p_name;
end $$;

create or replace function public.admin_set_integration(p_key text, p_is_enabled boolean, p_config jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin() then raise exception 'not authorized'; end if;
  update public.integration
     set is_enabled = coalesce(p_is_enabled, is_enabled),
         config = coalesce(p_config, config), updated_date = now()
   where key = p_key;
end $$;

create or replace function public.admin_get_integrations()
returns jsonb language sql security definer set search_path = public as $$
  select case when public.is_org_admin() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', i.key, 'name', i.name, 'category', i.category,
      'is_enabled', i.is_enabled, 'status', i.status,
      'last_tested_at', i.last_tested_at, 'last_error', i.last_error,
      'config', i.config, 'config_fields', i.config_fields,
      'secret_fields', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', sf->>'name', 'label', sf->>'label',
          'is_set', exists(select 1 from vault.secrets vs where vs.name = sf->>'name')
        )), '[]'::jsonb)
        from jsonb_array_elements(i.secret_fields) sf
      )) order by i.sort_order)
    from public.integration i), '[]'::jsonb) else '[]'::jsonb end;
$$;

-- Service-role-only accessor for Vault secrets (Edge Functions call this).
create or replace function public.get_secret(p_name text)
returns text language sql security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

revoke execute on function public.admin_set_secret(text,text) from anon;
revoke execute on function public.admin_clear_secret(text) from anon;
revoke execute on function public.admin_set_integration(text,boolean,jsonb) from anon;
revoke execute on function public.admin_get_integrations() from anon;
revoke execute on function public.get_secret(text) from public, anon, authenticated;
grant execute on function public.get_secret(text) to service_role;

-- Seed the 8 providers.
insert into public.integration (key, name, category, sort_order, secret_fields, config_fields, config) values
  ('twilio','Twilio','Messaging',10,
    '[{"name":"TWILIO_ACCOUNT_SID","label":"Account SID"},{"name":"TWILIO_AUTH_TOKEN","label":"Auth Token"}]'::jsonb,
    '[{"name":"from_number","label":"From Number (E.164)","type":"text","placeholder":"+14805551234"},{"name":"messaging_service_sid","label":"Messaging Service SID","type":"text","placeholder":"MG..."}]'::jsonb,'{}'::jsonb),
  ('resend','Resend','Email',20,
    '[{"name":"RESEND_API_KEY","label":"API Key"}]'::jsonb,
    '[{"name":"from_email","label":"From Email","type":"text","placeholder":"no-reply@notifications.floordaddy.com"}]'::jsonb,'{}'::jsonb),
  ('rfms','RFMS','ERP',30,
    '[{"name":"RFMS_BEARER_TOKEN","label":"Store Token (storeId:apiKey)"}]'::jsonb,
    '[{"name":"auth_scheme","label":"Auth Scheme","type":"text","placeholder":"Bearer or Basic"}]'::jsonb,'{"auth_scheme":"Bearer"}'::jsonb),
  ('ghl','GoHighLevel','CRM',40,
    '[{"name":"GHL_PIT_TOKEN","label":"Private Integration Token"}]'::jsonb,
    '[{"name":"GHL_LOCATION_ID","label":"Location ID","type":"text"}]'::jsonb,'{}'::jsonb),
  ('assemblyai','AssemblyAI','AI · Audio',50,
    '[{"name":"ASSEMBLYAI_API_KEY","label":"API Key"},{"name":"ASSEMBLYAI_WEBHOOK_SECRET","label":"Webhook Secret"}]'::jsonb,
    '[]'::jsonb,'{}'::jsonb),
  ('anthropic','Claude (Anthropic)','AI · LLM',60,
    '[{"name":"ANTHROPIC_API_KEY","label":"API Key"}]'::jsonb,
    '[{"name":"model","label":"Model","type":"text","placeholder":"claude-sonnet-5"}]'::jsonb,'{"model":"claude-sonnet-5"}'::jsonb),
  ('google','Google APIs','Google',70,
    '[{"name":"GOOGLE_MAPS_API_KEY","label":"Maps / Geocoding API Key"}]'::jsonb,
    '[{"name":"calendar_auth_model","label":"Calendar/Sheets Auth Model","type":"text","placeholder":"service_account | shared_oauth | per_user"}]'::jsonb,'{}'::jsonb),
  ('shortio','Short.io','Utility',80,
    '[{"name":"SHORTIO_API_KEY","label":"API Key"}]'::jsonb,
    '[{"name":"SHORTIO_DOMAIN","label":"Short-link Domain","type":"text","placeholder":"go.floordaddy.com"}]'::jsonb,'{}'::jsonb)
on conflict (key) do update set
  name=excluded.name, category=excluded.category, sort_order=excluded.sort_order,
  secret_fields=excluded.secret_fields, config_fields=excluded.config_fields;

-- Register the admin page in the access model (settings module, admin-only).
insert into public.app_page (key, module_key, label, route_path, is_public, min_permission)
values ('Integrations','settings','Integrations','/Integrations', false, 'admin')
on conflict (key) do update set module_key=excluded.module_key, label=excluded.label, min_permission=excluded.min_permission;
