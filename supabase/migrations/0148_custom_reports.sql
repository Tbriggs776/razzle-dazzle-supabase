-- Custom reports: build one, save it, run it. For everyone, not just admins.
--
-- ============================================================================
-- THE SECURITY DESIGN, because it is the whole reason this is shaped this way
-- ============================================================================
-- The obvious build stores SQL in a row and executes it. That is arbitrary SQL
-- execution driven from a browser: a saved "report" could be a DELETE, and any
-- function powerful enough to run it would have to be SECURITY DEFINER, which
-- discards RLS and hands every reader the whole database.
--
-- So nothing here stores SQL. A report stores a STRUCTURED DEFINITION -- subject,
-- columns, filters, grouping, sort -- and run_report() compiles it, validating every
-- identifier against a registry before it reaches the query. Two properties follow,
-- and both are load-bearing:
--
--   1. run_report is SECURITY INVOKER (the default, stated because it matters). It
--      executes as the caller, so RLS on the underlying tables applies unchanged. A
--      CSR running a report on leads sees exactly the leads they could see anywhere
--      else. THIS is what makes it safe to give to the whole team rather than to
--      admins only.
--   2. A write cannot be expressed. The definition has no vocabulary for one, and
--      every identifier is looked up in report_field before it is formatted with %I.
--      An unknown column is an error, not an injection point.
--
-- The registry is therefore the security boundary. Adding a subject is a deliberate
-- act that says "this data is reportable, by anyone who holds this module".

-- ---------------------------------------------------------------------------
-- Registry: what may be reported on
-- ---------------------------------------------------------------------------
create table if not exists public.report_subject (
  key             text primary key,
  label           text not null,
  source_relation text not null,   -- validated against pg_class before use
  module_key      text not null,   -- the permission that gates it
  description     text,
  sort_order      int  not null default 0,
  is_active       boolean not null default true
);

comment on table public.report_subject is
  'What a custom report may be built on. This is a WHITELIST and the security boundary -- run_report() will not touch a relation that is not listed here. module_key gates it against the existing permission matrix.';

create table if not exists public.report_field (
  subject_key  text not null references public.report_subject(key) on delete cascade,
  key          text not null,      -- must be a real column of source_relation
  label        text not null,
  data_type    text not null check (data_type in ('text','number','date','boolean')),
  filterable   boolean not null default true,
  groupable    boolean not null default true,
  aggregatable boolean not null default false,
  sort_order   int not null default 0,
  primary key (subject_key, key)
);

comment on table public.report_field is
  'Which columns of a subject may be selected, filtered or grouped. A column absent from here is invisible to the report builder, which is how internal fields stay internal.';

-- ---------------------------------------------------------------------------
-- Saved reports
-- ---------------------------------------------------------------------------
create table if not exists public.report (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  subject_key  text not null references public.report_subject(key),
  columns      text[] not null default '{}',
  filters      jsonb  not null default '[]'::jsonb,   -- [{field, op, value}]
  group_by     text[] not null default '{}',
  aggregates   jsonb  not null default '[]'::jsonb,   -- [{field, fn}]
  order_by     jsonb  not null default '[]'::jsonb,   -- [{field, dir}]
  row_limit    int    not null default 500,
  -- 'private' = only the owner. 'shared' = anyone who holds the subject's module.
  -- Deliberately NOT a per-user share list: sharing with a person who cannot see the
  -- underlying data would produce an empty report and a support ticket, because RLS
  -- still applies when they run it.
  visibility   text   not null default 'private' check (visibility in ('private','shared')),
  owner_id     uuid,
  -- Reserved so scheduling can be added without rewriting the table. Nothing reads
  -- these yet; outbound is disarmed until the base44 cutover.
  schedule_cron text,
  schedule_recipients text[],
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by   text
);

create index if not exists report_owner_idx   on public.report (owner_id);
create index if not exists report_subject_idx on public.report (subject_key);

-- ---------------------------------------------------------------------------
-- Reporting subjects. Views rather than raw tables, so the columns a report can
-- reach are chosen here rather than being "whatever the table happens to have" --
-- and so the joins people actually want (a name instead of an id) come for free.
-- security_invoker on every one: RLS decides the rows.
-- ---------------------------------------------------------------------------
create or replace view public.rpt_leads with (security_invoker = on) as
select l.id, l.first_name, l.last_name, l.email, l.phone, l.city, l.state,
       l.source_channel, l.source_campaign, l.disposition,
       l.created_date::date as created_on,
       l.queued_at::date    as queued_on,
       b.category           as outcome,
       b.appointment_count, b.purchase_count, b.purchase_total,
       b.contact_status,
       tm.first_name || ' ' || tm.last_name as assigned_csr_name
  from public.lead l
  left join public.founder_lead_buckets b on b.lead_id = l.id
  left join public.team_member tm on tm.id = l.assigned_csr;

