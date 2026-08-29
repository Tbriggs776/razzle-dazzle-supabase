-- ─────────────────────────────────────────────────────────────────────────────
-- 0098 — Pillars 1 & 2, slice 1: identity. `lead` today is name / email / phone
-- / address / notes and NOTHING about where the person came from, which is why
-- MarketingPerformance can only join an aggregate GHL count to an aggregate
-- appointment count to a Google Sheet. There is no per-lead campaign join
-- anywhere in the system. Everything downstream in that spec — CallRail, the
-- campaign-day table, offline conversion upload, cost-per-booked — joins on
-- columns that do not exist yet. This adds them.
--
-- ── VOCABULARIES ARE TABLES, NOT CHECK CONSTRAINTS ──────────────────────────
-- source_channel and disposition are both closed vocabularies the owner will
-- refine (the spec's §9 is a list of open questions, and OPERATING_MODEL and the
-- Pillars spec already disagree — §2 of OPERATING_MODEL says the unattributed
-- queue is `source_channel='unknown'`, everywhere else says 'unattributed').
-- A CHECK constraint would make every refinement a migration and a deploy.
-- Lookup tables with FKs give the same integrity, let the CSR UI render the
-- list, and make adding a channel an INSERT.
--
-- ⚠️ I resolved that conflict to 'unattributed' — it is the newer spec, it is
-- stated twice, and OPERATING_MODEL's own stage-1 row uses it. If Tyler wants
-- 'unknown', it is one UPDATE on lead_source_channel.
--
-- The disposition list is assembled from the tokens that actually appear across
-- OPERATING_MODEL (`not_ready`, `no_contact_exhausted`, `below_minimum`,
-- `out_of_area`, `duplicate`, `no_contact_method`) plus the obvious remainder.
-- It is not authoritative until Tyler reads it — which is exactly why it is a
-- table.
--
-- ── phone_e164 IS GENERATED, NOT WRITTEN ────────────────────────────────────
-- The match key cannot be allowed to drift from the phone number it represents.
-- A generated column makes that structurally impossible: edit `phone` and the
-- key follows. A number that does not normalise (too short, junk) yields NULL
-- rather than a guess — an unmatchable lead is recoverable, a lead matched onto
-- the WRONG person is not, and every unique index below is partial on NOT NULL
-- so those rows simply do not participate.
--
-- Verified on the live 27 leads: all 27 are 10-digit US, no duplicate phones or
-- emails, so every unique index below builds clean.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
-- No attempt counter. `no_contact_exhausted` requires ≥7 attempts over ≥14 days
-- and there is nowhere yet that records an attempt — that arrives with the CSR
-- queue (slice 4). A denormalised counter written by hand would be wrong within
-- a week. The two constraints that CAN be enforced today are, and the rest is
-- left to the slice that owns the data.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.lead_source_channel (
  key         text primary key,
  label       text not null,
  is_paid     boolean not null default false,
  is_active   boolean not null default true,
  sort_order  int not null default 100
);

insert into public.lead_source_channel (key, label, is_paid, sort_order) values
  ('web_form',      'Web form',            true,  10),
  ('inbound_call',  'Inbound call',        false, 20),
  ('sms',           'Inbound text',        false, 30),
  ('chat',          'Website chat',        true,  40),
  ('social',        'Social / Meta lead',  true,  50),
  ('referral',      'Referral',            false, 60),
  ('walk_in',       'Walk-in',             false, 70),
  ('outbound',      'Outbound / cold',     false, 80),
  ('unattributed',  'Unattributed',        false, 999)
on conflict (key) do nothing;

create table if not exists public.lead_disposition (
  key                   text primary key,
  label                 text not null,
  requires_recall_date  boolean not null default false,
  -- Advisory today: the CSR queue slice enforces these once attempts exist.
  min_attempts          int,
  min_days_working      int,
  is_active             boolean not null default true,
  sort_order            int not null default 100
);

insert into public.lead_disposition (key, label, requires_recall_date, min_attempts, min_days_working, sort_order) values
  ('not_ready',            'Not ready yet — call back',   true,  null, null, 10),
  ('no_contact_exhausted', 'Could not reach them',        false, 7,    14,   20),
  ('no_contact_method',    'No usable phone or email',    false, null, null, 30),
  ('wrong_number',         'Wrong number',                false, null, null, 40),
  ('out_of_area',          'Outside our service area',    false, null, null, 50),
  ('below_minimum',        'Below job minimum',           false, null, null, 60),
  ('not_interested',       'Not interested',              false, null, null, 70),
  ('duplicate',            'Duplicate of another lead',   false, null, null, 80),
  ('competitor',           'Went with someone else',      false, null, null, 90)
on conflict (key) do nothing;

alter table public.lead_source_channel enable row level security;
alter table public.lead_disposition   enable row level security;
-- Readable by every signed-in user: these are dropdown contents, not data.
drop policy if exists lead_source_channel_read on public.lead_source_channel;
create policy lead_source_channel_read on public.lead_source_channel for select to authenticated using (true);
drop policy if exists lead_disposition_read on public.lead_disposition;
create policy lead_disposition_read on public.lead_disposition for select to authenticated using (true);
drop policy if exists lead_source_channel_write on public.lead_source_channel;
create policy lead_source_channel_write on public.lead_source_channel for all to authenticated
  using (public.is_org_admin()) with check (public.is_org_admin());
drop policy if exists lead_disposition_write on public.lead_disposition;
create policy lead_disposition_write on public.lead_disposition for all to authenticated
  using (public.is_org_admin()) with check (public.is_org_admin());

