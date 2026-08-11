-- ST1: make the 'uploads' bucket PRIVATE. It holds customer PII — driver's licenses, e-sign
-- signatures, contract PDFs, call recordings, inspection/claim/floor-prep photos — but was
-- public=true with an unrestricted SELECT policy (no `to` clause), so the anon role could READ
-- and LIST every object by URL. This closes that in one move.
--
-- After this, files are reachable only via short-lived signed URLs: authenticated pages mint
-- them client-side (@/lib/fileUrl), and the one anon page (CustomerProjectView) receives
-- already-signed URLs from the getPublicProjectSigned edge function.
--
-- SEQUENCING: the signing-aware frontend + getPublicProjectSigned must be deployed BEFORE this
-- migration is applied, or the currently-live app's public <img> URLs 404.
update storage.buckets set public = false where id = 'uploads';

drop policy if exists uploads_public_read on storage.objects;

-- Authenticated org members may read/list uploads (required so createSignedUrl works client-side).
-- INSERT/UPDATE policies from 0004 (uploads_auth_insert / uploads_auth_update) remain; anon has
-- no policy at all now, so it is fully denied; service_role bypasses RLS for the server signer.
drop policy if exists uploads_auth_read on storage.objects;
create policy uploads_auth_read on storage.objects
  for select to authenticated using (bucket_id = 'uploads');
