// Twilio message status callback. Twilio POSTs delivery updates (queued -> sent
// -> delivered / undelivered / failed) here; we flip the matching communication
// row's delivery_status.
//
// Auth: a genuine Twilio callback carries X-Twilio-Signature (verified with
// TWILIO_AUTH_TOKEN over the exact callback URL + POST params). Internal/test callers
// use the x-internal-secret header. No secret is accepted in the URL query string
// (Twilio stores/displays callback URLs, so a ?s= secret would be disclosed).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyTwilioSignature, twilioCandidateUrls } from '../_shared/twilio.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const paramObj = Object.fromEntries(params.entries());

  const sig = req.headers.get('X-Twilio-Signature');
  const authToken = await getSecret('TWILIO_AUTH_TOKEN');
  const internal = await getSecret('CRON_SECRET');
  const internalHdr = req.headers.get('x-internal-secret');
  const authed =
    (!!sig && !!authToken && await verifyTwilioSignature(authToken, twilioCandidateUrls(SUPABASE_URL, req, 'twilioStatus'), paramObj, sig)) ||
    (!!internal && internalHdr === internal);
  if (!authed) return new Response('forbidden', { status: 401 });

  const sid = params.get('MessageSid');
  const status = params.get('MessageStatus'); // queued|sent|delivered|undelivered|failed
  const errorCode = params.get('ErrorCode');
  if (sid && status) {
    await svc().rpc('apply_delivery_status', { p_provider_message_id: sid, p_status: status, p_error: errorCode || null });
  }
  return new Response('', { status: 200 });
});
