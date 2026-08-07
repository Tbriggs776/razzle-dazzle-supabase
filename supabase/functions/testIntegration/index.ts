// Admin-only: verify a provider's stored credentials with one cheap authenticated
// call, and record the result on the integration row. Powers the "Test" button in
// the Integrations admin page. Self-contained (no shared import) for a clean deploy.
import { createClient } from 'jsr:@supabase/supabase-js@2';

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
      const token = await getSecret('RFMS_BEARER_TOKEN');
      if (!token) return miss('Store Token');
      const scheme = (cfg.auth_scheme || 'Bearer').trim();
      const r = await fetch('https://api.rfms.online/v2/session/begin', {
        method: 'POST', headers: { Authorization: `${scheme} ${token}`, 'Content-Type': 'application/json' },
      });
      if (!r.ok) return { ok: false, message: `RFMS session/begin failed with ${scheme} auth (HTTP ${r.status}) — try the other scheme` };
      return { ok: true, message: `Session established using ${scheme} auth` };
    }
    case 'ghl': {
      const token = await getSecret('GHL_PIT_TOKEN');
      if (!token) return miss('Private Integration Token');
      if (!cfg.GHL_LOCATION_ID) return { ok: false, message: 'Location ID (config) not set' };
      const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${cfg.GHL_LOCATION_ID}&limit=1`, {
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
