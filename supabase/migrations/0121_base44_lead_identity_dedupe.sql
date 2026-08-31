-- ─────────────────────────────────────────────────────────────────────────────
-- 0121 — Lead identity, enforced against real data. Supersedes 0120's importer.
--
-- The first live import stopped on `lead_phone_e164_uniq`, and that is the
-- system working as designed. base44 has no identity rule for leads; this app
-- has one — ONE LEAD PER PHONE NUMBER — and the migration is where the two
-- meet. Measured on the real export: 2,220 base44 leads collapse to 2,094
-- distinct phone numbers. 90 phones carry duplicates, 124 rows are surplus,
-- and the largest group is 29 rows on one number (staff testing: "Kevin Test",
-- "Jonathan Tessmar TEST 0120"). 85 appointments and 30 sales point at a row
-- that is about to be superseded.
--
-- DROPPING those references would silently orphan 115 real appointments and
-- sales, so this does the honest thing instead: the EARLIEST-created row for a
-- phone wins (that is when we actually met this customer — the number
-- speed-to-lead is measured from), every loser is recorded in
-- base44_id_merge, and child references are REWRITTEN to the winner. Nothing
-- is lost except the duplicate row itself.
--
-- Two knobs are added to the importer, both reusable on cutover day because
-- base44 will keep minting duplicates until it is switched off:
--   p_dedupe_expr — an expression whose value must be unique; losers are
--                   merged, not deleted-and-forgotten.
--   p_remap       — {"column":"table"}: rewrite this column through the merge
--                   map before the foreign key ever sees it.
-- Remap runs BEFORE the dangling-reference pass, so a reference that merely
-- pointed at a duplicate is repaired rather than nulled.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.base44_id_merge (
  table_name text not null,
  old_id     text not null,
  new_id     text not null,
  merged_at  timestamptz not null default now(),
  primary key (table_name, old_id)
);

comment on table public.base44_id_merge is
  'base44 rows collapsed into a canonical row during import (duplicate leads by phone). Kept permanently: it is the only record of why an old base44 id no longer resolves, and the cutover re-run reuses it.';

alter table public.base44_id_merge enable row level security;
create policy base44_id_merge_read on public.base44_id_merge
  for select using (public.is_org_admin());
revoke all on public.base44_id_merge from anon;
grant select on public.base44_id_merge to authenticated;

