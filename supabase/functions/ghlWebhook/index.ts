// GoHighLevel Marketplace — webhook receiver.
//
// Turns GHL contact events into leads in the CSR queue, and keeps the install
// record honest. Subscribed events: INSTALL, UNINSTALL, ContactCreate,
// ContactUpdate, ContactDelete, ContactDndUpdate.
//
// SIGNATURE VERIFICATION IS THE WHOLE SECURITY MODEL. This endpoint deploys
// with verify_jwt = false (GHL cannot present a Supabase JWT), so without a
// signature check anyone who guessed the URL could POST fabricated contacts
// straight into the lead table.
//
// GHL SENDS TWO SIGNATURES USING TWO DIFFERENT ALGORITHMS, and pairing the
// wrong one with the wrong key rejects every event:
//     x-ghl-signature  ->  Ed25519      (current; prefer whenever present)
//     x-wh-signature   ->  RSA-SHA256   (legacy, deprecated 2026-09-01)
// Both are base64 over the RAW body, which is why the body is read as text and
// never round-tripped through JSON.parse -- re-serialising changes bytes and
// breaks the signature.
//
// Both public keys are PUBLISHED BY GHL AND ARE NOT SECRETS, so they are baked
// in below: a missing environment variable must not be able to take lead
// ingest offline. Either can still be overridden by a stored secret if GHL
// rotates one. An unverified lead is worse than a missed one, so a body that
// carries no recognised signature is refused rather than trusted.
//
// MESSAGES ARRIVE HERE LIVE. InboundMessage/OutboundMessage are written straight
// into ghl_message, which is the same table ghlSync backfills history into --
// history and the leading edge meet in one corpus. ghl_replay_message_webhooks()
// exists as a reconciler over ghl_webhook_event in case this path ever misses one.
//
// AN OPT-OUT HAS TO ACTUALLY STOP OUTBOUND. GHL's DND state is pushed into
// public.suppression, which sendMessage already checks before every send, so a
// customer who switches DND on in GHL stops receiving texts and email from here
// too. See readDnd/applyDnd below for the semantics and the one-way rule.
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

// GHL's published verification keys. Public by definition -- these appear in
// the vendor's own docs and identify GHL to us, they do not authenticate us to
// anyone. Checked in deliberately so ingest cannot break on a missing env var.
const GHL_ED25519_PUB = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

const GHL_RSA_PUB = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

const pemToDer = (pem: string) =>
  decodeBase64(pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, ''));

/**
 * Verify a base64 signature over the RAW body.
 *
 * `alg` must match the header the signature came from -- Ed25519 for
 * x-ghl-signature, RSA-SHA256 for x-wh-signature. Verifying one with the
 * other's key fails 100% of the time, which reads exactly like a hostile
 * caller, so the two are never allowed to drift apart in the caller below.
 */
