-- ─────────────────────────────────────────────────────────────────────────────
-- 0100 — The credentials Pillars 1 & 2 needs, entered the same way every other
-- provider's are: a row here, and the Integrations page renders it. Nothing in
-- the page is hardcoded per provider — `secret_fields` and `config_fields` drive
-- the form, secrets go to Supabase Vault write-only, and `testIntegration` gets
-- one case per key. So adding a provider is this migration plus that one case.
--
-- ── SECRET vs CONFIG ────────────────────────────────────────────────────────
-- A secret goes into the Vault and never comes back to the browser; a config
-- value is stored in plain jsonb on the row and IS shown. The split is not
-- "sensitive vs not" — it is "would leaking this let someone act as us". So
-- OAuth client ids sit with their secrets (they are useless apart and the pair
-- is the credential), while account ids, property ids and ad-account ids are
-- config: they identify which account, they do not authorise anything.
--
-- ── WHY GHL GROWS FOUR SECRETS ──────────────────────────────────────────────
-- It already had a Private Integration Token, which is enough to upsert contacts
-- and read calendars. It is NOT enough for the thing that actually matters here:
-- becoming GHL's DEFAULT conversation provider, so that campaign and workflow
-- SMS/email modules deliver through our Twilio and Resend instead of GHL's own
-- LC Phone. That requires a Marketplace app — client id, client secret, and the
-- Ed25519 public key that verifies the X-GHL-Signature on inbound provider
-- webhooks. (X-WH-Signature, the older header, dies 1 Sep 2026.)
--
-- ── NOTES ON THE OTHER FOUR ─────────────────────────────────────────────────
-- CallRail: the API key is user-scoped, and the webhook secret is set per
--   COMPANY, not per account — hence both ids as config.
-- RingCentral: this is the JWT *server* app, used for the telephony-session
--   webhook, call log, recordings and queue presence. The Embeddable click-to-
--   dial widget uses USER OAuth instead and is deliberately not modelled here:
--   mixing the two makes WebRTC run as the admin rather than as the setter.
-- Google Ads: three account ids because they are genuinely three different
--   things — spend lives on the child customer, `login-customer-id` is the
--   manager you authenticate through, and the Data Manager API's
--   `operating_account` (where conversions land) can be neither.
-- GA4: no property-level credential exists; it authenticates with a service
--   account that has been granted access to the property. GA4_SA_JSON is
--   optional so it can simply reuse the Google APIs one.
--
-- Nothing here turns anything on: every row lands is_enabled=false /
-- not_configured, and every integration in this app graceful-degrades until a
-- key is entered.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.integration (key, name, category, is_enabled, status, sort_order, config, secret_fields, config_fields) values
('callrail', 'CallRail', 'Telephony · Attribution', false, 'not_configured', 90,
 '{}'::jsonb,
 '[{"name":"CALLRAIL_API_KEY","label":"API Key (user-scoped token)"},
   {"name":"CALLRAIL_WEBHOOK_SECRET","label":"Company Webhook Secret"}]'::jsonb,
 '[{"name":"callrail_account_id","type":"text","label":"Account ID","placeholder":"ACCxxxxxxxxxxxxxxxx"},
   {"name":"callrail_company_id","type":"text","label":"Company ID","placeholder":"COMxxxxxxxxxxxxxxxx"}]'::jsonb),

('ringcentral', 'RingCentral', 'Telephony', false, 'not_configured', 100,
 '{"rc_server_url":"https://platform.ringcentral.com"}'::jsonb,
 '[{"name":"RC_CLIENT_ID","label":"Server App Client ID"},
   {"name":"RC_CLIENT_SECRET","label":"Server App Client Secret"},
   {"name":"RC_JWT","label":"JWT Credential"}]'::jsonb,
 '[{"name":"rc_server_url","type":"text","label":"Server URL","placeholder":"https://platform.ringcentral.com"},
   {"name":"rc_main_number","type":"text","label":"Main Company Number (E.164)","placeholder":"+16025550100"},
   {"name":"rc_queue_extension","type":"text","label":"CSR Queue Extension (optional)","placeholder":"1001"}]'::jsonb),

('google_ads', 'Google Ads', 'Advertising', false, 'not_configured', 110,
 '{}'::jsonb,
 '[{"name":"GOOGLE_ADS_DEVELOPER_TOKEN","label":"Developer Token"},
   {"name":"GOOGLE_ADS_CLIENT_ID","label":"OAuth Client ID"},
   {"name":"GOOGLE_ADS_CLIENT_SECRET","label":"OAuth Client Secret"},
   {"name":"GOOGLE_ADS_REFRESH_TOKEN","label":"OAuth Refresh Token"}]'::jsonb,
 '[{"name":"google_ads_customer_id","type":"text","label":"Customer ID (spend lives here, digits only)","placeholder":"1234567890"},
   {"name":"google_ads_login_customer_id","type":"text","label":"Manager (MCC) ID — only if access is through a manager","placeholder":"0987654321"},
   {"name":"google_ads_conversion_customer_id","type":"text","label":"Conversion Account ID (Data Manager operating_account)","placeholder":"leave blank to use Customer ID"}]'::jsonb),

('meta', 'Meta (Facebook / Instagram)', 'Advertising', false, 'not_configured', 120,
 '{"meta_api_version":"v21.0"}'::jsonb,
 '[{"name":"META_SYSTEM_USER_TOKEN","label":"System User Access Token"},
   {"name":"META_CAPI_TEST_EVENT_CODE","label":"CAPI Test Event Code (optional, testing only)"}]'::jsonb,
 '[{"name":"meta_ad_account_id","type":"text","label":"Ad Account ID","placeholder":"act_1234567890"},
   {"name":"meta_dataset_id","type":"text","label":"Dataset / Pixel ID (for CAPI)","placeholder":"1234567890"},
   {"name":"meta_api_version","type":"text","label":"Graph API Version","placeholder":"v21.0"}]'::jsonb),

('ga4', 'Google Analytics 4', 'Analytics', false, 'not_configured', 130,
 '{}'::jsonb,
 '[{"name":"GA4_SA_JSON","label":"Service Account JSON (optional — falls back to the Google APIs one)"}]'::jsonb,
 '[{"name":"ga4_property_id","type":"text","label":"Property ID (digits only)","placeholder":"123456789"}]'::jsonb)
on conflict (key) do nothing;

-- GHL needs a Marketplace app on top of the PIT: the PIT can upsert contacts, but
-- the DEFAULT conversation provider (which is what makes GHL workflow SMS/Email
-- modules fire through Twilio/Resend) is only available to a Marketplace app.
update public.integration
   set secret_fields = '[{"name":"GHL_PIT_TOKEN","label":"Private Integration Token"},
                         {"name":"GHL_APP_CLIENT_ID","label":"Marketplace App Client ID"},
                         {"name":"GHL_APP_CLIENT_SECRET","label":"Marketplace App Client Secret"},
                         {"name":"GHL_WEBHOOK_PUBLIC_KEY","label":"Webhook Public Key (Ed25519, verifies X-GHL-Signature)"}]'::jsonb,
       config_fields = '[{"name":"ghl_location_id","type":"text","label":"GHL Location ID"},
                         {"name":"ghl_conversation_provider_id","type":"text","label":"Conversation Provider ID (from the Marketplace app)"},
                         {"name":"ghl_api_version","type":"text","label":"API Version header","placeholder":"2021-07-28"}]'::jsonb
 where key = 'ghl';
