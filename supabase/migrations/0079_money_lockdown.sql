-- ─────────────────────────────────────────────────────────────────────────────
-- 0079 — Money lockdown. Audit item A1, plus a privilege sweep found while doing it.
--
-- THE HOLE, which is mine from 0056: `WHEN collect_exempt_reason IS NOT NULL THEN
-- true` is the FIRST arm of both deposit_satisfied and fully_collected in
-- sale_balance, and `collect_exempt_reason` was UPDATE-grantable to every logged-in
-- user. One PATCH with any string at all cleared both money gates. Worse, the
-- sale_resolves_cod_hold trigger fires ON that column, so setting it actively
-- RELEASES the ordering hold — and trg_sale_financial_log did not log the column,
-- so the release left no trace.
--
-- Confirmed against live grants before writing: collect_exempt_reason,
-- collection_terms, deposit_required, deposit_pct_required, deposit_pct_target and
-- the three lender_* columns were all UPDATE-grantable to `authenticated`.
--
-- NOTHING IN THE APP WRITES ANY OF THEM. Every reference in src/ and
-- supabase/functions/ is a read. So revoking costs no working flow — but it also
-- means there was no legitimate way to grant an exemption at all. This migration
-- closes the back door AND opens a proper front door: set_collection_terms(),
-- gated on can_edit('finance'), which records what changed and why.
--
-- PAYMENTS were the same shape: `authenticated` held INSERT plus column-level
-- UPDATE on amount/kind/confirmed_at/confirmed_by, while the confirmation guard was
-- BEFORE UPDATE only — so a payment could be INSERTED already confirmed, and an
-- amount could be rewritten on an already-confirmed row. record_payment() and
-- convert_to_sale() are both SECURITY DEFINER and are the only inserters, so the
-- direct grants buy nothing and are removed.
--
-- ── THE PRIVILEGE SWEEP ──────────────────────────────────────────────────────
-- `authenticated` and `anon` hold TRUNCATE on all 78 tables, including payment,
-- sale_financial_log, task_log and signature_event — every append-only audit table.
-- TRUNCATE ignores RLS and ignores the DELETE revoke 0063 put on payment.
--
-- HONEST SEVERITY: this is NOT currently exploitable. PostgREST never issues
-- TRUNCATE, and neither role has CREATE on schema public, so a user cannot author
-- a function containing one. Reaching it needs a direct Postgres connection with
-- real credentials. It is a latent footgun rather than an open door — but it costs
-- nothing to remove and it should never have been granted.
--
-- The grant comes from Supabase's default privileges (authenticated=arwdDxtm),
-- so revoking on today's tables is not enough: the next CREATE TABLE hands it back.
-- The ALTER DEFAULT PRIVILEGES below is the part that actually makes it stick.
-- Only TRUNCATE is stripped from the defaults — removing more would silently break
-- future tables' API access.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A. The privilege sweep ───────────────────────────────────────────────────
revoke truncate on all tables in schema public from authenticated, anon;

alter default privileges for role postgres in schema public
  revoke truncate on tables from authenticated, anon;

-- ── B. The gate columns stop being client-writable ───────────────────────────
revoke update (
  collect_exempt_reason,
  collection_terms,
  deposit_required,
  deposit_pct_required,
  deposit_pct_target,
  lender_approval_ref,
  lender_signer_verified_at,
  lender_signer_verified_by
) on public.sale from authenticated;

