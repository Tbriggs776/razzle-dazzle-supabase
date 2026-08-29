-- ─────────────────────────────────────────────────────────────────────────────
-- 0071 — Threads. Slice 4: conversation attached to the work.
--
-- Owner: "allow communication with approvals between team member, manager,
-- homeowner, and subcontractor (as needed)".
--
-- I had planned to re-key ticket/ticket_message to any subject. On inspection
-- both are EMPTY (0 rows) and ticket is hard-shaped to a DC support case —
-- order_number, customer_last_name, assigned_dc, dc_short_url,
-- requester_short_url. Re-keying would drag all of that into every project and
-- claim conversation, so a purpose-built table is both cleaner and less work.
-- ticket is left alone for whatever it was for.
--
-- THE CENTRAL IDEA IS `audience`. One thread per subject, with each message
-- marked for who may see it. That is what lets a homeowner and a subcontractor
-- take part in the same conversation as staff without ever seeing the internal
-- half of it — and it is why this is a table and not a chat app.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.thread (
  id           text primary key default gen_random_uuid()::text,
  subject_type text not null,          -- project | claim | sale | task | installer
  subject_id   text not null,
  topic        text not null,
  created_by   uuid references public.app_user(id) on delete set null,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,
  closed_by    uuid,
  constraint thread_subject_type_chk
    check (subject_type in ('project','claim','sale','task','installer'))
);

create index if not exists thread_subject_idx on public.thread (subject_type, subject_id);
create index if not exists thread_open_idx on public.thread (created_at desc) where closed_at is null;

create table if not exists public.thread_message (
  id           text primary key default gen_random_uuid()::text,
  thread_id    text not null references public.thread(id) on delete cascade,
  body         text not null,

  -- WHO MAY SEE THIS. 'internal' never leaves staff. The external audiences are
  -- additive: a message for the customer is also visible to staff, never the
  -- other way round. Default is the safe one.
  audience     text not null default 'internal',

  author_user  uuid references public.app_user(id) on delete set null,
  author_kind  text not null default 'staff',    -- staff | customer | installer | system
  author_label text,                             -- display name for non-staff authors
  file_urls    jsonb not null default '[]'::jsonb,

  -- A message can BE an approval request or its outcome, which is how
  -- "communication with approvals" stays in one place instead of two.
  approval_id  text references public.approval(id) on delete set null,

  created_at   timestamptz not null default now(),

  constraint thread_message_audience_chk
    check (audience in ('internal','customer','installer','all')),
  constraint thread_message_author_kind_chk
    check (author_kind in ('staff','customer','installer','system'))
);

create index if not exists thread_message_thread_idx on public.thread_message (thread_id, created_at);

comment on column public.thread_message.audience is
  'internal = staff only (the default, deliberately). customer = the homeowner may see it. installer = the subcontractor may see it. all = every participant. Staff can always see everything; external audiences never see internal.';

alter table public.thread         enable row level security;
alter table public.thread_message enable row level security;
revoke all on table public.thread, public.thread_message from anon;

-- Staff visibility follows the subject's module. External participants do NOT
-- read these tables at all — they will come through narrow RPCs in the customer
-- portal and the subcontractor portal, so a policy mistake here can never expose
-- a thread to a third party.
drop policy if exists thread_read on public.thread;
create policy thread_read on public.thread
  for select to authenticated
  using (public.is_org_admin() or public.can_view('projects') or public.can_view('journey')
         or public.can_view('tickets') or public.can_view('communication'));

drop policy if exists thread_message_read on public.thread_message;
create policy thread_message_read on public.thread_message
  for select to authenticated
  using (public.is_org_admin() or public.can_view('projects') or public.can_view('journey')
         or public.can_view('tickets') or public.can_view('communication'));

-- Writes go through the RPCs only, so authorship and audience cannot be forged.
drop policy if exists thread_service on public.thread;
create policy thread_service on public.thread
  for all to service_role using (true) with check (true);
drop policy if exists thread_message_service on public.thread_message;
create policy thread_message_service on public.thread_message
  for all to service_role using (true) with check (true);

-- Messages are never edited or deleted: a conversation that can be rewritten
-- afterwards is worthless in a dispute, which is the situation these exist for.
revoke update, delete on public.thread_message from authenticated;

-- ── Posting ──────────────────────────────────────────────────────────────────
-- One open thread per (subject, topic), so "the conversation about this job"
-- has one home rather than fragmenting.
create or replace function public.open_thread(
  p_subject_type text,
  p_subject_id   text,
  p_topic        text
) returns text language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_id text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_topic), '') = '' then raise exception 'A thread needs a topic'; end if;

  select id into v_id from public.thread
   where subject_type = p_subject_type and subject_id = p_subject_id
     and lower(trim(topic)) = lower(trim(p_topic)) and closed_at is null
   limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.thread (subject_type, subject_id, topic, created_by)
  values (p_subject_type, p_subject_id, p_topic, v_uid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.post_message(
  p_thread_id   text,
  p_body        text,
  p_audience    text default 'internal',
  p_file_urls   jsonb default '[]'::jsonb,
  p_approval_id text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_actor text; v_msg text; t public.thread; v_o uuid; v_n int := 0;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'A message needs a body'; end if;
  if p_audience not in ('internal','customer','installer','all') then
    raise exception 'Unknown audience %', p_audience;
  end if;

  select * into t from public.thread where id = p_thread_id;
  if not found then raise exception 'Thread not found'; end if;
  if t.closed_at is not null then raise exception 'That thread is closed'; end if;

  v_actor := coalesce(public.jwt_email(), 'system');

  insert into public.thread_message (thread_id, body, audience, author_user, author_kind,
                                     author_label, file_urls, approval_id)
  values (p_thread_id, p_body, p_audience, v_uid, 'staff', v_actor,
          coalesce(p_file_urls, '[]'::jsonb), p_approval_id)
  returning id into v_msg;

  -- Notify everyone already in the conversation, plus whoever currently owns
  -- work on the same subject — that is the link between talking and doing.
  for v_o in
    select distinct u from (
      select m.author_user as u from public.thread_message m
       where m.thread_id = p_thread_id and m.author_user is not null
      union
      select tk.assigned_user from public.task tk
       where tk.subject_type = t.subject_type and tk.subject_id = t.subject_id
         and tk.completed_at is null and tk.assigned_user is not null
      union
      select th.created_by from public.thread th where th.id = p_thread_id and th.created_by is not null
    ) s(u)
    where u is distinct from v_uid
  loop
    if public.notify(v_o, 'New message: ' || t.topic, left(p_body, 180), 'message', 'info',
                     t.subject_type, t.subject_id, '/Work',
                     'thread_message', 'thread:' || p_thread_id, false) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'message_id', v_msg, 'notified', v_n);
end $$;

create or replace function public.close_thread(p_thread_id text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  update public.thread set closed_at = now(), closed_by = v_uid
   where id = p_thread_id and closed_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'missing or already closed'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.open_thread(text,text,text) from public, anon;
revoke all on function public.post_message(text,text,text,jsonb,text) from public, anon;
revoke all on function public.close_thread(text) from public, anon;
grant execute on function public.open_thread(text,text,text) to authenticated, service_role;
grant execute on function public.post_message(text,text,text,jsonb,text) to authenticated, service_role;
grant execute on function public.close_thread(text) to authenticated, service_role;
