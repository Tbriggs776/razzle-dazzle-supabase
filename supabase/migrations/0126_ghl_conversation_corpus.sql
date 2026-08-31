-- GoHighLevel conversation corpus.
--
-- 18,919 conversations and their messages, pulled in over time. The point is not
-- an inbox mirror: this is the text record of how Floor Daddy actually talks to
-- customers, and it is meant to be read by analysis later — which drives three
-- decisions that would otherwise look like over-engineering.
--
-- 1. RAW IS KEPT VERBATIM. Every row carries the GHL payload in `raw` alongside
--    the parsed columns. Parsing is a guess about what matters today; analysis
--    later will want fields nobody thought to extract, and re-pulling 18,919
--    conversations to recover them is not a thing anyone should have to do. The
--    typed columns are a convenience over the raw, never a replacement for it.
--
-- 2. THESE ARE NOT `thread` ROWS. thread.subject_type is CHECK-constrained to
--    project|claim|sale|task|installer, and a conversation with a lead is none
--    of those. Widening that constraint would drag the internal-notes machinery
--    (visibility audiences, closure) onto records that have neither. So the
--    corpus stands on its own and links out to `lead` instead.
--
-- 3. THE SYNC IS RESUMABLE, NOT A BIG RUN. GHL pages, rate-limits, and will fail
--    somewhere in the middle of any job this size. `ghl_sync_state` holds one
--    cursor per unit of work so a crashed or throttled run resumes where it
--    stopped rather than starting over — and so the backfill can trickle in the
--    background without anyone babysitting it.
--
-- Read access is gated on can_view('leads'): message bodies carry customer names,
-- phone numbers and addresses, and are exactly as sensitive as the lead record
-- they belong to. Writes are service_role only — the sync worker.

-- ── conversations ─────────────────────────────────────────────────────────────
create table if not exists public.ghl_conversation (
  id                 text primary key,               -- GHL conversation id
  location_id        text not null,
  contact_id         text,
  lead_id            text references public.lead(id) on delete set null,

  last_message_at    timestamptz,
  last_message_type  text,
  last_message_body  text,
  unread_count       int,

  raw                jsonb not null,

  -- Message-pull progress for THIS conversation. null messages_synced_at means
  -- the thread has been discovered but its messages have never been fetched.
  messages_synced_at timestamptz,
  messages_cursor    text,
  message_count      int not null default 0,
  last_error         text,

  created_date       timestamptz not null default now(),
  updated_date       timestamptz not null default now()
);

comment on table public.ghl_conversation is
  'One row per GoHighLevel conversation thread. `raw` is the search payload verbatim; the typed columns are a convenience over it. messages_synced_at null means the messages for this thread have not been pulled yet.';

create index if not exists ghl_conversation_lead_idx
  on public.ghl_conversation (lead_id) where lead_id is not null;
create index if not exists ghl_conversation_contact_idx
  on public.ghl_conversation (contact_id);
create index if not exists ghl_conversation_recent_idx
  on public.ghl_conversation (last_message_at desc nulls last);
-- The work queue for the backfill: threads whose messages are still missing,
-- oldest activity first so history fills in predictably rather than randomly.
create index if not exists ghl_conversation_unsynced_idx
  on public.ghl_conversation (last_message_at desc nulls last)
  where messages_synced_at is null;

-- ── messages ──────────────────────────────────────────────────────────────────
create table if not exists public.ghl_message (
  id              text primary key,                  -- GHL message id
  conversation_id text not null references public.ghl_conversation(id) on delete cascade,
  location_id     text,
  contact_id      text,
  lead_id         text references public.lead(id) on delete set null,

  direction       text,                              -- inbound | outbound
  message_type    text,                              -- TYPE_SMS | TYPE_EMAIL | TYPE_INSTAGRAM | …
  status          text,                              -- delivered | failed | …
  body            text,
  sent_at         timestamptz,

  raw             jsonb not null,
  created_date    timestamptz not null default now()
);

