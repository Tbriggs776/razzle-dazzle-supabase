-- Three things CallRail needs to work at volume.
--
-- Established on a real lead (BOBBY OCHOA, 2026-08-31): the pipeline is
-- CallRail -> Zapier -> GHL -> Razzle, and attribution dies at the Zapier hop. GHL
-- received a name, a phone, a pool name, and custom fields reading "Third Party||||||"
-- -- a pipe-delimited attribution template with every slot after the first empty.
-- CallRail meanwhile held Google Ads, campaign "CN - PMAX - Flooring General", the
-- gclid, the landing page, a 141-second answered call, a recording, a lead score of
-- 42, and an AI summary explaining he is a contractor trying to SELL tile, not a
-- customer. He sat in the CSR queue as an uncontacted first dial.

-- 1. SOMEWHERE TO PUT THE GOOD PART -----------------------------------------
-- Per-CALL facts, so they live on the communication rather than the lead: a second
-- call can score differently, and flattening onto the lead loses which call the
-- judgement was about.
alter table public.communication
  add column if not exists lead_score       int,
  add column if not exists lead_explanation text,
  add column if not exists landing_page_url text;

comment on column public.communication.lead_score is
  'Provider-assigned lead quality (CallRail 0-100). Per-call, not per-lead.';
comment on column public.communication.lead_explanation is
  'Provider AI summary of why the call scored as it did. On the lead that prompted this it said the caller was a contractor trying to sell tile -- which would have saved a CSR the call.';

-- 2. THE RECONCILER ---------------------------------------------------------
-- THE RACE IS REAL, NOT THEORETICAL. Zapier took four minutes to create Bobby's GHL
-- contact. A CallRail webhook arriving in that window finds no lead, logs the call
-- with lead_id null, and nothing ever links it. At ~1,192 calls a month some fraction
-- always loses that race, and each loss is a call the queue does not know happened --
-- so a CSR rings someone who spoke to us minutes ago.
--
-- Forward-only by design: links calls to leads and fills attribution that is still
-- empty. NEVER overwrites attribution already set -- an earlier source outranks a
-- later guess.
create or replace function public.reconcile_callrail_calls()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_linked int := 0;
  v_attributed int := 0;
begin
  with orphans as (
    select c.id as comm_id, l.id as lead_id
      from public.communication c
      join public.lead l on l.phone_e164 = c.contact_phone
     where c.provider = 'callrail' and c.lead_id is null and c.contact_phone is not null
  ), upd as (
    update public.communication c set lead_id = o.lead_id
      from orphans o where c.id = o.comm_id returning 1
  )
  select count(*) into v_linked from upd;

  with best as (
    select distinct on (c.lead_id)
           c.lead_id, c.source_name, c.campaign_name, c.landing_page_url, c.started_at,
           c.callrail_person_id
      from public.communication c
     where c.provider = 'callrail' and c.lead_id is not null
     order by c.lead_id, c.started_at asc      -- first touch wins attribution
  ), upd2 as (
    update public.lead l
       set source_channel     = case when l.source_channel is null or l.source_channel = 'unattributed'
                                     then 'inbound_call' else l.source_channel end,
           source_campaign    = coalesce(l.source_campaign, b.campaign_name),
           source_medium      = coalesce(l.source_medium, b.source_name),
           callrail_person_id = coalesce(l.callrail_person_id, b.callrail_person_id),
           source_created_at  = coalesce(l.source_created_at, b.started_at)
      from best b
     where l.id = b.lead_id
       and (l.source_channel is null or l.source_channel = 'unattributed'
            or l.source_campaign is null or l.callrail_person_id is null)
     returning 1
  )
  select count(*) into v_attributed from upd2;

  return jsonb_build_object('calls_linked', v_linked, 'leads_attributed', v_attributed);
end;
$fn$;

comment on function public.reconcile_callrail_calls() is
  'Back-links CallRail calls that arrived before their lead existed (the Zapier race), and fills attribution the Zapier hop dropped. Never overwrites attribution already set.';

revoke execute on function public.reconcile_callrail_calls() from anon;
grant  execute on function public.reconcile_callrail_calls() to authenticated;

-- 3. SCHEDULE ---------------------------------------------------------------
-- Every 5 minutes, because the race window we measured was 4. On a quiet cycle it is
-- two indexed anti-joins that find nothing.
select cron.unschedule('callrail-reconcile')
 where exists (select 1 from cron.job where jobname = 'callrail-reconcile');

select cron.schedule('callrail-reconcile', '*/5 * * * *',
  $cron$select public.reconcile_callrail_calls();$cron$);
