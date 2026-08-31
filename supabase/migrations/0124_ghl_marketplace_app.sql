-- ─────────────────────────────────────────────────────────────────────────────
-- 0124 — The GoHighLevel Marketplace app: install state, and the ingest fix
--        that made lead webhooks possible at all.
--
-- Until now the GHL integration was a read-only Private Integration Token that
-- counted contacts for the marketing dashboard. This is the other half: a real
-- OAuth app that receives contact events and turns them into leads in the CSR
-- queue, with a first-dial clock running.
--
-- ── THE BUG THIS FIXES ──────────────────────────────────────────────────────
-- 0099's header calls upsert_lead "the function every ingest path in slices 2
-- and 3 calls instead of inserting". It could not be. Its guard reads
--
--     if not (public.can_edit('leads') or public.is_org_admin()) then
--
-- and BOTH of those resolve against auth.uid(), which is NULL for a webhook
-- arriving on the service role. Verified against the live database before
-- writing this: a service-role call raises "Not allowed to create or update
-- leads". The ingest path was a trap — the very first GHL event would have
-- failed, and the failure would have looked like a GHL problem rather than
-- ours.
--
-- The fix admits the service role EXPLICITLY rather than loosening the guard:
-- auth.role() reads the JWT's role claim, so only a caller holding the
-- service-role key (which is server-side only and never reaches a browser) can
-- satisfy it. can_edit/is_org_admin still govern every human caller, and anon
-- still cannot reach the function at all — 0099's revoke stands.
--
-- ── WHY TOKENS LIVE IN A TABLE, NOT VAULT ───────────────────────────────────
-- Vault holds NAMED, operator-managed secrets (one Twilio key, one Resend key).
-- OAuth install tokens are per-location, created and rotated by GHL, and
-- arbitrary in number — that is table-shaped data, not configuration. The table
-- is therefore locked to service_role: RLS on, and NO policy for any client
-- role, so PostgREST returns nothing to anon or authenticated no matter what.
-- Access tokens expire in ~24h, so the refresh token is the load-bearing
-- secret; losing it means every location must reinstall.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Make the documented ingest path actually callable ────────────────────
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
  if not (public.can_edit('leads') or public.is_org_admin()
          or coalesce(auth.role(), '') = 'service_role') then
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
grant execute on function public.upsert_lead(jsonb) to authenticated, service_role;

comment on function public.upsert_lead(jsonb) is
  'Identity-safe lead ingest (phone → email → ghl_contact_id → callrail_person_id). Callable by a human with can_edit(leads) OR by the service role, which is what every inbound webhook uses.';

-- ── 2. Per-location OAuth installs ──────────────────────────────────────────
create table if not exists public.ghl_install (
  location_id    text primary key,
  company_id     text,
  access_token   text,
  refresh_token  text,
  token_type     text,
  scope          text,
  user_type      text,
  expires_at     timestamptz,
  installed_at   timestamptz not null default now(),
  uninstalled_at timestamptz,
  last_refreshed_at timestamptz,
  last_error     text,
  updated_date   timestamptz not null default now()
);

comment on table public.ghl_install is
  'One row per GoHighLevel sub-account that installed the app. Holds live OAuth tokens — service_role only, no client policy exists. An uninstalled_at row is kept rather than deleted so a reinstall is distinguishable from a first install.';

alter table public.ghl_install enable row level security;
-- Deliberately NO policy: RLS with zero policies denies every client role, so
-- anon and authenticated get nothing from PostgREST regardless of the query.
revoke all on public.ghl_install from anon, authenticated;

-- ── 3. Webhook receipts — idempotency and a trail when something looks wrong ─
create table if not exists public.ghl_webhook_event (
  id           text primary key default gen_random_uuid()::text,
  event_id     text,
  event_type   text not null,
  location_id  text,
  contact_id   text,
  payload      jsonb,
  handled      boolean not null default false,
  result       jsonb,
  error        text,
  received_at  timestamptz not null default now()
);

-- GHL retries on non-2xx, and delivery is at-least-once. A unique event id lets
-- the handler recognise a replay instead of processing it twice.
create unique index if not exists ghl_webhook_event_id_uniq
  on public.ghl_webhook_event (event_id) where event_id is not null;
create index if not exists ghl_webhook_event_recent
  on public.ghl_webhook_event (received_at desc);

comment on table public.ghl_webhook_event is
  'Raw GHL webhook receipts. Kept because "the lead never arrived" is otherwise unanswerable — this says whether it arrived, verified, and what happened to it.';

alter table public.ghl_webhook_event enable row level security;
create policy ghl_webhook_event_read on public.ghl_webhook_event
  for select using (public.is_org_admin());
revoke all on public.ghl_webhook_event from anon;
grant select on public.ghl_webhook_event to authenticated;
