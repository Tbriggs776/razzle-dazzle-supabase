-- Public marketing-assets bucket: customer-facing videos (testimonials + CEO) and the
-- comparison image, rehosted off Bytescale/upcdn.io and base44's storage so they survive
-- base44 decommissioning. Kept SEPARATE from the private 'uploads' bucket (which holds
-- customer PII). A public bucket is served via the /storage/v1/object/public/ path, so no
-- RLS SELECT policy is needed for read. The asset BYTES are uploaded out-of-band
-- (supabase storage cp -> ss:///public-assets/marketing/*); this migration only ensures the
-- bucket exists with a 75 MB per-object cap.
insert into storage.buckets (id, name, public, file_size_limit)
values ('public-assets', 'public-assets', true, 78643200)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;
