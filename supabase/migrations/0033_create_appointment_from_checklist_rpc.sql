-- AT2: atomically create an appointment from a checklist AND link it back, idempotently. The two
-- conversion flows (ChecklistDetail -> appointment_setting_checklist, ChecklistV2Detail ->
-- checklist_v2) did Appointment.create() then a SEPARATE checklist.update(appointment) with no
-- transaction — a failure between them orphaned an unlinked appointment, and a retry created a
-- DUPLICATE (the lead is deduped by email but the appointment is not). This SECURITY DEFINER RPC
-- does both in one transaction and returns the existing linked appointment if the checklist is
-- already converted (idempotent retry). p_checklist_table is whitelisted (no arbitrary tables).
create or replace function public.create_appointment_from_checklist(
  p_checklist_table text,
  p_checklist_id text,
  p_appointment jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.appointment;
  v_existing text;
  v_appt_id text;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not (public.is_org_admin() or public.can_edit('appointments')) then
    raise exception 'Not authorized to create an appointment';
  end if;
  if p_checklist_table not in ('appointment_setting_checklist', 'checklist_v2') then
    raise exception 'Invalid checklist table: %', p_checklist_table;
  end if;

  -- Idempotency: already linked?
  execute format('select appointment from public.%I where id = $1', p_checklist_table)
    into v_existing using p_checklist_id;
  if v_existing is not null then
    return jsonb_build_object('appointment_id', v_existing, 'idempotent', true);
  end if;

  a := jsonb_populate_record(null::public.appointment, p_appointment);
  insert into public.appointment
    (status, customer, location_address, appointment_date, appointment_block, notes, assigned_dc, assigned_csr, appointment_created_date)
  values
    (coalesce(a.status, 'Scheduled'), a.customer, a.location_address, a.appointment_date, a.appointment_block, a.notes, a.assigned_dc, a.assigned_csr, coalesce(a.appointment_created_date, now()))
  returning id into v_appt_id;

  execute format('update public.%I set appointment = $1 where id = $2', p_checklist_table)
    using v_appt_id, p_checklist_id;

  return jsonb_build_object('appointment_id', v_appt_id, 'idempotent', false);
end;
$$;

revoke all on function public.create_appointment_from_checklist(text, text, jsonb) from public, anon;
grant execute on function public.create_appointment_from_checklist(text, text, jsonb) to authenticated;
