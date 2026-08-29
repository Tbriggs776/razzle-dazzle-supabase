-- ─────────────────────────────────────────────────────────────────────────────
-- 0063b — RECOVERED 2026-08-29 from the live database.
--
-- This migration was applied to production via MCP in an earlier session and the
-- file was never saved, so the repo could not rebuild production. Recovered by
-- dumping pg_get_functiondef() of the object it created. Same failure mode as the
-- 0052 recovery; see the note at the bottom of this file.
--
-- WHAT IT FIXES: 0056 added sale.deposit_required as a gate input but gave it no
-- default and no writer, so every NEW sale was created with a null and was
-- therefore permanently gate-blocked. This trigger fills the collection-terms
-- columns on insert/update.
--
-- The load-bearing property is that it only ever FILLS A NULL. Recomputing
-- deposit_required on an edit would retroactively un-satisfy a gate on a job that
-- has already been released to order — i.e. it would claw back a decision
-- Accounting already made. deposit_required is a snapshot of what was agreed, not
-- a derived value.
--
-- Verified identical to production at recovery time.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_sale_collection_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.collection_terms     := coalesce(new.collection_terms, 'cod');
  new.deposit_pct_target   := coalesce(new.deposit_pct_target, 0.50);
  new.deposit_pct_required := coalesce(new.deposit_pct_required, 0.50);

  -- Only ever FILL a null. Never recompute: deposit_required is a snapshot of
  -- what was agreed, and re-deriving it on an edit would retroactively
  -- un-satisfy a gate on a job that has already been released.
  if new.deposit_required is null and coalesce(new.sale_amount, 0) > 0 then
    new.deposit_required := round(new.sale_amount * new.deposit_pct_required, 2);
  end if;

  return new;
end $function$;

-- ── PROCESS NOTE ─────────────────────────────────────────────────────────────
-- Root cause of this file's absence: apply_migration was called without saving
-- the file in the same turn. Every apply MUST be followed by writing the file
-- before moving on, or production drifts ahead of the repo silently and the only
-- way back is a dump like this one.
-- ─────────────────────────────────────────────────────────────────────────────
