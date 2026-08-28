-- Security & safety hardening — Phase 0 of the ERP readiness plan.
--
-- These are the defects that cause IRREVERSIBLE damage the moment the system
-- holds real money, real customer data and real users. They are fixed before
-- credentials are set and before staff are provisioned, because doing them
-- afterwards is doing them after the incident.
--
--   1. cancel_sale hard-deleted the sale, its projects, and the record of a
--      deposit the company is physically holding.
--   2. Three SECURITY DEFINER functions were executable by anon — including one
--      that writes installer TIN and bank details.
--   3. rfms_session (live API session tokens) was readable by any user with
--      order-processing view rights.
--   4. installer_application (TIN, bank last-4, W-9/COI uploads) was readable
--      and writable by ANY authenticated user regardless of role.
--   5. sms_settings had no quiet hours and no master off switch, with 13 live
--      crons that begin firing the instant a Twilio credential is entered.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. cancel_sale: soft-cancel instead of hard delete.
--
-- The sale, its projects and the deposit history are preserved and flagged, so
-- the event is reversible and auditable. Reporting already filters on
-- sale.is_cancelled / project.status = 'Cancelled' in eight places, and
-- CancelledProjects.jsx already cancels this way — this makes the two
-- cancellation paths agree instead of producing opposite data.
--
-- Signature gains an optional reason; the existing single-argument callers in
-- SaleDetail.jsx keep working unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_sale(p_sale_id text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_appt     text;
  v_found    boolean;
  v_projects integer := 0;
  v_actor    text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;
  if not (public.is_org_admin() or public.can_edit('sales') or public.can_edit('order_processing')) then
    raise exception 'Not authorized to cancel this sale';
  end if;

  select appointment, true into v_appt, v_found from public.sale where id = p_sale_id;
  if not coalesce(v_found, false) then
    return jsonb_build_object('success', true, 'already_gone', true);
  end if;

  v_actor := public.jwt_email();

  -- Projects: keep the row and remember what stage it was at, so a cancel can
  -- be reasoned about (and undone) later.
  update public.project
     set pre_cancelled_status = coalesce(pre_cancelled_status, status),
         status               = 'Cancelled',
         cancelled_date       = now(),
         cancelled_by         = coalesce(v_actor, cancelled_by),
         cancelled_reason     = coalesce(p_reason, cancelled_reason),
         updated_date         = now()
   where sale = p_sale_id
     and coalesce(status, '') <> 'Cancelled';
  get diagnostics v_projects = row_count;

  -- Sale: flagged, never deleted. deposit_amount and deposit_payment_method
  -- survive, because the company is still holding that money.
  update public.sale
     set is_cancelled     = true,
         cancelled_date   = now(),
         cancelled_reason = coalesce(p_reason, cancelled_reason),
         updated_date     = now()
   where id = p_sale_id;

  -- The appointment itself still happened; it is no longer 'Sold'.
  if v_appt is not null then
    update public.appointment
       set status = 'Completed', updated_date = now()
     where id = v_appt;
  end if;

  return jsonb_build_object(
    'success', true,
    'appointment', v_appt,
    'projects_cancelled', v_projects,
    'soft_cancelled', true
  );
end;
$function$;

-- Keep the grant surface identical to the rest of the app's staff RPCs.
revoke all on function public.cancel_sale(text) from public, anon;
revoke all on function public.cancel_sale(text, text) from public, anon;
grant execute on function public.cancel_sale(text)       to authenticated, service_role;
grant execute on function public.cancel_sale(text, text)  to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lock down SECURITY DEFINER functions that were anon-executable.
--
-- Postgres grants EXECUTE to PUBLIC by default, so a REVOKE that names only
-- anon/authenticated leaves PUBLIC intact — which is why the earlier hardening
-- pass did not actually take. Revoke from PUBLIC explicitly.
--
-- _apply_installer_payload is an internal helper called only from other
-- SECURITY DEFINER functions; nested calls execute as the function owner, so
-- the public apply flow is unaffected.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  fn text;
begin
  foreach fn in array array[
    '_apply_installer_payload',
    'reset_roc_staging',
    'swap_roc_licensee'
  ] loop
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      fn,
      (select pg_get_function_identity_arguments(p.oid)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = fn
        limit 1)
    );
    execute format(
      'grant execute on function public.%I(%s) to service_role',
      fn,
      (select pg_get_function_identity_arguments(p.oid)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = fn
        limit 1)
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. rfms_session holds live RFMS API session tokens.
--
-- Only the edge functions touch it, and they use the service role (which
-- bypasses RLS). No frontend code reads it — the entity is mapped in the shim
-- but never queried. Remove every authenticated policy so an ordinary
-- order-processing user cannot read a live credential and call RFMS directly.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists mod_select on public.rfms_session;
drop policy if exists mod_insert on public.rfms_session;
drop policy if exists mod_update on public.rfms_session;
drop policy if exists mod_delete on public.rfms_session;
alter table public.rfms_session enable row level security;
revoke all on table public.rfms_session from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. installer_application carries TIN, bank last-4 and W-9/COI uploads.
--
-- It was ALL/true to every authenticated user. Gate it to the module the page
-- already lives under ('team', per app_page.InstallerApplications). The public
-- apply flow is unaffected: create/save/get/submit_installer_application are
-- SECURITY DEFINER and bypass RLS, gated by their own token check.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists installer_application_staff_all on public.installer_application;

create policy installer_application_view on public.installer_application
  for select to authenticated
  using (public.is_org_admin() or public.can_view('team'));

create policy installer_application_write on public.installer_application
  for all to authenticated
  using (public.is_org_admin() or public.can_edit('team'))
  with check (public.is_org_admin() or public.can_edit('team'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SMS safety rails.
--
-- There are 13 live crons that begin sending the moment a Twilio credential is
-- entered. Give the owner an arm/disarm switch and quiet hours BEFORE that
-- happens. Defaults are deliberately conservative: outbound disarmed, quiet
-- hours on and set to Arizona-friendly waking hours.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.sms_settings
  add column if not exists sms_outbound_enabled  boolean not null default false,
  add column if not exists quiet_hours_enabled   boolean not null default true,
  add column if not exists quiet_hours_start     text    not null default '20:00',
  add column if not exists quiet_hours_end       text    not null default '08:00',
  add column if not exists quiet_hours_timezone  text    not null default 'America/Phoenix';

comment on column public.sms_settings.sms_outbound_enabled is
  'Master arm/disarm for ALL outbound SMS. Defaults to false so connecting Twilio does not immediately release 13 crons worth of messages.';
comment on column public.sms_settings.quiet_hours_enabled is
  'When on, customer-facing SMS outside quiet_hours_start..end is held rather than sent. Staff/internal alerts are exempt.';
