-- ─────────────────────────────────────────────────────────────────────────────
-- 0088 — B7's remaining half. The language choice follows the PERSON, not the
--        device.
--
-- The EN/ES toggle wrote to localStorage under 'razzle_language'. So a
-- Spanish-speaking installer who set it on the yard phone got English again on his
-- own phone, English again after clearing site data, and English on the first
-- device he ever opens a job on — which is the one that matters, because that is
-- where the assignment SMS lands. And no manager could set it for him, because
-- there was nowhere to set it.
--
-- ON app_user RATHER THAN team_member: this is a preference of a LOGIN, it is read
-- at sign-in, and 11 of 13 roster members have no login at all — a preference
-- stored on a row that cannot sign in would never be read.
--
-- Deliberately NO check constraint on the column: a value outside the set simply
-- falls back to English in the client, and a CHECK would turn adding a third
-- language into a migration. The RPC validates instead.
--
-- Verified in a rolled-back transaction: a crew member sets and reads back their
-- own; 'fr' is refused; a non-admin setting someone else's is refused; an admin
-- setting it for a crew member succeeds.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.app_user
  add column if not exists preferred_language text;

-- Set your own, or an org admin sets it for someone who cannot easily do it
-- themselves — which is the actual case here: a crew member on a phone, mid-job,
-- in a language they cannot read the settings screen in.
create or replace function public.set_preferred_language(
  p_language text,
  p_user_id  uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid; v_target uuid; v_allowed text[] := array['en','es'];
begin
  v_uid := (select auth.uid());
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if p_language is not null and not (p_language = any (v_allowed)) then
    raise exception 'Unsupported language: %', p_language
      using hint = 'Expected en or es.';
  end if;

  v_target := coalesce(p_user_id, v_uid);
  if v_target <> v_uid and not public.is_org_admin() then
    raise exception 'Only an administrator can set the language for someone else';
  end if;

  update public.app_user set preferred_language = p_language where id = v_target;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no such user'); end if;

  return jsonb_build_object('ok', true, 'user_id', v_target, 'language', p_language);
end $$;

revoke all on function public.set_preferred_language(text, uuid) from public, anon;
grant execute on function public.set_preferred_language(text, uuid) to authenticated, service_role;

-- Reading it needs no permission gymnastics: app_user_self already grants a user
-- SELECT on their own row.
create or replace function public.my_preferred_language()
returns text language sql stable security definer set search_path to 'public'
as $$
  select preferred_language from public.app_user where id = (select auth.uid());
$$;

revoke all on function public.my_preferred_language() from public, anon;
grant execute on function public.my_preferred_language() to authenticated, service_role;
