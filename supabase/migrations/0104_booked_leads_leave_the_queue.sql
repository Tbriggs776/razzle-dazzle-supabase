-- ─────────────────────────────────────────────────────────────────────────────
-- 0104 — Fixes a defect in 0102, found by an adversarial review of it.
--
-- 0102's own header states the invariant: "a lead leaves the queue exactly once
-- — BOOKED or DISPOSITIONED". Only the DISPOSITIONED half was implemented.
-- lead_queue() filtered on `disposition is null` and nothing else, nothing set a
-- disposition when a lead was booked, and there is deliberately no 'booked' row
-- in lead_disposition — so a booked lead stayed on the board forever. Worse,
-- with attempt_count still 0 its next_due_at was queued_at + 5 minutes, so it
-- sat at the TOP of the queue in red, permanently, for a job already sold in.
--
-- ── WHY NOT A 'booked' DISPOSITION ──────────────────────────────────────────
-- Tempting, and wrong. OPERATING_MODEL treats booked and dispositioned as two
-- different exits, and `lead_disposition` is specifically the "why we did NOT
-- book" vocabulary — Marketing reads it per campaign to find defects
-- (`below_minimum` clustering in one ad set is a targeting problem, not a CSR
-- problem). Adding a 'booked' key would put the success case into the failure
-- taxonomy and quietly corrupt every one of those numbers.
--
-- ── WHY DERIVED, NOT STAMPED ────────────────────────────────────────────────
-- `appointment.customer` holds the LEAD id — verified on live data: all 37
-- appointments join to a lead and none to a customer. So "has this lead been
-- booked" is a fact already in the database and needs no new column and no
-- stamping step. Deriving it means it is true however the appointment was
-- created (queue, Setting Checklists, a future GHL calendar webhook), true
-- retroactively for the 19 leads already booked, and impossible to forget.
--
-- This is the same reasoning as attempts in 0102: derive from the row that
-- already exists rather than keep a second number that can disagree with it.
--
-- Also returns address_line1/state/zip so that booking can prefill the whole
-- address. It previously passed only name, email, phone and city, which made
-- the CSR retype an address the lead record already held.
--
-- Verified: a queued lead is visible with its full address; after an
-- appointment is created against it, it disappears from the queue and its
-- disposition is still null.
-- ─────────────────────────────────────────────────────────────────────────────

-- Return type changes, so this is a drop rather than a replace.
drop function if exists public.lead_queue(text);

create function public.lead_queue(p_scope text default 'mine')
returns table (
  lead_id text, first_name text, last_name text, phone text, phone_e164 text,
  email text, address_line1 text, city text, state text, zip text,
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
       -- BOOKED is the other exit. `appointment.customer` holds the LEAD id
       -- until the lead becomes a customer (verified: all 37 appointments point
       -- at a lead), so booking is derivable and needs no stamp — it is true
       -- however the appointment was created, and true retroactively.
       and not exists (select 1 from public.appointment a where a.customer = l.id)
  )
  select b.id, b.first_name, b.last_name, b.phone, b.phone_e164, b.email,
         b.address_line1, b.city, b.state, b.zip,
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
   order by 19 asc nulls last;   -- next_due_at: most overdue first
$$;

-- The queue now asks this question once per open lead on every refresh.
create index if not exists appointment_customer_idx on public.appointment (customer);

revoke all on function public.lead_queue(text) from public, anon;
grant execute on function public.lead_queue(text) to authenticated, service_role;
