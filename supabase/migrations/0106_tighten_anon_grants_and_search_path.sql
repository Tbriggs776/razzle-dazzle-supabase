-- ─────────────────────────────────────────────────────────────────────────────
-- 0106 — Hardening found by Supabase's own security advisors, which nothing in
-- this project had been running.
--
-- ⚠️ THIS MIGRATION'S REVOKES DO NOT WORK. See 0107, which fixes them. Kept as
-- applied rather than rewritten, because the mistake is worth having on the
-- record: `revoke execute ... from anon` is a no-op when the grant is held by
-- PUBLIC, and anon inherits from PUBLIC. It is the same shape as the
-- column-level REVOKE trap documented in 0080, and I walked into it again.
-- has_function_privilege() said `true` immediately afterwards; only reading
-- proacl showed why — the entry is `=X/postgres`, and a leading empty grantee
-- IS public.
--
-- The search_path fixes below ARE effective and are the real content here.
--
-- ── search_path ─────────────────────────────────────────────────────────────
-- to_e164 and lead_cadence_days were the only two functions I wrote without
-- `set search_path`, because both are trivial and IMMUTABLE and it did not seem
-- to matter. It matters anyway: a function with a mutable search_path resolves
-- its operators and functions against whatever the caller has set. Neither of
-- these touches a table, so the practical risk was low — but "low" is not a
-- reason to be the only two functions in the schema that differ.
-- ─────────────────────────────────────────────────────────────────────────────

-- Ineffective — superseded by 0107. Left for the record.
revoke execute on function public.resolve_cod_hold(text) from anon;
revoke execute on function public.current_user_module_permission(text) from anon;
revoke execute on function public.my_access() from anon;
revoke execute on function public.is_org_admin() from anon;

create or replace function public.to_e164(p_phone text)
returns text language sql immutable set search_path to 'public'
as $$
  select case
    when regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') = '' then null
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) = 10
      then '+1' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) = 11
     and left(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      then '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    when btrim(coalesce(p_phone, '')) like '+%'
     and length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) between 8 and 15
      then '+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    else null
  end;
$$;

create or replace function public.lead_cadence_days(p_attempts int)
returns int language sql immutable set search_path to 'public'
as $$
  -- See the header: arrays are 1-based, so element n+1 is the day AFTER n attempts.
  select (array[0, 1, 3, 7, 14])[least(greatest(p_attempts, 0) + 1, 5)];
$$;