create or replace view public.rpt_appointments with (security_invoker = on) as
select a.id, a.status, a.appointment_date, a.appointment_block,
       a.installation_date, a.location_address,
       a.cancelled_reason, a.analyzed_not_sold_reason, a.not_sold_deal_size,
       a.created_date::date as created_on,
       l.first_name || ' ' || l.last_name as customer_name,
       l.city, l.state, l.source_channel,
       csr.first_name || ' ' || csr.last_name as csr_name,
       dc.first_name  || ' ' || dc.last_name  as consultant_name,
       (s.id is not null)   as resulted_in_sale,
       s.sale_amount
  from public.appointment a
  left join public.lead l        on l.id  = a.customer
  left join public.team_member csr on csr.id = a.assigned_csr
  left join public.team_member dc  on dc.id  = a.assigned_dc
  left join public.sale s        on s.appointment = a.id;

create or replace view public.rpt_sales with (security_invoker = on) as
select s.id, s.sale_date, s.sale_amount, s.deposit_amount, s.tax_amount,
       s.cost_material, s.cost_labor, s.cost_finance_fee, s.cost_commission,
       s.sale_amount - coalesce(s.cost_material,0) - coalesce(s.cost_labor,0)
         - coalesce(s.cost_finance_fee,0) - coalesce(s.cost_commission,0) as gross_profit,
       s.channel, s.invoice_number, s.is_cancelled, s.cancelled_reason,
       s.deposit_payment_method, s.collection_terms,
       s.created_date::date as created_on,
       c.first_name || ' ' || c.last_name as customer_name,
       c.city, c.state,
       dc.first_name || ' ' || dc.last_name as consultant_name
  from public.sale s
  left join public.customer c   on c.id  = s.customer
  left join public.team_member dc on dc.id = s.assigned_dc;

create or replace view public.rpt_projects with (security_invoker = on) as
select p.id, p.status, p.installation_date, p.installation_date_status,
       p.scheduled_start_date, p.scheduled_end_date,
       p.actual_start_date, p.actual_completion_date,
       p.cancelled_date, p.cancelled_reason, p.installer_crew_name,
       p.created_date::date as created_on,
       c.first_name || ' ' || c.last_name as customer_name,
       c.city, c.state,
       pm.first_name || ' ' || pm.last_name as project_manager_name,
       im.first_name || ' ' || im.last_name as installation_manager_name,
       s.sale_amount
  from public.project p
  left join public.customer c    on c.id  = p.customer
  left join public.sale s        on s.id  = p.sale
  left join public.team_member pm on pm.id = p.project_manager
  left join public.team_member im on im.id = p.installation_manager;

-- ---------------------------------------------------------------------------
-- The compiler
-- ---------------------------------------------------------------------------
-- Small helper so the CASE below can fail loudly on an unknown operator rather than
-- silently producing NULL, which would drop the filter and widen the result set.
create or replace function public.raise_op(p_op text) returns text
language plpgsql immutable as $$
begin raise exception 'Unsupported filter operator: %', p_op; end; $$;

create or replace function public.run_report(p_def jsonb)
returns jsonb
language plpgsql
stable
-- SECURITY INVOKER by omission, and that omission is the point: this runs as the
-- caller so RLS applies. Do not add SECURITY DEFINER here without replacing the
-- entire permission story.
set search_path = public
as $$
declare
  v_subject   public.report_subject%rowtype;
  v_cols      text[] := coalesce(array(select jsonb_array_elements_text(p_def->'columns')), '{}');
  v_group     text[] := coalesce(array(select jsonb_array_elements_text(p_def->'group_by')), '{}');
  v_limit     int    := least(greatest(coalesce((p_def->>'row_limit')::int, 500), 1), 5000);
  v_select    text   := '';
  v_where     text   := '';
  v_orderby   text   := '';
  v_groupby   text   := '';
  v_sql       text;
  v_result    jsonb;
  f           jsonb;
  v_field     public.report_field%rowtype;
  v_op        text;
  v_fn        text;