-- ── C. …and get a real front door instead ────────────────────────────────────
-- Everything a Finance user legitimately needs to do to a sale's collection terms,
-- in one place, permission-checked and logged. An exemption is the single most
-- consequential thing anyone can do to the money gates, so it demands a written
-- reason of substance — not "x".
create or replace function public.set_collection_terms(
  p_sale_id               text,
  p_collection_terms      text    default null,
  p_collect_exempt_reason text    default null,
  p_deposit_pct_required  numeric default null,
  p_clear_exemption       boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid; v_actor text; s public.sale; v_changes text[] := '{}';
  v_allowed text[] := array['cod','financed','net_terms','insurance','warranty','no_charge'];
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  if not (public.is_org_admin() or public.can_edit('finance')) then
    raise exception 'Changing collection terms is an Accounting action'
      using hint = 'You need edit permission on the finance module.';
  end if;

  select * into s from public.sale where id = p_sale_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no such sale'); end if;

  if p_collection_terms is not null then
    if not (p_collection_terms = any (v_allowed)) then
      raise exception 'Unknown collection terms: %', p_collection_terms
        using hint = 'Expected one of cod, financed, net_terms, insurance, warranty, no_charge.';
    end if;
    if p_collection_terms is distinct from s.collection_terms then
      v_changes := v_changes || ('terms ' || coalesce(s.collection_terms,'-') || ' -> ' || p_collection_terms)::text;
      update public.sale set collection_terms = p_collection_terms where id = p_sale_id;
    end if;
  end if;

  if p_clear_exemption then
    if s.collect_exempt_reason is not null then
      v_changes := v_changes || ('exemption REMOVED (was "' || s.collect_exempt_reason || '")')::text;
      update public.sale set collect_exempt_reason = null where id = p_sale_id;
    end if;
  elsif p_collect_exempt_reason is not null then
    if length(btrim(p_collect_exempt_reason)) < 10 then
      raise exception 'An exemption needs a real reason'
        using hint = 'This releases the money gate on the whole job. Say why, in a sentence.';
    end if;
    if btrim(p_collect_exempt_reason) is distinct from s.collect_exempt_reason then
      v_changes := v_changes || ('EXEMPTED from collection: "' || btrim(p_collect_exempt_reason) || '"')::text;
      update public.sale set collect_exempt_reason = btrim(p_collect_exempt_reason) where id = p_sale_id;
    end if;
  end if;

  if p_deposit_pct_required is not null then
    if p_deposit_pct_required < 0 or p_deposit_pct_required > 1 then
      raise exception 'Deposit percentage must be between 0 and 1';
    end if;
    if p_deposit_pct_required is distinct from s.deposit_pct_required then
      v_changes := v_changes || ('deposit % ' || coalesce(s.deposit_pct_required::text,'-')
                                 || ' -> ' || p_deposit_pct_required::text)::text;
      update public.sale
         set deposit_pct_required = p_deposit_pct_required,
             -- The agreed figure is re-snapshotted only when someone deliberately
             -- changes the percentage. It is never recomputed behind their back.
             deposit_required = round(coalesce(s.sale_amount,0) * p_deposit_pct_required, 2)
       where id = p_sale_id;
    end if;
  end if;

  if array_length(v_changes, 1) is null then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  return jsonb_build_object('ok', true, 'changed', true,
                            'changes', array_to_string(v_changes, '; '));
end $$;

revoke all on function public.set_collection_terms(text,text,text,numeric,boolean) from public, anon;
grant execute on function public.set_collection_terms(text,text,text,numeric,boolean) to authenticated, service_role;

-- ── D. The financial log learns about the gate columns ───────────────────────
-- It logged sale_amount / tax_amount / deposit_amount / is_cancelled but NOT the
-- columns that actually open the gates, which is how an exemption could release a
-- hold and leave nothing behind.
create or replace function public.trg_sale_financial_log()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_actor text := coalesce(public.jwt_email(), 'system');
begin
  if new.sale_amount is distinct from old.sale_amount then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'sale_amount', old.sale_amount::text, new.sale_amount::text, v_actor);
  end if;
  if new.tax_amount is distinct from old.tax_amount then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'tax_amount', old.tax_amount::text, new.tax_amount::text, v_actor);
  end if;
  if new.deposit_amount is distinct from old.deposit_amount then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'deposit_amount', old.deposit_amount::text, new.deposit_amount::text, v_actor);
  end if;
  if coalesce(new.is_cancelled,false) is distinct from coalesce(old.is_cancelled,false) then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'is_cancelled', old.is_cancelled::text, new.is_cancelled::text, v_actor);
  end if;
  -- The gate columns. These are the ones that decide whether material ships.
  if new.collect_exempt_reason is distinct from old.collect_exempt_reason then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'collect_exempt_reason', old.collect_exempt_reason, new.collect_exempt_reason, v_actor);
  end if;
  if new.collection_terms is distinct from old.collection_terms then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'collection_terms', old.collection_terms, new.collection_terms, v_actor);
  end if;
  if new.deposit_required is distinct from old.deposit_required then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'deposit_required', old.deposit_required::text, new.deposit_required::text, v_actor);
  end if;
  if new.deposit_pct_required is distinct from old.deposit_pct_required then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'deposit_pct_required', old.deposit_pct_required::text, new.deposit_pct_required::text, v_actor);
  end if;
  if new.lender_approval_ref is distinct from old.lender_approval_ref then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.id, 'lender_approval_ref', old.lender_approval_ref, new.lender_approval_ref, v_actor);
  end if;
  return new;
