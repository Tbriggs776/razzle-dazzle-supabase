// Unified outbound message path. One code path for all SMS/email:
//   check integration enabled -> check suppression -> write a "queued"
//   communication row -> send via the provider -> update the row with the
//   provider message id + delivery_status. Delivery/bounce webhooks later flip
//   that row to delivered/failed/bounced.
// Internal-secret gated (x-internal-secret == CRON_SECRET) — called by
// processJobs handlers and other server-side code, never the browser.
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  const internal = await getSecret('CRON_SECRET');
  if (!internal || req.headers.get('x-internal-secret') !== internal) {
    return new Response('forbidden', { status: 401 });
  }

  const s = svc();
  const p = await req.json();
  const channel: string = p.channel; // 'sms' | 'email'
  const to: string = p.to;
  if (!channel || !to) return Response.json({ ok: false, error: 'channel and to required' }, { status: 400 });

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
      form.append('StatusCallback', `${FUNCTIONS_BASE}/twilioStatus?s=${internal}`);
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
