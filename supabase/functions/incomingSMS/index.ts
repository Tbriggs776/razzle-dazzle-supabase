// Inbound Twilio SMS webhook (public, verify_jwt off). Twilio POSTs a form-encoded
// From/Body/MessageSid; we match the sender to a lead/customer, store ONE inbound
// communication row, handle STOP/START opt-out against the suppression table (the same
// table sendMessage checks before every outbound send), and queue a staff alert email
// through the durable rail. Returns empty TwiML so Twilio doesn't retry.
//
// Gate: ?s=<CRON_SECRET> query param (same pattern as twilioStatus / resendWebhook). Point
// the Twilio inbound webhook at .../incomingSMS?s=<CRON_SECRET>. (X-Twilio-Signature HMAC
// validation is a possible future hardening; the shared-secret gate is what the rest of the
// project uses and is deterministically testable.)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = 'https://razzle-dazzle-supabase.vercel.app';
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
const START_WORDS = ['START', 'YES', 'UNSTOP'];
const TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

const esc = (x: unknown) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xml = () => new Response(TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  const url = new URL(req.url);
  const secret = await getSecret('CRON_SECRET');
  const provided = url.searchParams.get('s') || req.headers.get('x-internal-secret');
  if (!secret || provided !== secret) return new Response('forbidden', { status: 403 });

  // Read the body ONCE as text, then parse by content-type. (Calling req.formData() first
  // and falling back to req.json() fails: the first read consumes/locks the body.) Twilio
  // sends application/x-www-form-urlencoded; JSON is accepted for testing.
  let From = '', Body = '', MessageSid = '';
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  const raw = await req.text().catch(() => '');
  if (ct.includes('application/json')) {
    try { const j = JSON.parse(raw); From = j.From || ''; Body = j.Body || ''; MessageSid = j.MessageSid || ''; } catch (_e) { /* empty */ }
  } else {
    const params = new URLSearchParams(raw);
    From = params.get('From') || ''; Body = params.get('Body') || ''; MessageSid = params.get('MessageSid') || '';
  }
  if (!From) return xml();

  const s = svc();

  // Idempotency: a Twilio retry carries the same MessageSid — no-op if we already stored it.
  if (MessageSid) {
    const { data: dup } = await s.from('communication').select('id').eq('direction', 'inbound').eq('provider_message_id', MessageSid).maybeSingle();
    if (dup) return xml();
  }

  // Opt-out keywords flip the same suppression table outbound sends check.
  const kw = Body.trim().toUpperCase();
  let optOut = false;
  if (STOP_WORDS.includes(kw)) { await s.rpc('add_suppression', { p_channel: 'sms', p_value: From, p_reason: 'sms_stop' }); optOut = true; }
  else if (START_WORDS.includes(kw)) { await s.rpc('remove_suppression', { p_channel: 'sms', p_value: From }); }

  // Match sender to a lead/customer (DB query on last-10-digits).
  const { data: match } = await s.rpc('find_contact_by_phone', { p_phone: From });
  const m: any = Array.isArray(match) ? match[0] : match;
  const leadId = m?.lead_id || null;
  const customerId = m?.customer_id || null;
  const contactName = m?.contact_name || From;

  await s.from('communication').insert({
    type: 'SMS', direction: 'inbound', contact_phone: From, contact_name: contactName,
    body: Body, status: 'received', delivery_status: 'received', status_updated_at: new Date().toISOString(),
    lead_id: leadId, customer_id: customerId, provider_message_id: MessageSid || null, twilio_sid: MessageSid || null,
  });

  // Staff alert through the durable rail (suppression/retry/tracking), skipped on opt-outs.
  if (!optOut) {
    const { data: ss } = await s.from('sms_settings').select('inbound_sms_alert_emails').limit(1);
    const emails: string[] = Array.isArray(ss?.[0]?.inbound_sms_alert_emails) ? ss[0].inbound_sms_alert_emails : [];
    if (emails.length) {
      let apptLine = '';
      const cid = leadId || customerId;
      if (cid) {
        const { data: appts } = await s.from('appointment').select('id').eq('customer', cid).order('created_date', { ascending: false }).limit(1);
        if (appts?.[0]) apptLine = `<p><strong>Appointment:</strong> <a href='${APP_URL}/AppointmentDetail?id=${appts[0].id}'>View</a></p>`;
      }
      const html =
        `<div style='font-family:-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;'>` +
        `<h2>New inbound SMS from ${esc(contactName)}</h2>` +
        `<p>You received a new text message in the Communication Hub.</p>` +
        `<p><strong>From:</strong> ${esc(contactName)} (${esc(From)})<br/><strong>Message:</strong> ${esc(Body)}</p>` +
        apptLine +
        `<p><a href='${APP_URL}/CommunicationHub' style='background:#4f46e5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;'>Reply in Communication Hub &rarr;</a></p></div>`;
      await s.rpc('enqueue_job', {
        p_type: 'send_email',
        p_payload: { to: emails[0], bcc: emails.slice(1), subject: `New inbound SMS from ${contactName}`, body: html, sent_by: 'System', lead_id: leadId, customer_id: customerId },
      });
    }
  }

  return xml();
});
