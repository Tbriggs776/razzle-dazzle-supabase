-- Show the CSR that the lead already called us.
--
-- A lead can have had a 141-second answered inbound call and still read as an
-- uncontacted first dial, because attempt_count counts OUTBOUND touches. That is the
-- right definition -- an inbound call is not outreach -- and changing it would shift
-- every lead's follow-up cadence, which is not a thing to do to fix a display problem.
--
-- So the count keeps its meaning and the queue gains the missing fact. On the lead
-- that prompted this the card now reads: they called us, 2m 21s, score 42, "a private
-- contractor with overstock tile ... seeking to sell it" -- and the CSR skips him in
-- five seconds instead of finding out on the phone.
--
-- Adding columns to a RETURNS TABLE signature needs a drop; the body is otherwise
-- unchanged from the previous version.
drop function if exists public.lead_queue(text);

create function public.lead_queue(p_scope text default 'mine'::text)
returns table(
  lead_id text, first_name text, last_name text, phone text, phone_e164 text, email text,
  address_line1 text, city text, state text, zip text,
  source_channel text, source_label text, source_campaign text,
  queued_at timestamptz, assigned_csr text, csr_name text,
  attempt_count integer, last_attempt_at timestamptz, next_due_at timestamptz,
  recall_date date, is_first_dial boolean, is_recall boolean,
  -- New: what the lead did before we ever dialled.
  inbound_count integer, last_inbound_at timestamptz, last_inbound_seconds integer,
  last_inbound_answered boolean, last_inbound_score integer, last_inbound_summary text
)
language sql
stable security definer
set search_path to 'public'
as $fn$
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
  ),
  -- The most recent inbound CALL per lead, with whatever the provider made of it.
  inb as (
    select distinct on (c.lead_id)
           c.lead_id, c.started_at, c.duration_seconds, c.answered,
           c.lead_score, c.lead_explanation,
           count(*) over (partition by c.lead_id) as n
      from public.communication c
     where c.direction = 'inbound' and c.type = 'Call' and c.deleted_at is null
     order by c.lead_id, c.started_at desc nulls last
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
         (b.disposition = 'not_ready'),
         coalesce(inb.n, 0)::int, inb.started_at, inb.duration_seconds,
         inb.answered, inb.lead_score, inb.lead_explanation
    from base b
    cross join me
    left join public.lead_source_channel sc on sc.key = b.source_channel
    left join public.team_member tm on tm.id = b.assigned_csr
    left join inb on inb.lead_id = b.id
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
$fn$;

comment on function public.lead_queue(text) is
  'The CSR work queue. attempt_count counts OUTBOUND touches only -- an inbound call is not outreach -- so the inbound_* columns carry the fact that the lead already called us, including the provider lead score and summary.';

revoke execute on function public.lead_queue(text) from anon;
grant  execute on function public.lead_queue(text) to authenticated;