create or replace function public.import_base44(
  p_key text, p_entity text, p_table text,
  p_since timestamptz default null, p_dry_run boolean default true,
  p_null_fks jsonb default '{}'::jsonb, p_drop_orphan jsonb default '{}'::jsonb,
  p_page int default 1000, p_max_pages int default 200,
  p_dedupe_expr text default null, p_remap jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path to 'public, extensions, pg_temp'
as $$
declare
  v_base text := 'https://customer-hub-5e0f0fdd.base44.app/api/entities/';
  v_url text; v_resp extensions.http_response; v_raw jsonb; v_batch jsonb;
  v_nontext text[]; v_upd text; v_collist text;
  v_skip int := 0; v_pages int := 0; v_fetched int := 0; v_staged int := 0;
  v_written int := 0; v_merged int := 0; v_n int; v_last timestamptz;
  v_nulled jsonb := '{}'::jsonb; v_dropped jsonb := '{}'::jsonb;
  v_defaulted jsonb := '{}'::jsonb; v_remapped jsonb := '{}'::jsonb; r record;
begin
  if to_regclass('public.' || p_table) is null then
    raise exception 'No such table public.%', p_table;
  end if;

  select coalesce(array_agg(column_name), '{}') into v_nontext
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table
     and data_type not in ('text', 'character varying', 'jsonb', 'json');

  -- Writable columns only: a GENERATED column (lead.phone_e164) rejects any
  -- value, including the null jsonb_populate_record would hand it.
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into v_collist
    from information_schema.columns
   where table_schema='public' and table_name=p_table
     and is_generated <> 'ALWAYS' and coalesce(is_identity,'NO') <> 'YES';

  execute 'drop table if exists pg_temp._stage';
  execute format('create temp table _stage (like public.%I)', p_table);

  -- Staging must accept whatever base44 has: jsonb_populate_record writes an
  -- EXPLICIT null for every omitted column, and an explicit null does not fire
  -- a column default. NOT NULL comes off here; real defaults go on below.
  for r in select column_name from information_schema.columns
            where table_schema='public' and table_name=p_table and is_nullable='NO'
  loop
    execute format('alter table _stage alter column %I drop not null', r.column_name);
  end loop;

  loop
    v_pages := v_pages + 1;
    exit when v_pages > p_max_pages;
    v_url := v_base || p_entity || '?limit=' || p_page || '&skip=' || v_skip
             || '&sort_by=' || case when p_since is null then 'created_date' else '-updated_date' end;
    select * into v_resp from extensions.http((
      'GET', v_url, array[extensions.http_header('api_key', p_key)], null, null
    )::extensions.http_request);
    if v_resp.status <> 200 then
      raise exception 'base44 % returned HTTP %: %', p_entity, v_resp.status, left(v_resp.content, 200);
    end if;
    v_raw := v_resp.content::jsonb;
    if jsonb_typeof(v_raw) <> 'array' then
      raise exception 'base44 % did not return an array: %', p_entity, left(v_resp.content, 200);
    end if;
    v_n := jsonb_array_length(v_raw);
    v_fetched := v_fetched + v_n;
    v_batch := v_raw;
    if p_since is not null then
      select coalesce(jsonb_agg(e), '[]'::jsonb) into v_batch
        from jsonb_array_elements(v_raw) e
       where coalesce((e->>'updated_date')::timestamptz, (e->>'created_date')::timestamptz) > p_since;
    end if;
    if jsonb_array_length(v_batch) > 0 then
      execute format(
        'insert into _stage select (jsonb_populate_record(null::public.%I, clean)).*
           from (select (select coalesce(jsonb_object_agg(k, val), ''{}''::jsonb)
                           from jsonb_each(e) kv(k, val)
                          where not (val = ''""''::jsonb and k = any($2))) as clean
                   from jsonb_array_elements($1) e) s', p_table)
        using v_batch, v_nontext;
    end if;
    exit when v_n < p_page;
    if p_since is not null then
      select coalesce((v_raw->-1->>'updated_date')::timestamptz,
                      (v_raw->-1->>'created_date')::timestamptz) into v_last;
      exit when v_last is not null and v_last <= p_since;
    end if;
    v_skip := v_skip + p_page;
  end loop;

  for r in select column_name, column_default from information_schema.columns
            where table_schema='public' and table_name=p_table
              and is_nullable='NO' and column_default is not null
              and is_generated <> 'ALWAYS'
  loop
    execute format('update _stage set %I = %s where %I is null',
                   r.column_name, r.column_default, r.column_name);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_defaulted := v_defaulted || jsonb_build_object(r.column_name, v_n); end if;
  end loop;

  -- Identity collapse: earliest row wins, losers recorded, then removed.
  if p_dedupe_expr is not null then
    execute format(
      'with ranked as (
         select id, (%s) as k, created_date,
                row_number() over (partition by (%s)
                                   order by created_date asc nulls last, id) as rn
           from _stage where (%s) is not null)
       insert into public.base44_id_merge (table_name, old_id, new_id)
       select %L, l.id, w.id
         from ranked l join ranked w on w.k = l.k and w.rn = 1
        where l.rn > 1
       on conflict (table_name, old_id) do update set new_id = excluded.new_id',
      p_dedupe_expr, p_dedupe_expr, p_dedupe_expr, p_table);
    get diagnostics v_merged = row_count;
    execute format(
      'delete from _stage where id in
         (select old_id from public.base44_id_merge where table_name = %L)', p_table);
  end if;

  -- Repair references to merged rows BEFORE the dangling-reference pass, so a
  -- pointer at a duplicate is rewritten rather than thrown away.
  for r in select key as col, value as ref from jsonb_each_text(p_remap) loop
    execute format(
      'update _stage s set %I = m.new_id from public.base44_id_merge m
        where m.table_name = %L and m.old_id = s.%I', r.col, r.ref, r.col);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_remapped := v_remapped || jsonb_build_object(r.col, v_n); end if;
  end loop;

  for r in select key as col, value as ref from jsonb_each_text(p_null_fks) loop
    execute format('update _stage s set %I = null where s.%I is not null
                     and not exists (select 1 from public.%I t where t.id = s.%I)',
                   r.col, r.col, r.ref, r.col);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_nulled := v_nulled || jsonb_build_object(r.col, v_n); end if;
  end loop;

  for r in select key as col, value as ref from jsonb_each_text(p_drop_orphan) loop
    execute format('delete from _stage s where s.%I is not null
                     and not exists (select 1 from public.%I t where t.id = s.%I)',
                   r.col, r.ref, r.col);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_dropped := v_dropped || jsonb_build_object(r.col, v_n); end if;
  end loop;

  execute 'select count(*) from _stage' into v_staged;

  if not p_dry_run then
    select string_agg(format('%I = excluded.%I', column_name, column_name), ', ') into v_upd
      from information_schema.columns
     where table_schema = 'public' and table_name = p_table and column_name <> 'id'
       and is_generated <> 'ALWAYS' and coalesce(is_identity,'NO') <> 'YES';
    -- Business triggers off, FK enforcement on (see 0120's header for what each
    -- silenced trigger would otherwise do to imported history).
    execute format('alter table public.%I disable trigger user', p_table);
    begin
      execute format('insert into public.%I (%s) select %s from _stage on conflict (id) do update set %s',
                     p_table, v_collist, v_collist, v_upd);
      get diagnostics v_written = row_count;
    exception when others then
      execute format('alter table public.%I enable trigger user', p_table);
      raise;
    end;
    execute format('alter table public.%I enable trigger user', p_table);
  end if;

  execute 'drop table if exists pg_temp._stage';

  return jsonb_build_object('entity', p_entity, 'table', p_table, 'pages', v_pages,
    'fetched', v_fetched, 'staged', v_staged, 'written', v_written,
    'merged_duplicates', v_merged, 'defaults_applied', v_defaulted,
    'remapped', v_remapped, 'nulled_fks', v_nulled,
    'dropped_orphans', v_dropped, 'dry_run', p_dry_run, 'since', p_since);
end $$;

revoke all on function public.import_base44(text,text,text,timestamptz,boolean,jsonb,jsonb,int,int,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.import_base44(text,text,text,timestamptz,boolean,jsonb,jsonb,int,int,text,jsonb)
  to service_role;

drop function if exists public.import_base44(text,text,text,timestamptz,boolean,jsonb,jsonb,int,int);
