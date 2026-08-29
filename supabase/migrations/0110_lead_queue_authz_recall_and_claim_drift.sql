-- ─────────────────────────────────────────────────────────────────────────────
-- 0110 — Three defects in my own lead queue (0102/0104), found by an
-- adversarial review and each reproduced against the live database first.
--
-- ── 1. PII LEAK (critical) ──────────────────────────────────────────────────
-- lead_queue() is SECURITY DEFINER, so RLS on `lead` does not apply — and the
-- scope switch checked can_view('leads') on the 'all' branch ONLY. 'mine' and
-- 'unassigned' had no permission check whatsoever.
--
-- Demonstrated: a subcontractor CREW login — no staff modules, correctly reads
-- ZERO rows from `lead` under RLS — called lead_queue('unassigned') and got
-- back "Marcy Vaughn 6025550909 marcy@example.test 88 Cactus Rd". Full name,
-- phone, email and home address of every unworked lead, to an outside
-- contractor. This is precisely the exposure the portal migrations 0092-0094
-- were written to prevent, punched open by me eight migrations later.
--
-- The authorization check now sits OUTSIDE the scope switch, so it applies to
-- every branch and a future scope cannot be added without it.
--
-- ── 2. A PROMISE THE SYSTEM DID NOT KEEP (critical) ─────────────────────────
-- The disposition dialog told the CSR, in as many words, "They come back to the
-- top of your queue that morning." They never did. lead_queue filtered on
-- `disposition is null`, and `not_ready` sets a disposition — so parking a lead
-- with a call-back date removed it permanently. The recall_date branch inside
-- next_due_at was dead code for the same reason.
--
-- Every "call me in the spring" lead was being silently dropped, which is the
-- single most valuable category of lead a dealership has.
--
-- Fixed by treating a due recall as OPEN rather than closed. The disposition is
-- kept (it still records why the lead was parked) and the row is flagged
-- is_recall so the board can say why someone closed out last month is back.
-- The date comparison is in America/Phoenix, because "that morning" means the
-- customer's morning.
--
-- ── 3. DRIFT BETWEEN TWO COPIES OF ONE RULE (high) ──────────────────────────
-- 0104 added the booked-lead exclusion to lead_queue but not to
-- claim_next_lead, which carried its own copy of the predicate. So "Take the
-- next lead" could assign a CSR a job that was already booked — verified — and
-- that lead then never appeared on their board, because lead_queue correctly
-- hid it. The CSR is holding something they cannot see.
--
-- The fix is not to patch the second copy; it is to delete it. claim_next_lead
-- now selects its candidate FROM lead_queue('unassigned'), so there is exactly
-- one definition of "workable" and the two cannot diverge again.
--
-- That means giving up FOR UPDATE SKIP LOCKED, which cannot lock rows read
-- through a function. Replaced with a compare-and-swap: `update ... where id = ?
-- and assigned_csr is null`, which is a stronger guarantee than the row lock —
-- it is atomic regardless of how the candidate was chosen — with a short retry
-- for the case where another CSR wins the race.
--
-- Verified: crew login now gets 0 rows from all three scopes; staff still see
-- the unworked lead; a lead recalled for today is back and flagged; a booked
-- lead stays hidden; and three consecutive claims hand out the two workable
-- leads and never the booked one.
-- ─────────────────────────────────────────────────────────────────────────────

-- Return type changes (adds is_recall), so this is a drop rather than a replace.
drop function if exists public.lead_queue(text);

create function public.lead_queue(p_scope text default 'mine')
returns table (
  lead_id text, first_name text, last_name text, phone text, phone_e164 text,
  email text, address_line1 text, city text, state text, zip text,
  source_channel text, source_label text, source_campaign text,
  queued_at timestamptz, assigned_csr text, csr_name text,
  attempt_count int, last_attempt_at timestamptz, next_due_at timestamptz,
  recall_date date, is_first_dial boolean, is_recall boolean
) language sql stable security definer set search_path to 'public'
as $$
  with me as (select public.my_team_member() as tm),
  base as (
    select l.*,
           (select max(c.created_date) from public.communication c
             where c.lead_id = l.id and c.direction = 'outbound' and c.deleted_at is null) as last_att,
           public.lead_attempt_count(l.id) as atts
      from public.lead l
     where l.queued_at is not null
       and (
         l.disposition is null
         -- A promised call-back is not a closed lead. It comes back on its date.
         or (l.disposition = 'not_ready'
             and l.recall_date is not null
             and l.recall_date <= (now() at time zone 'America/Phoenix')::date)
       )
       and not exists (select 1 from public.appointment a where a.customer = l.id)
  )
  select b.id, b.first_name, b.last_name, b.phone, b.phone_e164, b.email,
         b.address_line1, b.city, b.state, b.zip,
         b.source_channel, sc.label, b.source_campaign,
         b.queued_at, b.assigned_csr,
         nullif(btrim(coalesce(tm.first_name,'') || ' ' || coalesce(tm.last_name,'')), ''),
         b.atts, b.last_att,
         case
           when b.recall_date is not null then b.recall_date::timestamptz
           when b.atts = 0 then b.queued_at + interval '5 minutes'
           else b.queued_at + (public.lead_cadence_days(b.atts) || ' days')::interval
         end,
         b.recall_date,
         (b.atts = 0),
         (b.disposition = 'not_ready')
    from base b
    cross join me
    left join public.lead_source_channel sc on sc.key = b.source_channel
    left join public.team_member tm on tm.id = b.assigned_csr
   -- OUTSIDE the scope switch on purpose: every branch is gated, and a scope
   -- added later cannot accidentally skip it the way 'unassigned' and 'mine' did.
   where (public.can_view('leads') or public.is_org_admin())
     and (
       case p_scope
         when 'mine'       then b.assigned_csr is not distinct from me.tm and me.tm is not null
         when 'unassigned' then b.assigned_csr is null
         else true
       end
     )
   order by 19 asc nulls last;   -- next_due_at: most overdue first
$$;

create or replace function public.claim_next_lead()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_tm text; v_id text; v_try int := 0;
begin
  if not (public.can_edit('leads') or public.is_org_admin()) then
    raise exception 'Not allowed to work leads';
  end if;
  v_tm := public.my_team_member();
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'your login is not linked to a team member yet');
  end if;

  -- Reads the SAME definition of "workable" the board shows, by asking
  -- lead_queue itself. Previously this had its own copy of the predicate, and
  -- 0104's booked-lead exclusion was added to lead_queue but not here — so
  -- "Take the next lead" could hand a CSR a job that was already booked, which
  -- then never appeared on their board.
  while v_try < 3 loop
    v_try := v_try + 1;

    select q.lead_id into v_id
      from public.lead_queue('unassigned') q
     order by q.next_due_at asc nulls last
     limit 1;

    if v_id is null then
      return jsonb_build_object('ok', false, 'reason', 'nothing waiting in the queue');
    end if;

    -- Compare-and-swap instead of FOR UPDATE SKIP LOCKED: `assigned_csr is null`
    -- in the UPDATE is itself the race guard, and unlike a row lock it survives
    -- reading the candidate through a function.
    update public.lead
       set assigned_csr = v_tm, updated_date = now()
     where id = v_id and assigned_csr is null;

    if found then
      return jsonb_build_object('ok', true, 'lead_id', v_id);
    end if;
    -- Someone else took it between the read and the write. Try the next one.
  end loop;

  return jsonb_build_object('ok', false, 'reason', 'the queue is busy right now, try again');
end $$;

revoke all on function public.lead_queue(text) from public, anon;
grant execute on function public.lead_queue(text) to authenticated, service_role;
