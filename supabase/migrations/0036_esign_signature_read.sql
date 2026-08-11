-- ES3: let authenticated org members read (createSignedUrl) e-sign SIGNATURE images, so the
-- business-record signature thumbnail renders via a short-lived signed URL minted on demand
-- (<SignedImage>/resolveFileUrl with the `esign:` prefix) instead of the stored 365-day bearer URL.
-- Scoped to signature PNGs ONLY — the sealed PDFs (full contract snapshot + PII + signer IP) stay
-- service-role-only per 0021/#76. INSERT/UPDATE remain service-role (the esign function writes).
drop policy if exists esign_auth_read_signatures on storage.objects;
create policy esign_auth_read_signatures on storage.objects
  for select to authenticated
  using (bucket_id = 'esign' and name like 'signatures/%/signature.png');
