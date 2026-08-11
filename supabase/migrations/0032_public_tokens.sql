-- NO4: give the anon public views a dedicated random capability token, decoupled from the primary
-- key. 0011/0023 relied on the id itself being an unguessable UUID — true for records created in
-- the new app, but NOT for anything migrated from base44 (24-char timestamp-prefixed ObjectIds) or
-- seeded with short ids (proj_2, …), which would be enumerable through get_public_appointment /
-- get_public_project. A per-row public_token is unguessable regardless of id shape, keeps the PK out
-- of customer-facing URLs, and could later be rotated to revoke a shared link.
alter table public.appointment add column if not exists public_token text;
alter table public.project     add column if not exists public_token text;

update public.appointment set public_token = gen_random_uuid()::text where public_token is null;
update public.project     set public_token = gen_random_uuid()::text where public_token is null;

alter table public.appointment alter column public_token set default gen_random_uuid()::text;
alter table public.project     alter column public_token set default gen_random_uuid()::text;
alter table public.appointment alter column public_token set not null;
alter table public.project     alter column public_token set not null;

create unique index if not exists appointment_public_token_key on public.appointment (public_token);
create unique index if not exists project_public_token_key     on public.project     (public_token);

-- The anon RPCs now match on public_token (the value passed as p_id is the token, not the PK).
create or replace function public.get_public_appointment(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when a.id is null then null else jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', a.id,
      'status', a.status,
      'appointment_date', a.appointment_date,
      'appointment_block', a.appointment_block,
      'location_address', a.location_address,
      'consultant_en_route_time', a.consultant_en_route_time
    ),
    'lead', case when l.id is null then null else jsonb_build_object(
      'first_name', l.first_name,
      'last_name', l.last_name
    ) end,
    'dc', case when t.id is null then null else jsonb_build_object(
      'first_name', t.first_name,
      'last_name', t.last_name,
      'profile_photo', t.profile_photo,
      'bio', t.bio
    ) end
  ) end
  from public.appointment a
  left join public.lead l on l.id = a.customer
  left join public.team_member t on t.id = a.assigned_dc
  where a.public_token = p_id;
$$;

create or replace function public.get_public_project(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id,
      'status', p.status,
      'installation_date', p.installation_date,
      'installation_date_status', p.installation_date_status,
      'scheduled_start_date', p.scheduled_start_date,
      'scheduled_end_date', p.scheduled_end_date
    ),
    'customer', case when c.id is null then null else jsonb_build_object(
      'first_name', c.first_name,
      'last_name', c.last_name
    ) end,
    'sale', case when s.id is null then null else jsonb_build_object(
      'location_address', s.location_address,
      'contract_file_url', s.contract_file_url
    ) end,
    'projectManager', case when pm.id is null then null else jsonb_build_object(
      'first_name', pm.first_name, 'last_name', pm.last_name,
      'profile_photo', pm.profile_photo, 'email', pm.email, 'phone', pm.phone
    ) end,
    'installationManager', case when im.id is null then null else jsonb_build_object(
      'first_name', im.first_name, 'last_name', im.last_name,
      'profile_photo', im.profile_photo, 'email', im.email, 'phone', im.phone
    ) end,
    'settings', jsonb_build_object(
      'show_progress_tracker', (select show_progress_tracker from public.customer_project_settings limit 1)
    )
  ) end
  from public.project p
  left join public.customer c on c.id = p.customer
  left join public.sale s on s.id = p.sale
  left join public.team_member pm on pm.id = p.project_manager
  left join public.team_member im on im.id = p.installation_manager
  where p.public_token = p_id;
$$;
