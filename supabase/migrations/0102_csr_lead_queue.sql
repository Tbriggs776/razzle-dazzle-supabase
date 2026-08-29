-- ─────────────────────────────────────────────────────────────────────────────
-- 0102 — Pillars slice 4: the CSR lead queue, server side.
--
-- OPERATING_MODEL stage 2 (`lead_working`) says a lead leaves the queue exactly
-- once — BOOKED or DISPOSITIONED — with a first dial inside 5 minutes and a
-- 0/1/3/7/14 day attempt cadence. 0098 gave leads `queued_at`, `assigned_csr`
-- and a disposition vocabulary. This makes them workable.
--
-- ── ATTEMPTS ARE COMMUNICATION ROWS, NOT A COUNTER ──────────────────────────
-- The 0098 commit flagged that `no_contact_exhausted` (>=7 attempts over >=14
-- days) was unenforceable because nothing recorded an attempt, and that a
-- denormalised counter would be wrong within a week. It is not needed: an
-- attempt already has a natural home. `communication` has lead_id, direction
-- and type, so a logged dial is one outbound row — and it is the SAME table
-- CallRail will write into at slice 2. A hand-logged dial and an automatically
-- captured one therefore count alike, and there is no second number to drift.
--
-- `lead_attempt_count()` is the single definition of "how many times have we
-- tried", and both the cadence and the disposition rules read it.
--
-- ── THE CADENCE, AND AN OFF-BY-ONE WORTH REMEMBERING ────────────────────────
-- Touch days are 0, 1, 3, 7, 14. Postgres arrays are ONE-based, so the day
-- after n attempts is element n+1: one attempt made (that was day 0) means the
-- next touch is day 1. Indexing with n returned day 0 after the first dial,
-- which left every worked lead permanently showing as overdue — caught by the
-- cadence test, not by reading the code.
--
-- After the fifth touch the cadence plateaus at day 14 rather than running off
-- the end of the array: by then the lead is eligible for no_contact_exhausted
-- and needs a decision, not another slot.
--
-- ── claim_next_lead USES `for update skip locked` ───────────────────────────
-- Two CSRs pressing "next" in the same second must not both be handed the same
-- person to ring. This is the one place in the queue with a real race.
--
-- ── WHAT THE RPCs REFUSE ────────────────────────────────────────────────────
-- disposition_lead reads the rules off `lead_disposition` itself rather than
-- hardcoding them, so tightening "7 attempts / 14 days" is an UPDATE. It
-- refuses: an unknown disposition, `not_ready` with no recall date, a recall
-- date in the past, and any disposition whose min_attempts/min_days_working are
-- not met. log_lead_attempt auto-dispositions `bad_number` to `wrong_number` —
-- there is nothing left to attempt on a number that does not exist.
--
-- Verified by impersonation: cadence lands on +5min / +1 / +3 / +7 / +14 / +14;
-- exhaustion refused at 1 attempt, refused at 7 attempts on day 0, accepted at
-- 7 attempts on day 15; not_ready refused with no date and with a past date;
-- a dispositioned lead leaves the queue; bad_number closes the lead.
-- ─────────────────────────────────────────────────────────────────────────────

-- Which team_member is the signed-in user? `app_user.team_member_id` is stamped
-- at signup from the email match, but a team_member row created AFTER the login
-- leaves it null — so fall back to the email.
create or replace function public.my_team_member()
returns text language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select team_member_id from public.app_user where id = (select auth.uid())),
    (select id from public.team_member where lower(email) = lower(coalesce(public.jwt_email(), '')) limit 1)
  );
$$;

create or replace function public.lead_attempt_count(p_lead_id text)
returns int language sql stable security definer set search_path to 'public'
as $$
  select count(*)::int from public.communication
   where lead_id = p_lead_id and direction = 'outbound' and deleted_at is null;
$$;

create or replace function public.lead_cadence_days(p_attempts int)
returns int language sql immutable
as $$
  -- See the header: arrays are 1-based, so element n+1 is the day AFTER n attempts.
  select (array[0, 1, 3, 7, 14])[least(greatest(p_attempts, 0) + 1, 5)];
$$;

