-- ─────────────────────────────────────────────────────────────────────────────
-- 0120 — The base44 importer: the tool that finally moves the real business.
--
-- CONTEXT. The Razzle app went live on 2026-08-31 running the 15 demo sales the
-- port was built against. The ACTUAL business is still base44 (667 sales, 738
-- projects, 2220 leads, a sale taken the day before). This migration builds the
-- pipe that carries base44 → here, twice: once now for testing on real data,
-- and again on cutover day (incrementally, via p_since) to close the gap.
--
-- WHY THE FETCH RUNS INSIDE POSTGRES. The alternative — pull locally, then push
-- 63,000 rows back up as SQL literals — drags every customer's PII through a
-- third system for no benefit. `http` is enabled here, locked to service_role,
-- and dropped again the moment the load finishes (see the run log in the PR).
--
-- WHAT MAKES IT SAFE, in the order the hazards were found:
--
--   1. TRIGGERS ARE SILENCED PER TABLE (`disable trigger user`, which keeps FK
--      constraint triggers live). Left on, they would have: queued ~650 RFMS
--      fetch jobs (trg_sale_rfms_fetch), written 738 fake "Project Created"
--      entries over the real ProjectLog history we are importing (trg_project_log),
--      rewritten imported statuses and stamped TODAY onto historical
--      pending-cancellation dates — which is the clock the claim ladder
--      escalates against (trg_project_before) — and overwritten every
--      source `updated_date` with now() (set_updated_date), destroying the
--      watermark the cutover re-run depends on.
--
--   2. BASE44 HAS REAL ORPHANS and our schema has real foreign keys. Measured,
--      not assumed: 214 appointments and 84 sales point at deleted team
--      members; 2 appointments at deleted leads; 6 projects at deleted sales;
--      48 project_logs, 5 design_mods and 2 checkpoints at deleted projects.
--      p_null_fks nulls a dangling reference (the row is still real);
--      p_drop_orphan discards the row (a log entry whose project no longer
--      exists is not worth keeping). Both are COUNTED and returned, so a
--      silent data loss is impossible to miss.
--
--   3. EMPTY STRINGS ARE NOT DATES. base44 writes "" where a value is absent;
--      '' into a date/numeric/boolean column throws. Stripped for non-text
--      columns only, so a genuinely empty text field stays empty.
--
--   4. NOTHING CAN REACH A CUSTOMER. Verified before the first load: Resend and
--      Twilio are is_enabled=false with zero credentials, and
--      sms_settings.sms_outbound_enabled is false. The email flags in
--      sms_settings ARE all true, so this stays true only while the
--      integrations stay uncredentialed — arming Resend before cutover would
--      let the 15-minute reminder cron and the 9am follow-up crons mail real
--      customers about appointments base44 is also still mailing them about.
--      The imported *_email_sent_at stamps protect anything base44 already
--      sent; they do not protect an appointment booked after this import.
--
-- The importer is deliberately generic — jsonb_populate_record against the live
-- table shape — because a hand-written column list for 37 entities is a list of
-- 37 chances to typo a column into silence. A field diff run before this
-- migration found exactly ONE base44 field with no home on our side, and the
-- three columns it needed are added below.
-- ─────────────────────────────────────────────────────────────────────────────

-- SUPERSEDED IN PART: the import_base44() defined below was replaced twice
-- during the first live run, by 0121 (lead identity) and finally by 0122
-- (multi-key identity + junk cleanup). Each replacement was forced by a real
-- constraint the data hit; the sequence is left intact because it is the
-- record of what base44 actually contains. 0122 holds the current function.

-- ── 1. The one genuine schema gap (base44 ProjectCheckpoint) ────────────────
alter table public.project_checkpoint
  add column if not exists completed_by_name  text,
  add column if not exists completed_by_email text,
  add column if not exists completed_date     timestamptz;

comment on column public.project_checkpoint.completed_date is
  'base44 recorded completion separately from approval. Imported as-is rather than folded into approved_date, which means something different.';

-- ── 2. Outbound HTTP, service_role only ────────────────────────────────────
create extension if not exists http with schema extensions;

do $lock$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'extensions' and p.proname like 'http%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $lock$;

-- ── 3. The importer ────────────────────────────────────────────────────────
create or replace function public.import_base44(
  p_key         text,                          -- base44 api_key, passed per call, never stored
  p_entity      text,                          -- base44 entity name  e.g. 'Sale'
  p_table       text,                          -- our table           e.g. 'sale'
  p_since       timestamptz default null,      -- incremental: only rows touched after this
  p_dry_run     boolean     default true,      -- stage + report, write nothing
  p_null_fks    jsonb       default '{}'::jsonb,   -- {"column":"ref_table"} → null a dangling ref
  p_drop_orphan jsonb       default '{}'::jsonb,   -- {"column":"ref_table"} → discard the row
  p_page        int         default 1000,
  p_max_pages   int         default 200
) returns jsonb
language plpgsql security definer set search_path to 'public, extensions, pg_temp'
as $$
declare
  v_base    text := 'https://customer-hub-5e0f0fdd.base44.app/api/entities/';
  v_url     text;
  v_resp    extensions.http_response;
  v_raw     jsonb;
  v_batch   jsonb;
  v_nontext text[];
  v_upd     text;
  v_skip    int := 0;
  v_pages   int := 0;
  v_fetched int := 0;
  v_staged  int := 0;
  v_written int := 0;
  v_n       int;
  v_last    timestamptz;
  v_nulled  jsonb := '{}'::jsonb;
  v_dropped jsonb := '{}'::jsonb;
  r         record;
