// Google Maps cluster — the API-key half of the Google integration (Geocoding + Street View
// Static). One function, `type` discriminator. No OAuth: just GOOGLE_MAPS_API_KEY from Vault.
// (Google Calendar/Sheets use OAuth and live elsewhere.)
//
// Graceful degrade: { stub: true } when the google integration is disabled or no key is set.
// Auth: internal secret OR an authenticated user.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireModules } from '../_shared/authz.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
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

async function mapsKey(): Promise<string | null> {
  const { data: integ } = await svc().from('integration').select('is_enabled').eq('key', 'google').maybeSingle();
  if (!integ?.is_enabled) return null;
  return await getSecret('GOOGLE_MAPS_API_KEY');
}

// HMAC over a "lat,lng" string so the public Street View image proxy (GET below) only serves
// locations WE minted a URL for — it can't be used as an open proxy for arbitrary coordinates
// (which would burn our Maps quota). The signature never reveals the signing key.
async function signLoc(loc: string): Promise<string> {
  const secret = (await getSecret('CRON_SECRET')) || '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(loc));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function geocodeAddress(key: string, address: string): Promise<{ lat: number; lng: number } | null> {
  const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
  const d = await r.json();
  if (d.status !== 'OK' || !d.results?.length) return null;
  return d.results[0].geometry.location;
}

// Ray-casting point-in-polygon (coords are [lat, lng]).
function pointInPolygon(point: number[], polygon: number[][]): boolean {
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

async function handle(type: string, p: any, key: string): Promise<Record<string, unknown>> {
  switch (type) {
    case 'street_view': { // getStreetView
      if (!p.address) return { error: 'Address is required' };
      const loc = await geocodeAddress(key, p.address);
      if (!loc) return { error: 'Address not found' };
      const meta = await (await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${loc.lat},${loc.lng}&key=${key}`)).json();
      if (meta.status !== 'OK') return { error: 'Street View not available for this location' };
      // Return a signed PROXY URL (below), NOT a Google URL with the key embedded — the key must
      // never reach the browser DOM. The proxy serves the image bytes server-side.
      const svLoc = `${loc.lat},${loc.lng}`;
      return { streetViewUrl: `${SUPABASE_URL}/functions/v1/googleMaps?sv=${svLoc}&sig=${await signLoc(svLoc)}`, lat: loc.lat, lng: loc.lng };
    }
    case 'geocode': { // journeyGeocode
      if (!p.address) return { error: 'address required' };
      const loc = await geocodeAddress(key, p.address);
      return loc ? { success: true, lat: loc.lat, lng: loc.lng } : { success: false, lat: null, lng: null };
    }
    case 'zips_in_polygon': { // getZipsInPolygon
      const poly: number[][] = p.polygon_coordinates;
      if (!poly || poly.length < 3) return { zip_codes: [] };
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const [lat, lng] of poly) { minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng); }
      const latStep = (maxLat - minLat) / 5, lngStep = (maxLng - minLng) / 5;
      const geocodedZips = new Map<string, number[]>();
      for (let i = 0; i <= 5; i++) {
        for (let j = 0; j <= 5; j++) {
          const lat = minLat + i * latStep, lng = minLng + j * lngStep;
          if (!pointInPolygon([lat, lng], poly)) continue;
          const d = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=postal_code&key=${key}`)).json();
          for (const result of d.results || []) {
            const zipComp = result.address_components?.find((c: any) => c.types.includes('postal_code'));
            const loc = result.geometry?.location;
            if (zipComp && loc && !geocodedZips.has(zipComp.long_name)) geocodedZips.set(zipComp.long_name, [loc.lat, loc.lng]);
          }
        }
      }
      const zips = [...geocodedZips.entries()].filter(([, c]) => pointInPolygon(c, poly)).map(([z]) => z).sort();
      return { zip_codes: zips };
    }
    default:
      return { error: `Unknown maps type ${type}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Street View image PROXY (GET). Serves the image bytes so the API key never reaches the browser
  // (rendered via <img src>, which can't send auth headers — so this is unauthenticated but gated
  // by the HMAC over the location, which only WE can produce).
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const sv = url.searchParams.get('sv');
    const sig = url.searchParams.get('sig');
    if (!sv || !sig) return new Response('bad request', { status: 400, headers: cors });
    if (sig !== (await signLoc(sv))) return new Response('forbidden', { status: 403, headers: cors });
    const key = await mapsKey();
    if (!key) return new Response('not configured', { status: 503, headers: cors });
    const g = await fetch(`https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${encodeURIComponent(sv)}&key=${key}&fov=80&pitch=0`);
    if (!g.ok) return new Response('street view unavailable', { status: 502, headers: cors });
    return new Response(g.body, {
      status: 200,
      headers: { ...cors, 'Content-Type': g.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
    });
  }

  const internal = await getSecret('CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  if (!isInternal) {
    const user = await currentUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
    // 0114 punch list: a JWT alone is not authorization. This also excludes
    // crew logins (active, role-less) and inactive signups (see _shared/authz.ts).
    const denied = await requireModules(req, cors, ['appointments','journey','projects','leads'], 'view');
    if (denied) return denied;
  }

  try {
    const p = await req.json();
    if (!p?.type) return Response.json({ error: 'type required' }, { status: 400, headers: cors });
    const key = await mapsKey();
    if (!key) return Response.json({ stub: true }, { headers: cors });
    const result = await handle(p.type, p, key);
    return Response.json(result, { status: result.error ? 400 : 200, headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
