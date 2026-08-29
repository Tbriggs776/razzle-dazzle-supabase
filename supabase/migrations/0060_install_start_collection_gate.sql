-- ─────────────────────────────────────────────────────────────────────────────
-- 0060 — GATE 2: the install-start collection backstop.
--
-- Observe-only by owner decision: it records and alerts, it never blocks. The
-- Job Start Checklist has never been submitted once in production, so the
-- company's first hard money stop does not go on an unexercised screen.
--
-- Collection itself belongs to Install Coordination BEFORE install day (0059).
-- This is the net under that process, not the process.
--
-- Three things this must never do:
--   1. Write into project.installation_date_status. That column carries the
--      asbestos halt, and get_public_project exports it to the CUSTOMER'S OWN
--      public tracker — a balance hold there would publish their delinquency.
--   2. Depend on the checklist to clear. A checklist is submitted once and is
--      read-only afterwards; the money can arrive on day 3 of a 5-day install.
--      The releasing event is a PAYMENT, so a payment trigger clears it.
--   3. Leak the ledger. The person submitting this checklist is often a
--      subcontract installer whose role cannot read `payment` at all.
-- ─────────────────────────────────────────────────────────────────────────────

-- One open exception per (code, subject), so re-evaluating is idempotent.
create unique index if not exists workflow_exception_open_uq
  on public.workflow_exception (code, subject_type, subject_id)
  where resolved_at is null;

-- ── install_collection_status ────────────────────────────────────────────────
-- The driveway read. Project-keyed in, project-scoped out: no customer PII, no
-- cost_* columns, no sale id, and no way to enumerate AR across jobs.
create or replace function public.install_collection_status(p_project_id text)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_sale text; v_b public.sale_balance;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not (public.is_org_admin() or public.can_view('journey') or public.can_view('projects')) then
    raise exception 'Not authorized';
  end if;

  select sale into v_sale from public.project where id = p_project_id;
  if v_sale is null then
    -- Manual projects with no sale exist. Never invent a debt for them.
    return jsonb_build_object('gate_applies', false, 'satisfied', true, 'reason', 'no_sale');
  end if;

  select * into v_b from public.sale_balance where sale_id = v_sale;
  if not found then
    return jsonb_build_object('gate_applies', false, 'satisfied', true, 'reason', 'no_balance_row');
  end if;

  if v_b.is_cancelled then
    -- Nothing can be collected against a cancelled sale. Neither pass nor block:
    -- E11 already flags these for a human.
    return jsonb_build_object('gate_applies', false, 'satisfied', true, 'reason', 'sale_cancelled');
  end if;

  return jsonb_build_object(
    'gate_applies',     true,
    'satisfied',        v_b.fully_collected,
    'amount_due',       greatest(0, coalesce(v_b.balance_due, 0)),
    'collected',        coalesce(v_b.amount_paid, 0),
    'collection_terms', v_b.collection_terms,
    'exempt',           v_b.collect_exempt,
    'reason',           case
                          when v_b.collect_exempt then 'exempt'
                          when v_b.collection_terms = 'financed' then 'financed'
                          when v_b.fully_collected then 'collected'
                          else 'outstanding'
                        end);
end $$;

revoke all on function public.install_collection_status(text) from public, anon;
grant execute on function public.install_collection_status(text) to authenticated, service_role;

comment on function public.install_collection_status(text) is
  'Driveway-safe collection state for one project. Deliberately minimal: no customer PII, no cost columns, no sale id, no cross-job enumeration — the caller is often a subcontract installer who cannot read the payment ledger.';

-- ── The release mechanism ────────────────────────────────────────────────────
-- Money arriving is what clears a collection hold, NOT a checklist re-submit
-- (which is impossible: the row is read-only once submitted). Without this, a
-- customer paying at noon on day 1 of a 4-day install leaves the exception open
-- through completion.
create or replace function public.trg_payment_resolves_cod_hold()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  update public.workflow_exception w
     set resolved_at = now(),
         last_seen_at = now(),
         detail = coalesce(w.detail, '') || ' [resolved: payment recorded ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ']'
   where w.code = 'E9_COD_UNCOLLECTED'
     and w.resolved_at is null
     and w.subject_type = 'project'
     and w.subject_id in (select p.id from public.project p where p.sale = new.sale)
     -- Only clear once the sale is genuinely collected in full: a partial
     -- payment must not silently release a stop under zero tolerance.
     and exists (select 1 from public.sale_balance b where b.sale_id = new.sale and b.fully_collected);
  return new;
end $$;

drop trigger if exists payment_resolves_cod_hold on public.payment;
create trigger payment_resolves_cod_hold
  after insert on public.payment
  for each row execute function public.trg_payment_resolves_cod_hold();