create or replace function public.lead_queue(p_scope text default 'mine')
returns table (
  lead_id text, first_name text, last_name text, phone text, phone_e164 text,
  email text, city text,
  source_channel text, source_label text, source_campaign text,
  queued_at timestamptz, assigned_csr text, csr_name text,
  attempt_count int, last_attempt_at timestamptz, next_due_at timestamptz,
  recall_date date, is_first_dial boolean
) language sql stable security definer set search_path to 'public'
as $$
  with me as (select public.my_team_member() as tm),
  base as (
    select l.*,
           (select max(c.created_date) from public.communication c
             where c.lead_id = l.id and c.direction = 'outbound' and c.deleted_at is null) as last_att,
           public.lead_attempt_count(l.id) as atts
      from public.lead l
     where l.disposition is null
       and l.queued_at is not null
  )
  select b.id, b.first_name, b.last_name, b.phone, b.phone_e164, b.email, b.city,
         b.source_channel, sc.label, b.source_campaign,
         b.queued_at, b.assigned_csr,
         nullif(btrim(coalesce(tm.first_name,'') || ' ' || coalesce(tm.last_name,'')), ''),
         b.atts, b.last_att,
         case
           -- A promised call-back date outranks the cadence: we told them a day.
           when b.recall_date is not null then b.recall_date::timestamptz
           when b.atts = 0 then b.queued_at + interval '5 minutes'
           else b.queued_at + (public.lead_cadence_days(b.atts) || ' days')::interval
         end,
         b.recall_date,
         (b.atts = 0)
    from base b
    cross join me
    left join public.lead_source_channel sc on sc.key = b.source_channel
    left join public.team_member tm on tm.id = b.assigned_csr
   where (
     case p_scope
       when 'mine'       then b.assigned_csr is not distinct from me.tm and me.tm is not null
       when 'unassigned' then b.assigned_csr is null
       else public.can_view('leads')
     end
   )
   order by 16 asc nulls last;   -- next_due_at: most overdue first
$$;

create or replace function public.claim_next_lead()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_tm text; v_id text;
begin
  if not (public.can_edit('leads') or public.is_org_admin()) then
    raise exception 'Not allowed to work leads';
  end if;
  v_tm := public.my_team_member();
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'your login is not linked to a team member yet');
  end if;

  -- skip locked: two CSRs pressing "next" at the same moment must not both be
  -- handed the same person to ring.
  select id into v_id from public.lead
   where disposition is null and queued_at is not null and assigned_csr is null
   order by queued_at asc
   for update skip locked
   limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing waiting in the queue');
  end if;

  update public.lead set assigned_csr = v_tm, updated_date = now() where id = v_id;
  return jsonb_build_object('ok', true, 'lead_id', v_id);
end $$;

