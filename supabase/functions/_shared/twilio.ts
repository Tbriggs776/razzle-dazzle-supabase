// Twilio request-signature verification (X-Twilio-Signature).
// Twilio computes: base64( HMAC-SHA1( authToken, URL + concat(sortedKey + value) ) )
// over the EXACT URL it POSTed to (no query string when none is configured) plus the
// POST params in alphabetical key order. We verify against a set of candidate URLs to
// tolerate Supabase's two function-URL forms and any proxy host/scheme rewrite.
import { encodeBase64 } from 'jsr:@std/encoding/base64';

async function hmacSha1B64(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  return encodeBase64(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// The URL forms Twilio might have been pointed at for a given function.
export function twilioCandidateUrls(supabaseUrl: string, req: Request, fnName: string): string[] {
  const out: string[] = [];
  const base = (supabaseUrl || '').replace(/\/$/, '');
  if (base) {
    out.push(`${base}/functions/v1/${fnName}`);
    try {
      const projRef = new URL(base).hostname.split('.')[0];
      out.push(`https://${projRef}.functions.supabase.co/${fnName}`);
    } catch (_) { /* ignore */ }
  }
  out.push(req.url);
  out.push(req.url.split('?')[0]);
  return out;
}

export async function verifyTwilioSignature(
  authToken: string,
  candidateUrls: string[],
  params: Record<string, string>,
  signature: string | null,
): Promise<boolean> {
  if (!authToken || !signature) return false;
  const tail = Object.keys(params).sort().map((k) => k + params[k]).join('');
  for (const url of candidateUrls) {
    if (!url) continue;
    const expected = await hmacSha1B64(authToken, url + tail);
    if (timingSafeEqual(expected, signature)) return true;
  }
  return false;
}
