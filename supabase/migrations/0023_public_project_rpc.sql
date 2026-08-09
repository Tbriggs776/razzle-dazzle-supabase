-- Public (anon) access for CustomerProjectView, mirroring get_public_appointment (0011).
--
-- The customer project tracker renders outside the auth guard and identifies the project
-- by its id in the URL. RLS denies the anon role on project/customer/sale/team_member, so
-- the page was non-functional for a real (logged-out) customer — it read those tables
-- directly. The secure fix is the same token-scoped pattern: a SECURITY DEFINER RPC that
-- returns ONLY the fields this one page needs, for a SINGLE project, keyed by its id. The
-- id is the unguessable capability (random in production); tables stay fully denied to anon.
--
-- NOTE: unlike the appointment projection, this DELIBERATELY exposes the assigned project /
-- installation managers' work email + phone — that is the point of the page (the customer
-- needs to reach their managers), and matches the original base44 behavior. No other staff,
-- customer, or internal fields are exposed.

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
      'first_name', pm.first_name,
      'last_name', pm.last_name,
      'profile_photo', pm.profile_photo,
      'email', pm.email,
      'phone', pm.phone
    ) end,
    'installationManager', case when im.id is null then null else jsonb_build_object(
      'first_name', im.first_name,
      'last_name', im.last_name,
      'profile_photo', im.profile_photo,
      'email', im.email,
      'phone', im.phone
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
  where p.id = p_id;
$$;

-- The RPC is the ONLY anon-reachable surface for this data (minimal read-only projection).
grant execute on function public.get_public_project(text) to anon, authenticated;
