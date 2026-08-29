-- ─────────────────────────────────────────────────────────────────────────────
-- 0112 — A green "Verified" badge that survived changing the credential.
--
-- admin_set_secret, admin_clear_secret and admin_set_integration never touched
-- `integration.status`. Only testIntegration wrote it. So the sequence an admin
-- actually performs — test a key, see Verified, later paste a NEW key, press
-- Save — left the badge green, describing a successful test of a credential
-- that is no longer there.
--
-- Worse for the five providers added in 0100: paste a wrong Google Ads customer
-- id over a right one and the page still says Verified, because that id lives in
-- `config` and nothing re-checked it.
--
-- Now:
--   admin_set_secret        verified -> configured      (untested, not unknown)
--   admin_clear_secret      verified -> not_configured
--   admin_set_integration   verified -> configured, but ONLY when p_config
--                           actually DIFFERS from what is stored
--
-- That last condition matters. The page calls admin_set_integration on every
-- Save, including when the admin only flipped the Enabled toggle — demoting
-- unconditionally would throw away a perfectly good verification for a change
-- that could not have invalidated it.
--
-- The demotion is scoped by looking the secret name up in each provider's own
-- secret_fields, so writing GHL_PIT_TOKEN cannot disturb Twilio's badge. The
-- 'configured' status already had a label in the UI ("Configured, untested")
-- and, until now, nothing that ever produced it.
--
-- Verified in a rolled-back transaction: re-saving an identical config keeps
-- Verified; a real config change demotes to configured; rewriting a secret
-- demotes to configured; clearing one drops to not_configured; an unrelated
-- provider is untouched throughout.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_set_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not public.is_org_admin() then raise exception 'not authorized'; end if;
  if p_value is null or length(trim(p_value)) = 0 then raise exception 'empty secret'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, 'integration secret');
  else
    perform vault.update_secret(v_id, p_value, p_name, 'integration secret');
  end if;

  -- A credential that changed has not been tested. Demote any provider whose
  -- secret_fields include this name from 'verified' back to 'configured', and
  -- drop the stale error, so the badge stops asserting something we last
  -- confirmed about a different key.
  update public.integration i
     set status = 'configured', last_error = null, last_tested_at = null, updated_date = now()
   where i.status = 'verified'
     and exists (
       select 1 from jsonb_array_elements(i.secret_fields) sf
        where sf->>'name' = p_name
     );
end $function$;

create or replace function public.admin_clear_secret(p_name text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.is_org_admin() then raise exception 'not authorized'; end if;
  delete from vault.secrets where name = p_name;

  -- Removing a credential certainly invalidates a green badge.
  update public.integration i
     set status = 'not_configured', last_error = null, last_tested_at = null, updated_date = now()
   where i.status = 'verified'
     and exists (
       select 1 from jsonb_array_elements(i.secret_fields) sf
        where sf->>'name' = p_name
     );
end $function$;

create or replace function public.admin_set_integration(p_key text, p_is_enabled boolean, p_config jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_old jsonb;
begin
  if not public.is_org_admin() then raise exception 'not authorized'; end if;

  select config into v_old from public.integration where key = p_key;

  update public.integration
     set is_enabled = coalesce(p_is_enabled, is_enabled),
         config = coalesce(p_config, config),
         -- Config carries account ids, property ids and API versions — change any
         -- of them and the last successful test was against a different target.
         -- Only demote on an ACTUAL change, so toggling Enabled or re-saving an
         -- unchanged form does not throw away a good verification.
         status = case
                    when status = 'verified'
                     and p_config is not null
                     and p_config is distinct from v_old then 'configured'
                    else status
                  end,
         last_error = case
                        when status = 'verified'
                         and p_config is not null
                         and p_config is distinct from v_old then null
                        else last_error
                      end,
         updated_date = now()
   where key = p_key;
end $function$;