-- ── The canonical match key ─────────────────────────────────────────────────
alter table public.lead add column if not exists phone_e164 text
  generated always as (
    case
      when regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = '' then null
      when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 10
        then '+1' || regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
      when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 11
       and left(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 1) = '1'
        then '+' || regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
      -- Already international: trust the leading + rather than assuming +1.
      when btrim(coalesce(phone, '')) like '+%'
       and length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) between 8 and 15
        then '+' || regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
      else null
    end
  ) stored;

-- ── Attribution ─────────────────────────────────────────────────────────────
alter table public.lead
  add column if not exists source_channel  text not null default 'unattributed',
  add column if not exists source_campaign text,
  add column if not exists source_medium   text,
  add column if not exists utm_source      text,
  add column if not exists utm_medium      text,
  add column if not exists utm_campaign    text,
  add column if not exists utm_content     text,
  add column if not exists utm_term        text,
  add column if not exists gclid           text,
  add column if not exists gbraid          text,
  add column if not exists wbraid          text,
  add column if not exists fbclid          text,
  add column if not exists fbp             text,
  add column if not exists fbc             text,
  add column if not exists msclkid         text,
  add column if not exists ctwa_clid       text,
  add column if not exists meta_lead_id    text,
  add column if not exists ghl_contact_id  text,
  add column if not exists ghl_location_id text,
  add column if not exists callrail_person_id  text,
  add column if not exists callrail_tracker_id text,
  add column if not exists callrail_company_id text,
  add column if not exists ga_client_id    text,
  add column if not exists ga_session_id   text,
  add column if not exists assigned_csr    text,
  add column if not exists queued_at       timestamptz,
  add column if not exists source_created_at timestamptz,
  add column if not exists disposition     text,
  add column if not exists disposition_at  timestamptz,
  add column if not exists recall_date     date;

do $$ begin
  alter table public.lead add constraint lead_source_channel_fkey
    foreign key (source_channel) references public.lead_source_channel(key);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.lead add constraint lead_disposition_fkey
    foreign key (disposition) references public.lead_disposition(key);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.lead add constraint lead_assigned_csr_fkey
    foreign key (assigned_csr) references public.team_member(id) on delete set null;
exception when duplicate_object then null; end $$;

-- OPERATING_MODEL stage 2: a lead leaves lead_working exactly once, booked or
-- dispositioned. A disposition with no timestamp cannot be aged or reported on.
do $$ begin
  alter table public.lead add constraint lead_disposition_needs_timestamp
    check (disposition is null or disposition_at is not null);
exception when duplicate_object then null; end $$;

-- `not_ready` without a recall date is how a lead disappears: dispositioned, so
-- off the queue, with nothing to bring it back.
do $$ begin
  alter table public.lead add constraint lead_not_ready_needs_recall_date
    check (disposition is distinct from 'not_ready' or recall_date is not null);
exception when duplicate_object then null; end $$;

-- ── Upsert keys ─────────────────────────────────────────────────────────────
-- "Never create a second Lead because GHL and CallRail both fired for the same
-- number." These indexes are that sentence, enforced. All partial, so a lead
-- with no phone/email/external id is still allowed to exist.
create unique index if not exists lead_phone_e164_uniq on public.lead (phone_e164)
  where phone_e164 is not null;
create unique index if not exists lead_email_uniq on public.lead (lower(btrim(email)))
  where email is not null and btrim(email) <> '';
create unique index if not exists lead_ghl_contact_uniq on public.lead (ghl_contact_id)
  where ghl_contact_id is not null;
create unique index if not exists lead_callrail_person_uniq on public.lead (callrail_person_id)
  where callrail_person_id is not null;

create index if not exists lead_source_channel_idx on public.lead (source_channel);
create index if not exists lead_source_campaign_idx on public.lead (source_campaign)
  where source_campaign is not null;
-- The CSR queue: my open leads, oldest first.
create index if not exists lead_queue_idx on public.lead (assigned_csr, queued_at)
  where queued_at is not null and disposition is null;
create index if not exists lead_recall_idx on public.lead (recall_date)
  where recall_date is not null;
create index if not exists lead_gclid_idx on public.lead (gclid) where gclid is not null;
create index if not exists lead_fbclid_idx on public.lead (fbclid) where fbclid is not null;

-- ── Call rows on `communication` ────────────────────────────────────────────
-- `type` has no CHECK constraint in the database — the SMS|Email vocabulary is
-- enforced only in app code — so 'Call' needs no widening, just its fields.
--
-- CallRail's CAL… id and RingCentral's telephonySessionId are NOT the same id
-- and cannot be made into one: they are correlated by phone number and start
-- time. Both get a column, both get a unique index, and a call may legitimately
-- carry one, the other, or both. Same for the two recordings — dual recordings
-- are expected, not a bug.
alter table public.communication
  add column if not exists callrail_id            text,
  add column if not exists callrail_person_id     text,
  add column if not exists tracking_phone_number  text,
  add column if not exists rc_telephony_session_id text,
  add column if not exists source_name            text,
  add column if not exists campaign_name          text,
  add column if not exists answered               boolean,
  add column if not exists duration_seconds        int,
  add column if not exists voicemail              boolean,
  add column if not exists callrail_recording_id  text,
  add column if not exists rc_recording_id        text,
  add column if not exists started_at             timestamptz;

-- Webhook idempotency: pre-call, routing-complete, post-call and call-modified
-- all fire for ONE call and must all land on one row.
create unique index if not exists communication_callrail_id_uniq
  on public.communication (callrail_id) where callrail_id is not null;
create unique index if not exists communication_rc_session_uniq
  on public.communication (rc_telephony_session_id) where rc_telephony_session_id is not null;
create index if not exists communication_call_started_idx
  on public.communication (started_at desc) where type = 'Call';
