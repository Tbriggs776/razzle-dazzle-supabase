-- The founder's lead-outcome list, as a report subject.
--
-- It already existed as a view and the only way to get it out was Supabase's SQL
-- editor, which caps the rows it returns -- exactly the problem that prompted this
-- whole thing ("the sql i pulled stopped at 100 rows"). Registering it means anyone
-- with leads access opens Custom Reports, picks it, filters it and downloads all
-- 17,529 rows. No SQL, no service key handed out, and RLS still decides the rows.
insert into public.report_subject (key, label, source_relation, module_key, description, sort_order)
values ('lead_outcomes', 'Lead Outcomes', 'founder_lead_buckets', 'leads',
        'Every lead bucketed as Purchased / Sold but cancelled / Appointment, no purchase / No appointment, with GHL do-not-contact status', 5)
on conflict (key) do update set
  label = excluded.label, source_relation = excluded.source_relation,
  module_key = excluded.module_key, description = excluded.description,
  sort_order = excluded.sort_order;

-- Derived from the view, so a registry entry can never name a column that is not there.
insert into public.report_field (subject_key, key, label, data_type, filterable, groupable, aggregatable, sort_order)
select 'lead_outcomes',
       c.column_name,
       initcap(replace(replace(replace(c.column_name,'_',' '),' dnd ',' DND '),' ghl ',' GHL ')),
       case
         when c.data_type in ('numeric','integer','bigint','double precision','real','smallint') then 'number'
         when c.data_type like 'timestamp%' or c.data_type = 'date' then 'date'
         when c.data_type = 'boolean' then 'boolean'
         else 'text'
       end,
       true,
       c.data_type not in ('numeric','double precision','real'),
       c.data_type in ('numeric','integer','bigint','double precision','real','smallint'),
       c.ordinal_position
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'founder_lead_buckets'
   and c.column_name <> 'lead_id'
on conflict (subject_key, key) do update set
  label = excluded.label, data_type = excluded.data_type,
  groupable = excluded.groupable, aggregatable = excluded.aggregatable,
  sort_order = excluded.sort_order;
