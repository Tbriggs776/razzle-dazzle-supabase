// Short.io link shortener. Port of base44 shortenUrl with two fixes:
//  (1) requires an authenticated caller — base44's was a public endpoint anyone
//      could use to mint links on the company domain (abuse/phishing vector);
//  (2) reads SHORTIO_API_KEY/DOMAIN from Vault, not env.
// When Short.io isn't configured yet, returns the original (long) URL so callers
// keep working during the migration instead of erroring.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireActiveStaff } from '../_shared/authz.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data } = await asUser.auth.getUser();
  return data?.user ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const user = await currentUser(req);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  // 0114 punch list: link shortening is used across ticket/appointment/sale
  // flows — any active staff member, but never a crew or inactive login.
  const denied = await requireActiveStaff(req, cors);
  if (denied) return denied;

  try {
    const { originalURL } = await req.json();
    if (!originalURL) return Response.json({ error: 'originalURL is required' }, { status: 400, headers: cors });

    const apiKey = await getSecret('SHORTIO_API_KEY');
    const domain = await getSecret('SHORTIO_DOMAIN');
    if (!apiKey || !domain) {
      // Graceful fallback: hand back the long URL so the caller still works.
      return Response.json({ shortURL: originalURL, originalURL, success: false, stub: true }, { headers: cors });
    }

    const r = await fetch('https://api.short.io/links', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', Authorization: apiKey },
      body: JSON.stringify({ allowDuplicates: false, originalURL, domain }),
    });
    const data = await r.json();
    if (!r.ok) return Response.json({ error: 'Failed to shorten URL', details: data }, { status: r.status, headers: cors });

    return Response.json({ shortURL: data.shortURL, originalURL: data.originalURL, success: true }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
