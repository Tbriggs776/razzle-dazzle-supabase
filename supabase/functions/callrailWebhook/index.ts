// CallRail webhook receiver: post-call, call-modified and text-message events.
//
// SIGNATURE, verified against CallRail's own published test vector rather than
// assumed. Their docs give a key and a payload whose signature must be
// UZAHbUdfm3GqL7qzilGozGzWV64=; selfTest() below reproduces it, so a wrong algorithm
// fails here instead of silently 401-ing every real call.
//
//   header:     Signature
//   algorithm:  HMAC-SHA1 over the RAW request body
//   encoding:   base64
//   key:        the company signing key from CallRail's Webhooks settings page
//
// This was worth checking. The GHL webhook in this repo was written reading one
// header and verifying it with the other's algorithm, which would have rejected every
// genuine delivery while looking perfectly correct in review.
//
// FAILS CLOSED. No secret configured means every request is rejected. A webhook that
// accepts unsigned posts is an open write endpoint for anyone who learns the URL, and
// this one can create leads.
//
// LEAD CREATION IS OFF BY DEFAULT. Set integration.config.callrail_create_leads = true
// to turn it on. Until then an unrecognised caller is logged as a communication with
// no lead attached, which is a record rather than a new row in somebody's work queue.
// Turning it on is a deliberate act because leads feed the CSR queue.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function getSecret(s: any, name: string): Promise<string | null> {
  const { data, error } = await s.rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

