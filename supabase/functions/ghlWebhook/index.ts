// GoHighLevel Marketplace — webhook receiver.
//
// Turns GHL contact events into leads in the CSR queue, and keeps the install
// record honest. Subscribed events: INSTALL, UNINSTALL, ContactCreate,
// ContactUpdate, ContactDelete, ContactDndUpdate.
//
// SIGNATURE VERIFICATION IS THE WHOLE SECURITY MODEL. This endpoint deploys
// with verify_jwt = false (GHL cannot present a Supabase JWT), so without a
// signature check anyone who guessed the URL could POST fabricated contacts
// straight into the lead table. GHL signs with Ed25519 over the raw body; we
// verify against GHL_WEBHOOK_PUBLIC_KEY before looking at the payload at all.
// If that key is absent the endpoint REFUSES every request rather than
// falling open — an unverified lead is worse than a missed one.
//
// DELIVERY IS AT-LEAST-ONCE AND OUT OF ORDER. A ContactUpdate can arrive before
// its ContactCreate, and anything can arrive twice. Both are fine here because
// upsert_lead is keyed on identity (phone → email → ghl_contact_id), so every
// event is treated as an upsert rather than assuming create-then-update.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { decodeBase64 } from 'jsr:@std/encoding/base64';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-wh-signature, x-ghl-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function getSecret(s: any, name: string): Promise<string | null> {
  const { data, error } = await s.rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

/** Ed25519 verify over the RAW body — re-serialised JSON would not match. */
async function verifySignature(raw: string, sigB64: string, pubKeyPem: string): Promise<boolean> {
  try {
    const der = decodeBase64(
      pubKeyPem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, ''),
    );
    const key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify(
      { name: 'Ed25519' }, key, decodeBase64(sigB64), new TextEncoder().encode(raw),
    );
  } catch (e) {
    console.error('signature verify threw', (e as Error).message);
    return false;
  }
}

/**
 * GHL's contact shape → upsert_lead's shape.
 *
 * source_channel is NOT "ghl". The channel column answers "how did this person
 * reach us" (web form, inbound call, referral), not "which system told us" —
 * and lead_source_channel rejects anything outside its whitelist, which would
 * fail the whole webhook. So GHL's free-text source is mapped onto the known
 * channels and anything unrecognised falls through to 'unattributed', which
 * upsert_lead treats as "unset" so a real channel can still fill it later.
 */
const CHANNEL_BY_SOURCE: Record<string, string> = {
  'form submission': 'web_form', form: 'web_form', 'survey submission': 'web_form',
  website: 'web_form', 'landing page': 'web_form', funnel: 'web_form',
  'phone call': 'inbound_call', call: 'inbound_call', 'inbound call': 'inbound_call',
  sms: 'sms', 'text message': 'sms',
  facebook: 'social', instagram: 'social', 'facebook lead form': 'social',
  'google my business': 'social', tiktok: 'social',
  chat: 'chat', 'live chat': 'chat', 'chat widget': 'chat',
  referral: 'referral', 'walk in': 'walk_in', 'walk-in': 'walk_in',
};

