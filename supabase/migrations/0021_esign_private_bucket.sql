-- Signing story fix: (1) a PRIVATE bucket for signed artifacts — the sealed PDF (contract
-- snapshot + signature + PII + signer IP) and the signature image must NOT sit in the public
-- 'uploads' bucket. The esign edge function (service role) reads/writes here and mints
-- short-lived signed URLs; there is intentionally NO public-read policy. (2) Enable e-sign for
-- the three doc types so signing actually routes through the working SignDocument engine
-- (base44's legacy submit* views are bypassed once these are on).
insert into storage.buckets (id, name, public)
  values ('esign', 'esign', false)
  on conflict (id) do nothing;

update public.esign_document_type
  set esign_enabled = true
  where document_type in ('manual_sales_contract', 'design_mod', 'pre_install');
