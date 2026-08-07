-- Phase 01 — modular access model, RLS, schema hardening.
-- Applied to the Supabase project via MCP; captured here for reproducibility.
-- Order: (a) access tables + resolver, (b) my_access RPC, (c) indexes,
--        (d) module RLS on the 44 business tables, (e) fn hardening.
-- Seed data (org/modules/pages/roles/permissions) lives in 0003_seed_access_model.sql.

-- ===========================================================================
-- (a) Access model tables + permission resolver
-- ===========================================================================
create table if not exists public.organization (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  plan text not null default 'internal',
  is_active boolean not null default true,
  created_date timestamptz not null default now()
);

create table if not exists public.module (
  key text primary key,
  name text not null,
  icon text,
  sort_order int not null default 0,
  is_core boolean not null default false,
  is_active boolean not null default true
);

create table if not exists public.app_page (
  key text primary key,
  module_key text not null references public.module(key) on delete cascade,
  label text not null,
  route_path text,
  is_public boolean not null default false,
  min_permission text not null default 'view' check (min_permission in ('view','edit','admin'))
);

create table if not exists public.role (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references public.organization(id) on delete cascade,
  key text not null,
  name text not null,
  is_system boolean not null default false,
  sort_order int not null default 0,
  unique (org_id, key)
);

create table if not exists public.role_module_permission (
  id text primary key default gen_random_uuid()::text,
  role_id text not null references public.role(id) on delete cascade,
  module_key text not null references public.module(key) on delete cascade,
  permission text not null default 'none' check (permission in ('none','view','edit','admin')),
  unique (role_id, module_key)
);

create table if not exists public.app_user (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id text not null references public.organization(id) on delete cascade,
  team_member_id text references public.team_member(id) on delete set null,
  is_org_admin boolean not null default false,
  is_active boolean not null default true,
  created_date timestamptz not null default now()
);

create table if not exists public.user_role (
  user_id uuid not null references public.app_user(id) on delete cascade,
  role_id text not null references public.role(id) on delete cascade,
  primary key (user_id, role_id)
);

create table if not exists public.org_module_entitlement (
  org_id text not null references public.organization(id) on delete cascade,
  module_key text not null references public.module(key) on delete cascade,
  is_enabled boolean not null default true,
  primary key (org_id, module_key)
);

create table if not exists public.user_region (
  user_id uuid not null references public.app_user(id) on delete cascade,
  region_assignment_id text not null references public.region_assignment(id) on delete cascade,
  primary key (user_id, region_assignment_id)
);

create index if not exists idx_role_module_permission_role on public.role_module_permission(role_id);
create index if not exists idx_user_role_user on public.user_role(user_id);
create index if not exists idx_app_page_module on public.app_page(module_key);
create index if not exists idx_role_org on public.role(org_id);

create or replace function public.current_user_module_permission(p_module text)
returns text language sql stable security definer set search_path = public as $$
  with me as (
    select id, org_id, is_org_admin from public.app_user
    where id = auth.uid() and is_active = true
  ),
  ent as (
    select e.is_enabled from public.org_module_entitlement e, me
    where e.org_id = me.org_id and e.module_key = p_module
  ),
  lvl as (
    select coalesce(max(case rmp.permission
      when 'admin' then 4 when 'edit' then 3 when 'view' then 2 else 1 end), 1) as n
    from public.user_role ur
    join public.role_module_permission rmp on rmp.role_id = ur.role_id
    where ur.user_id = (select id from me) and rmp.module_key = p_module
  )
  select case
    when (select is_org_admin from me) then 'admin'
    when not coalesce((select is_enabled from ent), false) then 'none'
    else (select case n when 4 then 'admin' when 3 then 'edit' when 2 then 'view' else 'none' end from lvl)
  end;
$$;

create or replace function public.can_view(m text) returns boolean
  language sql stable set search_path = public as
  $$ select public.current_user_module_permission(m) in ('view','edit','admin') $$;

create or replace function public.can_edit(m text) returns boolean
  language sql stable set search_path = public as
  $$ select public.current_user_module_permission(m) in ('edit','admin') $$;

create or replace function public.is_org_admin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.app_user where id = auth.uid() and is_org_admin = true and is_active = true) $$;

