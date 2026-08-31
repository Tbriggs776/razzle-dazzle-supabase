-- Re-apply 0140's two functions verbatim from the checked-in file.
--
-- The copy applied first had slightly different comment wording, so md5(prosrc)
-- and the repo disagreed. Functionally identical, but a file that says one thing
-- while production runs another is how this project has been caught out before,
-- and the hash check is only worth having if it is allowed to fail.
--
-- Bodies identical to 0140 -- see that file for what the functions do and why
-- the index expression has to be repeated character for character.
create or replace function public.search_leads(
  p_query  text default null,
  p_limit  int  default 50,
  p_offset int  default 0,
  p_sort   text default 'desc'
)
returns table (
  id           text,
  first_name   text,
  last_name    text,
  email        text,
  phone        text,
  city         text,
  state        text,
  tags         jsonb,
  created_date timestamptz,
  total_count  bigint
)
language sql stable set search_path = public as $$
  with q as (
    select nullif(btrim(coalesce(p_query, '')), '') as term
  ),
  matched as (
    select l.*
      from public.lead l, q
     where q.term is null
        or (
          coalesce(l.first_name, '') || ' ' ||
          coalesce(l.last_name, '')  || ' ' ||
          coalesce(l.email, '')      || ' ' ||
          coalesce(l.phone, '')
        ) ilike '%' || q.term || '%'
        -- Digits-only fallback: someone searching "6026998747" or
        -- "(602) 699-8747" should find a lead stored in the other format. The
        -- trigram index cannot serve this, so it is guarded to inputs that
        -- actually look like a phone number.
        or (
          q.term ~ '^[0-9()+.\- ]{7,}$'
          and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g')
              like '%' || regexp_replace(q.term, '\D', '', 'g') || '%'
        )
  )
  select m.id, m.first_name, m.last_name, m.email, m.phone, m.city, m.state,
         m.tags, m.created_date,
         -- Same total on every row. One query answers both "which page" and
         -- "how many altogether", so the caller does not need a second round
         -- trip just to render "1-50 of 17,459".
         count(*) over () as total_count
    from matched m
   order by
     case when lower(coalesce(p_sort,'desc')) = 'asc'  then m.created_date end asc  nulls last,
     case when lower(coalesce(p_sort,'desc')) <> 'asc' then m.created_date end desc nulls last,
     m.id
   limit  greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.lead_stats()
returns table (
  total          bigint,
  new_this_week  bigint,
  new_this_month bigint,
  spark          bigint[]
)
language sql stable set search_path = public as $$
  select
    (select count(*) from public.lead),
    (select count(*) from public.lead where created_date > now() - interval '7 days'),
    (select count(*) from public.lead where created_date > now() - interval '30 days'),
    -- Leads per week for the last eight weeks, oldest first.
    --
    -- The page previously built this in the browser by slicing the sorted list
    -- into eight equal-sized chunks and plotting each chunk's LENGTH -- which is
    -- the chunk size by construction, so it drew a flat line from 17,000 rows
    -- and called it a trend. Bucketing by time shows what it always claimed to.
    (select coalesce(array_agg(c order by wk), array[]::bigint[])
       from (
         select date_trunc('week', d)::date as wk,
                (select count(*) from public.lead l
                  where l.created_date >= d and l.created_date < d + interval '7 days') as c
           from generate_series(
                  date_trunc('week', now()) - interval '7 weeks',
                  date_trunc('week', now()),
                  interval '1 week'
                ) d
       ) weeks);
$$;

