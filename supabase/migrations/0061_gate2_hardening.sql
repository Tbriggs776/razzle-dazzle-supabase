-- ─────────────────────────────────────────────────────────────────────────────
-- 0061 — Gate 2 hardening. Eight defects found by an adversarial pass over the
-- code shipped in 0060, each verified against this database.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. I created a duplicate index. 0053 already had uq_workflow_exception with a
--    character-for-character equivalent definition.
drop index if exists public.workflow_exception_open_uq;

-- 2. workflow_exception.detail carried exact dollar figures — the outstanding
--    balance AND the contract total — into a table whose only policy was
--    `using (true)`, i.e. readable by every authenticated user including roles
--    RLS otherwise denies the payment ledger to.
--
--    Two fixes, because either alone is insufficient: stop writing money into
--    the string (in the Edge Function), and scope who can read the table at all.
drop policy if exists workflow_exception_read on public.workflow_exception;
create policy workflow_exception_read on public.workflow_exception
  for select to authenticated
  using (
    public.is_org_admin()
    or public.can_view('projects')
    or public.can_view('journey')
    or public.can_view('finance')
    or public.can_view('order_processing')
  );

-- Nobody could close an exception: the table had a SELECT policy and nothing
-- else, no UI, and no reconciler. A stuck 'crit' row was unclearable by anyone.
create or replace function public.resolve_workflow_exception(p_id text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_actor text;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not (public.is_org_admin() or public.can_edit('cod_exception')) then
    raise exception 'Not authorized to resolve a workflow exception';
  end if;
  v_actor := coalesce(public.jwt_email(), 'system');
  update public.workflow_exception
     set resolved_at = now(),
         last_seen_at = now(),
         detail = coalesce(detail, '') || ' [resolved by ' || v_actor
                  || coalesce(': ' || p_note, '') || ']'
   where id = p_id and resolved_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not found or already resolved'); end if;
  return jsonb_build_object('ok', true, 'resolved_by', v_actor);
end $$;

revoke all on function public.resolve_workflow_exception(text, text) from public, anon;
grant execute on function public.resolve_workflow_exception(text, text) to authenticated, service_role;

-- 3. An UNPRICED sale made the gate fire permanently and uncollectably.
--    sale_balance forces fully_collected=false when sale_amount <= 0, while
--    balance_due goes NEGATIVE once any deposit exists. The crew saw
--    "Collect $0.00 before starting" (amount_due clamped at 0) while the
--    coordinator alert quoted negative dollars, and because no payment could
--    ever make an unpriced sale fully_collected, the crit row could never clear.
--
--    An unpriced sale is a Sales data problem, not a collection problem —
--    flow.js already raises a 'sale_unpriced' crit owned by Sales for exactly
--    this. The gate must stand down and say why.
--
-- 4. `collected` is removed from the payload: the crew needs what is DUE, not
--    the customer's payment history. Less disclosure through a SECURITY DEFINER
--    function that authorises on can_view('journey'|'projects') without checking
--    the caller is attached to this project.
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
    return jsonb_build_object('gate_applies', false, 'satisfied', true, 'reason', 'no_sale');
  end if;

  select * into v_b from public.sale_balance where sale_id = v_sale;
  if not found then
    return jsonb_build_object('gate_applies', false, 'satisfied', true, 'reason', 'no_balance_row');
  end if;
  if v_b.is_cancelled then
    return jsonb_build_object('gate_applies', false, 'satisfied', true, 'reason', 'sale_cancelled');
  end if;
  -- The fix: stand down on an unpriced sale rather than demanding $0.00 forever.
  if coalesce(v_b.gross_amount, 0) <= 0 then
    return jsonb_build_object('gate_applies', false, 'satisfied', true, 'reason', 'unpriced');
  end if;

  return jsonb_build_object(
    'gate_applies',     true,
    'satisfied',        v_b.fully_collected,
    'amount_due',       greatest(0, coalesce(v_b.balance_due, 0)),
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

-- 5. A payment INSERT was the only thing that could clear a hold. Correcting a
--    mistyped payment (UPDATE), deleting a duplicate (DELETE), or repricing the
--    sale so nothing is owed (UPDATE on sale) all left a crit row open forever.
create or replace function public.resolve_cod_hold(p_sale text)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if p_sale is null then return; end if;
  update public.workflow_exception w
     set resolved_at = now(), last_seen_at = now(),
         detail = coalesce(w.detail, '') || ' [resolved: balance collected in full]'
   where w.code = 'E9_COD_UNCOLLECTED'
     and w.resolved_at is null
     and w.subject_type = 'project'
     and w.subject_id in (select p.id from public.project p where p.sale = p_sale)
     -- Zero tolerance: only a sale collected IN FULL releases the hold.
     and exists (select 1 from public.sale_balance b where b.sale_id = p_sale and b.fully_collected);
end $$;

create or replace function public.trg_payment_resolves_cod_hold()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  perform public.resolve_cod_hold(coalesce(new.sale, old.sale));
  return coalesce(new, old);
end $$;

drop trigger if exists payment_resolves_cod_hold on public.payment;
create trigger payment_resolves_cod_hold
  after insert or update or delete on public.payment
  for each row execute function public.trg_payment_resolves_cod_hold();

-- Repricing a sale downward can satisfy it without any payment moving.
create or replace function public.trg_sale_resolves_cod_hold()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  perform public.resolve_cod_hold(new.id);
  return new;
end $$;

drop trigger if exists sale_resolves_cod_hold on public.sale;
create trigger sale_resolves_cod_hold
  after update of sale_amount, is_cancelled, collect_exempt_reason, collection_terms on public.sale
  for each row execute function public.trg_sale_resolves_cod_hold();
