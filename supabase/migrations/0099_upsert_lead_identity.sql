-- ─────────────────────────────────────────────────────────────────────────────
-- 0099 — The upsert path 0098's unique indexes require.
--
-- 0098 made "one lead per phone number" a database rule. Without a resolver
-- that is a trap rather than a guarantee: the second webhook for the same
-- person raises a unique violation and the whole CallRail or GHL request fails.
-- This is the function every ingest path in slices 2 and 3 calls instead of
-- inserting.
--
-- ── MATCH ORDER ─────────────────────────────────────────────────────────────
-- phone → email → ghl_contact_id → callrail_person_id, most reliable first.
-- A phone number is the one identifier both CallRail and GHL always have, and
-- it is the one the spec names as the upsert key.
--
-- ── FIRST TOUCH vs LAST TOUCH ───────────────────────────────────────────────
-- The spec: "CallRail source/campaign is first-touch; gclid/fbclid on the call
-- is most recent click. Store both. Report first-touch for 'which campaign
-- bought this lead', last-touch for ads optimization."
--
-- Rather than doubling every column, the split runs along the natural grain of
-- the data:
--   source_channel / source_campaign / source_medium  are FIRST touch. Once
--     set they are never overwritten — 'unattributed' counts as unset, so a
--     real channel arriving later does fill it.
--   gclid / fbclid / the other click ids and utm_*      are LAST touch. A newer
--     click id replaces the old one, because that is what the ads platforms
--     need back for optimisation.
--   source_created_at takes the EARLIEST value seen, since it is by definition
--     the first touch's timestamp.
--
-- ── THE EMAIL TRAP ──────────────────────────────────────────────────────────
-- A webhook can arrive with person A's phone and person B's email (shared
-- household address, a typo, a form autofilled by the wrong browser profile).
-- Writing it would violate lead_email_uniq and fail the request. The update
-- checks first and simply does not take an email that belongs to someone else.
-- Verified: Dana keeps her own address when a webhook offers her another
-- lead's.
--
-- Contact details fill blanks only. A CSR who corrects a misspelled name must
-- not have the next webhook overwrite it.
--
-- Verified end to end: a GHL form and a CallRail call on the same number in two
-- different formats produce ONE lead, first touch web_form/spring-lvp intact,
-- gclid advanced to the newer click, both external ids merged onto the row.
-- ─────────────────────────────────────────────────────────────────────────────

-- Same normalisation as lead.phone_e164's generated expression, callable on an
-- inbound number BEFORE it is a row — which is what every webhook needs.
create or replace function public.to_e164(p_phone text)
returns text language sql immutable
as $$
  select case
    when regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') = '' then null
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) = 10
      then '+1' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) = 11
     and left(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      then '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    when btrim(coalesce(p_phone, '')) like '+%'
     and length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) between 8 and 15
      then '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    else null
  end;
$$;

