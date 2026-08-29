-- ─────────────────────────────────────────────────────────────────────────────
-- 0062 — Close the second door.
--
-- submitCheckpoint is not the only way a Job Start Checklist reaches
-- SubmittedForApproval. src/components/projects/InstallationCheckpointsSection.jsx
-- writes project_checkpoint directly through PostgREST (permitted by the
-- mod_insert / mod_update policies), so an Edge-Function-only gate guards one of
-- two doors.
--
-- The invariant therefore belongs in the database, where BOTH doors pass through.
-- The Edge Function keeps the UX — the response flag and the notifications — but
-- it is no longer where the decision is made or where the record is written.
--
-- MODE: 'observe' (the owner's decision) records and never blocks. 'enforce'
-- blocks unless a cod_exception holder has waived it. Flipping the flag is the
-- whole rollout; no code changes.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.app_settings
  add column if not exists cod_gate_mode text not null default 'observe';

alter table public.app_settings drop constraint if exists app_settings_cod_gate_mode_chk;
alter table public.app_settings add constraint app_settings_cod_gate_mode_chk
  check (cod_gate_mode in ('observe', 'enforce'));

comment on column public.app_settings.cod_gate_mode is
  'observe = record a COD shortfall and alert, never block (default). enforce = refuse the Job Start Checklist unless collected in full or waived by a cod_exception holder. This flag is the entire rollout switch.';

create or replace function public.cod_gate_mode()
returns text language sql stable set search_path to 'public'
as $$ select coalesce((select cod_gate_mode from public.app_settings limit 1), 'observe') $$;

-- ── The waiver ───────────────────────────────────────────────────────────────
-- Enforcement without a remedy is a stop that gets routed around on day one.
-- A waiver is an explicit, attributed act by someone holding cod_exception.
create or replace function public.waive_cod_hold(p_project_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_actor text;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated'; end if;
  if not (public.is_org_admin() or public.can_edit('cod_exception')) then
    raise exception 'Not authorized to waive a collection hold';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A waiver needs a written reason';
  end if;
  v_actor := coalesce(public.jwt_email(), 'system');

  insert into public.workflow_exception
    (id, code, subject_type, subject_id, detail, severity, first_seen_at, last_seen_at)
  values (gen_random_uuid()::text, 'E10_COD_WAIVED', 'project', p_project_id,
          'Collection waived by ' || v_actor || ': ' || p_reason, 'warn', now(), now())
  on conflict (code, subject_type, subject_id) where resolved_at is null
  do update set last_seen_at = now(),
                detail = 'Collection waived by ' || v_actor || ': ' || p_reason;

  return jsonb_build_object('ok', true, 'waived_by', v_actor);
end $$;

revoke all on function public.waive_cod_hold(text, text) from public, anon;
grant execute on function public.waive_cod_hold(text, text) to authenticated, service_role;

-- ── The invariant ────────────────────────────────────────────────────────────
-- SECURITY DEFINER is required: the PostgREST caller is `authenticated`, and
-- workflow_exception has no INSERT policy for that role.
create or replace function public.trg_checkpoint_cod_gate()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_sale text; v_b public.sale_balance; v_mode text; v_waived boolean;
begin
  -- Only the job-start transition into a submitted/complete state.
  if new.step_key is distinct from 'job_start_checklist' then return new; end if;
  if new.status not in ('SubmittedForApproval', 'Completed') then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;

  select sale into v_sale from public.project where id = new.project_id;
  if v_sale is null then return new; end if;

  select * into v_b from public.sale_balance where sale_id = v_sale;
  -- Gate stands down on: no balance row, a cancelled sale (E11 covers those),
  -- and an UNPRICED sale (balance_due goes negative and nothing could ever
  -- satisfy it — that is a Sales data problem, not a collection one).
  if not found or v_b.is_cancelled or coalesce(v_b.gross_amount, 0) <= 0 then
    return new;
  end if;

  if v_b.fully_collected then
    perform public.resolve_cod_hold(v_sale);
    return new;
  end if;

  v_mode := public.cod_gate_mode();
  select exists (
    select 1 from public.workflow_exception
     where code = 'E10_COD_WAIVED' and subject_type = 'project'
       and subject_id = new.project_id and resolved_at is null
  ) into v_waived;

  if v_mode = 'enforce' and not v_waived then
    -- Raising aborts the statement, so nothing is written here — the message IS
    -- the record, and it must carry the remedy. A stop with no remedy is a stop
    -- people route around.
    raise exception
      'COD_UNCOLLECTED: the balance on this job must be collected before the install starts.'
      using hint = 'Record the payment, or ask someone with the COD Exceptions permission to waive it.',
            errcode = 'check_violation';
  end if;

  -- Observe: record it and let the write through. No dollar figures — this table
  -- is readable by every ops role, which is wider than the payment ledger's RLS.
  insert into public.workflow_exception
    (id, code, subject_type, subject_id, detail, severity, first_seen_at, last_seen_at)
  values (gen_random_uuid()::text, 'E9_COD_UNCOLLECTED', 'project', new.project_id,
          'Install started with a balance outstanding. Terms: '
            || coalesce(v_b.collection_terms, 'cod')
            || '. Observe-only — the crew was NOT stopped.',
          'crit', now(), now())
  on conflict (code, subject_type, subject_id) where resolved_at is null
  do update set last_seen_at = now();

  return new;
end $$;

drop trigger if exists checkpoint_cod_gate on public.project_checkpoint;
create trigger checkpoint_cod_gate
  before insert or update on public.project_checkpoint
  for each row execute function public.trg_checkpoint_cod_gate();