async function verifySignature(
  raw: string, sigB64: string, pubKeyPem: string, alg: 'ed25519' | 'rsa',
): Promise<boolean> {
  try {
    const params = alg === 'ed25519'
      ? { name: 'Ed25519' }
      : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const key = await crypto.subtle.importKey(
      'spki', pemToDer(pubKeyPem), params, false, ['verify'],
    );
    return await crypto.subtle.verify(
      params.name, key, decodeBase64(sigB64), new TextEncoder().encode(raw),
    );
  } catch (e) {
    console.error(`signature verify threw (${alg})`, (e as Error).message);
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

const GHL_DND_REASON = 'ghl_dnd';

/**
 * Phone -> E.164, byte-identical to sendMessage's normE164.
 *
 * THIS HAS TO MATCH OR THE SUPPRESSION IS INERT. normalize_contact() keys SMS
 * rows on digits only, so "(480) 555-0111" stores as 4805550111 while
 * "+14805550111" stores as 14805550111 -- different rows. sendMessage converts
 * every destination to E.164 before it checks is_suppressed, so a suppression
 * written from an un-normalised number is never found and silently suppresses
 * nothing. Deliberately duplicated rather than imported: _shared has no comms
 * module, and a copy that is wrong is far more obvious than an import that
 * drifts.
 */
function normE164(p: unknown): string | null {
  if (!p) return null;
  const v = String(p).trim();
  if (v.startsWith('+')) return v;
  const digits = v.replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`;
}

/**
 * GHL's DND state -> the channels this system can actually act on.
 *
 * SEMANTICS, because inverting this is the whole ballgame: in GHL a channel
 * whose status is 'active' has DND ACTIVE -- do NOT contact. 'inactive' means
 * sending is allowed. The top-level `dnd` boolean is a blanket override that
 * turns every channel off at once.
 *
 * dndSettings also covers Call, WhatsApp, GMB and FB. There is no outbound path
 * for any of those here -- sendMessage speaks only 'sms' and 'email', which is
 * also all public.suppression's check constraint permits -- so they are reported
 * on the event log rather than written somewhere nothing reads and mistaken for
 * enforcement.
 */
function readDnd(c: any): { sms: boolean; email: boolean; unenforced: string[] } {
  const settings = c?.dndSettings ?? {};
  const statusOf = (name: string) => {
    const key = Object.keys(settings).find((k) => k.toLowerCase() === name.toLowerCase());
    return String((key ? settings[key]?.status : '') ?? '').toLowerCase();
  };
  const blanket = c?.dnd === true;
  const on = (name: string) => blanket || statusOf(name) === 'active';
  return {
    sms: on('SMS'),
    email: on('Email'),
    unenforced: ['Call', 'WhatsApp', 'GMB', 'FB'].filter(on),
  };
}

/**
 * Push that state into public.suppression -- the table sendMessage consults
 * before dispatching anything.
 *
 * RETRACTION IS ONE-WAY ON PURPOSE. Turning DND off in GHL clears only the
 * suppression GHL itself created, via remove_suppression_reason. It must never
 * delete an 'sms_stop' row, because that one came from the customer texting
 * STOP to the carrier, and a third-party UI toggle is not consent to resume.
 */
async function applyDnd(s: any, c: any, contactId: string | null) {
  const dnd = readDnd(c);

  // A suppression keyed on nothing suppresses nothing, so if the payload omits
  // an address fall back to the lead already on file rather than no-op quietly.
  let phone: string | null = c?.phone ?? null;
  let email: string | null = c?.email ?? null;
  if ((!phone || !email) && contactId) {
    const { data } = await s.from('lead')
      .select('phone_e164, phone, email').eq('ghl_contact_id', contactId).limit(1).maybeSingle();
    // phone_e164 is the generated column; `phone` is raw as the CSR typed it.
    phone = phone ?? data?.phone_e164 ?? data?.phone ?? null;
    email = email ?? data?.email ?? null;
  }

  const out: Record<string, unknown> = {
    sms: dnd.sms, email: dnd.email,
    ...(dnd.unenforced.length ? { noted_only: dnd.unenforced } : {}),
  };

  for (const [channel, raw, suppress] of [
    ['sms', phone, dnd.sms],
    ['email', email, dnd.email],
  ] as const) {
    const value = channel === 'sms' ? normE164(raw) : raw;
    if (!value) { out[`${channel}_action`] = raw ? 'unusable address' : 'no address'; continue; }
    const { error } = await s.rpc(
      suppress ? 'add_suppression' : 'remove_suppression_reason',
      { p_channel: channel, p_value: value, p_reason: GHL_DND_REASON },
    );
    if (error) {
      console.error(`dnd ${channel} write failed`, error.message);
      out[`${channel}_action`] = `failed: ${error.message}`;
    } else {
      out[`${channel}_action`] = suppress ? 'suppressed' : 'released';
    }
  }
  return out;
}

// A medium is a small closed vocabulary. GHL's attributionSource.medium is the
// INTEGRATION that created the contact -- "zapier", "survey", "manual", "form" -- not
// a marketing medium, and mapping it into source_medium put plumbing into an
// attribution column on 139 leads before anyone looked. Anything outside the
// vocabulary is something that wandered into the wrong field; drop it rather than
// store it, because a wrong value is worse than an empty one in a report.
const MEDIA = new Set([
  'cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'social', 'organic', 'email',
  'referral', 'direct', 'display', 'video', 'affiliate', 'sms', 'none',
]);
const medium = (v: unknown) => {
  const m = String(v ?? '').trim().toLowerCase();
  return MEDIA.has(m) ? m : null;
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
    // The two columns have different jobs, and conflating them is what caused this.
    //   source_medium  Razzle's NORMALISED medium -- trustworthy for reporting, so it
    //                  takes utmMedium first (the real medium) and drops anything
    //                  outside the vocabulary rather than storing plumbing.
    //   utm_medium     the RAW utm_medium as received, kept verbatim even when the
    //                  advertiser has stuffed an ad-set name in it. It is the raw
    //                  truth of what arrived, and 20 existing leads carry Facebook
    //                  ad-set names there that appear in no other column -- dropping
    //                  new ones would lose that dimension for the sake of tidiness.
    source_medium: medium(attr.utmMedium) ?? medium(attr.medium),
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
  // Header choice picks the algorithm; the algorithm picks the key. Ed25519
  // first because GHL prefers it and the RSA header retires 2026-09-01.
  const edSig = req.headers.get('x-ghl-signature');
  const rsaSig = req.headers.get('x-wh-signature');
  const attempt = edSig
    ? { sig: edSig, alg: 'ed25519' as const, key: await getSecret(s, 'GHL_WEBHOOK_PUBLIC_KEY') ?? GHL_ED25519_PUB }
    : rsaSig
    ? { sig: rsaSig, alg: 'rsa' as const, key: await getSecret(s, 'GHL_WEBHOOK_RSA_PUBLIC_KEY') ?? GHL_RSA_PUB }
    : null;

  if (!attempt) {
    console.error('webhook carried neither x-ghl-signature nor x-wh-signature');
    return Response.json({ error: 'Unsigned request' }, { status: 401, headers: cors });
  }
  if (!(await verifySignature(raw, attempt.sig, attempt.key, attempt.alg))) {
    console.error(`webhook failed ${attempt.alg} verification`);
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
        // DND travels on ordinary contact events too. Reading it only from
        // ContactDndUpdate would leave anyone who opted out BEFORE this app was
        // installed un-suppressed until they happened to toggle it again.
        const dnd = await applyDnd(s, contact, contactId);
        return await finish({ action: 'lead_upserted', ...(data as object), dnd });
      }

      case 'ContactDndUpdate': {
        if (!contact) return await finish({ action: 'ignored', reason: 'no contact on payload' });
        return await finish({ action: 'dnd_applied', contactId, ...(await applyDnd(s, contact, contactId)) });
      }

      case 'InboundMessage':
      case 'OutboundMessage': {
        // Live messages. The backfill in ghlSync walks history; this is the
        // leading edge, so a text sent thirty seconds ago is already in the
        // corpus rather than waiting for the next sweep.
        const convId = evt.conversationId ?? null;
        const msgId = evt.messageId ?? evt.id ?? null;
        if (!convId || !msgId) {
          return await finish({ action: 'skipped', reason: 'no conversationId or messageId' });
        }

        // The message needs its conversation to exist (FK). Insert a stub ONLY
        // if the corpus has never seen this thread — ignoreDuplicates keeps an
        // existing row's richer `raw` from the sweep instead of flattening it
        // to a single message event.
        await s.from('ghl_conversation').upsert(
          { id: convId, location_id: locationId ?? 'unknown', contact_id: contactId, raw: evt },
          { onConflict: 'id', ignoreDuplicates: true },
        );

        // Resolve the customer now rather than leaving it to the next sweep, so
        // a live message is attached the moment it lands. The conversation's own
        // lead is authoritative; falling back to the contact id covers a thread
        // this webhook just created.
        const { data: conv } = await s.from('ghl_conversation')
          .select('lead_id').eq('id', convId).maybeSingle();
        let leadId: string | null = conv?.lead_id ?? null;
        if (!leadId && contactId) {
          const { data: l } = await s.from('lead')
            .select('id').eq('ghl_contact_id', contactId).limit(1).maybeSingle();
          leadId = l?.id ?? null;
        }

        const rawSent = evt.dateAdded ?? evt.timestamp ?? null;
        const sentAt = rawSent ? new Date(rawSent).toISOString() : new Date().toISOString();

        const { error: mErr } = await s.from('ghl_message').upsert({
          id: msgId,
          conversation_id: convId,
          location_id: locationId,
          contact_id: contactId,
          lead_id: leadId,
          direction: evt.direction ?? null,
          // messageType is absent on some events; messageTypeString carries it.
          message_type: evt.messageType ?? evt.messageTypeString ?? null,
          status: evt.status ?? null,
          body: evt.body ?? null,
          sent_at: sentAt,
          raw: evt,
        }, { onConflict: 'id' });
        if (mErr) return await finish({ action: 'failed' }, mErr.message);

        // Keep the thread summary current so ordering is right immediately,
        // without waiting for the sweep to come back round.
        await s.from('ghl_conversation').update({
          last_message_at: sentAt,
          last_message_type: evt.messageType ?? evt.messageTypeString ?? null,
          last_message_body: evt.body ?? null,
          updated_date: new Date().toISOString(),
        }).eq('id', convId);

        return await finish({
          action: 'message_stored', conversationId: convId, messageId: msgId,
          linked_to_lead: !!leadId,
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
