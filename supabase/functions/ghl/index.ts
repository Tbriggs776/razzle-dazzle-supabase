// GoHighLevel — migrated from the EOL v1 API to v2 (services.leadconnectorhq.com, Private
// Integration Token + Location ID + Version header). Powers the lead-count dashboard.
//   type = lead_count   -> read the cached contact timestamps (getGHLLeadCount)
//   type = sync_contacts-> pull all contacts' dateAdded from GHL v2 -> cache (syncGHLContacts, admin)
//
// Graceful degrade: { stub: true } when ghl is disabled / no token / no location id.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

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

async function isOrgAdmin(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data } = await u.rpc('is_org_admin');
  return data === true;
}

async function ghlContext(s: any): Promise<{ token: string; locationId: string } | null> {
  const { data: integ } = await s.from('integration').select('is_enabled, config').eq('key', 'ghl').maybeSingle();
  if (!integ?.is_enabled) return null;
  const token = await getSecret('GHL_PIT_TOKEN');
  const locationId = (integ.config || {}).ghl_location_id;
  if (!token || !locationId) return null;
  return { token, locationId };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const s = svc();
  const internal = await getSecret('CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  if (!isInternal) { const user = await currentUser(req); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors }); }

  try {
    const p = await req.json().catch(() => ({}));
    const type = p.type || 'lead_count';

    if (type === 'lead_count') {
      const { data: rows } = await s.from('ghl_contact_cache').select('*').limit(1);
      const cache = rows?.[0] ?? null;
      return Response.json({ dateAddedList: cache?.date_added_list ?? [], synced_at: cache?.synced_at ?? null, contact_count: cache?.contact_count ?? 0 }, { headers: cors });
    }

    // Snapshot every contact's do-not-contact state into public.ghl_contact_dnd.
    //
    // suppression only knows about contacts whose DND CHANGED since the webhook went
    // live -- 32 rows against 17,524 leads. Reporting on reachability across the whole
    // book needs the state of every contact, and GHL's contacts list is the only
    // source for it.
    //
    // Writes to ghl_contact_dnd, NEVER to suppression: that table is what sendMessage
    // consults before a send, and bulk-loading it would silently change who this
    // system is willing to message while outbound is deliberately disarmed.
    if (type === 'sync_dnd') {
      if (!isInternal && !(await isOrgAdmin(req))) return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors });
      const ctx = await ghlContext(s);
      if (!ctx) return Response.json({ stub: true }, { headers: cors });
      const headers = { Authorization: `Bearer ${ctx.token}`, Version: GHL_VERSION, Accept: 'application/json' };

      // GHL semantics, and inverting this is the whole ballgame: a channel whose
      // status is 'active' has DND ACTIVE -- do NOT contact. 'inactive' means sending
      // is allowed. Top-level `dnd` is a blanket override. Same reading as
      // ghlWebhook's readDnd(), deliberately identical.
      const readDnd = (c: any) => {
        const settings = c?.dndSettings ?? {};
        const statusOf = (name: string) => {
          const key = Object.keys(settings).find((k) => k.toLowerCase() === name.toLowerCase());
          return String((key ? settings[key]?.status : '') ?? '').toLowerCase();
        };
        const blanket = c?.dnd === true;
        const on = (n: string) => blanket || statusOf(n) === 'active';
        return {
          dnd_blanket: blanket,
          dnd_sms: on('SMS'),
          dnd_email: on('Email'),
          dnd_other: ['Call', 'WhatsApp', 'GMB', 'FB'].filter(on),
        };
      };

      // THE CURSOR IS PERSISTED, not returned. Returning it assumes the caller sees
      // the response, and the first real run proved that assumption false: pg_net
      // times out at 5s while this function legitimately runs for 50, so the cursor
      // went into a response nobody read and the next call restarted from page one --
      // making the table permanently unfinishable past one budget's worth of pages.
      // Parking it in a row means "call me again" actually resumes.
      const CURSOR_KEY = 'contact_dnd';
      const { data: saved } = await s.from('ghl_sync_state')
        .select('cursor, is_complete, items_seen').eq('key', CURSOR_KEY).maybeSingle();
      const resuming = p?.restart !== true && saved?.is_complete === false && !!saved?.cursor;
      let startAfter: string | null = resuming ? (saved.cursor.split('|')[0] || null) : null;
      let startAfterId: string | null = resuming ? (saved.cursor.split('|')[1] || null) : null;
      let page = 0, withDnd = 0;
      // Carried across resumes so the reported total is the run, not the page.
      let seen = resuming ? (saved.items_seen ?? 0) : 0;
      const limit = 100, maxPages = 400;
      const t0 = Date.now();

      const park = async (complete: boolean) => {
        await s.from('ghl_sync_state').upsert({
          key: CURSOR_KEY,
          cursor: complete ? null : `${startAfter ?? ''}|${startAfterId ?? ''}`,
          page,
          items_seen: seen,
          items_written: seen,
          is_complete: complete,
          last_run_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          updated_date: new Date().toISOString(),
        }, { onConflict: 'key' });
      };

      while (page < maxPages) {
        // Leave the request before the platform kills it. 17k contacts at 100 a page
        // is ~175 round trips; a slow day at GHL should degrade into "call me again",
        // not a half-written table with no record of how far it got.
        if (Date.now() - t0 > 45_000) {
          await park(false);
          return Response.json({ ok: true, partial: true, resumable: true, pages: page, contacts: seen, with_dnd: withDnd }, { headers: cors });
        }
        const params = new URLSearchParams({ locationId: ctx.locationId, limit: String(limit) });
        if (startAfter) params.set('startAfter', String(startAfter));
        if (startAfterId) params.set('startAfterId', startAfterId);
        const r = await fetch(`${GHL_BASE}/contacts/?${params}`, { headers });
        if (!r.ok) return Response.json({ error: `GHL v2 API ${r.status}: ${await r.text()}`, pages: page, contacts: seen }, { status: r.status, headers: cors });
        const d = await r.json();
        const contacts = d.contacts || [];
        if (!contacts.length) break;

        const rows = contacts.filter((c: any) => c?.id).map((c: any) => ({
          contact_id: c.id, ...readDnd(c), synced_at: new Date().toISOString(),
        }));
        withDnd += rows.filter((x: any) => x.dnd_blanket || x.dnd_sms || x.dnd_email).length;
        seen += rows.length;
        const { error } = await s.from('ghl_contact_dnd').upsert(rows, { onConflict: 'contact_id' });
        if (error) return Response.json({ error: `write failed on page ${page}: ${error.message}`, contacts: seen }, { status: 500, headers: cors });

        if (contacts.length < limit || !d.meta?.startAfterId) break;
        startAfter = d.meta.startAfter; startAfterId = d.meta.startAfterId; page++;
      }
      await park(true);
      return Response.json({ ok: true, done: true, pages: page, contacts: seen, with_dnd: withDnd }, { headers: cors });
    }

    if (type === 'sync_contacts') {
      if (!isInternal && !(await isOrgAdmin(req))) return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors });
      const ctx = await ghlContext(s);
      if (!ctx) return Response.json({ stub: true }, { headers: cors });
      const headers = { Authorization: `Bearer ${ctx.token}`, Version: GHL_VERSION, Accept: 'application/json' };
      const dateAddedList: string[] = [];
      let startAfter: string | null = null, startAfterId: string | null = null, page = 0;
      const limit = 100, maxPages = 300;
      while (page < maxPages) {
        const params = new URLSearchParams({ locationId: ctx.locationId, limit: String(limit) });
        if (startAfter) params.set('startAfter', String(startAfter));
        if (startAfterId) params.set('startAfterId', startAfterId);
        const r = await fetch(`${GHL_BASE}/contacts/?${params}`, { headers });
        if (!r.ok) return Response.json({ error: `GHL v2 API ${r.status}: ${await r.text()}` }, { status: r.status, headers: cors });
        const d = await r.json();
        const contacts = d.contacts || [];
        for (const c of contacts) if (c.dateAdded) dateAddedList.push(c.dateAdded);
        if (contacts.length < limit || !d.meta?.startAfterId) break;
        startAfter = d.meta.startAfter; startAfterId = d.meta.startAfterId; page++;
      }
      const cacheData = { date_added_list: dateAddedList, synced_at: new Date().toISOString(), contact_count: dateAddedList.length };
      const { data: existing } = await s.from('ghl_contact_cache').select('id').limit(1);
      if (existing?.[0]) await s.from('ghl_contact_cache').update(cacheData).eq('id', existing[0].id);
      else await s.from('ghl_contact_cache').insert(cacheData);
      return Response.json({ success: true, contact_count: dateAddedList.length, synced_at: cacheData.synced_at }, { headers: cors });
    }

    return Response.json({ error: `Unknown ghl type ${type}` }, { status: 400, headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
