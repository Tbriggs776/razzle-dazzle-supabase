-- AT3: atomic sale cancellation. The UI reverted appointment.status='Completed' THEN deleted the
-- sale in two un-transactioned steps — a failed delete left the appointment reverted with the sale
-- still present, and (no FKs) deleting a sale a project references left project.sale dangling. This
-- SECURITY DEFINER RPC does the whole undo in ONE transaction: delete the project(s) created from
-- the sale, delete the sale, and revert the linked appointment to 'Completed'. Idempotent-ish:
-- returns success even if the sale is already gone.
create or replace function public.cancel_sale(p_sale_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt text;
  v_found boolean;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  -- Cancelling a sale is destructive — restrict to sales/order-processing editors or org-admin
  -- (SECURITY DEFINER bypasses RLS, so this guard is the access control).
  if not (public.is_org_admin() or public.can_edit('sales') or public.can_edit('order_processing')) then
    raise exception 'Not authorized to cancel this sale';
  end if;

  select appointment, true into v_appt, v_found from public.sale where id = p_sale_id;
  if not coalesce(v_found, false) then
    return jsonb_build_object('success', true, 'already_gone', true);
  end if;

  delete from public.project where sale = p_sale_id;
  delete from public.sale where id = p_sale_id;
  if v_appt is not null then
    update public.appointment set status = 'Completed', updated_date = now() where id = v_appt;
  end if;

  return jsonb_build_object('success', true, 'appointment', v_appt);
end;
$$;

revoke all on function public.cancel_sale(text) from public, anon;
grant execute on function public.cancel_sale(text) to authenticated;
