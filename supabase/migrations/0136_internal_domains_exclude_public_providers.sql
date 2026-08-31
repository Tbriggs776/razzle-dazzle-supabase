-- Six of your staff use Gmail, and that broke the import.
--
-- 0135 derived "our own domains" from team_member.email rather than hardcoding
-- floordaddy.com, on the reasoning that a derived list survives a rebrand. It
-- does. It also learns gmail.com (6 staff), yahoo.com (2) and outlook.com (1),
-- and then treats every customer with a Gmail address as an internal contact.
-- 8,588 real people were excluded from the import, and the same predicate in
-- 0135's cleanup deleted the ones already created.
--
-- Recovery was clean because the rows were minutes old: no sale, appointment or
-- communication had attached, conversations detached to lead_id null rather than
-- being destroyed, and re-running the import restored all 8,504. Nothing that
-- pre-dated this work was touched.
--
-- The lesson is narrow and worth stating: a rule inferred from data is only as
-- good as the assumption that the data means what you think. "Domains the team
-- emails from" is not the same set as "domains the business owns", and the gap
-- between them is every free mail provider on earth. Hardcoding the domain --
-- the thing this was trying to be cleverer than -- would have been correct.
--
-- Fixed by subtracting the public providers. The derived part still works, so a
-- new company domain is picked up automatically, but a personal mailbox can no
-- longer promote an entire provider to internal.
create or replace function public.internal_email_domains()
returns table (domain text)
language sql stable security definer set search_path = public as $$
  select distinct lower(split_part(btrim(tm.email), '@', 2))
    from public.team_member tm
   where tm.email is not null
     and position('@' in tm.email) > 0
     and lower(split_part(btrim(tm.email), '@', 2)) not in (
       -- Public providers. A staff member's personal mailbox must never make
       -- the whole provider internal.
       'gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com',
       'outlook.com','live.com','msn.com','icloud.com','me.com','mac.com',
       'aol.com','comcast.net','cox.net','att.net','verizon.net','sbcglobal.net',
       'protonmail.com','proton.me','gmx.com','mail.com','zoho.com','qq.com'
     )
     and lower(split_part(btrim(tm.email), '@', 2)) <> '';
$$;

comment on function public.internal_email_domains() is
  'Domains the business itself uses, learned from team_member.email with public mail providers subtracted. Deriving this without the subtraction classifies every Gmail customer as internal -- which is exactly what happened in 0135.';

revoke execute on function public.internal_email_domains() from public, anon;
grant execute on function public.internal_email_domains() to authenticated, service_role;

create or replace function public.import_ghl_contacts_as_leads(p_limit int default 100000)
returns table (leads_created int, skipped_existing int, skipped_no_identity int)
language plpgsql security definer set search_path = public as $$
declare v_created int; v_before int; v_candidates int; v_no_identity int;
begin
  select count(*) into v_before from public.lead;

  create temp table _internal_domains on commit drop as
  select domain from public.internal_email_domains();

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
           case when full_name_raw is not null and position('@' in full_name_raw) = 0
                then full_name_raw end as full_name
      from per_contact
  ),
  external_only as (
    select * from usable u
     where (u.email_ok is null
            or lower(split_part(u.email_ok,'@',2)) not in (select domain from _internal_domains))
       and coalesce(u.email_ok,'') !~ '^(no-?re?p+l+[yi]|do-?not-?reply|mailer-daemon|postmaster)'
       and not exists (select 1 from public.team_member tm
                        where tm.email is not null and u.email_ok is not null
                          and lower(btrim(tm.email)) = u.email_ok)
       and not exists (select 1 from public.team_member tm
                        where tm.phone is not null and u.phone_e164 is not null
                          and public.to_e164(tm.phone) = u.phone_e164)
  ),
  fresh as (
    select * from external_only u
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
  'Create leads for external GoHighLevel contacts that have conversations but no lead. Internal contacts are excluded using internal_email_domains(), which subtracts public mail providers -- without that, a staff member''s personal Gmail makes every Gmail customer look internal. Deduplicates against existing leads, across a contact''s threads, and within the batch. Re-runnable.';

revoke execute on function public.import_ghl_contacts_as_leads(int) from public, anon;
grant execute on function public.import_ghl_contacts_as_leads(int) to service_role;