begin
  if to_regclass('public.' || p_table) is null then
    raise exception 'No such table public.%', p_table;
  end if;

  -- Columns where '' is not a legal value.
  select coalesce(array_agg(column_name), '{}')
    into v_nontext
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table
     and data_type not in ('text', 'character varying', 'jsonb', 'json');

  -- Staging carries the target's shape but none of its constraints, so orphans
  -- can be measured and repaired BEFORE they hit a foreign key.
  execute 'drop table if exists pg_temp._stage';
  -- INCLUDING DEFAULTS matters: LIKE copies NOT NULL but not the default that
  -- satisfies it, so a column like lead.source_channel ('unknown' by default)
  -- would reject every base44 row that omits it.
  execute format('create temp table _stage (like public.%I including defaults)', p_table);

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
       where coalesce((e->>'updated_date')::timestamptz,
                      (e->>'created_date')::timestamptz) > p_since;
    end if;

    if jsonb_array_length(v_batch) > 0 then
      execute format(
        'insert into _stage
         select (jsonb_populate_record(null::public.%I, clean)).*
           from (select (select coalesce(jsonb_object_agg(k, val), ''{}''::jsonb)
                           from jsonb_each(e) kv(k, val)
                          where not (val = ''""''::jsonb and k = any($2))) as clean
                   from jsonb_array_elements($1) e) s', p_table)
        using v_batch, v_nontext;
    end if;

    exit when v_n < p_page;

    -- Incremental runs walk newest-first and stop at the watermark.
    if p_since is not null then
      select coalesce((v_raw->-1->>'updated_date')::timestamptz,
                      (v_raw->-1->>'created_date')::timestamptz) into v_last;
      exit when v_last is not null and v_last <= p_since;
    end if;

    v_skip := v_skip + p_page;
  end loop;

  -- Dangling references: null the pointer, keep the row.
  for r in select key as col, value as ref from jsonb_each_text(p_null_fks) loop
    execute format(
      'update _stage s set %I = null
        where s.%I is not null
          and not exists (select 1 from public.%I t where t.id = s.%I)',
      r.col, r.col, r.ref, r.col);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_nulled := v_nulled || jsonb_build_object(r.col, v_n); end if;
  end loop;

  -- Orphaned children: discard. A log line whose subject was deleted is noise.
  for r in select key as col, value as ref from jsonb_each_text(p_drop_orphan) loop
    execute format(
      'delete from _stage s
        where s.%I is not null
          and not exists (select 1 from public.%I t where t.id = s.%I)',
      r.col, r.ref, r.col);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_dropped := v_dropped || jsonb_build_object(r.col, v_n); end if;
  end loop;

  execute 'select count(*) from _stage' into v_staged;

  if not p_dry_run then
    select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
      into v_upd
      from information_schema.columns
     where table_schema = 'public' and table_name = p_table and column_name <> 'id';

    -- Business triggers off, FK enforcement on. See the header for what each
    -- silenced trigger would otherwise have done to this data.
    execute format('alter table public.%I disable trigger user', p_table);
    begin
      execute format(
        'insert into public.%I select * from _stage on conflict (id) do update set %s',
        p_table, v_upd);
      get diagnostics v_written = row_count;
    exception when others then
      execute format('alter table public.%I enable trigger user', p_table);
      raise;
    end;
    execute format('alter table public.%I enable trigger user', p_table);
  end if;

  execute 'drop table if exists pg_temp._stage';

  return jsonb_build_object(
    'entity', p_entity, 'table', p_table, 'pages', v_pages,
    'fetched', v_fetched, 'staged', v_staged, 'written', v_written,
    'nulled_fks', v_nulled, 'dropped_orphans', v_dropped,
    'dry_run', p_dry_run, 'since', p_since);
end $$;

revoke all on function public.import_base44(text, text, text, timestamptz, boolean, jsonb, jsonb, int, int)
  from public, anon, authenticated;
grant execute on function public.import_base44(text, text, text, timestamptz, boolean, jsonb, jsonb, int, int)
  to service_role;

comment on function public.import_base44(text, text, text, timestamptz, boolean, jsonb, jsonb, int, int) is
  'base44 → Razzle importer. Idempotent upsert by id. Call with p_dry_run first; p_since makes the cutover re-run incremental. The api_key is a parameter and is never persisted.';
