-- Let an operator paste a session token minted somewhere else, and use it directly.
--
-- WHY THIS EXISTS. POST /v2/session/begin refuses our store credentials. Verified
-- 2026-09-01 against the live API:
--
--     bare host          GET  /                 -> 200, RFMS API landing page
--     no auth header     GET  /v2/customers     -> 403, empty body
--     bogus credentials  POST /v2/session/begin -> 403, empty body
--     our credentials    POST /v2/session/begin -> 403, empty body
--
-- The network path is fine and the 403 is simply this API's opaque "not authorized"
-- for every failure, so nothing distinguishes a bad key from a disabled entitlement
-- from the outside. What we do know: the credential currently in the vault is not
-- accepted, and the ORIGINAL base44 app mints sessions against this same API every
-- day from its own infrastructure.
--
-- So: mint the token where it works, paste it here, and let this app skip the step
-- it cannot perform. That is a diagnostic before it is a feature -- if a token minted
-- elsewhere works from ours, everything except the stored store-credential is proven
-- healthy, and the remaining question is narrowed to one value.
--
-- THIS IS A BRIDGE, NOT A DESIGN. Session tokens expire; RFMS extends them on each
-- call, but a quiet weekend kills one and only session/begin can produce another. Do
-- not cut over anything that matters onto a pinned token. The end state is store
-- credentials that authenticate on their own, at which point clearing these two
-- secrets restores the normal path with no code change.
--
-- storeId is the username half, matching base44's proven-working shape:
-- btoa(`${sessionData.storeId}:${sessionData.sessionToken}`). RFMS's own docs say to
-- reuse "the same user name you used in the first step" (the store queue). Those two
-- reconcile if the storeId that session/begin returns IS the store queue -- which is
-- exactly what pasting a real response will tell us, and is a large part of the point.
update public.integration set
  secret_fields = jsonb_build_array(
    jsonb_build_object('name', 'RFMS_STORE_QUEUE',      'label', 'Store Queue Value'),
    jsonb_build_object('name', 'RFMS_API_TOKEN',        'label', 'API Token'),
    jsonb_build_object('name', 'RFMS_SESSION_STORE_ID', 'label', 'Bridge: storeId from session/begin'),
    jsonb_build_object('name', 'RFMS_SESSION_TOKEN',    'label', 'Bridge: sessionToken from session/begin')
  )
where key = 'rfms';

comment on table public.integration is
  'Provider credentials + config driving the /Integrations admin page. secret_fields names Vault secrets; config_fields names keys inside config. RFMS carries two optional bridge secrets (RFMS_SESSION_STORE_ID / RFMS_SESSION_TOKEN) that pin an externally minted session -- see 0144.';
