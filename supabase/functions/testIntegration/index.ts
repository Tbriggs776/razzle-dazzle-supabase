// Admin-only: verify a provider's stored credentials with one cheap authenticated
// call, and record the result on the integration row. Powers the "Test" button in
// the Integrations admin page.
//
// Was self-contained; now imports googleToken from _shared/google.ts for GA4,
// because signing a service-account JWT is real crypto and a second copy of it
// would be a bug waiting to happen. The CLI bundles relative imports.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { googleToken } from '../_shared/google.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const service = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await service().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

type Result = { ok: boolean; message: string; configured?: boolean };
const miss = (w: string): Result => ({ ok: false, configured: false, message: `${w} not set` });

// Account ids get pasted straight out of a vendor dashboard, hyphens and all.
// Google Ads in particular rejects 123-456-7890 in both the header and the path.
const digits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');

// Vendors bury the useful part of a failure in a JSON body. Surfacing "invalid
// developer token" instead of "HTTP 401" is the whole difference between an
// admin fixing it and an admin filing a ticket.
async function detail(r: Response): Promise<string> {
  try {
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      const m = j?.error?.message || j?.error_description || j?.message
        || j?.error?.details?.[0]?.errors?.[0]?.message;
      if (m) return ` — ${String(m).slice(0, 220)}`;
    } catch { /* not JSON */ }
    if (t) return ` — ${t.slice(0, 220)}`;
  } catch { /* body already consumed */ }
  return '';
}

