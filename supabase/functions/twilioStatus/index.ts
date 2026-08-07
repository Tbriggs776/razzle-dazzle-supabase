// Twilio message status callback. Twilio POSTs delivery updates (queued -> sent
// -> delivered / undelivered / failed) here; we flip the matching communication
// row's delivery_status. Gated by the ?s= secret on the callback URL (which
// sendMessage sets to the internal CRON_SECRET).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const secret = await getSecret('CRON_SECRET');
  if (!secret || url.searchParams.get('s') !== secret) return new Response('forbidden', { status: 401 });

  const params = new URLSearchParams(await req.text());
  const sid = params.get('MessageSid');
  const status = params.get('MessageStatus'); // queued|sent|delivered|undelivered|failed
  const errorCode = params.get('ErrorCode');
  if (sid && status) {
    await svc().rpc('apply_delivery_status', { p_provider_message_id: sid, p_status: status, p_error: errorCode || null });
  }
  return new Response('', { status: 200 });
});
