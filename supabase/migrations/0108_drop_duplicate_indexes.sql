-- ---------------------------------------------------------------------------
-- 0108 -- Drops four indexes I created that already existed.
--
-- Found by Supabase's performance advisors. Every one is byte-identical to an
-- index that has been in place since 0002, and every one is mine:
--
--   appointment_customer_idx           (0104)  == idx_appointment_customer      (0002)
--   project_customer_idx               (0093)  == idx_project_customer          (0002)
--   project_checkpoint_project_id_idx  (0087)  == idx_project_checkpoint_project (0002)
--   project_log_project_idx            (0087)  == idx_project_log_project       (0002)
--
-- The cause is the same each time: I reasoned "this new query filters on
-- <column>, so it needs an index on <column>" and wrote a CREATE INDEX IF NOT
-- EXISTS without checking whether one was already there. IF NOT EXISTS only
-- guards the NAME, not the definition, so a differently-named duplicate is
-- created silently. Every duplicate is pure cost: it is maintained on every
-- insert, update and delete of those tables and can never be chosen over its
-- twin.
--
-- Keeping the 0002 originals rather than mine, so this is a revert to the
-- pre-existing state rather than a rename.
--
-- The lesson for the next index: check pg_indexes for the table first. The
-- naming conventions differ across the porting eras of this schema (idx_<table>_<col>
-- vs <table>_<col>_idx), which is exactly why a name-based check missed them.
-- ---------------------------------------------------------------------------

drop index if exists public.appointment_customer_idx;
drop index if exists public.project_customer_idx;
drop index if exists public.project_checkpoint_project_id_idx;
drop index if exists public.project_log_project_idx;
