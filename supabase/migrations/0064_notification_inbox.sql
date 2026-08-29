-- ─────────────────────────────────────────────────────────────────────────────
-- 0064 — The in-app inbox. Slice 1 of communications + task management.
--
-- Why this is first, before any rule engine:
--   Every internal alert in this system is an SMS through an account that cannot
--   send, and there is no in-app fallback anywhere in 78 pages. So the asbestos
--   hard-stop, the Journey hard-locks and the COD hold all fire into a void —
--   the job stalls while the board shows green. Read state today lives in one
--   browser's localStorage and dies on a device switch, so the question
--   "did the Field Manager SEE the asbestos halt?" is currently unanswerable.
--
-- This table exists to make that question answerable, and it depends on NO
-- vendor credential.
--
-- ACKNOWLEDGEMENT IS THE POINT. `read_at` is passive (it appeared on screen);
-- `acknowledged_at` is a deliberate act by a named human. Accountability is
-- built on the second, never the first.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.notification (
  id              text primary key default gen_random_uuid()::text,
  recipient       uuid not null references public.app_user(id) on delete cascade,

  kind            text not null default 'alert',   -- alert | task | approval | message | system
  severity        text not null default 'info',    -- info | warn | crit
  title           text not null,
  body            text,

  -- What it is about, so the inbox can deep-link and so management can ask
  -- "everything outstanding on this job".
  subject_type    text,                            -- project | sale | claim | task | installer
  subject_id      text,
  route           text,                            -- in-app path to act on it

  rule_key        text,                            -- provenance when machine-generated
  dedupe_key      text,                            -- one open notice per logical event

  requires_ack    boolean not null default false,
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  expires_at      timestamptz,

  constraint notification_severity_chk check (severity in ('info','warn','crit')),
  constraint notification_kind_chk     check (kind in ('alert','task','approval','message','system'))
);

comment on table public.notification is
  'In-app inbox. NEVER put customer money or margin in title/body — an inbox row is visible to its recipient regardless of what module permissions they hold. Reference the subject and let the target screen apply its own RLS.';
comment on column public.notification.acknowledged_at is
  'A deliberate act by a named human. read_at only means it rendered. Accountability is measured on this column.';

create index if not exists notification_recipient_open_idx
  on public.notification (recipient, created_at desc)
  where acknowledged_at is null;
create index if not exists notification_subject_idx
  on public.notification (subject_type, subject_id);

-- One OPEN notice per (recipient, dedupe_key): re-firing an unresolved event
-- refreshes it rather than burying the person in duplicates.
create unique index if not exists notification_dedupe_uq
  on public.notification (recipient, dedupe_key)
  where dedupe_key is not null and acknowledged_at is null;

alter table public.notification enable row level security;
revoke all on table public.notification from anon;

-- Recipients read their own. Org admins read everything, because the owner's
-- stated goal is management visibility into whether people are acknowledging.
drop policy if exists notification_read on public.notification;
create policy notification_read on public.notification
  for select to authenticated
  using (recipient = (select auth.uid()) or public.is_org_admin());

-- Nobody writes directly — not even to mark their own as read. Every mutation
-- goes through the gated RPCs below, so the audit trail cannot be forged.
drop policy if exists notification_service_write on public.notification;
create policy notification_service_write on public.notification
  for all to service_role using (true) with check (true);

