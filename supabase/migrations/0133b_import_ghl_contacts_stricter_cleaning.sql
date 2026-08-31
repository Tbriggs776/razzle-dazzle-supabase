-- Tighten two things the dry run exposed.
--
-- 1. THE EMAIL PATTERN WAS TOO LOOSE. '^[^@[:space:]]+@...' accepts any
--    non-space junk before the @, so '{markdiggs22123@gmail.com' passed as a
--    valid address. On a column with a unique index that is not cosmetic: the
--    brace makes it a different key from the real address, so the same person
--    imports twice and neither row is reachable by searching their email.
--    Now anchored to the characters an address may actually contain.
--
-- 2. AN EMAIL WAS BECOMING SOMEONE'S NAME. GHL's fullName is free text and
--    sometimes holds an address, so the naive split put
--    '{markdiggs22123@gmail.com' in first_name. A name containing @ is not a
--    name; leave it null rather than write nonsense into the field staff read.
--
-- Not fixed, deliberately: 'Phoenix Az' imports as a person called Phoenix Az,
-- because that is genuinely what the GHL record says. Guessing which free-text
-- names are really cities is a heuristic that will be wrong in both directions,
-- and inventing a rule here would corrupt real names like Austin or Savannah.
-- The junk is in the source; it should stay visible rather than be silently
-- reshaped into something that looks trustworthy.
create or replace function public.import_ghl_contacts_as_leads(p_limit int default 100000)
returns table (leads_created int, skipped_existing int, skipped_no_identity int)
language plpgsql security definer set search_path = public as $$
declare v_created int; v_before int; v_candidates int; v_no_identity int;
begin
  select count(*) into v_before from public.lead;

  create temp table _cand on commit drop as
  with per_contact as (
    select distinct on (gc.contact_id)
           gc.contact_id,
           nullif(btrim(coalesce(gc.raw->>'fullName', gc.raw->>'contactName', '')), '') as full_name_raw,
           public.to_e164(nullif(btrim(gc.raw->>'phone'), ''))                          as phone_e164,
           lower(nullif(btrim(gc.raw->>'email'), ''))                                   as email_raw,
           gc.raw->>'phone'                                                             as phone_raw,
           gc.last_message_at
      from public.ghl_conversation gc
     where gc.lead_id is null
       and gc.contact_id is not null
     order by gc.contact_id, gc.last_message_at desc nulls last
  ),
  usable as (
    select contact_id, phone_e164, phone_raw, last_message_at,
           case when email_raw ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then email_raw end as email_ok,
           -- A name with an @ in it is an address, not a name.
           case when full_name_raw is not null and position('@' in full_name_raw) = 0
                then full_name_raw end as full_name
      from per_contact
  ),
  fresh as (
    select * from usable u
     where not exists (select 1 from public.lead l where l.ghl_contact_id = u.contact_id)
       and (u.phone_e164 is null
            or not exists (select 1 from public.lead l where l.phone_e164 = u.phone_e164))
       and (u.email_ok is null
            or not exists (select 1 from public.lead l where lower(btrim(l.email)) = u.email_ok))
  ),
  dedup_phone as (
    select distinct on (coalesce(phone_e164, contact_id)) *
      from fresh order by coalesce(phone_e164, contact_id), last_message_at desc nulls last
  ),
  dedup_email as (
    select distinct on (coalesce(email_ok, contact_id)) *
      from dedup_phone order by coalesce(email_ok, contact_id), last_message_at desc nulls last
  )
  select * from dedup_email
   where phone_e164 is not null or email_ok is not null
   limit p_limit;

  select count(*) into v_candidates from _cand;
  select count(*) into v_no_identity
    from public.ghl_conversation gc
   where gc.lead_id is null and gc.contact_id is not null
     and public.to_e164(nullif(btrim(gc.raw->>'phone'), '')) is null
     and lower(coalesce(gc.raw->>'email','')) !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$';

  insert into public.lead (
    first_name, last_name, phone, email, ghl_contact_id, source_channel, notes
  )
  select
    nullif(split_part(coalesce(c.full_name, ''), ' ', 1), ''),
    nullif(btrim(substr(coalesce(c.full_name, ''), strpos(coalesce(c.full_name,'') || ' ', ' ') + 1)), ''),
    coalesce(c.phone_raw, c.phone_e164),
    c.email_ok,
    c.contact_id,
    'unattributed',
    'Imported from GoHighLevel conversation history.'
  from _cand c
  on conflict do nothing;

  select count(*) into v_created from public.lead;
  v_created := v_created - v_before;

  return query select v_created, (v_candidates - v_created), v_no_identity;
end $$;

comment on function public.import_ghl_contacts_as_leads(int) is
  'Create leads for GoHighLevel contacts that have conversations but no lead. Deduplicates against existing leads, across a contact''s several threads, and within the batch; the unique indexes on phone_e164/email/ghl_contact_id are the real guarantee. Rejects malformed emails and refuses to use an address as a name. Re-runnable.';

revoke execute on function public.import_ghl_contacts_as_leads(int) from public, anon;
grant execute on function public.import_ghl_contacts_as_leads(int) to service_role;
