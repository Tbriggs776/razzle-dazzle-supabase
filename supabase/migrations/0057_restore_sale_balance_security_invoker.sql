-- create or replace view DROPS reloptions. 0056 silently reverted the
-- security_invoker set in 0054, which would have let any authenticated user read
-- every sale through the view regardless of their row permissions.
-- Grants survived (only DROP resets those), so anon stayed blocked.
--
-- RULE: every future `create or replace view public.sale_balance` must be
-- immediately followed by this statement.
alter view public.sale_balance set (security_invoker = true);
