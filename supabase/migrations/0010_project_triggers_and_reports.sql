-- P1: internal automations as Postgres triggers + reporting RPCs (credential-free).
-- Replaces base44 event-functions autoUpdateProjectStatus, stampPendingCancellationDate,
-- logProjectStatusChange (now DB triggers) and the reporting functions
-- getAppointmentsByDC / getSalesByDC / getOnHoldCache (now RPCs, no 100-row cap).

-- Who made the change: the request JWT's email; service-role / cron / SQL -> System.
create or replace function public.jwt_email() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
$$;

-- BEFORE trigger: auto-advance status + stamp pending cancellation, in-place.
create or replace function public.trg_project_before() returns trigger language plpgsql as $$
begin
  -- Accepted -> Scheduled once an installation_date is present (autoUpdateProjectStatus).
  if NEW.installation_date is not null and coalesce(NEW.status, 'Accepted') = 'Accepted' then
    if TG_OP = 'INSERT' then
      NEW.status := 'Scheduled';
    elsif NEW.installation_date is distinct from OLD.installation_date then
      NEW.status := 'Scheduled';
    end if;
  end if;

  -- Stamp the moment a project enters "pending cancellation" (stampPendingCancellationDate).
  if NEW.installation_date_status = 'pending cancellation' and NEW.pending_cancellation_date is null then
    NEW.pending_cancellation_date := now();
  end if;

  return NEW;
end $$;

drop trigger if exists project_before on public.project;
create trigger project_before before insert or update on public.project
  for each row execute function public.trg_project_before();

-- AFTER trigger: audit trail to project_log (logProjectStatusChange).
-- SECURITY DEFINER so the log write bypasses project_log RLS regardless of the
-- acting user's edit permissions (the change itself was already authorized).
create or replace function public.trg_project_log() returns trigger language plpgsql
security definer set search_path = public as $$
declare
  v_email text := public.jwt_email();
  v_actor text := coalesce(v_email, 'System');
  v_name  text;
begin
  if v_email is not null then
    select nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '')
      into v_name from public.team_member where email = v_email limit 1;
  end if;
  v_name := coalesce(v_name, v_actor);

  if TG_OP = 'INSERT' then
    insert into public.project_log (project, action, details, user_email, user_name)
    values (NEW.id, 'Project Created', 'Automatically created from appointment/sale conversion', v_actor, v_name);
    return NEW;
  end if;

  if NEW.status is distinct from OLD.status then
    insert into public.project_log (project, action, details, user_email, user_name)
    values (NEW.id, 'Status Changed',
      format('Status changed from "%s" to "%s"', OLD.status, NEW.status), v_actor, v_name);
  end if;
  if NEW.installation_date_status is distinct from OLD.installation_date_status then
    insert into public.project_log (project, action, details, user_email, user_name)
    values (NEW.id, 'Installation Status Changed',
      format('Installation status changed from "%s" to "%s"',
             coalesce(OLD.installation_date_status,'None'), coalesce(NEW.installation_date_status,'None')), v_actor, v_name);
  end if;
  if NEW.installation_date is distinct from OLD.installation_date then
    insert into public.project_log (project, action, details, user_email, user_name)
    values (NEW.id, 'Installation Date Changed',
      format('Installation date changed from "%s" to "%s"',
             coalesce(OLD.installation_date::text,'Not set'), coalesce(NEW.installation_date::text,'Not set')), v_actor, v_name);
  end if;
  return NEW;
end $$;

drop trigger if exists project_log_changes on public.project;
create trigger project_log_changes after insert or update on public.project
  for each row execute function public.trg_project_log();

-- Reporting RPCs. Proper SQL GROUP BY across ALL rows (base44 capped at 100 and
-- counted client-side). Return the same envelope shape the frontend expects.
create or replace function public.get_appointments_by_dc(p_start_date text, p_end_date text)
returns jsonb language sql stable security definer set search_path = public as $$
  with rng as (
    select assigned_dc from public.appointment
    where appointment_date >= p_start_date::date and appointment_date <= p_end_date::date
  ),
  bydc as (
    select r.assigned_dc as id, trim(t.first_name || ' ' || t.last_name) as name, count(*)::int as count
    from rng r join public.team_member t on t.id = r.assigned_dc and t.role = 'Design Consultant'
    group by r.assigned_dc, t.first_name, t.last_name
    order by count(*) desc
  )
  select jsonb_build_object(
    'startDate', p_start_date, 'endDate', p_end_date,
    'totalFiltered', (select count(*) from rng),
    'byDC', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', count)) from bydc), '[]'::jsonb)
  );
$$;

create or replace function public.get_sales_by_dc(p_start_date text, p_end_date text)
returns jsonb language sql stable security definer set search_path = public as $$
  with rng as (
    select assigned_dc from public.appointment
    where appointment_date >= p_start_date::date and appointment_date <= p_end_date::date and status = 'Sold'
  ),
  bydc as (
    select r.assigned_dc as id, trim(t.first_name || ' ' || t.last_name) as name, count(*)::int as count
    from rng r join public.team_member t on t.id = r.assigned_dc and t.role = 'Design Consultant'
    group by r.assigned_dc, t.first_name, t.last_name
    order by count(*) desc
  )
  select jsonb_build_object(
    'startDate', p_start_date, 'endDate', p_end_date,
    'totalSold', (select count(*) from rng),
    'byDC', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', count)) from bydc), '[]'::jsonb)
  );
$$;

-- On-hold RFMS cache read (getOnHoldCache). Returns [] until the RFMS cluster
-- (P8) populates rfms_order_status — but a valid empty envelope, not a stub.
create or replace function public.get_on_hold_cache()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'success', true,
    'results', coalesce((select jsonb_agg(to_jsonb(r) order by r.checked_at desc nulls last)
                         from public.rfms_order_status r), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_appointments_by_dc(text,text) from anon;
revoke execute on function public.get_sales_by_dc(text,text) from anon;
revoke execute on function public.get_on_hold_cache() from anon;
grant execute on function public.get_appointments_by_dc(text,text) to authenticated;
grant execute on function public.get_sales_by_dc(text,text) to authenticated;
grant execute on function public.get_on_hold_cache() to authenticated;

-- One-time backfill: Accepted projects that already have an installation_date -> Scheduled
-- (retires updateProjectStatuses / fixProjectStatuses / backfillProjectStatuses as endpoints).
-- The other two base44 backfills are no-ops on this schema: appointment.internal_notes does
-- not exist (migrateNotesToArray), and appointment_created_date is already populated on every
-- row (backfillAppointmentCreatedDate).
update public.project set status = 'Scheduled'
  where status = 'Accepted' and installation_date is not null;