create or replace function public.log_lead_attempt(
  p_lead_id text, p_channel text, p_outcome text, p_note text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_tm text; v_lead record; v_type text; v_id text;
begin
  if not (public.can_edit('leads') or public.is_org_admin()) then
    raise exception 'Not allowed to work leads';
  end if;
  if p_channel not in ('call','sms','email') then
    raise exception 'Channel must be call, sms or email';
  end if;
  if p_outcome not in ('no_answer','voicemail','connected','bad_number','sent') then
    raise exception 'Unknown outcome "%"', p_outcome;
  end if;

  select * into v_lead from public.lead where id = p_lead_id;
  if not found then raise exception 'No such lead'; end if;

  v_tm := public.my_team_member();
  v_type := case p_channel when 'call' then 'Call' when 'sms' then 'SMS' else 'Email' end;

  -- An attempt IS a communication row. That is the same table CallRail will write
  -- into, so a hand-logged dial and an automatically captured one count alike and
  -- no separate attempt counter can drift from it.
  insert into public.communication (
    type, direction, lead_id, contact_phone, contact_email, contact_name,
    body, status, sent_by, created_by, answered, started_at
  ) values (
    v_type, 'outbound', p_lead_id, v_lead.phone_e164, v_lead.email,
    nullif(btrim(coalesce(v_lead.first_name,'') || ' ' || coalesce(v_lead.last_name,'')), ''),
    coalesce(nullif(btrim(coalesce(p_note,'')), ''), 'Attempt logged: ' || p_channel || ' — ' || p_outcome),
    p_outcome, 'Team Member', v_tm,
    case when p_channel = 'call' then (p_outcome = 'connected') else null end,
    now()
  ) returning id into v_id;

  -- Bad number is terminal on its own: there is nothing left to attempt.
  if p_outcome = 'bad_number' and v_lead.disposition is null then
    update public.lead set disposition = 'wrong_number', disposition_at = now(), updated_date = now()
     where id = p_lead_id;
  end if;

  return jsonb_build_object('ok', true, 'communication_id', v_id,
                            'attempt_count', public.lead_attempt_count(p_lead_id));
end $$;

create or replace function public.disposition_lead(
  p_lead_id text, p_disposition text, p_recall_date date default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare d record; v_lead record; v_atts int; v_days numeric;
begin
  if not (public.can_edit('leads') or public.is_org_admin()) then
    raise exception 'Not allowed to work leads';
  end if;

  select * into d from public.lead_disposition where key = p_disposition and is_active;
  if not found then raise exception 'Unknown disposition "%"', p_disposition; end if;

  select * into v_lead from public.lead where id = p_lead_id;
  if not found then raise exception 'No such lead'; end if;

  if d.requires_recall_date and p_recall_date is null then
    return jsonb_build_object('ok', false, 'reason', 'that one needs a date to call them back on');
  end if;
  if p_recall_date is not null and p_recall_date < current_date then
    return jsonb_build_object('ok', false, 'reason', 'the call-back date is in the past');
  end if;

  -- The rules the vocabulary itself carries — today only no_contact_exhausted
  -- uses them (>=7 attempts over >=14 days), and they are now checkable because
  -- attempts are counted from `communication` rather than a hand-kept number.
  v_atts := public.lead_attempt_count(p_lead_id);
  v_days := extract(epoch from (now() - coalesce(v_lead.queued_at, v_lead.created_date))) / 86400.0;
  if d.min_attempts is not null and v_atts < d.min_attempts then
    return jsonb_build_object('ok', false, 'reason',
      format('that needs %s attempts logged and there are %s', d.min_attempts, v_atts));
  end if;
  if d.min_days_working is not null and v_days < d.min_days_working then
    return jsonb_build_object('ok', false, 'reason',
      format('that needs %s days of working the lead and it has been %s', d.min_days_working, round(v_days)));
  end if;

  update public.lead
     set disposition = p_disposition,
         disposition_at = now(),
         recall_date = p_recall_date,
         notes = case when nullif(btrim(coalesce(p_note,'')), '') is null then notes
                      else coalesce(notes || E'\n', '') ||
                           to_char(now() at time zone 'America/Phoenix', 'YYYY-MM-DD HH24:MI') ||
                           ' — ' || d.label || ': ' || btrim(p_note) end,
         updated_date = now()
   where id = p_lead_id;

  return jsonb_build_object('ok', true, 'disposition', p_disposition, 'attempts', v_atts);
end $$;

create or replace function public.reopen_lead(p_lead_id text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
begin
  if not (public.can_edit('leads') or public.is_org_admin()) then
    raise exception 'Not allowed to work leads';
  end if;
  update public.lead set disposition = null, disposition_at = null, updated_date = now()
   where id = p_lead_id;
  if not found then raise exception 'No such lead'; end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.my_team_member() from public, anon;
revoke all on function public.lead_attempt_count(text) from public, anon;
revoke all on function public.lead_cadence_days(int) from public, anon;
revoke all on function public.lead_queue(text) from public, anon;
revoke all on function public.claim_next_lead() from public, anon;
revoke all on function public.log_lead_attempt(text,text,text,text) from public, anon;
revoke all on function public.disposition_lead(text,text,date,text) from public, anon;
revoke all on function public.reopen_lead(text) from public, anon;
grant execute on function public.my_team_member() to authenticated, service_role;
grant execute on function public.lead_attempt_count(text) to authenticated, service_role;
grant execute on function public.lead_cadence_days(int) to authenticated, service_role;
grant execute on function public.lead_queue(text) to authenticated, service_role;
grant execute on function public.claim_next_lead() to authenticated, service_role;
grant execute on function public.log_lead_attempt(text,text,text,text) to authenticated, service_role;
grant execute on function public.disposition_lead(text,text,date,text) to authenticated, service_role;
grant execute on function public.reopen_lead(text) to authenticated, service_role;
