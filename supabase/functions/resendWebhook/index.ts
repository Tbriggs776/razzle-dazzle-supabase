// Resend delivery/bounce webhook. Resend POSTs email events (delivered, bounced,
// complained, delivery_delayed). We update the matching communication row and,
// on bounce/complaint, add the address to the suppression list so we stop emailing it.
//
// Auth: Resend signs webhooks with Svix. We verify svix-id / svix-timestamp /
// svix-signature against RESEND_WEBHOOK_SECRET (the endpoint signing secret pasted at
// /Integrations). Internal/test callers use the x-internal-secret header. No secret is
// accepted in the URL query string.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifySvix } from '../_shared/svix.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

const STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delayed',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  const raw = await req.text();

  const webhookSecret = await getSecret('RESEND_WEBHOOK_SECRET');
  const internal = await getSecret('CRON_SECRET');
  const internalHdr = req.headers.get('x-internal-secret');
  const svixOk = !!webhookSecret && await verifySvix(
    webhookSecret,
    { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') },
    raw,
  );
  if (!svixOk && !(internal && internalHdr === internal)) return new Response('forbidden', { status: 401 });

  let body: any = {};
  try { body = JSON.parse(raw); } catch (_) { body = {}; }
  const type: string = body?.type || '';
  const data = body?.data || {};
  const emailId: string | undefined = data.email_id;
  const to: string | undefined = Array.isArray(data.to) ? data.to[0] : data.to;
  const s = svc();

  if (emailId) {
    await s.rpc('apply_delivery_status', { p_provider_message_id: emailId, p_status: STATUS[type] || type.replace('email.', ''), p_error: null });
  }
  if (type === 'email.bounced' && to) await s.rpc('add_suppression', { p_channel: 'email', p_value: to, p_reason: 'bounce' });
  if (type === 'email.complained' && to) await s.rpc('add_suppression', { p_channel: 'email', p_value: to, p_reason: 'complaint' });

  return new Response('ok', { status: 200 });
});