-- RLS on the access tables (config readable by authed, writable by admins;
-- identity tables self-readable, admin-managed).
do $$
declare t text;
begin
  foreach t in array array['organization','module','app_page','role','role_module_permission','org_module_entitlement'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists cfg_read on public.%I', t);
    execute format('create policy cfg_read on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists cfg_write on public.%I', t);
    execute format('create policy cfg_write on public.%I for all to authenticated using (public.is_org_admin()) with check (public.is_org_admin())', t);
  end loop;
  foreach t in array array['app_user','user_role','user_region'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists ident_self on public.%I', t);
    execute format('create policy ident_self on public.%I for select to authenticated using (user_id = auth.uid() or public.is_org_admin())', t);
    execute format('drop policy if exists ident_admin on public.%I', t);
    execute format('create policy ident_admin on public.%I for all to authenticated using (public.is_org_admin()) with check (public.is_org_admin())', t);
  end loop;
end $$;
-- app_user keys on id (= auth.uid), not user_id: fix its self policy.
drop policy if exists ident_self on public.app_user;
create policy ident_self on public.app_user for select to authenticated using (id = auth.uid() or public.is_org_admin());

-- ===========================================================================
-- (b) my_access RPC — the current user's modules + pages (drives nav + guard)
-- ===========================================================================
create or replace function public.my_access()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user', (
      select jsonb_build_object(
        'id', au.id, 'org_id', au.org_id, 'is_org_admin', au.is_org_admin,
        'team_member_id', au.team_member_id, 'email', u.email,
        'full_name', coalesce(u.raw_user_meta_data->>'full_name', u.email)
      )
      from public.app_user au join auth.users u on u.id = au.id
      where au.id = auth.uid() and au.is_active
    ),
    'modules', coalesce((
      select jsonb_agg(row_to_json(m) order by m.sort_order)
      from (
        select mo.key, mo.name, mo.icon, mo.sort_order,
          public.current_user_module_permission(mo.key) as permission,
          coalesce((
            select jsonb_agg(jsonb_build_object('key', p.key, 'label', p.label, 'route', p.route_path) order by p.key)
            from public.app_page p where p.module_key = mo.key and p.is_public = false
          ), '[]'::jsonb) as pages
        from public.module mo
        where mo.is_active and public.current_user_module_permission(mo.key) <> 'none'
      ) m
    ), '[]'::jsonb)
  );
$$;

-- ===========================================================================
-- (c) Schema hardening — indexes on hot filter/sort columns
--     (FKs on business text-ids deferred to the data-migration phase)
-- ===========================================================================
create index if not exists idx_appointment_status on public.appointment(status);
create index if not exists idx_appointment_date on public.appointment(appointment_date);
create index if not exists idx_appointment_assigned_dc on public.appointment(assigned_dc);
create index if not exists idx_appointment_assigned_csr on public.appointment(assigned_csr);
create index if not exists idx_appointment_customer on public.appointment(customer);
create index if not exists idx_appointment_created on public.appointment(created_date desc);
create index if not exists idx_sale_assigned_dc on public.sale(assigned_dc);
create index if not exists idx_sale_customer on public.sale(customer);
create index if not exists idx_sale_appointment on public.sale(appointment);
create index if not exists idx_sale_date on public.sale(sale_date desc);
create index if not exists idx_sale_cancelled on public.sale(is_cancelled);
create index if not exists idx_sale_created on public.sale(created_date desc);
create index if not exists idx_lead_email on public.lead(email);
create index if not exists idx_lead_phone on public.lead(phone);
create index if not exists idx_lead_created on public.lead(created_date desc);
create index if not exists idx_customer_email on public.customer(email);
create index if not exists idx_customer_phone on public.customer(phone);
create index if not exists idx_customer_created on public.customer(created_date desc);
create index if not exists idx_project_status on public.project(status);
create index if not exists idx_project_customer on public.project(customer);
create index if not exists idx_project_sale on public.project(sale);
create index if not exists idx_project_install_date on public.project(installation_date);
create index if not exists idx_project_created on public.project(created_date desc);
create index if not exists idx_quote_assigned_dc on public.quote(assigned_dc);
create index if not exists idx_quote_lead on public.quote(lead);
create index if not exists idx_quote_status on public.quote(status);
create index if not exists idx_ticket_assigned_dc on public.ticket(assigned_dc);
create index if not exists idx_ticket_requester on public.ticket(requester);
create index if not exists idx_task_appointment on public.task(appointment);
create index if not exists idx_task_assigned_to on public.task(assigned_to);
create index if not exists idx_task_status on public.task(status);
create index if not exists idx_comm_lead on public.communication(lead_id);
create index if not exists idx_comm_customer on public.communication(customer_id);
create index if not exists idx_comm_appointment on public.communication(appointment_id);
create index if not exists idx_appt_log_appointment on public.appointment_log(appointment);
create index if not exists idx_project_log_project on public.project_log(project);
create index if not exists idx_ticket_log_ticket on public.ticket_log(ticket);
create index if not exists idx_ticket_message_ticket on public.ticket_message(ticket);
create index if not exists idx_asc_appointment on public.appointment_setting_checklist(appointment);
create index if not exists idx_checklist_v2_appointment on public.checklist_v2(appointment);
create index if not exists idx_project_checkpoint_project on public.project_checkpoint(project_id);
create index if not exists idx_team_member_email on public.team_member(email);
create index if not exists idx_team_member_role on public.team_member(role);