-- ── Producing ────────────────────────────────────────────────────────────────
create or replace function public.notify(
  p_recipient    uuid,
  p_title        text,
  p_body         text default null,
  p_kind         text default 'alert',
  p_severity     text default 'info',
  p_subject_type text default null,
  p_subject_id   text default null,
  p_route        text default null,
  p_rule_key     text default null,
  p_dedupe_key   text default null,
  p_requires_ack boolean default false
) returns text language plpgsql security definer set search_path to 'public'
as $$
declare v_id text;
begin
  if p_recipient is null or coalesce(trim(p_title), '') = '' then
    return null;
  end if;
  -- Never notify a disabled account.
  if not exists (select 1 from public.app_user where id = p_recipient and coalesce(is_active, true)) then
    return null;
  end if;

  insert into public.notification
    (recipient, title, body, kind, severity, subject_type, subject_id, route,
     rule_key, dedupe_key, requires_ack)
  values
    (p_recipient, p_title, p_body, p_kind, p_severity, p_subject_type, p_subject_id, p_route,
     p_rule_key, p_dedupe_key, p_requires_ack)
  on conflict (recipient, dedupe_key) where dedupe_key is not null and acknowledged_at is null
  do update set created_at = now(), title = excluded.title, body = excluded.body,
                severity = excluded.severity, read_at = null
  returning id into v_id;

  return v_id;
end $$;

-- Fan out to every ACTIVE holder of a role. This is the crude half of routing;
-- proper role->person resolution with an on-call flag is the next slice.
create or replace function public.notify_role(
  p_role_name    text,
  p_title        text,
  p_body         text default null,
  p_kind         text default 'alert',
  p_severity     text default 'info',
  p_subject_type text default null,
  p_subject_id   text default null,
  p_route        text default null,
  p_rule_key     text default null,
  p_dedupe_key   text default null,
  p_requires_ack boolean default false
) returns int language plpgsql security definer set search_path to 'public'
as $$
declare v_n int := 0; r record;
begin
  for r in
    select distinct au.id
      from public.app_user au
      join public.user_role ur on ur.user_id = au.id
      join public.role ro on ro.id = ur.role_id
     where coalesce(au.is_active, true)
       and lower(trim(ro.name)) = lower(trim(p_role_name))
  loop
    if public.notify(r.id, p_title, p_body, p_kind, p_severity, p_subject_type,
                     p_subject_id, p_route, p_rule_key, p_dedupe_key, p_requires_ack) is not null then
      v_n := v_n + 1;
    end if;
  end loop;

  -- An alert that reaches nobody is worse than no alert, because it looks like
  -- coverage. Fall back to org admins and say so in the body.
  if v_n = 0 then
    for r in select id from public.app_user where is_org_admin and coalesce(is_active, true) loop
      if public.notify(r.id, p_title,
                       coalesce(p_body || ' ', '') || '[Routed to you because no active user holds the role "'
                         || p_role_name || '".]',
                       p_kind, p_severity, p_subject_type, p_subject_id, p_route,
                       p_rule_key, p_dedupe_key, p_requires_ack) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end if;

  return v_n;
end $$;

-- ── Consuming ────────────────────────────────────────────────────────────────
create or replace function public.mark_notifications_read(p_ids text[])
returns int language plpgsql security definer set search_path to 'public'
as $$
declare v_n int;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  update public.notification
     set read_at = coalesce(read_at, now())
   where id = any(p_ids) and recipient = (select auth.uid());
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Acknowledging is the accountable act, so only the RECIPIENT may do it —
-- not an admin on their behalf. That is what makes the record mean something.
create or replace function public.acknowledge_notification(p_id text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid;
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  update public.notification
     set acknowledged_at = now(), acknowledged_by = v_uid, read_at = coalesce(read_at, now())
   where id = p_id and recipient = v_uid and acknowledged_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not yours, missing, or already acknowledged');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.notify(uuid,text,text,text,text,text,text,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.notify_role(text,text,text,text,text,text,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.notify(uuid,text,text,text,text,text,text,text,text,text,boolean) to service_role;
grant execute on function public.notify_role(text,text,text,text,text,text,text,text,text,text,boolean) to service_role;

revoke all on function public.mark_notifications_read(text[]) from public, anon;
revoke all on function public.acknowledge_notification(text)  from public, anon;
grant execute on function public.mark_notifications_read(text[]) to authenticated, service_role;
grant execute on function public.acknowledge_notification(text)  to authenticated, service_role;