async function testProvider(key: string, cfg: Record<string, any>): Promise<Result> {
  switch (key) {
    case 'twilio': {
      const sid = await getSecret('TWILIO_ACCOUNT_SID');
      const token = await getSecret('TWILIO_AUTH_TOKEN');
      if (!sid || !token) return miss('Account SID / Auth Token');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` },
      });
      if (!r.ok) return { ok: false, message: `Twilio auth failed (HTTP ${r.status})` };
      const a = await r.json();
      const svc = cfg.messaging_service_sid ? ' · Messaging Service set' : ' · no Messaging Service (10DLC recommended)';
      return { ok: true, message: `Connected: ${a.friendly_name || a.status}${svc}` };
    }
    case 'resend': {
      const k = await getSecret('RESEND_API_KEY');
      if (!k) return miss('API Key');
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${k}` } });
      if (!r.ok) return { ok: false, message: `Resend auth failed (HTTP ${r.status})` };
      const d = await r.json();
      const doms = (d.data || []).map((x: any) => `${x.name}(${x.status})`).join(', ') || 'none verified';
      return { ok: true, message: `Connected. Domains: ${doms}` };
    }
    case 'rfms': {
      // Mirror the runtime client (_shared/rfms.ts): HTTP Basic base64(storeQueue:apiToken)
      // against POST {base}/session/begin. (The old test used a never-set RFMS_BEARER_TOKEN with
      // Bearer auth, so it always reported "Store Token not set".)
      const storeQueue = await getSecret('RFMS_STORE_QUEUE');
      const apiToken = await getSecret('RFMS_API_TOKEN');
      if (!storeQueue || !apiToken) return miss('Store Queue / API Token');
      const base = cfg.base_url || 'https://api.rfms.online/v2';
      const r = await fetch(`${base}/session/begin`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa(`${storeQueue}:${apiToken}`), 'Content-Type': 'application/json' },
      });
      const text = await r.text();
      if (!r.ok) return { ok: false, message: `RFMS session/begin failed (HTTP ${r.status}): ${text.slice(0, 160)}` };
      let d: any; try { d = JSON.parse(text); } catch { d = {}; }
      const sessionToken = d.sessionToken ?? d.result?.sessionToken;
      return sessionToken
        ? { ok: true, message: 'RFMS session established (Basic auth)' }
        : { ok: false, message: `session/begin returned no sessionToken: ${text.slice(0, 160)}` };
    }
    case 'ghl': {
      const token = await getSecret('GHL_PIT_TOKEN');
      if (!token) return miss('Private Integration Token');
      // Runtime + the seeded admin field use lowercase ghl_location_id (the old test read
      // GHL_LOCATION_ID, so it reported "Location ID not set" even when GHL worked).
      const locationId = cfg.ghl_location_id;
      if (!locationId) return { ok: false, message: 'Location ID (config) not set' };
      const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${locationId}&limit=1`, {
        headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' },
      });
      if (!r.ok) return { ok: false, message: `GHL v2 auth failed (HTTP ${r.status})` };
      return { ok: true, message: 'Connected to GHL v2 contacts' };
    }
    case 'assemblyai': {
      const k = await getSecret('ASSEMBLYAI_API_KEY');
      if (!k) return miss('API Key');
      const r = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', { headers: { authorization: k } });
      if (!r.ok) return { ok: false, message: `AssemblyAI auth failed (HTTP ${r.status})` };
      return { ok: true, message: 'Connected to AssemblyAI' };
    }
    case 'anthropic': {
      const k = await getSecret('ANTHROPIC_API_KEY');
      if (!k) return miss('API Key');
      const model = cfg.model || 'claude-sonnet-5';
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] }),
      });
      if (!r.ok) {
        const e = await r.text();
        return { ok: false, message: `Anthropic call failed (HTTP ${r.status})${r.status === 404 ? ` — model "${model}" not found?` : ''}: ${e.slice(0, 120)}` };
      }
      return { ok: true, message: `Connected. Model "${model}" responded.` };
    }
    case 'google': {
      const k = await getSecret('GOOGLE_MAPS_API_KEY');
      if (!k) return miss('Maps API Key');
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Phoenix,AZ&key=${k}`);
      const d = await r.json();
      if (d.status !== 'OK') return { ok: false, message: `Geocoding returned ${d.status}${d.error_message ? ': ' + d.error_message : ''}` };
      return { ok: true, message: 'Maps/Geocoding key works (Calendar/Sheets auth is separate)' };
    }
    case 'shortio': {
      const k = await getSecret('SHORTIO_API_KEY');
      if (!k) return miss('API Key');
      const r = await fetch('https://api.short.io/api/domains', { headers: { authorization: k, accept: 'application/json' } });
      if (!r.ok) return { ok: false, message: `Short.io auth failed (HTTP ${r.status})` };
      return { ok: true, message: 'Connected to Short.io' };
    }
    case 'callrail': {
      const k = await getSecret('CALLRAIL_API_KEY');
      if (!k) return miss('API Key');
      // The Authentication section documents the quoted form; the List Accounts
      // sample shows it unquoted. Both are accepted — use the documented one.
      const r = await fetch('https://api.callrail.com/v3/a.json?per_page=1', {
        headers: { Authorization: `Token token="${k}"` },
      });
      if (r.status === 401) return { ok: false, message: 'CallRail rejected that API key (401)' };
      if (!r.ok) return { ok: false, message: `CallRail returned HTTP ${r.status}${await detail(r)}` };
      const d = await r.json();
      const acct = (d.accounts || [])[0];
      if (!acct) return { ok: false, message: 'The key works, but no CallRail account is visible to it' };

      // A wrong Account ID is invisible until webhooks silently match nothing,
      // so check the one the admin typed against the one the key actually sees.
      const typed = String(cfg.callrail_account_id || '').trim();
      if (typed && typed !== acct.id) {
        return { ok: false, message: `Key works (${acct.name}), but the Account ID you entered is ${typed} and this key sees ${acct.id}` };
      }
      const hook = await getSecret('CALLRAIL_WEBHOOK_SECRET');
      return {
        ok: true,
        message: `Connected: ${acct.name} (${acct.id})`
          + (typed ? '' : ' · copy that id into Account ID')
          + (hook ? '' : ' · no webhook secret yet, so inbound calls cannot be verified'),
      };
    }

    case 'ringcentral': {
      const id = await getSecret('RC_CLIENT_ID');
      const secret = await getSecret('RC_CLIENT_SECRET');
      const jwt = await getSecret('RC_JWT');
      if (!id || !secret || !jwt) return miss('Client ID / Client Secret / JWT');
      const base = String(cfg.rc_server_url || 'https://platform.ringcentral.com').replace(/\/+$/, '');

      // The token endpoint is in RingCentral's "Auth" rate-limit group: 5 per
      // minute. Fine for a button a human presses, not for anything automated.
      const tok = await fetch(`${base}/restapi/oauth/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }),
      });
      if (!tok.ok) {
        const body = await tok.text();
        // OAU-250 is worded as "unsupported grant type" but almost always means
        // a sandbox JWT against production or the reverse.
        const hint = /OAU-250/.test(body)
          ? ` — that error usually means the JWT belongs to the other environment. This Server URL is ${base.includes('devtest') ? 'sandbox' : 'production'}.`
          : ` — ${body.slice(0, 200)}`;
        return { ok: false, message: `RingCentral rejected the JWT (HTTP ${tok.status})${hint}` };
      }
      const t = await tok.json();
      const ext = await fetch(`${base}/restapi/v1.0/account/~/extension/~`, {
        headers: { Authorization: `Bearer ${t.access_token}` },
      });
      const env = base.includes('devtest') ? 'sandbox' : 'production';
      if (!ext.ok) {
        // The credential is good — this is a scopes problem, and saying so saves
        // the admin from re-generating a JWT that was never the issue.
        return { ok: false, message: `Credentials are valid, but reading the extension failed (HTTP ${ext.status})${await detail(ext)} — check the app's permissions` };
      }
      const e = await ext.json();
      return { ok: true, message: `Connected to ${env} as ${e.name || e.extensionNumber || t.owner_id}` };
    }

    case 'google_ads': {
      const dev = await getSecret('GOOGLE_ADS_DEVELOPER_TOKEN');
      const cid = await getSecret('GOOGLE_ADS_CLIENT_ID');
      const csec = await getSecret('GOOGLE_ADS_CLIENT_SECRET');
      const refresh = await getSecret('GOOGLE_ADS_REFRESH_TOKEN');
      if (!dev || !cid || !csec || !refresh) return miss('Developer Token / OAuth client / Refresh Token');

      const tk = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token', client_id: cid, client_secret: csec, refresh_token: refresh,
        }),
      });
      if (!tk.ok) return { ok: false, message: `Google rejected the refresh token (HTTP ${tk.status})${await detail(tk)}` };
      const { access_token } = await tk.json();

      const V = 'v25';
      const la = await fetch(`https://googleads.googleapis.com/${V}/customers:listAccessibleCustomers`, {
        headers: { Authorization: `Bearer ${access_token}`, 'developer-token': dev },
      });
      if (!la.ok) return { ok: false, message: `Google Ads rejected the credentials (HTTP ${la.status})${await detail(la)}` };
      const { resourceNames = [] } = await la.json();

      // Google's docs are explicit that listAccessibleCustomers IGNORES
      // login-customer-id. So the call above proves the developer token and the
      // refresh token and NOTHING about the MCC or the account we will query.
      // Reporting it as a pass on its own would be a green light that means
      // nothing on the day spend fails to import.
      const target = digits(cfg.google_ads_customer_id);
      if (!target) {
        return { ok: true, message: `Credentials valid · ${resourceNames.length} account(s) reachable. Add a Customer ID to check the account we will actually read.` };
      }
      const mcc = digits(cfg.google_ads_login_customer_id);
      const q = await fetch(`https://googleads.googleapis.com/${V}/customers/${target}/googleAds:search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'developer-token': dev,
          'Content-Type': 'application/json',
          ...(mcc ? { 'login-customer-id': mcc } : {}),
        },
        body: JSON.stringify({ query: 'SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1' }),
      });
      if (!q.ok) {
        return {
          ok: false,
          message: `Credentials valid, but account ${target} is not readable${mcc ? ` through manager ${mcc}` : ''} (HTTP ${q.status})${await detail(q)}`,
        };
      }
      const qd = await q.json();
      const name = qd?.results?.[0]?.customer?.descriptiveName || target;
      return { ok: true, message: `Connected: ${name} (${target})${mcc ? ` via manager ${mcc}` : ''}` };
    }

    case 'meta': {
      const tok = await getSecret('META_SYSTEM_USER_TOKEN');
      if (!tok) return miss('System User Access Token');
      const V = String(cfg.meta_api_version || 'v25.0').trim();
      const auth = { Authorization: `Bearer ${tok}` };

      const me = await fetch(`https://graph.facebook.com/${V}/me?fields=id,name`, { headers: auth });
      if (!me.ok) {
        const d = await detail(me);
        // appsecret_proof is optional until someone flips it on in App Settings,
        // at which point every call starts failing for a reason the error text
        // does not make obvious.
        const hint = /appsecret_proof/i.test(d)
          ? ' — this app now requires appsecret_proof, which needs the App Secret stored as well'
          : '';
        return { ok: false, message: `Meta rejected the token (HTTP ${me.status})${d}${hint}` };
      }
      const who = await me.json();

      const acct = String(cfg.meta_ad_account_id || '').replace(/^act_/i, '').trim();
      if (!acct) return { ok: true, message: `Token valid for ${who.name || who.id}. Add an Ad Account ID to check ad access.` };
      const ad = await fetch(`https://graph.facebook.com/${V}/act_${acct}?fields=id,name,account_status`, { headers: auth });
      if (!ad.ok) return { ok: false, message: `Token valid, but ad account ${acct} is not reachable (HTTP ${ad.status})${await detail(ad)}` };
      const a = await ad.json();
      // 1 is ACTIVE; anything else means spend has stopped, which is worth
      // saying out loud on a page about marketing credentials.
      const state = a.account_status === 1 ? '' : ` · account status ${a.account_status} (not active)`;
      return { ok: a.account_status === 1, message: `Connected: ${a.name || acct}${state}` };
    }

    case 'ga4': {
      // Falls back to the Google APIs service account, which is the usual setup:
      // one service account granted on the GA4 property.
      const sa = (await getSecret('GA4_SA_JSON')) || (await getSecret('GOOGLE_SA_JSON'));
      if (!sa) return miss('Service Account JSON (here or on the Google APIs card)');

      const raw = String(cfg.ga4_property_id || '').trim();
      if (/^G-/i.test(raw)) {
        return { ok: false, configured: false, message: `${raw} is the Measurement ID. The Property ID is the numeric one (e.g. 123456789) — it is in GA Admin under Property Settings.` };
      }
      const prop = digits(raw);
      if (!prop) return { ok: false, configured: false, message: 'Property ID not set' };

      let email = '';
      let token: string;
      try {
        email = JSON.parse(sa)?.client_email || '';
        token = await googleToken(sa, ['https://www.googleapis.com/auth/analytics.readonly']);
      } catch (e) {
        return { ok: false, message: `That service account JSON could not be used: ${(e as Error).message}` };
      }

      // The Admin API rather than the Data API: it proves access to this exact
      // property, and it draws on a different quota pool than getMetadata, which
      // is charged against the same Core tokens the real reports will need.
      const r = await fetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${prop}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 403) {
        // By far the most common GA4 failure, and unguessable from "403".
        return {
          ok: false,
          message: `The key is valid but has no access to property ${prop}.`
            + (email ? ` In GA Admin, add ${email} to that property with the Viewer role.` : ''),
        };
      }
      if (r.status === 404) return { ok: false, message: `No GA4 property ${prop} — check the Property ID` };
      if (!r.ok) return { ok: false, message: `GA4 returned HTTP ${r.status}${await detail(r)}` };
      const p = await r.json();
      return { ok: true, message: `Connected: ${p.displayName || prop}${p.currencyCode ? ` (${p.currencyCode})` : ''}` };
    }

    default:
      return { ok: false, message: `No test implemented for "${key}"` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    const svc = service();
    const { data: ures } = await svc.auth.getUser(jwt);
    const uid = ures?.user?.id;
    if (!uid) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
    const { data: au } = await svc.from('app_user').select('is_org_admin').eq('id', uid).maybeSingle();
    if (!au?.is_org_admin) return Response.json({ error: 'Admin only' }, { status: 403, headers: cors });

    const { integration } = await req.json();
    if (!integration) return Response.json({ error: 'integration required' }, { status: 400, headers: cors });

    const { data: row } = await svc.from('integration').select('config').eq('key', integration).single();
    const cfg = (row?.config as Record<string, any>) || {};

    let result: Result;
    try { result = await testProvider(integration, cfg); }
    catch (e) { result = { ok: false, message: (e as Error).message }; }

    const status = result.ok ? 'verified' : (result.configured === false ? 'not_configured' : 'error');
    await svc.from('integration')
      .update({ status, last_tested_at: new Date().toISOString(), last_error: result.ok ? null : result.message })
      .eq('key', integration);

    return Response.json(result, { headers: cors });
  } catch (error) {
    return Response.json({ ok: false, message: (error as Error).message }, { status: 500, headers: cors });
  }
});
