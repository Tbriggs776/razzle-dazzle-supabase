-- A trigger function without a pinned search_path can be hijacked by a caller
-- who prepends a schema of their own. Both of these are mine (0053, 0054).
alter function public.trg_payment_confirmation_guard() set search_path to 'public';
alter function public.trg_task_legacy_status()         set search_path to 'public';