-- ===========================================================================
-- (d) Module RLS on the 44 business tables (replaces the permissive POC policy)
-- ===========================================================================
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists poc_all_access on public.%I', t);
  end loop;
end $$;

do $$
declare rec record;
begin
  for rec in select * from (values
    ('appointment','appointments'), ('appointment_log','appointments'),
    ('appointment_setting_checklist','appointments'), ('checklist_v2','appointments'), ('task','appointments'),
    ('lead','leads'), ('ghl_contact_cache','leads'),
    ('customer','customers'), ('customer_project_settings','customers'),
    ('sale','sales'), ('design_mod','sales'), ('manual_sales_contract','sales'),
    ('quote','quotes'),
    ('project','projects'), ('project_checkpoint','projects'), ('project_claim','projects'),
    ('project_log','projects'), ('inspection_report','projects'), ('standalone_pre_install_checklist','projects'),
    ('journey_order','journey'),
    ('rfms_item','order_processing'), ('rfms_order_cache','order_processing'), ('rfms_order_status','order_processing'),
    ('rfms_roll','order_processing'), ('rfms_session','order_processing'),
    ('ticket','tickets'), ('ticket_log','tickets'), ('ticket_message','tickets'),
    ('fleet_driver','fleet'), ('fleet_maintenance','fleet'), ('fleet_vehicle','fleet'),
    ('communication','communication'), ('log','logs')
  ) as v(tbl, module)
  loop
    execute format('alter table public.%I enable row level security', rec.tbl);
    execute format('drop policy if exists mod_select on public.%I', rec.tbl);
    execute format('create policy mod_select on public.%I for select to authenticated using (public.can_view(%L))', rec.tbl, rec.module);
    execute format('drop policy if exists mod_insert on public.%I', rec.tbl);
    execute format('create policy mod_insert on public.%I for insert to authenticated with check (public.can_edit(%L))', rec.tbl, rec.module);
    execute format('drop policy if exists mod_update on public.%I', rec.tbl);
    execute format('create policy mod_update on public.%I for update to authenticated using (public.can_edit(%L)) with check (public.can_edit(%L))', rec.tbl, rec.module, rec.module);
    execute format('drop policy if exists mod_delete on public.%I', rec.tbl);
    execute format('create policy mod_delete on public.%I for delete to authenticated using (public.can_edit(%L))', rec.tbl, rec.module);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['team_member','tag','region_assignment','app_settings','time_block_settings','installer','project_checkpoint_template'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists shared_select on public.%I', t);
    execute format('create policy shared_select on public.%I for select to authenticated using (true)', t);
    execute format('drop policy if exists shared_write on public.%I', t);
    execute format('create policy shared_write on public.%I for all to authenticated using (public.is_org_admin()) with check (public.is_org_admin())', t);
  end loop;
  foreach t in array array['email_settings','sms_settings','role_permissions','alert_group'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_org_admin()) with check (public.is_org_admin())', t);
  end loop;
end $$;

-- ===========================================================================
-- (e) Function hardening (advisor cleanups)
-- ===========================================================================
alter function public.set_updated_date() set search_path = public;
revoke execute on function public.current_user_module_permission(text) from anon;
revoke execute on function public.is_org_admin() from anon;
revoke execute on function public.my_access() from anon;
revoke execute on function public.can_view(text) from anon;
revoke execute on function public.can_edit(text) from anon;
