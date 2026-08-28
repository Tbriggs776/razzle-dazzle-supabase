// Unified outbound message path. One code path for all SMS/email:
//   check integration enabled -> check suppression -> write a "queued"
//   communication row -> send via the provider -> update the row with the
//   provider message id + delivery_status. Delivery/bounce webhooks later flip
//   that row to delivered/failed/bounced.
// Internal-secret gated (x-internal-secret == CRON_SECRET) — called by
// processJobs handlers and other server-side code, never the browser.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

async function insertComm(s: any, row: Record<string, unknown>) {
  const { data } = await s.from('communication').insert(row).select('id').single();
  return data?.id as string | undefined;
}

// Normalize a phone to E.164 (assume US when no country code). Applied to every SMS
// destination here — the single choke point — so cron reminder/follow-up jobs that enqueue
// raw lead phones like "(602) 555-0100" (which Twilio rejects) send successfully, and so the
// suppression check keys on the same E.164 value that inbound STOP webhooks record.
function normE164(p: unknown): string | null {
  if (!p) return null;
  const s = String(p).trim();
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`;
}

/** Wall-clock minutes since midnight in a named timezone. */
function tzNowMinutes(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((x) => x.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((x) => x.type === 'minute')?.value ?? '0');
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function hhmmToMinutes(v: string): number {
  const [h, m] = String(v || '0:0').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * If we are currently inside quiet hours, return the moment they end; otherwise
 * null. Handles the usual window that wraps midnight (20:00 → 08:00).
 */
function quietHoldUntil(cfg: any): Date | null {
  const tz = cfg.quiet_hours_timezone || 'America/Phoenix';
  const now = tzNowMinutes(tz);
  const start = hhmmToMinutes(cfg.quiet_hours_start || '20:00');
  const end = hhmmToMinutes(cfg.quiet_hours_end || '08:00');
  const inside = start <= end ? (now >= start && now < end) : (now >= start || now < end);
  if (!inside) return null;
  let wait = end - now;
  if (wait <= 0) wait += 24 * 60; // quiet hours end tomorrow morning
  return new Date(Date.now() + wait * 60_000);
}

Deno.serve(async (req) => {
  const internal = await getSecret('CRON_SECRET');
  if (!internal || req.headers.get('x-internal-secret') !== internal) {
    return new Response('forbidden', { status: 401 });
  }

  const s = svc();
  const p = await req.json();
  const channel: string = p.channel; // 'sms' | 'email'
  let to: string = p.to;
  if (!channel || !to) return Response.json({ ok: false, error: 'channel and to required' }, { status: 400 });

  // Normalize SMS destinations to E.164 before anything downstream (suppression check,
  // stored contact_phone, Twilio 'To') uses `to`. Email addresses are left untouched.
  if (channel === 'sms') {
    const e164 = normE164(to);
    if (!e164) return Response.json({ ok: false, error: 'invalid phone number', skipped: 'invalid_phone' }, { status: 400 });
    to = e164;
  }

  const providerKey = channel === 'sms' ? 'twilio' : 'resend';
  const type = channel === 'sms' ? 'SMS' : 'Email';
  const refs = {
    contact_name: p.contact_name ?? null,
    lead_id: p.lead_id ?? null,
    customer_id: p.customer_id ?? null,
    appointment_id: p.appointment_id ?? null,
    sent_by: p.sent_by ?? null,
  };
  const commBase = {
    type, direction: 'outbound', provider: providerKey,
    contact_phone: channel === 'sms' ? to : null,
    contact_email: channel === 'email' ? to : null,
    body: p.body ?? null, subject: p.subject ?? null, ...refs,
  };

  // 1) Integration enabled?
  const { data: integ } = await s.from('integration').select('is_enabled, config').eq('key', providerKey).single();
  if (!integ?.is_enabled) {
    const id = await insertComm(s, { ...commBase, status: 'skipped', delivery_status: 'skipped_unconfigured', status_updated_at: new Date().toISOString(), error: `${providerKey} not enabled` });
    return Response.json({ ok: false, skipped: 'disabled', communication_id: id });
  }
  const cfg = (integ.config as Record<string, any>) || {};

  // 1.5) SMS safety rails — arm switch, then quiet hours.
  //
  // Thirteen crons begin sending the moment Twilio is credentialed. This is the
  // one choke point every outbound message passes through, so the switch lives
  // here rather than in each dispatcher.
  if (channel === 'sms') {
    const { data: smsCfgList } = await s.from('sms_settings').select('*').limit(1);
    const smsCfg: any = smsCfgList?.[0] || {};

    // Fail CLOSED: send only when explicitly armed. A missing or unreadable
    // sms_settings row must not become an open gate.
    if (smsCfg.sms_outbound_enabled !== true) {
      const id = await insertComm(s, {
        ...commBase, status: 'skipped', delivery_status: 'skipped_disarmed',
        status_updated_at: new Date().toISOString(),
        error: 'Outbound SMS is disarmed — enable it in SMS settings',
      });
      return Response.json({ ok: false, skipped: 'sms_disarmed', communication_id: id });
    }

    // Quiet hours protect CUSTOMERS. Internal staff alerts carry no lead or
    // customer reference and must still get through at 2am — an asbestos
    // hard-stop cannot wait until morning.
    const customerFacing = !!(p.lead_id || p.customer_id) && p.bypass_quiet_hours !== true;
    if (smsCfg.quiet_hours_enabled && customerFacing) {
      const until = quietHoldUntil(smsCfg);
      if (until) {
        // Held, not dropped: re-queue for the moment quiet hours end.
        await s.rpc('enqueue_job', {
          p_type: 'send_sms',
          p_payload: p,
          p_run_at: until.toISOString(),
          p_max_attempts: 5,
        });
        const id = await insertComm(s, {
          ...commBase, status: 'skipped', delivery_status: 'deferred_quiet_hours',
          status_updated_at: new Date().toISOString(),
          error: `Held for quiet hours until ${until.toISOString()}`,
        });
        return Response.json({
          ok: false, skipped: 'quiet_hours',
          deferred_until: until.toISOString(), communication_id: id,
        });
      }
    }
  }

  // 2) Suppressed?
  const { data: suppressed } = await s.rpc('is_suppressed', { p_channel: channel, p_value: to });
  if (suppressed) {
    const id = await insertComm(s, { ...commBase, status: 'suppressed', delivery_status: 'suppressed', status_updated_at: new Date().toISOString() });
    return Response.json({ ok: false, skipped: 'suppressed', communication_id: id });
  }

  // 3) Queued row
  const commId = await insertComm(s, { ...commBase, status: 'queued', delivery_status: 'queued' });

  // 4) Send
  let providerMessageId: string | null = null;
  let deliveryStatus = 'failed';
  let error: string | null = null;
  try {
    if (channel === 'sms') {
      const sid = await getSecret('TWILIO_ACCOUNT_SID');
      const token = await getSecret('TWILIO_AUTH_TOKEN');
      if (!sid || !token || !(cfg.messaging_service_sid || cfg.from_number)) throw new Error('Twilio not fully configured');
      const form = new URLSearchParams();
      form.append('To', to);
      if (cfg.messaging_service_sid) form.append('MessagingServiceSid', cfg.messaging_service_sid);
      else form.append('From', cfg.from_number);
      form.append('Body', p.body ?? '');
      // No secret in the callback URL — Twilio stores/displays it. twilioStatus authenticates
      // the callback by verifying X-Twilio-Signature with TWILIO_AUTH_TOKEN instead.
      form.append('StatusCallback', `${FUNCTIONS_BASE}/twilioStatus`);
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST', headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || `Twilio HTTP ${r.status}`);
      providerMessageId = d.sid; deliveryStatus = 'sent';
    } else {
      const key = await getSecret('RESEND_API_KEY');
      if (!key || !cfg.from_email) throw new Error('Resend not fully configured');
      const isHtml = (p.body ?? '').trim().startsWith('<');
      const payload: any = { from: cfg.from_email, to: [to], subject: p.subject ?? '' };
      payload[isHtml ? 'html' : 'text'] = p.body ?? '';
      // Optional additional recipients / reply-to for transactional senders.
      if (Array.isArray(p.cc) && p.cc.length) payload.cc = p.cc;
      if (Array.isArray(p.bcc) && p.bcc.length) payload.bcc = p.bcc;
      if (p.reply_to) payload.reply_to = p.reply_to;
      // Attachments arrive as [{ filename, url }] (a Storage URL) so job payloads
      // stay small; fetch each and hand Resend the base64 content.
      if (Array.isArray(p.attachments) && p.attachments.length) {
        const atts: any[] = [];
        for (const a of p.attachments) {
          try {
            const fr = await fetch(a.url);
            if (fr.ok) atts.push({ filename: a.filename, content: encodeBase64(new Uint8Array(await fr.arrayBuffer())) });
          } catch (_) { /* skip a bad attachment rather than fail the whole send */ }
        }
        if (atts.length) payload.attachments = atts;
      }
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || `Resend HTTP ${r.status}`);
      providerMessageId = d.id; deliveryStatus = 'sent';
    }
  } catch (e) {
    error = (e as Error).message;
    deliveryStatus = error.includes('not fully configured') ? 'skipped_unconfigured' : 'failed';
  }

  await s.from('communication').update({
    provider_message_id: providerMessageId, delivery_status: deliveryStatus,
    status: deliveryStatus === 'sent' ? 'sent' : deliveryStatus, error, status_updated_at: new Date().toISOString(),
  }).eq('id', commId);

  return Response.json({ ok: deliveryStatus === 'sent', communication_id: commId, delivery_status: deliveryStatus, provider_message_id: providerMessageId, error });
});
