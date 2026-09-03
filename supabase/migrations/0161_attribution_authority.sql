-- Attribution by SOURCE AUTHORITY, not by first touch and not by recency.
--
-- Owner's model: GHL is the initial source of truth, and as each integration comes
-- online and finds the same lead, that system's attribution overrides and backfills
-- what GHL supplied.
--
-- WHY RANK AND NOT RECENCY, because this is the part that would quietly destroy data.
-- "Whoever found them last wins" means a low-fidelity source arriving late clobbers a
-- high-fidelity one -- a nightly GHL re-sync would overwrite CallRail's gclid with
-- "zapier" and nobody would see it happen. Authority is a property of the SYSTEM, not
-- of the clock.
--
-- The ranking reflects distance from the acquisition event. CallRail was there when
-- the phone rang and holds the ad, the keyword, the gclid and the landing page. GHL
-- learns about it second-hand through Zapier, which is exactly how 139 leads ended up
-- with "zapier" recorded as their marketing medium. A human beats everything, because
-- someone who corrects a record by hand knows something no API does.
create table if not exists public.attribution_authority (
  provider text primary key,
  rank     int  not null,
  label    text not null,
  notes    text
);

insert into public.attribution_authority (provider, rank, label, notes) values
  ('human',    100, 'Entered by a person',  'Nothing overrides a human correction.'),
  ('callrail',  80, 'CallRail',             'Present at the acquisition event: ad, keyword, gclid, landing page.'),
  ('google_ads',60, 'Google Ads',           'Reserved. The ad platform itself, once connected.'),
  ('meta',      60, 'Meta Ads',             'Reserved.'),
  ('ghl',       40, 'GoHighLevel',          'Initial source of truth, but receives attribution second-hand via Zapier.'),
  ('rfms',      30, 'RFMS',                 'Authoritative for orders, not for acquisition. Ranked low on purpose.'),
  ('import',    20, 'base44 import',        'Historical. Lowest confidence.'),
  ('unknown',    0, 'Unknown',              'Never blocks anything.')
on conflict (provider) do update set
  rank = excluded.rank, label = excluded.label, notes = excluded.notes;

comment on table public.attribution_authority is
  'Which system may overwrite another''s lead attribution. Ranked by distance from the acquisition event, NOT by recency -- "last writer wins" lets a nightly re-sync clobber better data silently.';

-- Provenance. Without it the next writer cannot tell whether it is allowed to write.
alter table public.lead
  add column if not exists attribution_provider text references public.attribution_authority(provider),
  add column if not exists attribution_rank     int  not null default 0,
  add column if not exists attribution_set_at   timestamptz;

comment on column public.lead.attribution_provider is
  'Which system supplied the attribution currently on this row. A write from a lower-ranked provider is refused -- see apply_attribution().';

create index if not exists lead_attribution_provider_idx on public.lead (attribution_provider);

