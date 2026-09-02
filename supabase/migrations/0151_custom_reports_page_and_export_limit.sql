-- Register the page, and raise the row ceiling so "export" means the whole thing.
--
-- WITHOUT THE app_page ROW THE NAV ITEM IS INVISIBLE TO EVERYONE. my_access() builds
-- each module's page list from app_page, and getFilteredNavigation drops a sub-item
-- whose page the user cannot open. A page that exists in the router but not here is a
-- page nobody can reach -- and it fails silently, which is the worst way for it to
-- fail: the code is deployed, the route works if you type it, and no one ever finds it.
insert into public.app_page (key, module_key, label, route_path, is_public)
values ('CustomReports', 'reports', 'Custom Reports', '/CustomReports', false)
on conflict (key) do update set
  module_key = excluded.module_key, label = excluded.label,
  route_path = excluded.route_path, is_public = excluded.is_public;

-- run_report's row cap goes 5,000 -> 50,000.
--
-- 5,000 was fine for looking at a report and useless for the thing people need next:
-- getting the result out as a CSV. The lead book alone is 17,525 rows, so a cap below
-- that turns "export" into "export part of it" -- someone builds a list, downloads it,
-- and never learns it was truncated. The statement timeout is what actually protects
-- the database; the row cap only ever protected the browser, and a file download does
-- not have that problem.
--
-- Body is otherwise byte-identical to 0148. See that migration for the security
-- design; the only change here is the clamp on v_limit.

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
  v_limit     int    := least(greatest(coalesce((p_def->>'row_limit')::int, 500), 1), 50000);
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

