-- Security hardening (advisor: anon/authenticated SECURITY DEFINER executable + mutable
-- search_path). Postgres grants EXECUTE to PUBLIC by default, so every helper was callable by
-- anon — including queue internals (enqueue_job/claim_jobs), suppression (add/remove_suppression,
-- a compliance-tampering vector), and find_contact_by_phone (a phone->identity oracle). Revoke
-- PUBLIC and grant back only the role each function actually needs. Uses a signature-safe
-- regprocedure loop so overloads resolve automatically; idempotent.
do $$
declare r record;
begin
  -- Internal / service-only: called by edge functions (service_role) or crons (owner). No client access.
  for r in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'enqueue_job','claim_jobs','complete_job','fail_job','tick_jobs','post_internal_fn',
      'add_suppression','remove_suppression','is_suppressed','apply_delivery_status',
      'backfill_followup_tasks','find_contact_by_phone'])
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;

  -- Trigger functions are invoked by the trigger (as the SECURITY DEFINER owner), never via a
  -- direct EXECUTE — revoke PUBLIC entirely.
  for r in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array['trg_project_log','trg_sale_rfms_fetch','trg_project_before'])
  loop execute format('revoke execute on function %s from public', r.sig); end loop;

  -- Admin + reporting RPCs: the browser calls these as an authenticated user; they self-gate on
  -- is_org_admin() / jwt scoping. Drop anon; keep authenticated (+ service_role for server use).
  for r in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'admin_clear_secret','admin_enqueue_job','admin_get_esign_types','admin_get_integrations',
      'admin_set_esign_type','admin_set_integration','admin_set_secret',
      'get_appointments_by_dc','get_sales_by_dc','get_on_hold_cache'])
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;

  -- Pin the mutable search_path flagged by the advisor.
  for r in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array['normalize_contact','jwt_email','trg_project_before'])
  loop execute format('alter function %s set search_path = public', r.sig); end loop;
end $$;

-- get_public_appointment stays anon-executable (the intentional public projection). The auth
-- helpers is_org_admin / my_access / current_user_module_permission stay PUBLIC (they compute the
-- caller's own access — anon gets false/empty — and are referenced by RLS policies).
