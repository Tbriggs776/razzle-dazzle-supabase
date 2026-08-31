-- ─────────────────────────────────────────────────────────────────────────────
-- 0122 — The importer, final form. Multi-key identity + junk cleanup.
--
-- 0120 built the pipe and 0121 taught it that a lead is identified by phone.
-- The first run then hit `lead_email_uniq` too: identity in this system is
-- FOUR rules — unique phone_e164, unique lower(email), unique ghl_contact_id,
-- unique callrail_person_id — and base44 enforces none of them.
--
-- THE HAZARD THAT SHAPED THIS FILE. Naively deduping on email would have
-- merged two unrelated customers because a CSR typed "na" in the email box.
-- Eleven base44 leads carry a non-email in the email field: 'na' twice,
-- 'sdvsgg', 'niknhknhknnhiono', '(602) 323-4658', a two-addresses-in-one-box
-- entry, and "doesn't do emails, doesn't have a family/so that has an email".
-- Fusing those people's appointment histories together would be a far worse
-- outcome than a duplicate row. So junk is nulled BEFORE any identity rule
-- runs — p_pre_sql — and only then do the dedupe passes execute, in order.
--
-- After cleanup the real numbers are: 124 surplus rows by phone, 78 by email.
-- Each loser is recorded in base44_id_merge and every child reference is
-- rewritten to the survivor, so no appointment or sale is orphaned.
--
-- p_pre_sql is import-authored SQL run against the staging table only. It is
-- service_role-only, like the rest of this function, and exists because data
-- this dirty cannot be cleaned by a declarative parameter.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.import_base44(text,text,text,timestamptz,boolean,jsonb,jsonb,int,int,text,jsonb);

create or replace function public.import_base44(
  p_key text, p_entity text, p_table text,
  p_since timestamptz default null, p_dry_run boolean default true,
  p_null_fks jsonb default '{}'::jsonb, p_drop_orphan jsonb default '{}'::jsonb,
  p_page int default 1000, p_max_pages int default 200,
  p_dedupe_exprs text[] default '{}', p_remap jsonb default '{}'::jsonb,
  p_pre_sql text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path to 'public, extensions, pg_temp'
as $$
declare
  v_base text := 'https://customer-hub-5e0f0fdd.base44.app/api/entities/';
  v_url text; v_resp extensions.http_response; v_raw jsonb; v_batch jsonb;
  v_nontext text[]; v_upd text; v_collist text; v_expr text; v_stmt text;
  v_skip int := 0; v_pages int := 0; v_fetched int := 0; v_staged int := 0;
  v_written int := 0; v_merged int := 0; v_n int; v_last timestamptz;
  v_nulled jsonb := '{}'::jsonb; v_dropped jsonb := '{}'::jsonb;
  v_defaulted jsonb := '{}'::jsonb; v_remapped jsonb := '{}'::jsonb;
  v_cleaned jsonb := '{}'::jsonb; r record;
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

  -- Staging accepts whatever base44 has: jsonb_populate_record writes an
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

  -- Junk first. An identity rule applied to garbage merges strangers.
  foreach v_stmt in array p_pre_sql loop
    execute v_stmt;
    get diagnostics v_n = row_count;
    v_cleaned := v_cleaned || jsonb_build_object(left(v_stmt, 60), v_n);
  end loop;

  -- Identity collapse, one pass per rule. Earliest row wins: that is when we
  -- actually met this customer, and it is the clock speed-to-lead measures.
  foreach v_expr in array p_dedupe_exprs loop
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
      v_expr, v_expr, v_expr, p_table);
    get diagnostics v_n = row_count;
    v_merged := v_merged + v_n;
    execute format(
      'delete from _stage where id in
         (select old_id from public.base44_id_merge where table_name = %L)', p_table);
  end loop;

  -- Repair references to merged rows BEFORE the dangling pass, so a pointer at
  -- a duplicate is rewritten rather than thrown away.
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
    -- Business triggers off, FK enforcement on (0120's header lists what each
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
    'merged_duplicates', v_merged, 'cleaned', v_cleaned,
    'defaults_applied', v_defaulted, 'remapped', v_remapped,
    'nulled_fks', v_nulled, 'dropped_orphans', v_dropped,
    'dry_run', p_dry_run, 'since', p_since);
end $$;

revoke all on function public.import_base44(text,text,text,timestamptz,boolean,jsonb,jsonb,int,int,text[],jsonb,text[])
  from public, anon, authenticated;
grant execute on function public.import_base44(text,text,text,timestamptz,boolean,jsonb,jsonb,int,int,text[],jsonb,text[])
  to service_role;
