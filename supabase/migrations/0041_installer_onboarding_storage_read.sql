-- Staff (authenticated, behind the app login) may read installer onboarding uploads so the review
-- screen can mint signed URLs (createSignedUrl needs a storage SELECT grant). Anon applicants
-- never read — they only upload through the service-role installerUpload function. Mirrors the
-- uploads_auth_read (0029) / esign (0036) pattern.
drop policy if exists installer_onboarding_auth_read on storage.objects;
create policy installer_onboarding_auth_read on storage.objects
  for select to authenticated using (bucket_id = 'installer-onboarding');
