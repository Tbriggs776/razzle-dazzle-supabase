-- Installer onboarding, Phase 2: the "Subcontractor Profile" that FD-01 §1.5 says lives in Floor
-- Daddy's contractor management system. Backs the pre-login "Install with Floor Daddy" apply page
-- (anon, token-scoped) and staff review. Sensitive data (full TIN, bank/routing) is NEVER stored
-- as plaintext here — only masked last-4 + bank name/type; the full values live in the uploaded
-- W-9 and (Phase 3) the sealed ACH PDF.

create table if not exists public.installer_application (
  id                     uuid primary key default gen_random_uuid(),
  -- unguessable capability token: the apply/resume link carries this, anon RPCs gate on it
  public_token           text not null unique default encode(gen_random_bytes(16), 'hex'),

  -- Business identity (Subcontractor Profile, FD-01 §1.5)
  legal_business_name    text,
  dba                    text,
  entity_type            text,           -- LLC | Corporation | Sole Proprietorship | Partnership | Other
  state_of_org           text default 'AZ',
  tax_id_last4           text,           -- last 4 only; full TIN lives in the uploaded W-9

  -- ROC license (validated + snapshotted from roc_lookup at save time)
  roc_license_no         text,
  roc_business_name      text,
  roc_status             text,
  roc_is_active          boolean,
  roc_classes            jsonb,
  roc_expiration         date,

  -- Contact / signatory / payee
  contact_name           text,
  contact_phone          text,
  contact_email          text,
  signatory_name         text,
  signatory_title        text,
  payee_name             text,

  -- Insurance (COI carriers + expirations, FD-01 §10.6)
  gl_carrier             text,
  gl_expiration          date,
  auto_carrier           text,
  auto_expiration        date,
  wc_carrier             text,
  wc_expiration          date,
  wc_waiver              boolean default false,   -- sole prop w/ no employees (§10.2)

  -- Direct deposit election (FD-03, optional). Masked only — full bank data handled at ACH sign.
  elect_direct_deposit   boolean default false,
  bank_name              text,
  account_type           text,           -- Checking | Savings | Business | Personal
  account_name           text,
  account_last4          text,

  -- Uploads (storage paths in the private installer-onboarding bucket; set by the upload fn)
  roc_license_file       text,
  bond_file              text,
  coi_file               text,
  w9_file                text,
  voided_check_file      text,

  -- Lifecycle
  status                 text not null default 'draft',   -- draft|submitted|under_review|approved|rejected
  master_packet_signed_at timestamptz,
  ach_signed_at          timestamptz,
  submitted_at           timestamptz,
  reviewed_by            text,
  reviewed_at            timestamptz,
  review_notes           text,
  installer_id           text,           -- set when promoted to an installer crew (Phase 4)

  created_by             text,
  created_date           timestamptz not null default now(),
  updated_date           timestamptz not null default now()
);
create index if not exists installer_application_status_idx on public.installer_application (status);
create index if not exists installer_application_roc_idx on public.installer_application (roc_license_no);

alter table public.installer_application enable row level security;

-- Staff (authenticated, behind the app login) manage applications; anon reaches its own row only
-- through the SECURITY DEFINER token RPCs below.
drop policy if exists installer_application_staff_all on public.installer_application;
create policy installer_application_staff_all on public.installer_application
  for all to authenticated using (true) with check (true);

-- Private bucket for onboarding uploads (COI, W-9, ROC license, bond, voided check).
insert into storage.buckets (id, name, public, file_size_limit)
values ('installer-onboarding', 'installer-onboarding', false, 26214400)  -- 25 MB/file
on conflict (id) do nothing;

-- ---- Anon, token-scoped RPCs for the pre-login apply page ---------------------------------------

