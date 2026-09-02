-- THE 2026-01-01 BOUNDARY. Owner's instruction, 2026-09-02: load the history, but
-- "do not have any of the automation kick off or add them to to-do lists if it's
-- older than 2026.01.01".
--
-- rfms_order_summary now holds 4,139 orders back to 2024-04-09 -- two years Razzle
-- had never seen, worth $16.0M in the historical portion alone. That history is
-- enormously useful for REPORTING and actively dangerous for AUTOMATION: the flow
-- engine, the reconciler and the task rules all reason about open work, and handed a
-- 2024 order they would raise follow-ups, escalations and to-dos for jobs that
-- finished eighteen months ago.
--
-- That is not hypothetical. The base44 import produced 327 close_out_install tasks
-- from stalled 2026 jobs. This is five times the volume and years older.
--
-- ENFORCED STRUCTURALLY rather than as a rule people are asked to remember:
--
--   is_historical           generated, so the boundary sits on every row and cannot
--                           be computed two different ways by two callers
--   rfms_order_actionable   the ONLY relation automation may read. Anything creating
--                           a task, job, escalation or notification reads this view.
--                           Reporting reads the base table.
--
-- If automation over older orders is ever wanted, that is a deliberate edit to this
-- view with a reason attached -- not an accident in a WHERE clause someone forgot.
--
-- Verified after applying: 3,038 historical / 1,101 from 2026 / 772 actionable, and
-- 0 rows before 2026-01-01 reachable through the view.
alter table public.rfms_order_summary
  add column if not exists is_historical boolean
  generated always as (order_date < date '2026-01-01') stored;

comment on column public.rfms_order_summary.is_historical is
  'Order predates 2026-01-01. Owner rule: historical orders are for reporting only -- no automation, no tasks, no escalations. Automation must read rfms_order_actionable, never this table.';

create index if not exists rfms_order_actionable_idx
  on public.rfms_order_summary (order_date)
  where not is_historical and not voided and coalesce(order_total,0) > 0;

create or replace view public.rfms_order_actionable
with (security_invoker = on) as
select * from public.rfms_order_summary
 where not is_historical
   and not voided
   and coalesce(order_total, 0) > 0;

comment on view public.rfms_order_actionable is
  'The ONLY relation automation may read. Live, non-voided orders from 2026-01-01 onward. Owner rule: nothing older than 2026-01-01 may generate a task, job, escalation or notification. Reporting reads rfms_order_summary; automation reads this.';

revoke all on public.rfms_order_actionable from anon;
grant select on public.rfms_order_actionable to authenticated;