comment on table public.ghl_message is
  'Individual GoHighLevel messages. Primary key is GHL''s own message id, so a re-run or an overlapping page upserts rather than duplicating.';

create index if not exists ghl_message_conversation_idx
  on public.ghl_message (conversation_id, sent_at desc);
create index if not exists ghl_message_lead_idx
  on public.ghl_message (lead_id, sent_at desc) where lead_id is not null;
create index if not exists ghl_message_sent_idx
  on public.ghl_message (sent_at desc);
create index if not exists ghl_message_type_idx
  on public.ghl_message (message_type);

-- ── sync cursors ──────────────────────────────────────────────────────────────
-- One row per unit of work. Deliberately generic (a text key) so the same table
-- carries the conversation sweep, the per-conversation message pull, and
-- whatever the next GHL backfill turns out to be.
create table if not exists public.ghl_sync_state (
  key           text primary key,
  cursor        text,
  page          int not null default 0,
  items_seen    int not null default 0,
  items_written int not null default 0,
  is_complete   boolean not null default false,
  last_run_at   timestamptz,
  last_error    text,
  started_at    timestamptz not null default now(),
  updated_date  timestamptz not null default now()
);

comment on table public.ghl_sync_state is
  'Resumable cursors for GHL backfills. A run that dies mid-way leaves its cursor here so the next run continues instead of restarting.';

-- ── access ────────────────────────────────────────────────────────────────────
alter table public.ghl_conversation enable row level security;
alter table public.ghl_message      enable row level security;
alter table public.ghl_sync_state   enable row level security;

drop policy if exists ghl_conversation_read on public.ghl_conversation;
create policy ghl_conversation_read on public.ghl_conversation
  for select to authenticated using (public.can_view('leads') or public.is_org_admin());

drop policy if exists ghl_message_read on public.ghl_message;
create policy ghl_message_read on public.ghl_message
  for select to authenticated using (public.can_view('leads') or public.is_org_admin());

drop policy if exists ghl_sync_state_read on public.ghl_sync_state;
create policy ghl_sync_state_read on public.ghl_sync_state
  for select to authenticated using (public.is_org_admin());

revoke all on public.ghl_conversation from anon, authenticated;
revoke all on public.ghl_message      from anon, authenticated;
revoke all on public.ghl_sync_state   from anon, authenticated;
grant select on public.ghl_conversation to authenticated;
grant select on public.ghl_message      to authenticated;
grant select on public.ghl_sync_state   to authenticated;

-- ── linking conversations to leads ────────────────────────────────────────────
-- Conversations arrive with a GHL contact id; leads carry the same id once they
-- have come through the webhook. The link is therefore resolvable at any time,
-- and is re-run rather than done once: a conversation can be pulled before its
-- contact has ever produced a lead, and should attach itself later rather than
-- staying orphaned forever.
create or replace function public.ghl_link_conversations_to_leads()
returns table (conversations_linked int, messages_linked int)
language plpgsql security definer set search_path = public as $$
declare c int; m int;
begin
  update public.ghl_conversation gc
     set lead_id = l.id, updated_date = now()
    from public.lead l
   where gc.lead_id is null
     and gc.contact_id is not null
     and l.ghl_contact_id = gc.contact_id;
  get diagnostics c = row_count;

  update public.ghl_message gm
     set lead_id = gc.lead_id
    from public.ghl_conversation gc
   where gm.conversation_id = gc.id
     and gm.lead_id is null
     and gc.lead_id is not null;
  get diagnostics m = row_count;

  return query select c, m;
end $$;

comment on function public.ghl_link_conversations_to_leads() is
  'Attach conversations and messages to leads by GHL contact id. Safe and cheap to re-run — it only touches rows that are still unlinked, so it can be called after every sync pass.';

revoke execute on function public.ghl_link_conversations_to_leads() from public, anon;
grant execute on function public.ghl_link_conversations_to_leads() to authenticated, service_role;
