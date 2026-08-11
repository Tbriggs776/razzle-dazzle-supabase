-- AT4: atomic manual project creation. Projects.handleCreateProject did Customer.create ->
-- Project.create -> ProjectLog.create with no transaction, so a Project failure orphaned the
-- just-created Customer. This SECURITY DEFINER RPC does customer + project + log in one txn. (The
-- 0010 project-insert trigger still writes its own change-log row too — unchanged parity.)
create or replace function public.create_manual_project(
  p_customer jsonb,
  p_project jsonb,
  p_log jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.customer;
  pr public.project;
  lg public.project_log;
  v_customer_id text;
  v_project_id text;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not (public.is_org_admin() or public.can_edit('projects')) then
    raise exception 'Not authorized to create a project';
  end if;

  c := jsonb_populate_record(null::public.customer, p_customer);
  insert into public.customer (first_name, last_name, email, phone, address_line1)
    values (c.first_name, c.last_name, c.email, c.phone, c.address_line1)
    returning id into v_customer_id;

  pr := jsonb_populate_record(null::public.project, p_project);
  insert into public.project (customer, status, installation_date, notes)
    values (v_customer_id, coalesce(pr.status, 'Scheduled'), pr.installation_date, pr.notes)
    returning id into v_project_id;

  if p_log is not null then
    lg := jsonb_populate_record(null::public.project_log, p_log);
    insert into public.project_log (project, action, details, user_email, user_name)
      values (v_project_id, lg.action, lg.details, lg.user_email, lg.user_name);
  end if;

  return jsonb_build_object('project_id', v_project_id, 'customer_id', v_customer_id);
end;
$$;

revoke all on function public.create_manual_project(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_manual_project(jsonb, jsonb, jsonb) to authenticated;