-- Whitelisted profile fields an applicant may set (never status/review/installer_id/files/signed).
create or replace function public._apply_installer_payload(p_id uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_lic text;
begin
  update public.installer_application set
    legal_business_name = coalesce(p_payload->>'legal_business_name', legal_business_name),
    dba                 = coalesce(p_payload->>'dba', dba),
    entity_type         = coalesce(p_payload->>'entity_type', entity_type),
    state_of_org        = coalesce(p_payload->>'state_of_org', state_of_org),
    tax_id_last4        = coalesce(right(regexp_replace(p_payload->>'tax_id_last4','\D','','g'),4), tax_id_last4),
    roc_license_no      = coalesce(p_payload->>'roc_license_no', roc_license_no),
    contact_name        = coalesce(p_payload->>'contact_name', contact_name),
    contact_phone       = coalesce(p_payload->>'contact_phone', contact_phone),
    contact_email       = coalesce(p_payload->>'contact_email', contact_email),
    signatory_name      = coalesce(p_payload->>'signatory_name', signatory_name),
    signatory_title     = coalesce(p_payload->>'signatory_title', signatory_title),
    payee_name          = coalesce(p_payload->>'payee_name', payee_name),
    gl_carrier          = coalesce(p_payload->>'gl_carrier', gl_carrier),
    gl_expiration       = coalesce((p_payload->>'gl_expiration')::date, gl_expiration),
    auto_carrier        = coalesce(p_payload->>'auto_carrier', auto_carrier),
    auto_expiration     = coalesce((p_payload->>'auto_expiration')::date, auto_expiration),
    wc_carrier          = coalesce(p_payload->>'wc_carrier', wc_carrier),
    wc_expiration       = coalesce((p_payload->>'wc_expiration')::date, wc_expiration),
    wc_waiver           = coalesce((p_payload->>'wc_waiver')::boolean, wc_waiver),
    elect_direct_deposit= coalesce((p_payload->>'elect_direct_deposit')::boolean, elect_direct_deposit),
    bank_name           = coalesce(p_payload->>'bank_name', bank_name),
    account_type        = coalesce(p_payload->>'account_type', account_type),
    account_name        = coalesce(p_payload->>'account_name', account_name),
    account_last4       = coalesce(right(regexp_replace(p_payload->>'account_last4','\D','','g'),4), account_last4),
    updated_date        = now()
  where id = p_id;

  -- Authoritative ROC snapshot from our mirror whenever a license number is present.
  select roc_license_no into v_lic from public.installer_application where id = p_id;
  if v_lic is not null then
    update public.installer_application a set
      roc_business_name = r.business_name,
      roc_status        = r.status,
      roc_is_active     = r.is_active,
      roc_classes       = r.classes,
      roc_expiration    = r.expiration_date
    from (select * from public.roc_lookup(v_lic)) r
    where a.id = p_id;
  end if;
end $$;

-- Start a new application (optionally with an initial payload); returns id + token.
create or replace function public.create_installer_application(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_token text;
begin
  insert into public.installer_application default values returning id, public_token into v_id, v_token;
  perform public._apply_installer_payload(v_id, coalesce(p_payload, '{}'::jsonb));
  return jsonb_build_object('id', v_id, 'public_token', v_token);
end $$;

-- Save profile edits against a token (only while still draft/submitted, not after review).
create or replace function public.save_installer_application(p_token text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.installer_application
    where public_token = p_token and status in ('draft','submitted');
  if v_id is null then return false; end if;
  perform public._apply_installer_payload(v_id, coalesce(p_payload, '{}'::jsonb));
  return true;
end $$;

-- Read an application by token (the applicant resuming their link). Excludes internal review cols.
create or replace function public.get_installer_application(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(a) - 'reviewed_by' - 'review_notes' - 'created_by'
  from public.installer_application a
  where a.public_token = p_token;
$$;

-- Applicant submits for review.
create or replace function public.submit_installer_application(p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update public.installer_application
    set status = 'submitted', submitted_at = now(), updated_date = now()
    where public_token = p_token and status = 'draft'
    returning id into v_id;
  return v_id is not null;
end $$;

grant execute on function public.create_installer_application(jsonb) to anon, authenticated;
grant execute on function public.save_installer_application(text, jsonb) to anon, authenticated;
grant execute on function public.get_installer_application(text) to anon, authenticated;
grant execute on function public.submit_installer_application(text) to anon, authenticated;
revoke execute on function public._apply_installer_payload(uuid, jsonb) from anon, authenticated;