end $$;

-- ── E. The payment ledger ────────────────────────────────────────────────────
-- record_payment() and convert_to_sale() are both SECURITY DEFINER and are the
-- only things that insert payments, so these grants bought nothing and cost the
-- ability to forge a pre-confirmed row.
revoke insert on public.payment from authenticated;
revoke update (amount, customer, kind, method, notes, payment_date, reference, updated_date)
  on public.payment from authenticated;

-- A refund is negative, a payment is positive, and neither is zero. Verified
-- against all 15 existing rows (kind='deposit', 4605.00 to 13200.00) before adding.
alter table public.payment drop constraint if exists payment_amount_sign_matches_kind;
alter table public.payment add constraint payment_amount_sign_matches_kind
  check (
    (kind = 'refund' and amount < 0)
    or (kind is distinct from 'refund' and amount > 0)
  ) not valid;
alter table public.payment validate constraint payment_amount_sign_matches_kind;

-- The guard now covers INSERT. It was BEFORE UPDATE only, so a payment could be
-- born already confirmed and never pass through confirm_payment() at all.
create or replace function public.trg_payment_confirmation_guard()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if TG_OP = 'INSERT' then
    if new.confirmed_at is not null or new.confirmed_by is not null then
      raise exception 'a payment cannot be created already confirmed'
        using hint = 'Record it with record_payment(), then clear it with confirm_payment().';
    end if;
  else
    if new.confirmed_at is distinct from old.confirmed_at
       or new.confirmed_by is distinct from old.confirmed_by then
      raise exception 'payment.confirmed_at may only be set through confirm_payment()'
        using hint = 'Confirming a deposit has cleared is an Accounting action.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists payment_confirmation_guard on public.payment;
create trigger payment_confirmation_guard
  before insert or update on public.payment
  for each row execute function public.trg_payment_confirmation_guard();

-- Money moving in the ledger is now recorded the same way money moving on the sale
-- already was. sale_financial_log is reused rather than adding a second trail —
-- one place to look when a number is questioned.
create or replace function public.trg_payment_financial_log()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_actor text := coalesce(public.jwt_email(), 'system');
begin
  if TG_OP = 'INSERT' then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (new.sale, 'payment.recorded', null,
            coalesce(new.kind,'payment') || ' ' || new.amount::text, v_actor);
  elsif TG_OP = 'DELETE' then
    insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
    values (old.sale, 'payment.DELETED',
            coalesce(old.kind,'payment') || ' ' || old.amount::text, null, v_actor);
    return old;
  else
    if new.amount is distinct from old.amount then
      insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
      values (new.sale, 'payment.amount', old.amount::text, new.amount::text, v_actor);
    end if;
    if new.kind is distinct from old.kind then
      insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
      values (new.sale, 'payment.kind', old.kind, new.kind, v_actor);
    end if;
    if new.confirmed_at is distinct from old.confirmed_at then
      insert into public.sale_financial_log (sale, field, old_value, new_value, changed_by)
      values (new.sale, 'payment.confirmed_at', old.confirmed_at::text, new.confirmed_at::text, v_actor);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists payment_financial_log_trg on public.payment;
create trigger payment_financial_log_trg
  after insert or update or delete on public.payment
  for each row execute function public.trg_payment_financial_log();
