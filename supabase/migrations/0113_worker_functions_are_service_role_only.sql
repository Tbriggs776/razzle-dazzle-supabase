-- ─────────────────────────────────────────────────────────────────────────────
-- 0113 — Background-worker plumbing was callable by every signed-in user,
-- including a subcontractor crew login that holds no role at all.
--
-- Found by a targeted sweep rather than by reading migrations: every SECURITY
-- DEFINER function that is VOLATILE, writes, is granted to `authenticated`, and
-- contains no authorization check of any kind. That query is worth keeping —
--
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.prokind='f' and p.prosecdef
--      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
--      and p.provolatile = 'v' and p.prosrc ~* '(insert|update|delete)\s'
--      and p.prosrc !~* '(is_org_admin|can_edit|can_view|auth\.uid|jwt_email|my_installer)';
--
-- — because it finds this class by construction instead of by noticing.
--
-- ── WHAT COULD BE DONE WITH THEM ────────────────────────────────────────────
--   check_worker_health(0)     every heartbeat is "older than 0 minutes", so it
--                              writes a crit, ack-required alert for every
--                              worker. An alert channel anyone can flood is an
--                              alert channel nobody reads.
--   reap_stuck_jobs(0)         re-queues in-flight jobs immediately, so a job
--                              that is running gets run again — duplicate sends
--                              once Twilio and Resend have keys.
--   reclaim_unsent_reminders() same shape against the reminder backlog.
--   record_heartbeat(...)      forge a heartbeat for a worker that is down, and
--                              the health check stops reporting it.
--   open_claim_rung / reconcile_claim_tasks
--                              drive the claim escalation ladder from outside.
--   resolve_cod_hold(text)     already revoked from anon in 0107; there is no
--                              reason for a UI session to hold it either.
--
-- None of the seven is called from src/ or from any edge function — checked.
-- Three run under pg_cron, which executes as the owner and is unaffected by a
-- grant to `authenticated`. reconcile_claim_tasks is called by reconcile_tasks,
-- itself SECURITY DEFINER, so that call runs with the owner's rights. The three
-- COD triggers (payment, sale, project_checkpoint) are all SECURITY DEFINER
-- too, which is what makes revoking resolve_cod_hold safe.
--
-- ── VERIFIED, INCLUDING THE PART THAT COULD HAVE BROKEN MONEY ───────────────
-- authenticated denied on all seven; service_role retains all seven; the owner
-- can still run the workers. And the whole money path still completes as a
-- staff user: record_payment -> confirm_sale_deposit -> sale_balance
-- fully_collected -> the trigger chain calls resolve_cod_hold and the COD hold
-- is released. That last check is the point — the revoke would have been
-- invisible until someone took a payment.
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function public.record_heartbeat(text, jsonb)      from public, anon, authenticated;
revoke execute on function public.check_worker_health(integer)       from public, anon, authenticated;
revoke execute on function public.reap_stuck_jobs(integer)           from public, anon, authenticated;
revoke execute on function public.reclaim_unsent_reminders()         from public, anon, authenticated;
revoke execute on function public.reconcile_claim_tasks()            from public, anon, authenticated;
revoke execute on function public.open_claim_rung(text, text, timestamptz, boolean)
                                                                     from public, anon, authenticated;
revoke execute on function public.resolve_cod_hold(text)             from authenticated;

grant execute on function public.record_heartbeat(text, jsonb)  to service_role;
grant execute on function public.check_worker_health(integer)   to service_role;
grant execute on function public.reap_stuck_jobs(integer)       to service_role;
grant execute on function public.reclaim_unsent_reminders()     to service_role;
grant execute on function public.reconcile_claim_tasks()        to service_role;
grant execute on function public.open_claim_rung(text, text, timestamptz, boolean) to service_role;
grant execute on function public.resolve_cod_hold(text)         to service_role;