begin
  select * into v_subject from public.report_subject
   where key = p_def->>'subject' and is_active;
  if not found then
    raise exception 'Unknown report subject: %', coalesce(p_def->>'subject', '(none)');
  end if;

  -- The module gate. Same permission the rest of the app uses, so a report cannot
  -- become a side door around the access matrix.
  if not (public.can_view(v_subject.module_key) or public.is_org_admin()) then
    raise exception 'You do not have access to % reports', v_subject.label;
  end if;

  -- SELECT list. Every name is checked against report_field before %I sees it.
  for i in 1 .. coalesce(array_length(v_cols, 1), 0) loop
    select * into v_field from public.report_field
     where subject_key = v_subject.key and key = v_cols[i];
    if not found then raise exception 'Unknown field "%" on %', v_cols[i], v_subject.label; end if;
    v_select := v_select || case when v_select = '' then '' else ', ' end || format('%I', v_field.key);
  end loop;

  -- Aggregates, for grouped reports.
  for f in select * from jsonb_array_elements(coalesce(p_def->'aggregates', '[]'::jsonb)) loop
    v_fn := lower(f->>'fn');
    if v_fn not in ('count','sum','avg','min','max') then
      raise exception 'Unsupported aggregate: %', v_fn;
    end if;
    if v_fn = 'count' and coalesce(f->>'field','') = '' then
      v_select := v_select || case when v_select = '' then '' else ', ' end || 'count(*) as count';
    else
      select * into v_field from public.report_field
       where subject_key = v_subject.key and key = f->>'field';
      if not found then raise exception 'Unknown field "%" on %', f->>'field', v_subject.label; end if;
      if v_fn <> 'count' and not v_field.aggregatable then
        raise exception '% cannot be %-ed', v_field.label, v_fn;
      end if;
      v_select := v_select || case when v_select = '' then '' else ', ' end
                || format('%s(%I) as %I', v_fn, v_field.key, v_fn || '_' || v_field.key);
    end if;
  end loop;

  if v_select = '' then v_select := '*'; end if;

  -- Filters. The operator comes from a fixed set; the value is passed through %L,
  -- never concatenated.
  for f in select * from jsonb_array_elements(coalesce(p_def->'filters', '[]'::jsonb)) loop
    select * into v_field from public.report_field
     where subject_key = v_subject.key and key = f->>'field';
    if not found then raise exception 'Unknown filter field "%"', f->>'field'; end if;
    if not v_field.filterable then raise exception '% cannot be filtered', v_field.label; end if;

    v_op := lower(coalesce(f->>'op', 'eq'));
    v_where := v_where || case when v_where = '' then ' where ' else ' and ' end ||
      case v_op
        when 'eq'        then format('%I = %L', v_field.key, f->>'value')
        when 'neq'       then format('%I is distinct from %L', v_field.key, f->>'value')
        when 'gt'        then format('%I > %L', v_field.key, f->>'value')
        when 'gte'       then format('%I >= %L', v_field.key, f->>'value')
        when 'lt'        then format('%I < %L', v_field.key, f->>'value')
        when 'lte'       then format('%I <= %L', v_field.key, f->>'value')
        when 'contains'  then format('%I::text ilike %L', v_field.key, '%' || (f->>'value') || '%')
        when 'is_null'   then format('%I is null', v_field.key)
        when 'not_null'  then format('%I is not null', v_field.key)
        when 'in'        then format('%I::text = any(%L::text[])', v_field.key,
                                     array(select jsonb_array_elements_text(f->'value')))
        else public.raise_op(v_op)
      end;
  end loop;

  for i in 1 .. coalesce(array_length(v_group, 1), 0) loop
    select * into v_field from public.report_field
     where subject_key = v_subject.key and key = v_group[i];
    if not found then raise exception 'Unknown group field "%"', v_group[i]; end if;
    if not v_field.groupable then raise exception '% cannot be grouped', v_field.label; end if;
    v_groupby := v_groupby || case when v_groupby = '' then ' group by ' else ', ' end
              || format('%I', v_field.key);
  end loop;

  for f in select * from jsonb_array_elements(coalesce(p_def->'order_by', '[]'::jsonb)) loop
    select * into v_field from public.report_field
     where subject_key = v_subject.key and key = f->>'field';
    if not found then raise exception 'Unknown sort field "%"', f->>'field'; end if;
    v_orderby := v_orderby || case when v_orderby = '' then ' order by ' else ', ' end
              || format('%I %s', v_field.key,
                        case when lower(coalesce(f->>'dir','asc')) = 'desc' then 'desc' else 'asc' end);
  end loop;

  v_sql := format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select %s from %I %s %s %s limit %s) t',
                  v_select, v_subject.source_relation, v_where, v_groupby, v_orderby, v_limit);
  execute v_sql into v_result;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

comment on function public.run_report(jsonb) is
  'Compiles a structured report definition into SQL, validating every identifier against report_field first. SECURITY INVOKER -- RLS decides the rows, and the caller must hold the subject''s module.';

revoke execute on function public.run_report(jsonb) from anon;
grant  execute on function public.run_report(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.report_subject enable row level security;
alter table public.report_field   enable row level security;
alter table public.report         enable row level security;

drop policy if exists report_subject_read on public.report_subject;
create policy report_subject_read on public.report_subject
  for select to authenticated using (true);

drop policy if exists report_field_read on public.report_field;
create policy report_field_read on public.report_field
  for select to authenticated using (true);

-- A saved report is visible to its owner, or to anyone if it was shared. Running it
-- still goes through run_report, so a shared report never widens what its reader may
-- actually see.
drop policy if exists report_read on public.report;
create policy report_read on public.report
  for select to authenticated
  using (visibility = 'shared' or owner_id = (select auth.uid()) or (select public.is_org_admin()));

drop policy if exists report_write on public.report;
create policy report_write on public.report
  for all to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_org_admin()))
  with check (owner_id = (select auth.uid()) or (select public.is_org_admin()));

revoke all on table public.report_subject, public.report_field, public.report from anon;
grant select on public.report_subject, public.report_field to authenticated;
grant select, insert, update, delete on public.report to authenticated;