-- ---------------------------------------------------------------------------
-- The ONE way attribution gets written.
-- ---------------------------------------------------------------------------
create or replace function public.apply_attribution(
  p_lead_id  text,
  p_provider text,
  p_attr     jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rank    int;
  v_current int;
begin
  select rank into v_rank from public.attribution_authority where provider = p_provider;
  if v_rank is null then
    raise exception 'Unknown attribution provider "%" -- add it to attribution_authority first', p_provider;
  end if;

  select coalesce(attribution_rank, 0) into v_current from public.lead where id = p_lead_id;
  if not found then raise exception 'No such lead %', p_lead_id; end if;

  -- Equal rank may refresh: the same system correcting itself is fine. Lower rank is
  -- refused outright rather than partially applied, because a half-overwritten
  -- attribution row is harder to reason about than an untouched one.
  if v_rank < v_current then
    return jsonb_build_object('applied', false, 'reason', 'outranked',
                              'incoming', p_provider, 'incoming_rank', v_rank,
                              'current_rank', v_current);
  end if;

  update public.lead l set
    -- Only overwrite with a value that is actually present. A higher-ranked source
    -- that does not know the campaign must not blank the campaign already held.
    source_channel  = coalesce(nullif(p_attr->>'source_channel',''),
                               nullif(l.source_channel,'unattributed'), l.source_channel),
    source_campaign = coalesce(nullif(p_attr->>'source_campaign',''), l.source_campaign),
    source_medium   = coalesce(public.normalise_medium(p_attr->>'source_medium'), l.source_medium),
    utm_source      = coalesce(nullif(p_attr->>'utm_source',''),   l.utm_source),
    utm_medium      = coalesce(nullif(p_attr->>'utm_medium',''),   l.utm_medium),
    utm_campaign    = coalesce(nullif(p_attr->>'utm_campaign',''), l.utm_campaign),
    utm_content     = coalesce(nullif(p_attr->>'utm_content',''),  l.utm_content),
    utm_term        = coalesce(nullif(p_attr->>'utm_term',''),     l.utm_term),
    gclid           = coalesce(nullif(p_attr->>'gclid',''),        l.gclid),
    attribution_provider = p_provider,
    attribution_rank     = v_rank,
    attribution_set_at   = now()
  where l.id = p_lead_id;

  return jsonb_build_object('applied', true, 'provider', p_provider, 'rank', v_rank,
                            'previous_rank', v_current);
end;
$fn$;

comment on function public.apply_attribution(text, text, jsonb) is
  'The one way lead attribution is written. Refuses a write from a provider ranked below whatever set the row last, so a low-fidelity re-sync cannot clobber a high-fidelity source. Only fills fields the incoming payload actually carries.';

revoke execute on function public.apply_attribution(text, text, jsonb) from anon;
grant  execute on function public.apply_attribution(text, text, jsonb) to authenticated;

-- Baseline provenance on the existing book, lowest authority applied first so higher
-- ones overwrite as they should. Result: callrail 1, ghl 17,364, import 188.
update public.lead set attribution_provider='import', attribution_rank=20, attribution_set_at=now()
 where attribution_provider is null and ghl_contact_id is null;
update public.lead set attribution_provider='ghl', attribution_rank=40, attribution_set_at=now()
 where ghl_contact_id is not null;
update public.lead l set attribution_provider='callrail', attribution_rank=80, attribution_set_at=now()
 where exists (select 1 from public.communication c where c.lead_id = l.id and c.provider='callrail');

-- ---------------------------------------------------------------------------
-- Route the CallRail reconciler through it, so precedence lives in one place.
-- ---------------------------------------------------------------------------
-- It previously did its own coalesce -- fill only what is empty, never overwrite.
-- Right instinct with no ranking to appeal to, but it meant CallRail could never
-- correct GHL's second-hand guess: source_medium said "zapier" and the reconciler
-- politely left it, because something was already there.
create or replace function public.reconcile_callrail_calls()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_linked int := 0;
  v_attributed int := 0;
  r record;
  v_res jsonb;
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

  for r in
    select distinct on (c.lead_id)
           c.lead_id, c.source_name, c.campaign_name, c.callrail_person_id, c.started_at
      from public.communication c
     where c.provider = 'callrail' and c.lead_id is not null
     order by c.lead_id, c.started_at asc
  loop
    v_res := public.apply_attribution(r.lead_id, 'callrail', jsonb_build_object(
      'source_channel',  'inbound_call',
      'source_campaign', r.campaign_name,
      'utm_source',      lower(nullif(r.source_name,''))
    ));
    if (v_res->>'applied')::boolean then v_attributed := v_attributed + 1; end if;

    -- Identity and first-touch timing are facts rather than attribution, so they are
    -- filled regardless of rank -- but still only where empty.
    update public.lead
       set callrail_person_id = coalesce(callrail_person_id, r.callrail_person_id),
           source_created_at  = coalesce(source_created_at, r.started_at)
     where id = r.lead_id;
  end loop;

  return jsonb_build_object('calls_linked', v_linked, 'leads_attributed', v_attributed);
end;
$fn$;

comment on function public.reconcile_callrail_calls() is
  'Back-links CallRail calls that arrived before their lead existed, then hands each lead''s first CallRail touch to apply_attribution() so the authority ranking decides whether it overwrites. Identity fields are filled where empty regardless of rank.';
