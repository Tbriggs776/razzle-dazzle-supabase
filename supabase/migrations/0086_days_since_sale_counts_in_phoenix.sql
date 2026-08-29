-- ─────────────────────────────────────────────────────────────────────────────
-- 0086 — C1, second half. 0076 fixed job_stage.stage_since; this is the other one.
--
-- sale_balance.days_since_sale computed
--   (now() AT TIME ZONE 'America/Phoenix')::date - s.sale_date::date
-- The left side is correctly Phoenix. The right is not: s.sale_date is timestamptz
-- and a bare ::date casts through the SESSION timezone, which is UTC on this
-- server. A sale written at 7pm Phoenix is 02:00 the NEXT day in UTC, so it dated
-- itself one day late and read one day FRESHER on the collections queue for the
-- rest of its life. In-home flooring sells in the evening, so that was the
-- majority of sales, permanently.
--
-- Patched in place from the LIVE definition rather than retyped: exactly one
-- occurrence exists, the DO block asserts that before touching anything, and
-- retyping a long view is how a second bug gets introduced.
--
-- NOTE: `create or replace view` DROPS reloptions, so security_invoker has to be
-- set again below or the view silently starts running as owner and bypassing RLS.
-- That is the 0057 lesson and it still applies every single time.
--
-- Verified: a 28 Aug 7:30pm Phoenix sale read 0 days old under the UTC cast and
-- reads 1 under the Phoenix cast.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare v_def text; v_hits int;
begin
  v_def := pg_get_viewdef('public.sale_balance', true);

  v_hits := (length(v_def) - length(replace(v_def, 's.sale_date::date', '')))
            / length('s.sale_date::date');
  if v_hits <> 1 then
    raise exception 'expected exactly 1 occurrence of s.sale_date::date, found %', v_hits;
  end if;

  v_def := replace(v_def, 's.sale_date::date',
                   '(s.sale_date AT TIME ZONE ''America/Phoenix'')::date');

  execute 'create or replace view public.sale_balance as ' || v_def;
end $$;

alter view public.sale_balance set (security_invoker = true);
