-- ─────────────────────────────────────────────────────────────────────────────
-- 0052 — convert_to_sale writes the payment ledger.
--
-- RECOVERED FROM PRODUCTION 2026-08-29. This migration was applied to the
-- database (supabase_migrations: 20260828223125 convert_to_sale_writes_payment_ledger)
-- but its file was never committed, so the repo could not rebuild production:
-- a clean replay from source produced a convert_to_sale that set
-- sale.deposit_amount and created NO payment row, meaning every new sale showed
-- the full amount owed and the deposit gate could never be satisfied.
--
-- The body below is a faithful dump of the deployed function, verified against
-- pg_get_functiondef by round-tripping it before committing.
--
-- KNOWN GAP recorded here rather than silently changed: this function checks
-- auth.uid() is not null (authentication) but performs NO role check
-- (authorization), so any authenticated account — including a freshly
-- auto-provisioned one with zero module grants — can mint a customer + sale +
-- project. Tightening it is a deliberate follow-up, not a drive-by edit, because
-- the appointment→Sold and quote→Convert flows both run through here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.convert_to_sale(p_customer jsonb, p_sale jsonb, p_project jsonb, p_appointment_id text DEFAULT NULL::text, p_appointment_update jsonb DEFAULT '{}'::jsonb, p_quote_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.customer;
  s public.sale;
  pr public.project;
  v_customer_id text;
  v_sale_id text;
  v_project_id text;
  v_existing_sale text;
  v_existing_project text;
  v_reused boolean := false;
  v_email text;
  v_phone text;
  au jsonb := coalesce(p_appointment_update, '{}'::jsonb);
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

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
  v_email := nullif(lower(trim(coalesce(c.email, ''))), '');
  v_phone := nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '');

  if c.converted_from_lead is not null then
    select id into v_customer_id from public.customer
     where converted_from_lead = c.converted_from_lead
     order by created_date asc limit 1;
  end if;
  if v_customer_id is null and v_email is not null then
    select id into v_customer_id from public.customer
     where lower(trim(coalesce(email, ''))) = v_email
     order by created_date asc limit 1;
  end if;
  if v_customer_id is null and v_phone is not null then
    select id into v_customer_id from public.customer
     where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone
     order by created_date asc limit 1;
  end if;

  if v_customer_id is not null then
    v_reused := true;
    update public.customer set
      first_name          = coalesce(nullif(first_name, ''), c.first_name),
      last_name           = coalesce(nullif(last_name, ''), c.last_name),
      email               = coalesce(nullif(email, ''), c.email),
      phone               = coalesce(nullif(phone, ''), c.phone),
      address_line1       = coalesce(nullif(address_line1, ''), c.address_line1),
      address_line2       = coalesce(nullif(address_line2, ''), c.address_line2),
      city                = coalesce(nullif(city, ''), c.city),
      state               = coalesce(nullif(state, ''), c.state),
      zip                 = coalesce(nullif(zip, ''), c.zip),
      converted_from_lead = coalesce(converted_from_lead, c.converted_from_lead),
      updated_date        = now()
    where id = v_customer_id;
  else
    insert into public.customer
      (first_name,last_name,email,phone,address_line1,address_line2,city,state,zip,notes,converted_from_lead,created_by)
    values
      (c.first_name,c.last_name,c.email,c.phone,c.address_line1,c.address_line2,c.city,c.state,c.zip,c.notes,c.converted_from_lead,c.created_by)
    returning id into v_customer_id;
  end if;

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

  -- THE FIX: the deposit taken at the table becomes a ledger entry immediately,
  -- so sale_balance.amount_paid is right from the moment the sale exists.
  if coalesce(s.deposit_amount, 0) > 0 then
    insert into public.payment (sale, customer, amount, payment_date, method, reference, kind, notes, recorded_by)
    values (v_sale_id, v_customer_id, round(s.deposit_amount::numeric, 2),
            coalesce(s.check_date, (coalesce(s.sale_date, now()))::date, current_date),
            s.deposit_payment_method, s.check_number, 'deposit',
            'Deposit captured at point of sale.', coalesce(public.jwt_email(), 'system'));
  end if;

  pr := jsonb_populate_record(null::public.project, p_project);
  insert into public.project
    (sale,customer,status,installation_date,pre_install_checklist_signature_url,pre_install_product_info,created_by)
  values
    (v_sale_id, v_customer_id, coalesce(pr.status,'Accepted'), pr.installation_date, pr.pre_install_checklist_signature_url, pr.pre_install_product_info, pr.created_by)
  returning id into v_project_id;

  if p_appointment_id is not null then
    update public.appointment set
      status = 'Sold',
      notes = coalesce(au->'notes', notes),
      installation_date = coalesce((au->>'installation_date')::date, installation_date),
      updated_date = now()
    where id = p_appointment_id;
  end if;

  if p_quote_id is not null then
    update public.quote set status = 'Converted', converted_sale_id = v_sale_id, updated_date = now() where id = p_quote_id;
  end if;

  return jsonb_build_object(
    'sale_id', v_sale_id, 'project_id', v_project_id, 'customer_id', v_customer_id,
    'customer_reused', v_reused, 'idempotent', false
  );
end;
$function$;