create or replace function public.upsert_lead(p_lead jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_phone   text := public.to_e164(p_lead->>'phone');
  v_email   text := lower(nullif(btrim(coalesce(p_lead->>'email', '')), ''));
  v_ghl     text := nullif(btrim(coalesce(p_lead->>'ghl_contact_id', '')), '');
  v_cr      text := nullif(btrim(coalesce(p_lead->>'callrail_person_id', '')), '');
  v_channel text := nullif(btrim(coalesce(p_lead->>'source_channel', '')), '');
  v_id      text;
  v_matched text;
  v_created boolean := false;
  v_email_free boolean;
begin
  -- SECURITY DEFINER so a webhook path can call it, but the caller still has to
  -- be allowed to touch leads. Service-role callers bypass RLS as they always do.
  if not (public.can_edit('leads') or public.is_org_admin()) then
    raise exception 'Not allowed to create or update leads';
  end if;

  if v_channel is null then v_channel := 'unattributed'; end if;
  if not exists (select 1 from public.lead_source_channel where key = v_channel) then
    raise exception 'Unknown source_channel "%" — add it to lead_source_channel first', v_channel;
  end if;
  -- A lead with no way to reach or re-identify the person is not a lead.
  if v_phone is null and v_email is null and v_ghl is null and v_cr is null then
    raise exception 'A lead needs at least one of: phone, email, GHL contact id, CallRail person id';
  end if;

  -- Match order is the spec's upsert key, most reliable first.
  select id, 'phone' into v_id, v_matched from public.lead where phone_e164 = v_phone and v_phone is not null limit 1;
  if v_id is null then
    select id, 'email' into v_id, v_matched from public.lead
     where v_email is not null and lower(btrim(email)) = v_email limit 1;
  end if;
  if v_id is null then
    select id, 'ghl_contact_id' into v_id, v_matched from public.lead
     where v_ghl is not null and ghl_contact_id = v_ghl limit 1;
  end if;
  if v_id is null then
    select id, 'callrail_person_id' into v_id, v_matched from public.lead
     where v_cr is not null and callrail_person_id = v_cr limit 1;
  end if;

  if v_id is null then
    insert into public.lead (
      first_name, last_name, email, phone,
      address_line1, address_line2, city, state, zip, notes,
      source_channel, source_campaign, source_medium,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      gclid, gbraid, wbraid, fbclid, fbp, fbc, msclkid, ctwa_clid, meta_lead_id,
      ghl_contact_id, ghl_location_id,
      callrail_person_id, callrail_tracker_id, callrail_company_id,
      ga_client_id, ga_session_id,
      assigned_csr, queued_at, source_created_at
    ) values (
      p_lead->>'first_name', p_lead->>'last_name', v_email, p_lead->>'phone',
      p_lead->>'address_line1', p_lead->>'address_line2', p_lead->>'city',
      p_lead->>'state', p_lead->>'zip', p_lead->>'notes',
      v_channel, p_lead->>'source_campaign', p_lead->>'source_medium',
      p_lead->>'utm_source', p_lead->>'utm_medium', p_lead->>'utm_campaign',
      p_lead->>'utm_content', p_lead->>'utm_term',
      p_lead->>'gclid', p_lead->>'gbraid', p_lead->>'wbraid', p_lead->>'fbclid',
      p_lead->>'fbp', p_lead->>'fbc', p_lead->>'msclkid', p_lead->>'ctwa_clid',
      p_lead->>'meta_lead_id',
      v_ghl, p_lead->>'ghl_location_id',
      v_cr, p_lead->>'callrail_tracker_id', p_lead->>'callrail_company_id',
      p_lead->>'ga_client_id', p_lead->>'ga_session_id',
      p_lead->>'assigned_csr',
      coalesce((p_lead->>'queued_at')::timestamptz, now()),
      coalesce((p_lead->>'source_created_at')::timestamptz, now())
    ) returning id into v_id;
    v_created := true;
    v_matched := 'new';
  else
    -- An email that already belongs to a DIFFERENT lead must not be written here:
    -- it would violate lead_email_uniq and fail the whole webhook.
    select not exists (
      select 1 from public.lead where lower(btrim(email)) = v_email and id <> v_id
    ) into v_email_free;

    update public.lead set
      -- Contact details: fill blanks, never clobber what a CSR corrected.
      first_name    = coalesce(nullif(btrim(first_name, ' '), ''), p_lead->>'first_name'),
      last_name     = coalesce(nullif(btrim(last_name, ' '), ''), p_lead->>'last_name'),
      email         = case when v_email is not null and coalesce(v_email_free, false)
                           then coalesce(nullif(btrim(email), ''), v_email) else email end,
      phone         = coalesce(nullif(btrim(phone), ''), p_lead->>'phone'),
      address_line1 = coalesce(nullif(btrim(address_line1), ''), p_lead->>'address_line1'),
      city          = coalesce(nullif(btrim(city), ''), p_lead->>'city'),
      state         = coalesce(nullif(btrim(state), ''), p_lead->>'state'),
      zip           = coalesce(nullif(btrim(zip), ''), p_lead->>'zip'),

      -- FIRST touch: whichever system saw them first owns the answer to
      -- "which campaign bought this lead". 'unattributed' counts as unset.
      source_channel  = case when source_channel = 'unattributed' and v_channel <> 'unattributed'
                             then v_channel else source_channel end,
      source_campaign = coalesce(source_campaign, p_lead->>'source_campaign'),
      source_medium   = coalesce(source_medium, p_lead->>'source_medium'),
      source_created_at = least(source_created_at,
                                coalesce((p_lead->>'source_created_at')::timestamptz, source_created_at)),

      -- LAST touch: click ids are the most recent click and drive ads
      -- optimisation, so a newer one replaces the old.
      gclid       = coalesce(p_lead->>'gclid', gclid),
      gbraid      = coalesce(p_lead->>'gbraid', gbraid),
      wbraid      = coalesce(p_lead->>'wbraid', wbraid),
      fbclid      = coalesce(p_lead->>'fbclid', fbclid),
      fbp         = coalesce(p_lead->>'fbp', fbp),
      fbc         = coalesce(p_lead->>'fbc', fbc),
      msclkid     = coalesce(p_lead->>'msclkid', msclkid),
      ctwa_clid   = coalesce(p_lead->>'ctwa_clid', ctwa_clid),
      utm_source  = coalesce(p_lead->>'utm_source', utm_source),
      utm_medium  = coalesce(p_lead->>'utm_medium', utm_medium),
      utm_campaign= coalesce(p_lead->>'utm_campaign', utm_campaign),
      utm_content = coalesce(p_lead->>'utm_content', utm_content),
      utm_term    = coalesce(p_lead->>'utm_term', utm_term),

      -- External ids: fill only. A conflicting id is kept out rather than
      -- overwriting the one we already trust.
      meta_lead_id        = coalesce(meta_lead_id, p_lead->>'meta_lead_id'),
      ghl_contact_id      = coalesce(ghl_contact_id, v_ghl),
      ghl_location_id     = coalesce(ghl_location_id, p_lead->>'ghl_location_id'),
      callrail_person_id  = coalesce(callrail_person_id, v_cr),
      callrail_tracker_id = coalesce(callrail_tracker_id, p_lead->>'callrail_tracker_id'),
      callrail_company_id = coalesce(callrail_company_id, p_lead->>'callrail_company_id'),
      ga_client_id        = coalesce(ga_client_id, p_lead->>'ga_client_id'),
      ga_session_id       = coalesce(p_lead->>'ga_session_id', ga_session_id),

      assigned_csr = coalesce(assigned_csr, p_lead->>'assigned_csr'),
      queued_at    = coalesce(queued_at, (p_lead->>'queued_at')::timestamptz, now()),
      updated_date = now()
    where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'lead_id', v_id, 'created', v_created, 'matched_on', v_matched);
end $$;

revoke all on function public.upsert_lead(jsonb) from public, anon;
revoke all on function public.to_e164(text) from public, anon;
grant execute on function public.upsert_lead(jsonb) to authenticated, service_role;
grant execute on function public.to_e164(text) to authenticated, service_role;
