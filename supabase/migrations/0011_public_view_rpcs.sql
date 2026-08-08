-- P3: token-scoped access for the anonymous public views.
--
-- The 9 public pages render outside the auth guard and identify a record by its
-- id in the URL. RLS already denies the anon role on every business table (verified:
-- anon SELECT returns 0 rows), so those pages are currently non-functional for real
-- customers. The secure fix is NOT to open blanket anon table access — it's a
-- security-definer RPC that returns ONLY the fields a given page needs, for a SINGLE
-- record, keyed by the row's id. Because ids are random UUIDs (128-bit, non-sequential),
-- the id is itself an unguessable capability token: a customer with their link sees
-- their own record; enumeration is infeasible; tables stay fully denied to anon.
--
-- This migration establishes the pattern with the flagship customer page
-- (LeadAppointmentView). The remaining public views follow the same shape.

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
  where a.id = p_id;
$$;

-- The RPC is the ONLY anon-reachable surface for this data. It exposes a minimal,
-- read-only projection (no phone/email/notes/internal fields) for one id.
grant execute on function public.get_public_appointment(text) to anon, authenticated;
