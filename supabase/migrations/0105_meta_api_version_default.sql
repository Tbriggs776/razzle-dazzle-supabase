-- ─────────────────────────────────────────────────────────────────────────────
-- 0105 — 0100 shipped a Meta Graph API default of v21.0, which was a guess and
-- a bad one.
--
-- Meta retires a version two years after the NEXT one ships, and the current
-- version is v26.0 (2026-07-29). v21.0 is well past that line, so the very
-- first Test Connection would have failed with a version error that says
-- nothing about the actual credential — the worst possible first impression of
-- a credential screen.
--
-- v25.0 rather than v26.0 deliberately: v25.0 (shipped 2026-02-18, retires
-- 2028-07-29) has a long life left and is not the version released four weeks
-- ago. The value stays an admin-editable config field, so bumping it later is a
-- text edit rather than a deploy.
--
-- Also adds META_APP_SECRET. appsecret_proof is optional by default but can be
-- switched to required per-app in App Settings > Advanced > Security. If someone
-- flips that switch, every call starts failing and the error does not obviously
-- point at it — testIntegration detects that specific failure and says so, but
-- it needs somewhere to have stored the secret to be able to fix it.
-- ─────────────────────────────────────────────────────────────────────────────

update public.integration
   set config = jsonb_set(coalesce(config, '{}'::jsonb), '{meta_api_version}', '"v25.0"', true),
       config_fields = '[{"name":"meta_ad_account_id","type":"text","label":"Ad Account ID","placeholder":"act_1234567890"},
                         {"name":"meta_dataset_id","type":"text","label":"Dataset / Pixel ID (for CAPI)","placeholder":"1234567890"},
                         {"name":"meta_api_version","type":"text","label":"Graph API Version","placeholder":"v25.0"}]'::jsonb,
       secret_fields = '[{"name":"META_SYSTEM_USER_TOKEN","label":"System User Access Token"},
                         {"name":"META_APP_SECRET","label":"App Secret (only if the app requires appsecret_proof)"},
                         {"name":"META_CAPI_TEST_EVENT_CODE","label":"CAPI Test Event Code (optional, testing only)"}]'::jsonb
 where key = 'meta'
   and coalesce(config->>'meta_api_version', '') in ('', 'v21.0');
