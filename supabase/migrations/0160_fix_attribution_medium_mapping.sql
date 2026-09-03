-- source_medium was recording the plumbing, not the marketing.
--
-- ghlWebhook mapped `attributionSource.medium` into source_medium, but that GHL field
-- is the INTEGRATION that created the contact, not a marketing medium. The 139 leads
-- carrying a value held: zapier 42, facebook 40, survey 37, instagram 12, manual 5,
-- form 2, other 1. Not one of those is a medium.
--
-- utm_medium turned out to be polluted from the other direction: of its 61 values only
-- 22 were real mediums (cpc/social/paid); the other 39 were campaign and ad-set names.
create or replace function public.normalise_medium(p text)
returns text language sql immutable as $fn$
  select case
    when lower(btrim(coalesce(p,''))) in
         ('cpc','ppc','paid','paid_social','paidsocial','social','organic','email',
          'referral','direct','display','video','affiliate','sms','none')
    then lower(btrim(p))
    else null
  end;
$fn$;

comment on function public.normalise_medium(text) is
  'Returns p only if it is a recognised marketing medium, else null. A medium is a closed vocabulary -- "zapier", "survey" and "Floor Daddy Gilbert" are integrations, form types and campaign names that wandered into the wrong column.';

-- ---------------------------------------------------------------------------
-- BACKFILL. Preserve first, then clear. Nothing is destroyed that has no home.
-- ---------------------------------------------------------------------------

-- 1. Preserve the two values that carry a real SOURCE before source_medium is
--    cleared. facebook was already in utm_source for 39 of 40; instagram was in none
--    of 12, and 'ig' matches the convention utm_source already uses.
update public.lead
   set utm_source = 'facebook'
 where lower(source_medium) = 'facebook' and utm_source is null;

update public.lead
   set utm_source = 'ig'
 where lower(source_medium) = 'instagram' and utm_source is null;

-- 2. Clear source_medium wherever it is not actually a medium. After step 1 this
--    loses nothing: zapier/manual/form/other are plumbing, survey is a GHL form type,
--    and facebook/instagram now live in utm_source where they belong.
update public.lead
   set source_medium = null
 where source_medium is not null
   and public.normalise_medium(source_medium) is null;

-- 3. Clear utm_medium ONLY where utm_campaign already holds the identical string --
--    19 rows of pure duplication.
update public.lead
   set utm_medium = null
 where utm_medium is not null
   and public.normalise_medium(utm_medium) is null
   and utm_campaign = utm_medium;

-- 4. THE OTHER 20 ARE DELIBERATELY LEFT ALONE, and this is the judgement worth
--    recording. Their utm_medium holds a Facebook ad-set or audience name that
--    appears in no other column: utm_campaign has the campaign ("Razzle Dazzle TV")
--    while utm_medium has the ad set ("ARIZONA | COLD | Web Form Leads ..."), and
--    utm_content is already occupied on all 20. There is no correct column to move
--    them to, so clearing would delete the ad-set dimension outright -- worse than a
--    mislabelled column. Tidying them needs an ad-set/audience column first, which is
--    a schema decision rather than a cleanup.
--
-- The webhook now keeps the two columns distinct, which is the fix that stops this
-- recurring:
--   source_medium  NORMALISED, trustworthy for reporting, drops anything outside the
--                  vocabulary rather than storing plumbing
--   utm_medium     RAW as received, kept verbatim even when an advertiser has stuffed
--                  an ad-set name into it

-- Result, verified: source_medium 139 -> 0; utm_source facebook 41 / google 19 /
-- ig 15; utm_medium keeps cpc 18, social 3, paid 1 plus the 20 ad-set names.