/** HMAC-SHA1(rawBody, key) as base64 — CallRail's scheme, exactly. */
async function sign(key: string, raw: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/**
 * CallRail's published test vector. If this ever stops matching, the signing scheme
 * has changed and every real delivery is about to be rejected -- better to find out
 * from a health check than from a week of missing calls.
 */
const VECTOR_KEY = '072e77e426f92738a72fe23c4d1953b4';
const VECTOR_SIG = 'UZAHbUdfm3GqL7qzilGozGzWV64=';
const VECTOR_BODY = "{\"answered\":false,\"business_phone_number\":\"\",\"call_type\":\"voicemail\",\"company_id\":155920786,\"company_name\":\"Boost Marketing\",\"company_time_zone\":\"America/Los_Angeles\",\"created_at\":\"2018-02-19T13:41:00.252-05:00\",\"customer_city\":\"Rochester\",\"customer_country\":\"US\",\"customer_name\":\"Kaylah Mills\",\"customer_phone_number\":\"+12148654559\",\"customer_state\":\"PA\",\"device_type\":\"\",\"direction\":\"inbound\",\"duration\":\"13\",\"first_call\":false,\"formatted_call_type\":\"Voicemail\",\"formatted_customer_location\":\"Rochester, PA\",\"formatted_business_phone_number\":\"\",\"formatted_customer_name\":\"Kaylah Mills\",\"prior_calls\":16,\"formatted_customer_name_or_phone_number\":\"Kaylah Mills\",\"formatted_customer_phone_number\":\"214-865-4559\",\"formatted_duration\":\"13s\",\"formatted_tracking_phone_number\":\"404-555-8514\",\"formatted_tracking_source\":\"Google Paid\",\"formatted_value\":\"--\",\"good_lead_call_id\":715587840,\"good_lead_call_time\":\"2016-06-17T10:23:33.363-04:00\",\"id\":766970532,\"lead_status\":\"previously_marked_good_lead\",\"note\":\"\",\"recording\":\"https://app.callrail.com/calls/766970532/recording/redirect?access_key=aaaaccccddddeeee\",\"recording_duration\":8,\"source_name\":\"Google AdWords\",\"start_time\":\"2018-02-19T13:41:00.236-05:00\",\"tags\":[],\"total_calls\":17,\"tracking_phone_number\":\"+14045558514\",\"transcription\":\"\",\"value\":\"\",\"voicemail\":true,\"tracker_id\":354024023,\"keywords\":\"\",\"medium\":\"\",\"referring_url\":\"\",\"landing_page_url\":\"\",\"last_requested_url\":\"\",\"referrer_domain\":\"\",\"conversational_transcript\":\"\",\"utm_source\":\"google\",\"utm_medium\":\"cpc\",\"utm_term\":\"\",\"utm_content\":\"\",\"utm_campaign\":\"Google AdWords\",\"utma\":\"\",\"utmb\":\"\",\"utmc\":\"\",\"utmv\":\"\",\"utmz\":\"\",\"ga\":\"\",\"gclid\":\"\",\"integration_data\":[{\"integration\":\"Webhooks\",\"data\":null}],\"keywords_spotted\":\"\",\"recording_player\":\"https://app.callrail.com/calls/766970532/recording?access_key=aaaabbbbccccdddd\",\"speaker_percent\":\"\",\"call_highlights\":[],\"callercity\":\"Rochester\",\"callercountry\":\"US\",\"callername\":\"Kaylah Mills\",\"callernum\":\"+12148654559\",\"callerstate\":\"PA\",\"callsource\":\"google_paid\",\"campaign\":\"\",\"custom\":\"\",\"datetime\":\"2018-02-19 18:41:00\",\"destinationnum\":\"\",\"ip\":\"\",\"kissmetrics_id\":\"\",\"landingpage\":\"\",\"referrer\":\"\",\"referrermedium\":\"\",\"score\":1,\"tag\":\"\",\"trackingnum\":\"+14045558514\",\"timestamp\":\"2018-02-19T13:41:00.236-05:00\"}";

/** Constant-time compare, so a wrong signature cannot be discovered byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const e164 = (v: unknown) => {
  const d = digits(v);
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const s = svc();
  const raw = await req.text();

  try {
    // Health probe: prove the signing implementation still matches CallRail's vector.
    if (new URL(req.url).searchParams.get('selftest') === '1') {
      const got = await sign(VECTOR_KEY, VECTOR_BODY);
      return Response.json({
        vector_ok: got === VECTOR_SIG,
        note: got === VECTOR_SIG
          ? 'signing matches CallRail published vector'
          : 'SIGNING SCHEME HAS CHANGED — real deliveries will be rejected',
      }, { status: got === VECTOR_SIG ? 200 : 500, headers: cors });
    }

    const secret = await getSecret(s, 'CALLRAIL_WEBHOOK_SECRET');
    if (!secret) {
      // Fail closed and say why. An unsigned-accepting webhook that can create leads
      // is an open write endpoint for anyone who learns the URL.
      return Response.json({ error: 'CALLRAIL_WEBHOOK_SECRET not configured — refusing unsigned webhooks' }, { status: 503, headers: cors });
    }

    const provided = req.headers.get('Signature') ?? req.headers.get('signature') ?? '';
    const expected = await sign(secret, raw);
    if (!provided || !safeEqual(provided.trim(), expected)) {
      return Response.json({ error: 'bad signature' }, { status: 401, headers: cors });
    }

    const p = JSON.parse(raw || '{}');

    // Text-message events carry message_type; calls do not. Acknowledge the ones we
    // do not store yet rather than 500-ing, or CallRail will retry them forever.
    if (p.message_type || p.media_urls) {
      return Response.json({ ok: true, ignored: 'text message webhook — not stored yet' }, { headers: cors });
    }
    const callId = String(p.id ?? '').trim();
    if (!callId) return Response.json({ ok: true, ignored: 'no call id in payload' }, { headers: cors });

    const { data: integ } = await s.from('integration').select('config').eq('key', 'callrail').maybeSingle();
    const cfg = (integ?.config ?? {}) as Record<string, unknown>;
    const mayCreateLeads = cfg.callrail_create_leads === true;

    const phone = e164(p.customer_phone_number);
    const inbound = String(p.direction ?? 'inbound').toLowerCase() !== 'outbound';

    // Find the lead. Phone is the reliable key; CallRail's person id is only present
    // on some event types, so it is a fallback rather than the primary match.
    let leadId: string | null = null;
    if (phone) {
      const { data } = await s.from('lead').select('id').eq('phone_e164', phone).limit(1).maybeSingle();
      leadId = data?.id ?? null;
    }

    let leadCreated = false;
    if (!leadId && mayCreateLeads && phone && inbound) {
      const { data, error } = await s.rpc('upsert_lead', {
        p_lead: {
          phone,
          first_name: String(p.customer_name ?? '').split(' ')[0] || null,
          last_name: String(p.customer_name ?? '').split(' ').slice(1).join(' ') || null,
          city: p.customer_city ?? null,
          state: p.customer_state ?? null,
          source_channel: 'inbound_call',
          source_campaign: p.campaign ?? p.utm_campaign ?? null,
          source_name: p.source_name ?? null,
          callrail_tracker_id: p.tracker_id ? String(p.tracker_id) : null,
          callrail_company_id: p.company_id ? String(p.company_id) : null,
        },
      });
      if (error) console.error('upsert_lead failed', error.message);
      else { leadId = (data as any)?.lead_id ?? null; leadCreated = !!(data as any)?.created; }
    }

    // One row per call. communication_callrail_id_uniq makes a replay a no-op rather
    // than a duplicate -- CallRail retries, and a call logged twice inflates the
    // attempt count that drives the CSR follow-up cadence.
    const row = {
      id: `cr_${callId}`,
      type: 'Call',
      direction: inbound ? 'inbound' : 'outbound',
      status: inbound ? 'received' : 'sent',
      lead_id: leadId,
      contact_phone: phone,
      contact_name: p.customer_name ?? null,
      body: p.transcription ?? p.note ?? null,
      subject: p.formatted_call_type ?? p.call_type ?? null,
      provider: 'callrail',
      provider_message_id: callId,
      callrail_id: callId,
      callrail_recording_id: p.recording ? String(p.recording).split('/').pop() ?? null : null,
      tracking_phone_number: p.tracking_phone_number ?? null,
      source_name: p.source_name ?? null,
      campaign_name: p.campaign ?? p.utm_campaign ?? null,
      answered: p.answered === true,
      duration_seconds: Number.isFinite(Number(p.duration)) ? Number(p.duration) : null,
      voicemail: String(p.call_type ?? '').toLowerCase() === 'voicemail' || p.voicemail === true,
      started_at: p.start_time ?? p.created_at ?? null,
      sent_by: 'CallRail',
    };

    const { error: writeErr } = await s.from('communication')
      .upsert(row, { onConflict: 'callrail_id', ignoreDuplicates: false });
    if (writeErr) {
      console.error('communication write failed', writeErr.message);
      return Response.json({ error: writeErr.message }, { status: 500, headers: cors });
    }

    return Response.json({
      ok: true, call_id: callId, lead_id: leadId, lead_created: leadCreated,
      lead_creation_enabled: mayCreateLeads,
    }, { headers: cors });
  } catch (e) {
    console.error('callrailWebhook', (e as Error).message);
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
