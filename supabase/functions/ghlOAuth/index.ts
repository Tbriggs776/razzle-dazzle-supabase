// GoHighLevel Marketplace — OAuth callback.
//
// This is the URL registered as the app's Redirect URL. GHL sends the installing
// user's BROWSER here with a one-time ?code=, which we exchange server-side for
// an access/refresh pair scoped to one sub-account (location).
//
// Shape notes, because this function is unlike every other one in this project:
//   - It is a GET. Everything else here is POST; this is a browser navigation.
//   - It deploys with verify_jwt = false. A redirect carries no Authorization
//     header, so requiring a JWT would make the install impossible. It is not
//     unauthenticated in the meaningful sense: possession of a valid one-time
//     code, redeemable only with our client secret, IS the authentication.
//   - It REDIRECTS rather than rendering. Supabase's function gateway forces
//     Content-Type: text/plain with nosniff on every response, so an HTML page
//     served from here reaches the installer as raw source. Verified by curl,
//     not assumed. Sending them back into the app is nicer anyway: they land on
//     a branded page instead of a bare endpoint.
//
// THE REFRESH TOKEN IS THE ASSET. Access tokens expire in about a day; if we
// only stored that, the integration would look fine and then silently die
// overnight. Both are written to ghl_install, which is service_role-only.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

async function getSecret(s: any, name: string): Promise<string | null> {
  const { data, error } = await s.rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

const APP_URL = Deno.env.get('APP_URL') || 'https://razzle-dazzle-supabase.vercel.app';

/**
 * Hand the installer back to the app with the outcome in the query string.
 * `reason` is a short code, never a provider message — those can carry token
 * material and must not end up in a URL, browser history or a referrer header.
 */
function back(status: string, reason?: string) {
  const to = new URL('/Integrations', APP_URL);
  to.searchParams.set('ghl', status);
  if (reason) to.searchParams.set('reason', reason);
  return Response.redirect(to.toString(), 302);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');

  if (err) {
    return back('cancelled', err.slice(0, 40));
  }
  if (!code) {
    // Someone opened the URL directly. Say so plainly instead of 500-ing.
    return back('no_code');
  }

  const s = svc();
  try {
    const clientId = await getSecret(s, 'GHL_APP_CLIENT_ID');
    const clientSecret = await getSecret(s, 'GHL_APP_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return back('not_configured');
    }

    // GHL wants form-encoded, not JSON. redirect_uri must match the registered
    // one EXACTLY — so it is derived from the request rather than typed twice.
    const redirectUri = `${url.origin}${url.pathname}`;
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      user_type: 'Location',
      redirect_uri: redirectUri,
    });

    const r = await fetch(GHL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
    const text = await r.text();
    let d: any; try { d = JSON.parse(text); } catch { d = { raw: text }; }

    if (!r.ok || !d?.access_token) {
      // Never echo the body back to the browser: it can contain token material.
      console.error('GHL token exchange failed', r.status, text.slice(0, 500));
      return back('token_exchange_failed', String(r.status));
    }

    const locationId = d.locationId ?? d.location_id ?? null;
    if (!locationId) {
      console.error('GHL token response carried no locationId', Object.keys(d));
      return back('no_location');
    }

    const expiresAt = d.expires_in
      ? new Date(Date.now() + Number(d.expires_in) * 1000).toISOString()
      : null;

    // Upsert, not insert: reinstalling the same location must refresh the tokens
    // and clear a previous uninstall rather than collide on the primary key.
    const { error: upErr } = await s.from('ghl_install').upsert({
      location_id: locationId,
      company_id: d.companyId ?? d.company_id ?? null,
      access_token: d.access_token,
      refresh_token: d.refresh_token ?? null,
      token_type: d.token_type ?? null,
      scope: d.scope ?? null,
      user_type: d.userType ?? d.user_type ?? 'Location',
      expires_at: expiresAt,
      installed_at: new Date().toISOString(),
      uninstalled_at: null,
      last_refreshed_at: new Date().toISOString(),
      last_error: null,
      updated_date: new Date().toISOString(),
    }, { onConflict: 'location_id' });

    if (upErr) {
      console.error('ghl_install upsert failed', upErr.message);
      return back('not_saved');
    }

    if (!d.refresh_token) {
      // Worth saying out loud: without it the connection dies in ~24h.
      console.warn('GHL install has no refresh_token', locationId);
    }

    return back('connected');
  } catch (e) {
    console.error('ghlOAuth error', (e as Error).message);
    return back('error');
  }
});
