-- Search and count leads on the server, so screens stop downloading all 17,459.
--
-- The Leads page already had a search box; it filtered rows the browser had
-- already fetched. That works until the table grows, and it did -- eight-fold in
-- one afternoon. The two appointment pickers had no search at all: they rendered
-- every lead as a <Select> option and expected you to scroll.
--
-- Two functions, because the page needs two different things and conflating
-- them is what forced the full download in the first place: a PAGE of matching
-- rows, and TOTALS over the whole book. Ask for one page and the KPI tiles are
-- wrong; ask for everything to keep the KPIs right and you are back where you
-- started.
--
-- Both are SECURITY INVOKER (the default, stated here because it matters): RLS
-- on `lead` applies to whoever calls them. A SECURITY DEFINER search function
-- would hand every caller the entire lead book regardless of their permissions.

-- Matching the index expression EXACTLY is what makes the search fast; Postgres
-- will only use an expression index when the query repeats the expression
-- character for character. If the concatenation below changes, change it in
-- search_leads() too or the index quietly stops being used.
create index if not exists lead_search_trgm_idx on public.lead using gin (
  (
    coalesce(first_name, '') || ' ' ||
    coalesce(last_name, '')  || ' ' ||
    coalesce(email, '')      || ' ' ||
    coalesce(phone, '')
  ) gin_trgm_ops
);

comment on index public.lead_search_trgm_idx is
  'Trigram index serving search_leads(). Its expression must stay identical to the one in that function -- an expression index is only used when the query repeats it exactly.';

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

comment on function public.search_leads(text, int, int, text) is
  'One page of leads matching a free-text term across name, email and phone, plus the total match count on every row. SECURITY INVOKER, so RLS decides what the caller may see. Empty or null term returns the whole book, paged.';

revoke execute on function public.search_leads(text, int, int, text) from anon;
grant execute on function public.search_leads(text, int, int, text) to authenticated;

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

comment on function public.lead_stats() is
  'Totals over the whole lead book, so a paged list does not force the page to download everything just to render its KPI tiles. SECURITY INVOKER -- the counts respect RLS.';

revoke execute on function public.lead_stats() from anon;
grant execute on function public.lead_stats() to authenticated;
