-- Seed the report registry.
--
-- Fields are DERIVED from the views rather than hand-listed. A hand-written registry
-- drifts the moment a view changes, and a registry entry for a column that no longer
-- exists is a saved report that fails at run time for whoever saved it -- long after
-- the person who changed the view has moved on.
insert into public.report_subject (key, label, source_relation, module_key, description, sort_order) values
  ('leads',        'Leads',        'rpt_leads',        'leads',        'Every lead, with its outcome and contactability', 10),
  ('appointments', 'Appointments', 'rpt_appointments', 'appointments', 'Appointments with the consultant, the CSR who booked it, and whether it sold', 20),
  ('sales',        'Sales',        'rpt_sales',        'sales',        'Sales with costs and gross profit', 30),
  ('projects',     'Projects',     'rpt_projects',     'projects',     'Installs with schedule dates and the people on them', 40)
on conflict (key) do update set
  label = excluded.label, source_relation = excluded.source_relation,
  module_key = excluded.module_key, description = excluded.description;

insert into public.report_field (subject_key, key, label, data_type, filterable, groupable, aggregatable, sort_order)
select s.key,
       c.column_name,
       initcap(replace(replace(c.column_name, '_', ' '), ' id', ' ID')),
       case
         when c.data_type in ('numeric','integer','bigint','double precision','real','smallint') then 'number'
         when c.data_type like 'timestamp%' or c.data_type = 'date' then 'date'
         when c.data_type = 'boolean' then 'boolean'
         else 'text'
       end,
       true,
       -- Grouping by a money column is almost never what someone means, and offering
       -- it produces a thousand one-row groups.
       c.data_type not in ('numeric','double precision','real'),
       c.data_type in ('numeric','integer','bigint','double precision','real','smallint'),
       c.ordinal_position
  from public.report_subject s
  join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = s.source_relation
 where c.column_name <> 'id'
on conflict (subject_key, key) do update set
  label = excluded.label, data_type = excluded.data_type,
  groupable = excluded.groupable, aggregatable = excluded.aggregatable,
  sort_order = excluded.sort_order;
