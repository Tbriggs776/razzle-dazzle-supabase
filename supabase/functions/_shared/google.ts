// Google service-account auth — replaces base44's managed OAuth connector (which has no
// Supabase equivalent). Mints a short-lived Google access token by signing a JWT (RS256) with
// the service account's private key and exchanging it at the token endpoint. No per-user OAuth,
// no refresh tokens. Optional `subject` impersonates a user (Workspace domain-wide delegation).
// Shared by syncCalendarEvent + googleSheets.
import { createClient } from 'jsr:@supabase/supabase-js@2';

export function svcClient(): any {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

export async function getSecret(s: any, name: string): Promise<string | null> {
  const { data, error } = await s.rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

// null when the google integration is disabled or the service-account JSON isn't set.
export async function googleContext(s: any): Promise<{ saJson: string; config: Record<string, any> } | null> {
  const { data: integ } = await s.from('integration').select('is_enabled, config').eq('key', 'google').maybeSingle();
  if (!integ?.is_enabled) return null;
  const saJson = await getSecret(s, 'GOOGLE_SA_JSON');
  if (!saJson) return null;
  return { saJson, config: integ.config || {} };
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

const tokenCache = new Map<string, { token: string; exp: number }>();

// Get (and cache per-isolate) a Google access token for the given scopes + optional subject.
export async function googleToken(saJson: string, scopes: string[], subject?: string): Promise<string> {
  const sa = JSON.parse(saJson);
  const scope = scopes.join(' ');
  const cacheKey = `${sa.client_email}|${scope}|${subject || ''}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.exp > now + 60) return cached.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim: any = { iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  if (subject) claim.sub = subject;
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`Google token error: ${JSON.stringify(d).slice(0, 300)}`);
  tokenCache.set(cacheKey, { token: d.access_token, exp: now + (d.expires_in || 3600) });
  return d.access_token;
}
