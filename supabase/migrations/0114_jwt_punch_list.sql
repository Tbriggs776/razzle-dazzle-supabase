-- ─────────────────────────────────────────────────────────────────────────────
-- 0114 — The JWT punch list. Three specs (playbooks, role matrix, ops flow)
-- all open with "do not start until this is closed", and they are right to:
-- every one of them adds surface on top of these gates.
--
-- ── THE THREE ITEMS, VERIFIED LIVE BEFORE FIXING ────────────────────────────
-- 1. convert_to_sale checked only `auth.uid() is not null`. Any JWT — a
--    subcontractor crew login, an inactive roster-less signup — could create
--    customers, sales, projects and LEDGER PAYMENT ROWS. It is SECURITY
--    DEFINER, so RLS never sees any of it.
-- 2. Ten edge functions gate on "has a JWT" with no module check: invokeLLM,
--    rfmsQuery, googleSheets (the three the specs name) plus analyzeRecording,
--    emailDispatch, financeReport, googleMaps, notifyInstallerAssigned,
--    pdfEmail, shortenUrl, syncCalendarEvent. Fixed in this commit's TS
--    changes using the helpers below.
-- 3. The inactive-session hole. current_user_module_permission already
--    requires app_user.is_active, so RLS is closed — but everything in items
--    1 and 2 never asked it. And the client consumed a 'user_not_registered'
--    error that nothing ever produced, so an inactive login just saw an empty
--    app while its session kept working against the any-JWT functions.
--
-- One module check closes both holes at once, because the permission resolver
-- returns 'none' for inactive users. That is why the fix is these two small
-- functions and not a parallel session system.
--
-- ── is_active_staff() ───────────────────────────────────────────────────────
-- "An active app_user who is org admin or holds at least one role." The
-- role-holding clause is what excludes CREW logins: the portal work (0092/0095)
-- deliberately activates crew signups, so is_active alone no longer means
-- staff. Used by the generic dispatchers (emailDispatch, shortenUrl) whose
-- callers span too many modules for an honest narrow list.
--
-- ── has_module_access(modules[], level) ─────────────────────────────────────
-- True when ANY of the listed modules is held at >= level. One RPC round trip
-- for an edge function instead of N. Runs as the caller (auth.uid()), so it
-- inherits is_active and entitlement from current_user_module_permission.
--
-- ── convert_to_sale ─────────────────────────────────────────────────────────
-- ⚠️ DELIBERATE DEVIATION from the spec's literal "needs can_edit('sales')":
-- the two UI callers are ConsultantAppointmentView (the DC 'Sold' flow) and
-- QuoteDetail (quote convert), and the DESIGN CONSULTANT role holds
-- appointments:edit and quotes:edit but NO sales module at all — verified
-- against role_module_permission. Gating on sales alone would lock the people
-- who actually convert sales out of converting sales. The gate is therefore
-- sales OR appointments OR quotes at edit, or org admin. A crew login and an
-- inactive signup hold none of those and are refused.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_active_staff()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.app_user au
     where au.id = auth.uid()
       and au.is_active
       and (au.is_org_admin
            or exists (select 1 from public.user_role ur where ur.user_id = au.id))
  );
$$;

create or replace function public.has_module_access(p_modules text[], p_level text default 'view')
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from unnest(p_modules) m
    where case public.current_user_module_permission(m)
            when 'admin' then 4 when 'edit' then 3 when 'view' then 2 else 1 end
          >= case p_level when 'admin' then 4 when 'edit' then 3 else 2 end
  );
$$;

revoke all on function public.is_active_staff() from public, anon;
revoke all on function public.has_module_access(text[], text) from public, anon;
grant execute on function public.is_active_staff() to authenticated, service_role;
grant execute on function public.has_module_access(text[], text) to authenticated, service_role;

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

  -- The punch-list gate. See the migration header for why appointments and
  -- quotes are admitted alongside sales: DCs convert, and DCs hold no sales
  -- module. current_user_module_permission enforces is_active, so an inactive
  -- login fails here too.
  if not (public.is_org_admin() or public.can_edit('sales')
          or public.can_edit('appointments') or public.can_edit('quotes')) then
    raise exception 'Not authorized to convert a sale';
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
