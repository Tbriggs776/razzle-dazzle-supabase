-- Phase 02: public 'uploads' bucket replacing base44 UploadFile.
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

drop policy if exists uploads_auth_insert on storage.objects;
create policy uploads_auth_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'uploads');

drop policy if exists uploads_auth_update on storage.objects;
create policy uploads_auth_update on storage.objects
  for update to authenticated using (bucket_id = 'uploads') with check (bucket_id = 'uploads');

drop policy if exists uploads_public_read on storage.objects;
create policy uploads_public_read on storage.objects
  for select using (bucket_id = 'uploads');
