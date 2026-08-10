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
