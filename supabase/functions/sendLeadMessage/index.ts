// Staff-initiated free-form message to a lead/customer from the "My Results" contact dialog.
// Authenticates the calling user (their JWT), then hands off to the unified internal sendMessage
// path — which normalizes SMS to E.164, checks suppression, sends via the CONFIGURED Twilio/Resend
// integration, tracks delivery, and logs a communication row (with the lead/appointment refs +
// sender) so the conversation thread and the Communication Hub both pick it up. This function does
// NOT call providers directly; sendMessage is the single hardened send path.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
// Inbound-reply domain: outbound lead emails set Reply-To to reply+{leadId}@<this>, so the
// customer's reply carries the lead id and incomingEmail threads it back. Configure Resend
// inbound for this domain (or override via REPLY_EMAIL_DOMAIN) at cutover.
const REPLY_DOMAIN = Deno.env.get('REPLY_EMAIL_DOMAIN') || 'reply.floordaddy.com';
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

async function currentUser(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data } = await u.auth.getUser();
  return data?.user ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Auth: an authenticated staff user (internal secret also accepted for server-side callers).
  const internal = await getSecret('CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  let user: any = null;
  if (!isInternal) {
    user = await currentUser(req);
    if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  try {
    const { channel, to, subject, body, leadId, appointmentId, customerId, contactName } = await req.json();
    if (!channel || !to || !body) {
      return Response.json({ success: false, error: 'Missing required fields: channel, to, body' }, { status: 400, headers: cors });
    }
    const senderName = user?.user_metadata?.full_name || user?.email || 'Team Member';

    const r = await fetch(`${FUNCTIONS_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': internal || '' },
      body: JSON.stringify({
        channel: channel === 'email' ? 'email' : 'sms',
        to,
        subject: channel === 'email' ? (subject || '') : undefined,
        // Route the customer's reply back to this lead's thread via incomingEmail.
        reply_to: (channel === 'email' && leadId) ? `reply+${leadId}@${REPLY_DOMAIN}` : undefined,
        body,
        lead_id: leadId || null,
        customer_id: customerId || null,
        appointment_id: appointmentId || null,
        contact_name: contactName || null,
        sent_by: senderName,
      }),
    });
    const d = await r.json().catch(() => ({} as any));

    if (d.ok) {
      return Response.json({ success: true, to, communication_id: d.communication_id, delivery_status: d.delivery_status }, { headers: cors });
    }
    // 200 with success:false — the dialog surfaces the reason (disabled / suppressed / provider error).
    return Response.json({ success: false, error: d.error || (d.skipped ? `Not sent (${d.skipped})` : 'Failed to send') }, { headers: cors });
  } catch (e) {
    return Response.json({ success: false, error: (e as Error).message }, { status: 500, headers: cors });
  }
});
