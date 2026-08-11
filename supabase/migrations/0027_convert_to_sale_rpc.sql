-- AT1: one atomic, idempotent conversion for BOTH the appointment "Sold" flow
-- (ConsultantAppointmentView) and the quote "Convert" flow (QuoteDetail).
--
-- Before: the frontend created Customer -> Sale -> Project in sequence with NO transaction and
-- flipped appointment.status='Sold' FIRST, so a mid-sequence failure left a "Sold" appointment
-- with no Sale/Project (counted as sold-with-zero-dollars by the reporting RPCs) and a re-click
-- double-created the whole chain. This RPC does it all in ONE transaction, flips the appointment
-- LAST, and is idempotent: if the appointment already has a Sale (or the quote is already
-- Converted), it returns the existing ids instead of creating duplicates.
--
-- Payloads are jsonb shaped exactly like the entity .create() calls the pages already build;
-- jsonb_populate_record casts each field to its column type. customer/sale/project ids and
-- created_date/updated_date use their column defaults (gen_random_uuid()::text / now()).
create or replace function public.convert_to_sale(
  p_customer jsonb,
  p_sale jsonb,
  p_project jsonb,
  p_appointment_id text default null,
  p_appointment_update jsonb default '{}'::jsonb,
  p_quote_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.customer;
  s public.sale;
  pr public.project;
  v_customer_id text;
  v_sale_id text;
  v_project_id text;
  v_existing_sale text;
  v_existing_project text;
  au jsonb := coalesce(p_appointment_update, '{}'::jsonb);
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

  -- Idempotency: already converted? Return the existing sale/project rather than duplicating.
  if p_quote_id is not null then
    select converted_sale_id into v_existing_sale from public.quote where id = p_quote_id;
    if v_existing_sale is not null then
      select id into v_existing_project from public.project where sale = v_existing_sale limit 1;
      return jsonb_build_object('sale_id', v_existing_sale, 'project_id', v_existing_project, 'idempotent', true);
    end if;
  end if;
  if p_appointment_id is not null then
    select id into v_existing_sale from public.sale where appointment = p_appointment_id limit 1;
    if v_existing_sale is not null then
      select id into v_existing_project from public.project where sale = v_existing_sale limit 1;
      return jsonb_build_object('sale_id', v_existing_sale, 'project_id', v_existing_project, 'idempotent', true);
    end if;
  end if;

  c := jsonb_populate_record(null::public.customer, p_customer);
  insert into public.customer
    (first_name,last_name,email,phone,address_line1,address_line2,city,state,zip,notes,converted_from_lead,created_by)
  values
    (c.first_name,c.last_name,c.email,c.phone,c.address_line1,c.address_line2,c.city,c.state,c.zip,c.notes,c.converted_from_lead,c.created_by)
  returning id into v_customer_id;

  s := jsonb_populate_record(null::public.sale, p_sale);
  insert into public.sale
    (appointment,customer,lead,assigned_dc,sale_date,contract_file_url,appointment_date,appointment_block,location_address,
     sale_amount,deposit_amount,notes,folder_photo_url,yard_sign_photo_url,yard_sign_opted_out,driver_license_photo_url,
     product_photos,deposit_payment_method,check_number,check_date,pre_install_checklist_signature_url,pre_install_product_info,created_by)
  values
    (s.appointment, v_customer_id, s.lead, s.assigned_dc, coalesce(s.sale_date, now()), s.contract_file_url, s.appointment_date, s.appointment_block, s.location_address,
     s.sale_amount, s.deposit_amount, s.notes, s.folder_photo_url, s.yard_sign_photo_url, coalesce(s.yard_sign_opted_out,false), s.driver_license_photo_url,
     s.product_photos, s.deposit_payment_method, s.check_number, s.check_date, s.pre_install_checklist_signature_url, s.pre_install_product_info, s.created_by)
  returning id into v_sale_id;

  pr := jsonb_populate_record(null::public.project, p_project);
  insert into public.project
    (sale,customer,status,installation_date,pre_install_checklist_signature_url,pre_install_product_info,created_by)
  values
    (v_sale_id, v_customer_id, coalesce(pr.status,'Accepted'), pr.installation_date, pr.pre_install_checklist_signature_url, pr.pre_install_product_info, pr.created_by)
  returning id into v_project_id;

  -- Flip the appointment LAST (status + optional appended notes / installation_date).
  if p_appointment_id is not null then
    update public.appointment set
      status = 'Sold',
      notes = coalesce(au->'notes', notes),
      installation_date = coalesce((au->>'installation_date')::date, installation_date),
      updated_date = now()
    where id = p_appointment_id;
  end if;

  -- Mark the quote Converted (quote flow only).
  if p_quote_id is not null then
    update public.quote set status = 'Converted', converted_sale_id = v_sale_id, updated_date = now() where id = p_quote_id;
  end if;

  return jsonb_build_object('sale_id', v_sale_id, 'project_id', v_project_id, 'customer_id', v_customer_id, 'idempotent', false);
end;
$$;

revoke all on function public.convert_to_sale(jsonb,jsonb,jsonb,text,jsonb,text) from public, anon;
grant execute on function public.convert_to_sale(jsonb,jsonb,jsonb,text,jsonb,text) to authenticated;
