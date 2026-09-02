-- GHL's do-not-contact state for every contact, as a readable snapshot.
--
-- WHY NOT public.suppression. That table is the ENFORCEMENT list -- sendMessage
-- consults it before every send, and its check constraint only admits the two
-- channels this system can actually act on. Bulk-loading 17,000 rows into it would
-- silently change who Razzle is willing to message, and outbound is deliberately
-- disarmed until the base44 cutover. Reporting on DND and enforcing DND are two
-- different acts; this table is the first one only.
--
-- WHY IT IS NEEDED AT ALL. suppression currently holds 32 rows, every one written by
-- the GHL webhook since it went live on 2026-08-31, matching 11 of 17,524 leads. We
-- know the DND state of contacts whose DND *changed* in the last two days and nothing
-- else. The founder asked for DND across the whole lead book, and the only source for
-- that is GHL's contacts API.
--
-- Channels are stored separately rather than as one boolean because they genuinely
-- differ -- a contact can be reachable by email and not by SMS, and "can we contact
-- them" has a different answer per campaign. `dnd_blanket` is GHL's top-level `dnd`
-- flag, which overrides every channel at once; it is kept distinct so a reader can
-- tell "opted out of texts" from "opted out of everything".
create table if not exists public.ghl_contact_dnd (
  contact_id    text primary key,
  dnd_blanket   boolean not null default false,
  dnd_sms       boolean not null default false,
  dnd_email     boolean not null default false,
  -- Call / WhatsApp / GMB / FB. Recorded because the founder's question is about
  -- reachability, not about what sendMessage happens to support today.
  dnd_other     text[]  not null default '{}',
  synced_at     timestamptz not null default now()
);

comment on table public.ghl_contact_dnd is
  'Snapshot of GHL do-not-contact state per contact, for reporting. NOT the enforcement list -- that is public.suppression, which sendMessage reads. Populated by the ghl function''s sync_dnd action.';

create index if not exists ghl_contact_dnd_any_idx
  on public.ghl_contact_dnd (contact_id)
  where dnd_blanket or dnd_sms or dnd_email;

alter table public.ghl_contact_dnd enable row level security;

-- Same shape as the other GHL tables: readable by staff who can see leads, wrapped in
-- a scalar subquery so the check is an InitPlan evaluated once rather than per row
-- (see 0141 -- the un-wrapped form is what took the Communication Hub down).
drop policy if exists ghl_contact_dnd_read on public.ghl_contact_dnd;
create policy ghl_contact_dnd_read on public.ghl_contact_dnd
  for select to authenticated
  using ((select public.can_view('leads')) or (select public.is_org_admin()));

revoke all on table public.ghl_contact_dnd from anon;
