-- In-house e-signature engine (replaces base44's canvas-only signature).
-- ESIGN/UETA-aligned: consent + intent, unguessable token access, server-captured
-- audit trail, SHA-256 tamper-evidence, sealed PDF + certificate, optional SMS OTP.
-- Admin-configurable per document type via esign_document_type.

-- Per-document-type config, managed by admins in the e-sign settings section.
create table if not exists public.esign_document_type (
  document_type text primary key,        -- 'design_mod' | 'manual_sales_contract' | 'pre_install' | ...
  label text not null,
  table_name text not null,              -- underlying record table
  esign_enabled boolean not null default false,   -- does this type require e-sign?
  require_sms_otp boolean not null default false,  -- text a code before signing?
  consent_text text not null,            -- the electronic-records consent disclosure
  expiry_days int not null default 14,
  notify_emails jsonb not null default '[]'::jsonb, -- internal recipients on completion
  updated_date timestamptz not null default now()
);

-- One signing request per document sent for signature. The token is the unguessable
-- capability (64 hex chars); signers only ever reach their own request through it.
create table if not exists public.signature_request (
  id text primary key default gen_random_uuid()::text,
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  document_type text not null,
  document_id text not null,
  signer_name text,
  signer_email text,
  signer_phone text,
  status text not null default 'sent'
    check (status in ('sent','viewed','otp_sent','otp_verified','signed','declined','expired','voided')),
  document_hash text,          -- sha256 of document_snapshot at send time (tamper-evidence)
  document_snapshot jsonb,     -- exact content presented to the signer
  consent_text text,           -- snapshot of the disclosure the signer agreed to
  require_sms_otp boolean not null default false,
  otp_hash text, otp_expires_at timestamptz, otp_attempts int not null default 0, otp_verified_at timestamptz,
  sent_at timestamptz not null default now(),
  viewed_at timestamptz,
  signed_at timestamptz,
  expires_at timestamptz,
  consent_agreed boolean not null default false,
  signer_printed_name text,
  signature_image_url text,    -- the drawn signature, stored in Storage
  sealed_pdf_url text,         -- the final sealed document + audit certificate
  sealed_pdf_hash text,        -- sha256 of the sealed PDF
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);
create index if not exists idx_sigreq_token on public.signature_request(token);
create index if not exists idx_sigreq_doc on public.signature_request(document_type, document_id);

-- Immutable-ish audit trail: every event with server-captured IP / device / time.
create table if not exists public.signature_event (
  id text primary key default gen_random_uuid()::text,
  request_id text not null references public.signature_request(id) on delete cascade,
  event text not null,         -- sent | viewed | otp_sent | otp_verified | consented | signed | declined
  ip text, user_agent text,
  at timestamptz not null default now(),
  meta jsonb
);
create index if not exists idx_sigevent_req on public.signature_event(request_id);

-- RLS: no anon / no direct client access. Edge Functions (service role) are the sole
-- access path for signers (token-scoped). Admins can read for oversight.
alter table public.esign_document_type enable row level security;
alter table public.signature_request enable row level security;
alter table public.signature_event enable row level security;
drop policy if exists esign_types_admin_read on public.esign_document_type;
create policy esign_types_admin_read on public.esign_document_type for select to authenticated using (public.is_org_admin());
drop policy if exists sigreq_admin_read on public.signature_request;
create policy sigreq_admin_read on public.signature_request for select to authenticated using (public.is_org_admin());
drop policy if exists sigevent_admin_read on public.signature_event;
create policy sigevent_admin_read on public.signature_event for select to authenticated using (public.is_org_admin());

-- Seed the three document types (DISABLED by default — admin turns them on).
insert into public.esign_document_type (document_type, label, table_name, consent_text) values
  ('manual_sales_contract','Sales Contract','manual_sales_contract',
   $c$By checking this box and signing below, I agree to use electronic records and electronic signatures for this document. I agree that my electronic signature is the legal equivalent of my handwritten signature, that I have reviewed this document in full, and that I intend to be legally bound by it. I understand I may request a paper copy at any time.$c$),
  ('design_mod','Design Modification','design_mod',
   $c$By checking this box and signing below, I agree to use electronic records and electronic signatures for this design modification. I agree that my electronic signature is the legal equivalent of my handwritten signature, that I have reviewed the changes and any added costs, and that I approve them. I understand I may request a paper copy at any time.$c$),
  ('pre_install','Pre-Install Checklist','standalone_pre_install_checklist',
   $c$By checking this box and signing below, I acknowledge that I have reviewed this pre-installation checklist, and I agree to use electronic records and electronic signatures. I agree that my electronic signature is the legal equivalent of my handwritten signature.$c$)
on conflict (document_type) do nothing;

-- Admin config RPCs (self-gated by is_org_admin).
create or replace function public.admin_get_esign_types()
returns setof public.esign_document_type language sql stable security definer set search_path = public as $$
  select * from public.esign_document_type where public.is_org_admin() order by label;
$$;
revoke execute on function public.admin_get_esign_types() from anon;

create or replace function public.admin_set_esign_type(
  p_document_type text, p_esign_enabled boolean default null, p_require_sms_otp boolean default null,
  p_consent_text text default null, p_expiry_days int default null, p_notify_emails jsonb default null)
returns public.esign_document_type language plpgsql security definer set search_path = public as $$
declare row public.esign_document_type;
begin
  if not public.is_org_admin() then raise exception 'not authorized'; end if;
  update public.esign_document_type set
    esign_enabled   = coalesce(p_esign_enabled, esign_enabled),
    require_sms_otp  = coalesce(p_require_sms_otp, require_sms_otp),
    consent_text     = coalesce(p_consent_text, consent_text),
    expiry_days      = coalesce(p_expiry_days, expiry_days),
    notify_emails    = coalesce(p_notify_emails, notify_emails),
    updated_date     = now()
  where document_type = p_document_type returning * into row;
  return row;
end $$;
revoke execute on function public.admin_set_esign_type(text,boolean,boolean,text,int,jsonb) from anon;
