-- The Communication Hub went blank, and this is why.
--
-- The policies on ghl_message and ghl_conversation read:
--
--     can_view('leads') OR is_org_admin()
--
-- Written that way, Postgres treats those calls as row-dependent and re-runs
-- them FOR EVERY ROW. On ghl_conversation (18,704 rows) that was survivable. On
-- ghl_message it is now 411,000 rows, each one re-resolving the caller's module
-- permissions, and the Hub's query simply ran past the statement timeout. A
-- timed-out query returns nothing, and the Hub rendered "No conversations yet"
-- -- with 32,065 messages sitting in the last thirty days.
--
-- It reads like an empty inbox rather than a failure, which is the worst way for
-- this to present: nothing looks broken, the data just appears to be gone.
--
-- Wrapping each call in a scalar subquery is the documented fix. `(select
-- can_view('leads'))` has no reference to the row, so the planner hoists it into
-- an InitPlan and evaluates it ONCE per query instead of once per row. Same
-- authorisation, same answer, one evaluation.
--
-- This is the auth_rls_initplan advisory Supabase had already been raising. It
-- was easy to read as a micro-optimisation; at 411,000 rows it is the difference
-- between a working screen and an empty one.
drop policy if exists ghl_message_read on public.ghl_message;
create policy ghl_message_read on public.ghl_message
  for select to authenticated
  using ((select public.can_view('leads')) or (select public.is_org_admin()));

drop policy if exists ghl_conversation_read on public.ghl_conversation;
create policy ghl_conversation_read on public.ghl_conversation
  for select to authenticated
  using ((select public.can_view('leads')) or (select public.is_org_admin()));

drop policy if exists ghl_sync_state_read on public.ghl_sync_state;
create policy ghl_sync_state_read on public.ghl_sync_state
  for select to authenticated
  using ((select public.is_org_admin()));
