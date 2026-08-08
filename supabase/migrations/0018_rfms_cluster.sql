-- P8: RFMS clean rebuild schema. Most RFMS tables/columns already exist (generated from
-- base44 entities); this fills the gaps + reseeds the integration for the DOCUMENTED HTTP
-- Basic auth (base44 wrongly used Bearer) with two secrets (Store Queue Value + API Token).
-- NOTE: originally applied via the Supabase MCP; captured here so the repo reproduces the DB.

-- Session cache needs storeId (base44 never captured it) to build the Basic credential.
alter table public.rfms_session
  add column if not exists store_id text;
alter table public.rfms_session alter column id set default gen_random_uuid()::text;
create index if not exists idx_rfms_session_recent on public.rfms_session(created_date desc);

-- Status/cache writers UPSERT by document_number (base44 raced with filter-then-create).
alter table public.rfms_order_status alter column id set default gen_random_uuid()::text;
create unique index if not exists uq_rfms_order_status_doc on public.rfms_order_status(document_number);
alter table public.rfms_order_cache alter column id set default gen_random_uuid()::text;
create unique index if not exists uq_rfms_order_cache_doc on public.rfms_order_cache(document_number);
create index if not exists idx_rfms_order_cache_age on public.rfms_order_cache(cached_at desc);

-- Sale sync-status surface (base44 Sale entity gap) + appointment RFMS customer id.
alter table public.sale
  add column if not exists rfms_sync_status text,
  add column if not exists rfms_sync_error text;
alter table public.appointment
  add column if not exists rfms_customer_id text;

-- Reseed the rfms integration for the documented Basic-auth model (two secrets).
update public.integration set
  config = jsonb_build_object('base_url','https://api.rfms.online/v2','session_token_position','password'),
  secret_fields = jsonb_build_array(
    jsonb_build_object('name','RFMS_STORE_QUEUE','label','Store Queue Value'),
    jsonb_build_object('name','RFMS_API_TOKEN','label','API Token')
  ),
  config_fields = jsonb_build_array(
    jsonb_build_object('name','base_url','type','text','label','Base URL','placeholder','https://api.rfms.online/v2'),
    jsonb_build_object('name','session_token_position','type','text','label','Session Token Position (username|password)','placeholder','password')
  )
where key='rfms';

-- GP flow: when a sale gets/changes an invoice number, enqueue an async RFMS order fetch
-- (the P1 credential-free trigger pattern — enqueue_job is SECURITY DEFINER, needs no creds).
create or replace function public.trg_sale_rfms_fetch() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if NEW.invoice_number is not null
     and (TG_OP = 'INSERT' or NEW.invoice_number is distinct from OLD.invoice_number)
  then
    perform public.enqueue_job('fetch_rfms_order', jsonb_build_object('saleId', NEW.id, 'invoiceNumber', NEW.invoice_number));
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_sale_rfms_fetch on public.sale;
create trigger trg_sale_rfms_fetch after insert or update on public.sale
  for each row execute function public.trg_sale_rfms_fetch();
