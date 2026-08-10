-- Receipts, inspection reports, and project claims (customer PII + signature images) were
-- written to the world-readable 'uploads' bucket and emailed as permanent public URLs.
-- Create a PRIVATE 'documents' bucket (no public read); pdfEmail now mints short-lived signed
-- URLs instead. Same hardening we applied to the e-sign bucket (migration 0021). Idempotent.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;
