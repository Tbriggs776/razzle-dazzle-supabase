-- Create a lead for every GoHighLevel contact that has a conversation.
--
-- ~16,775 conversations belong to GHL contacts with no lead in Razzle -- they
-- predate the integration. The transcript is stored but there is no customer
-- record to hang it on, so they are invisible to every screen, every task rule
-- and every report.
--
-- WHY NOT upsert_lead PER ROW. It is the right function for one webhook, but
-- 16,775 round trips inside a migration is not a plan. This is the same identity
-- discipline expressed set-wise, and it leans on the database rather than on
-- care: lead already has unique indexes on phone_e164, lower(trim(email)) and
-- ghl_contact_id, so a duplicate cannot be created even if the logic below is
-- wrong. ON CONFLICT DO NOTHING makes that a skip rather than a failure.
--
-- THREE WAYS TO DOUBLE-COUNT, ALL HANDLED.
--   * Against existing leads -- excluded by NOT EXISTS on all three identities.
--   * Between conversations -- one contact has many threads; DISTINCT ON picks
--     the most recently active.
--   * Within the batch -- two different GHL contacts can carry the same phone
--     or email. Left alone that trips the unique index and the whole insert
--     rolls back, so the batch is de-duplicated on each identity first.
--
-- Names arrive as one string, so the split is deliberately dumb: first token to
-- first_name, the rest to last_name. Guessing harder would be wrong more often.
--
-- source_channel stays 'unattributed'. These are historic contacts with no
-- attribution we can honestly reconstruct, and inventing one would corrupt every
-- marketing report that reads that column.
--
-- Superseded immediately by 0133b, which tightens two things the dry run caught.
-- Kept as its own file so the history shows what was actually applied.
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
           nullif(btrim(coalesce(gc.raw->>'fullName', gc.raw->>'contactName', '')), '') as full_name,
           public.to_e164(nullif(btrim(gc.raw->>'phone'), ''))                          as phone_e164,
           lower(nullif(btrim(gc.raw->>'email'), ''))                                   as email,
           gc.raw->>'phone'                                                             as phone_raw,
           gc.last_message_at
      from public.ghl_conversation gc
     where gc.lead_id is null
       and gc.contact_id is not null
     order by gc.contact_id, gc.last_message_at desc nulls last
  ),
  usable as (
    select *,
           case when email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then email end as email_ok
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
     and coalesce(gc.raw->>'email','') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$';

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

revoke execute on function public.import_ghl_contacts_as_leads(int) from public, anon;
grant execute on function public.import_ghl_contacts_as_leads(int) to service_role;
