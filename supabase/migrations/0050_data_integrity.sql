-- Data-model integrity — must land BEFORE real data is migrated.
--
-- Retrofitting any of this afterwards means a second migration while people are
-- already working in the system, and duplicate customer masters that can never
-- be cleanly unpicked.
--
--   1. convert_to_sale minted a NEW customer on every conversion — the duplicate
--      engine. It now reuses an existing master.
--   2. The business tables had ZERO foreign keys (all 14 existing FKs were on the
--      access model), so nothing stopped an orphan.
--   3. appointment.customer holds a LEAD id despite its name — documented and
--      constrained to the truth.
--   4. Log tables were editable and deletable by anyone with rights on them, so
--      the record that would show a change could be removed by whoever made it.
--
-- Verified against live data before writing: 0 orphans on every relationship
-- constrained below, and 0 duplicate customers today — which is exactly why the
-- constraints can go on now and not later.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. convert_to_sale: reuse the customer master instead of minting a new one.
--
-- Match order, strongest signal first:
--   a. converted_from_lead — this lead already became a customer (the repeat
--      conversion case that produced most duplicates)
--   b. case-insensitive email
--   c. digits-only phone
-- On a match we REUSE the id and only fill columns that are currently blank, so
-- a second sale can add a missing phone but can never silently overwrite the
-- address on file.
--
-- Everything else about the function — the sale/quote idempotency guards, the
-- appointment-flipped-last ordering, the payload shapes — is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_reused boolean := false;
  v_email text;
  v_phone text;
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
  v_email := nullif(lower(trim(coalesce(c.email, ''))), '');
  v_phone := nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '');

  -- (a) this lead already has a customer
  if c.converted_from_lead is not null then
    select id into v_customer_id from public.customer
     where converted_from_lead = c.converted_from_lead
     order by created_date asc limit 1;
  end if;

  -- (b) same email
  if v_customer_id is null and v_email is not null then
    select id into v_customer_id from public.customer
     where lower(trim(coalesce(email, ''))) = v_email
     order by created_date asc limit 1;
  end if;

  -- (c) same phone
  if v_customer_id is null and v_phone is not null then
    select id into v_customer_id from public.customer
     where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone
     order by created_date asc limit 1;
  end if;

  if v_customer_id is not null then
    v_reused := true;
    -- Fill blanks only. Never clobber what is already on the master.
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
$$;

revoke all on function public.convert_to_sale(jsonb,jsonb,jsonb,text,jsonb,text) from public, anon;
grant execute on function public.convert_to_sale(jsonb,jsonb,jsonb,text,jsonb,text) to authenticated;

-- Lookup indexes backing the dedupe above (and any future merge tooling).
create index if not exists customer_email_norm_idx
  on public.customer (lower(trim(coalesce(email, ''))))
  where coalesce(email, '') <> '';
create index if not exists customer_phone_norm_idx
  on public.customer ((regexp_replace(coalesce(phone, ''), '\D', '', 'g')))
  where coalesce(phone, '') <> '';
create index if not exists customer_converted_from_lead_idx
  on public.customer (converted_from_lead)
  where converted_from_lead is not null;

-- Deliberately NOT a unique constraint on email/phone. Real flooring data
-- legitimately shares a contact — spouses, a property manager over forty units,
-- a builder's single AP address. A hard unique would block the data migration
-- itself. Duplicates are prevented at the point of creation (above) and surfaced
-- for review here.
create or replace view public.duplicate_customers as
select
  'email' as match_on,
  lower(trim(email)) as match_value,
  count(*) as copies,
  array_agg(id order by created_date) as customer_ids
from public.customer
where coalesce(email, '') <> ''
group by 1, 2 having count(*) > 1
union all
select
  'phone',
  regexp_replace(phone, '\D', '', 'g'),
  count(*),
  array_agg(id order by created_date)
from public.customer
where coalesce(phone, '') <> ''
group by 1, 2 having count(*) > 1;

comment on view public.duplicate_customers is
  'Review queue for customer masters sharing an email or phone. Shared contacts are legitimate (spouses, property managers, builders), so this reports rather than blocks — check it during data migration.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Foreign keys on the business tables.
--
-- Every relationship below was verified to have 0 orphans against live data.
-- No ON DELETE CASCADE anywhere: cancellation is now a soft flag, so a delete
-- that would orphan a row should FAIL loudly rather than quietly take children
-- with it.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('sale',        'sale_customer_fkey',        'customer',    'customer',    'id'),
      ('sale',        'sale_appointment_fkey',     'appointment', 'appointment', 'id'),
      ('sale',        'sale_lead_fkey',            'lead',        'lead',        'id'),
      ('sale',        'sale_assigned_dc_fkey',     'assigned_dc', 'team_member', 'id'),
      ('project',     'project_sale_fkey',         'sale',        'sale',        'id'),
      ('project',     'project_customer_fkey',     'customer',    'customer',    'id'),
      ('appointment', 'appointment_customer_fkey', 'customer',    'lead',        'id'),
      ('appointment', 'appointment_assigned_dc_fkey', 'assigned_dc', 'team_member', 'id')
    ) as t(tbl, cname, col, ref_tbl, ref_col)
  loop
    if not exists (
      select 1 from information_schema.table_constraints
      where constraint_schema = 'public' and constraint_name = r.cname
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.%I(%I) on update cascade on delete restrict',
        r.tbl, r.cname, r.col, r.ref_tbl, r.ref_col
      );
    end if;
  end loop;
end $$;

-- 3. The misnamed column, documented at the source so the next person is not
-- misled. Every write site passes a lead id, convert_to_sale never repoints it,
-- and CustomerDetail looks appointments up by converted_from_lead.
comment on column public.appointment.customer is
  'LEAD id, not a customer id — despite the name. Every writer passes a lead, and the FK enforces it. Renaming is a separate refactor across ~10 call sites.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Append-only logs.
--
-- An audit trail that the person being audited can edit or delete is not an
-- audit trail. Inserts and reads stay; updates and deletes are revoked from
-- ordinary users (service_role still has them for retention jobs).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['appointment_log', 'project_log', 'ticket_log', 'log'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('revoke update, delete on table public.%I from authenticated, anon', t);
      -- Drop any policy that granted mutation rights, then re-grant insert+select.
      execute format('drop policy if exists mod_update on public.%I', t);
      execute format('drop policy if exists mod_delete on public.%I', t);
      execute format('drop policy if exists %I on public.%I', t || '_append_only_insert', t);
      execute format('drop policy if exists %I on public.%I', t || '_append_only_select', t);
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (true)',
        t || '_append_only_insert', t
      );
      execute format(
        'create policy %I on public.%I for select to authenticated using (true)',
        t || '_append_only_select', t
      );
    end if;
  end loop;
end $$;

comment on table public.appointment_log is 'Append-only. Update/delete revoked from application users.';
comment on table public.project_log is 'Append-only. Update/delete revoked from application users.';