function toLead(c: any, locationId: string | null) {
  const src = String(c.source ?? c.attributionSource?.sessionSource ?? '').trim().toLowerCase();
  const attr = c.attributionSource ?? c.attributions?.[0] ?? {};
  return {
    first_name: c.firstName ?? c.first_name ?? null,
    last_name: c.lastName ?? c.last_name ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    address_line1: c.address1 ?? c.address ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
    zip: c.postalCode ?? c.postal_code ?? null,
    source_channel: CHANNEL_BY_SOURCE[src] ?? 'unattributed',
    source_campaign: attr.campaign ?? attr.utmCampaign ?? null,
    source_medium: attr.medium ?? attr.utmMedium ?? null,
    utm_source: attr.utmSource ?? null,
    utm_medium: attr.utmMedium ?? null,
    utm_campaign: attr.campaign ?? attr.utmCampaign ?? null,
    utm_content: attr.utmContent ?? null,
    utm_term: attr.utmTerm ?? null,
    gclid: attr.gclid ?? null,
    fbclid: attr.fbclid ?? null,
    fbp: attr.fbp ?? null,
    fbc: attr.fbc ?? null,
    ghl_contact_id: c.id ?? c.contactId ?? null,
    ghl_location_id: locationId,
    source_created_at: c.dateAdded ?? c.createdAt ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });
  }

  const s = svc();
  const raw = await req.text();

  // ── Gate 1: signature. Nothing below runs on an unverified body. ──────────
  const pubKey = await getSecret(s, 'GHL_WEBHOOK_PUBLIC_KEY');
  if (!pubKey) {
    console.error('GHL_WEBHOOK_PUBLIC_KEY is not set — refusing webhook');
    return Response.json({ error: 'Webhook verification is not configured' }, { status: 503, headers: cors });
  }
  const sig = req.headers.get('x-wh-signature') ?? req.headers.get('x-ghl-signature') ?? '';
  if (!sig || !(await verifySignature(raw, sig, pubKey))) {
    return Response.json({ error: 'Bad signature' }, { status: 401, headers: cors });
  }

  let evt: any;
  try { evt = JSON.parse(raw); } catch {
    return Response.json({ error: 'Body is not JSON' }, { status: 400, headers: cors });
  }

  const type = String(evt.type ?? evt.eventType ?? '').trim();
  const locationId = evt.locationId ?? evt.location_id ?? evt.companyId ?? null;
  const eventId = evt.webhookId ?? evt.id ?? null;
  const contact = evt.contact ?? (type.startsWith('Contact') ? evt : null);
  const contactId = contact?.id ?? evt.contactId ?? null;

  // ── Gate 2: replay. A duplicate delivery must not create a second lead. ───
  const { error: logErr } = await s.from('ghl_webhook_event').insert({
    event_id: eventId, event_type: type || 'unknown', location_id: locationId,
    contact_id: contactId, payload: evt,
  });
  if (logErr && /duplicate key/i.test(logErr.message)) {
    return Response.json({ ok: true, duplicate: true }, { headers: cors });
  }

  const finish = async (result: Record<string, unknown>, error?: string) => {
    if (eventId) {
      await s.from('ghl_webhook_event')
        .update({ handled: !error, result, error: error ?? null })
        .eq('event_id', eventId);
    }
    // Always 200 on a handled-but-unwanted event: a non-2xx makes GHL retry
    // forever on something we are never going to want.
    return Response.json({ ok: !error, ...result }, { status: 200, headers: cors });
  };

  try {
    switch (type) {
      case 'INSTALL':
        // The OAuth callback already wrote the tokens; this is the belt to that
        // braces, and covers an install that reached us by another route.
        if (locationId) {
          await s.from('ghl_install').upsert(
            { location_id: locationId, company_id: evt.companyId ?? null,
              uninstalled_at: null, updated_date: new Date().toISOString() },
            { onConflict: 'location_id' });
        }
        return await finish({ action: 'install_recorded', locationId });

      case 'UNINSTALL':
        // Stop using the tokens immediately. The row is kept (not deleted) so a
        // later reinstall is distinguishable from a first install.
        if (locationId) {
          await s.from('ghl_install').update({
            uninstalled_at: new Date().toISOString(),
            access_token: null, refresh_token: null,
            updated_date: new Date().toISOString(),
          }).eq('location_id', locationId);
        }
        return await finish({ action: 'uninstalled', locationId });

      case 'ContactCreate':
      case 'ContactUpdate': {
        if (!contact) return await finish({ action: 'ignored', reason: 'no contact on payload' });
        const payload = toLead(contact, locationId);
        if (!payload.phone && !payload.email && !payload.ghl_contact_id) {
          return await finish({ action: 'skipped', reason: 'no reachable identifier' });
        }
        const { data, error } = await s.rpc('upsert_lead', { p_lead: payload });
        if (error) return await finish({ action: 'failed' }, error.message);
        return await finish({ action: 'lead_upserted', ...(data as object) });
      }

      case 'ContactDndUpdate': {
        // An opt-out has to stop outbound contact. The lead table has no DND
        // column, so this is recorded on the event log only and deliberately
        // NOT silently dropped — see the note in the PR. Wiring it to a real
        // suppression flag is a follow-up, not something to fake here.
        return await finish({
          action: 'dnd_noted', contactId,
          note: 'no suppression field on lead yet — event retained for follow-up',
        });
      }

      case 'ContactDelete':
        return await finish({ action: 'delete_noted', contactId,
          note: 'leads are not deleted here; the record stays with its history' });

      default:
        return await finish({ action: 'ignored', type });
    }
  } catch (e) {
    return await finish({ action: 'error' }, (e as Error).message);
  }
});
