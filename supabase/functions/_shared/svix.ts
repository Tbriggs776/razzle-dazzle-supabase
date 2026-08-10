// Svix webhook signature verification (the scheme Resend uses).
// Verifies the v1 signature over `${svix-id}.${svix-timestamp}.${rawBody}` using the
// endpoint signing secret (base64 after the optional `whsec_` prefix) and enforces a
// timestamp tolerance window to blunt replay.
import { encodeBase64, decodeBase64 } from 'jsr:@std/encoding/base64';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  toleranceSec = 300,
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSec) return false;

  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try { keyBytes = decodeBase64(raw); } catch (_) { return false; }
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = encodeBase64(new Uint8Array(sig));
  // The svix-signature header is a space-separated list of `v1,<base64>` entries.
  for (const part of signature.split(' ')) {
    const comma = part.indexOf(',');
    if (comma < 0) continue;
    const sval = part.slice(comma + 1);
    if (sval && timingSafeEqual(sval, expected)) return true;
  }
  return false;
}
