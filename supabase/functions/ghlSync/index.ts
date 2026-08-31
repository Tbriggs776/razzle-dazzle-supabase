// GoHighLevel conversation backfill.
//
// Pulls 18,919 conversations and their message history into ghl_conversation /
// ghl_message, to be read later by analysis. Two things shape this function:
//
// IT USES THE PRIVATE INTEGRATION TOKEN, NOT THE OAUTH APP. The marketplace app
// exists to deliver webhooks -- those are pushed and signature-verified and need
// no token at all. Everything this function reads goes through GHL_PIT_TOKEN,
// which the GoHighLevel integration row already holds and has verified. That is
// why conversation ingest does not wait on an OAuth access token.
//
// IT NEVER TRIES TO FINISH. A backfill this size cannot run inside one
// invocation, and a run that dies halfway must not start over. So every
// invocation does a BOUNDED amount of work against a cursor in ghl_sync_state
// and returns; call it again and it continues. Being interrupted is the normal
// case here, not the failure case.
//
//   POST { mode: 'conversations' }  page the thread list, oldest activity first
//   POST { mode: 'messages' }       pull messages for threads not yet fetched
//   POST { mode: 'both' }           (default) a slice of each, then re-link leads
//
// Idempotent throughout: both tables are keyed on GHL's own ids, so an
// overlapping page or a replayed run upserts instead of duplicating.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// Leave headroom under the platform's wall-clock limit. Whatever is unfinished
// when this expires is simply the next invocation's work.
const TIME_BUDGET_MS = 50_000;
// GHL rate-limits; a short gap between calls costs little and avoids 429 storms.
const PAUSE_MS = 60;
// How many conversations to pull at once. Almost all the wall-clock here is
// waiting on GHL, so a small pool multiplies throughput without multiplying
// load much. Kept modest on purpose: a backfill that trips a 429 storm finishes
// later than one that never does.
const CONCURRENCY = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getSecret(s: any, name: string): Promise<string | null> {
  const { data, error } = await s.rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

/** GHL sends epoch millis in some fields and ISO strings in others. */
function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(v).toISOString();
  const n = Number(v);
  if (Number.isFinite(n) && String(v).length >= 10) return new Date(n).toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type Ctx = { s: any; token: string; locationId: string; deadline: number };
const outOfTime = (c: Ctx) => Date.now() > c.deadline;

async function ghl(c: Ctx, path: string): Promise<any> {
  const r = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${c.token}`,
      Version: GHL_VERSION,
      Accept: 'application/json',
    },
  });
  const text = await r.text();
  if (!r.ok) {
    // Never echo the body: GHL errors can carry request context we do not want
    // in logs. Status plus path is enough to diagnose.
    throw new Error(`GHL ${r.status} on ${path.split('?')[0]}`);
  }
  try { return JSON.parse(text); } catch { throw new Error(`GHL sent non-JSON on ${path.split('?')[0]}`); }
}

async function readState(s: any, key: string) {
  const { data } = await s.from('ghl_sync_state').select('*').eq('key', key).maybeSingle();
  return data ?? null;
}

async function writeState(s: any, key: string, patch: Record<string, unknown>) {
  await s.from('ghl_sync_state').upsert(
    { key, ...patch, last_run_at: new Date().toISOString(), updated_date: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

// ---- the thread list -----------------------------------------------
/**
 * Page the conversation list oldest-first.
 *
 * Ascending order by last_message_date is deliberate. Descending would put new
 * activity at the front, so every fresh message would shift the whole window and
 * a long backfill would keep re-reading page one while never reaching the end.
 * Ascending means the cursor only ever moves forward and new conversations
 * append past it.
 */
async function syncConversations(c: Ctx) {
  const key = `ghl:conversations:${c.locationId}`;
  const st = await readState(c.s, key);
  let cursor: string | null = st?.cursor ?? null;
  let page = st?.page ?? 0;
  let seen = st?.items_seen ?? 0;
  let written = st?.items_written ?? 0;
  let total: number | null = null;

  while (!outOfTime(c)) {
    const qs = new URLSearchParams({
      locationId: c.locationId,
      limit: '100',
      sort: 'asc',
      sortBy: 'last_message_date',
    });
    if (cursor) qs.set('startAfterDate', cursor);

    const d = await ghl(c, `/conversations/search?${qs}`);
    const rows: any[] = d?.conversations ?? [];
    total = d?.total ?? total;

    if (!rows.length) {
      await writeState(c.s, key, { cursor, page, items_seen: seen, items_written: written, is_complete: true, last_error: null });
      return { done: true, page, seen, written, total };
    }

    const upserts = rows.map((r) => ({
      id: r.id,
      location_id: r.locationId ?? c.locationId,
      contact_id: r.contactId ?? null,
      last_message_at: toIso(r.lastMessageDate),
      last_message_type: r.lastMessageType ?? null,
      last_message_body: r.lastMessageBody ?? null,
      unread_count: typeof r.unreadCount === 'number' ? r.unreadCount : null,
      raw: r,
      updated_date: new Date().toISOString(),
    }));

    // Do NOT touch messages_synced_at here: a conversation already backfilled
    // must not be queued for a re-pull just because it received a new message.
    const { error } = await c.s.from('ghl_conversation')
      .upsert(upserts, { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw new Error(`conversation upsert failed: ${error.message}`);

    seen += rows.length;
    written += upserts.length;
    page += 1;

    // The `sort` array on the last row is this page's high-water mark.
    const lastSort = rows[rows.length - 1]?.sort;
    const next = Array.isArray(lastSort) ? String(lastSort[0]) : null;
    // A cursor that does not move means the next call would re-read this page
    // forever. Stop and record it rather than spin.
    if (!next || next === cursor) {
      await writeState(c.s, key, { cursor, page, items_seen: seen, items_written: written, is_complete: true, last_error: null });
      return { done: true, page, seen, written, total, note: 'cursor stopped advancing' };
    }
    cursor = next;

    await writeState(c.s, key, { cursor, page, items_seen: seen, items_written: written, is_complete: false, last_error: null });
    if (rows.length < 100) {
      await writeState(c.s, key, { is_complete: true });
      return { done: true, page, seen, written, total };
    }
    await sleep(PAUSE_MS);
  }
  return { done: false, page, seen, written, total };
}

// ---- the messages inside each thread -----------------------------------
async function syncMessages(c: Ctx, limitConversations: number) {
  // Newest conversations first: recent history is the part anyone will look at
  // soonest, and the long tail still gets there because the queue drains.
  const { data: pending, error } = await c.s
    .from('ghl_conversation')
    .select('id, contact_id, location_id, lead_id')
    .is('messages_synced_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limitConversations);
  if (error) throw new Error(`could not read pending conversations: ${error.message}`);

  let convDone = 0, msgWritten = 0, failed = 0;

  // One conversation, start to finish. Lifted out of the loop so several can be
  // in flight at once -- walking them one at a time is what made the first pass
  // crawl, since each thread is mostly a wait on GHL.
  const pullOne = async (conv: any) => {
    let lastMessageId: string | null = null;
    let guard = 0;
    let countForConv = 0;

    while (guard++ < 40) {
      const qs = new URLSearchParams({ limit: '100' });
      if (lastMessageId) qs.set('lastMessageId', lastMessageId);
      const d = await ghl(c, `/conversations/${conv.id}/messages?${qs}`);

      // GHL nests this one: { messages: { messages: [...], lastMessageId, nextPage } }
      const inner = d?.messages ?? {};
      const rows: any[] = Array.isArray(inner) ? inner : (inner.messages ?? []);
      if (!rows.length) break;

      const upserts = rows.map((m) => ({
        id: m.id,
        conversation_id: conv.id,
        location_id: m.locationId ?? conv.location_id ?? c.locationId,
        contact_id: m.contactId ?? conv.contact_id ?? null,
        lead_id: conv.lead_id ?? null,
        direction: m.direction ?? null,
        message_type: m.messageType ?? m.type ?? null,
        status: m.status ?? null,
        body: m.body ?? null,
        sent_at: toIso(m.dateAdded ?? m.dateUpdated),
        raw: m,
      }));

      const { error: mErr } = await c.s.from('ghl_message')
        .upsert(upserts, { onConflict: 'id', ignoreDuplicates: false });
      if (mErr) throw new Error(mErr.message);

      msgWritten += upserts.length;
      countForConv += upserts.length;

      const nextPage = inner.nextPage === true;
      const nextId = inner.lastMessageId ?? rows[rows.length - 1]?.id ?? null;
      if (!nextPage || !nextId || nextId === lastMessageId) break;
      lastMessageId = nextId;
      await sleep(PAUSE_MS);
    }

    await c.s.from('ghl_conversation').update({
      messages_synced_at: new Date().toISOString(),
      message_count: countForConv,
      last_error: null,
      updated_date: new Date().toISOString(),
    }).eq('id', conv.id);
  };

  // A shared queue rather than fixed slices, so one enormous thread cannot leave
  // three workers idle while it finishes.
  const queue = [...(pending ?? [])];
  const worker = async () => {
    while (queue.length && !outOfTime(c)) {
      const conv = queue.shift();
      if (!conv) return;
      try {
        await pullOne(conv);
        convDone += 1;
      } catch (e) {
        // One bad conversation must not stall the backfill. Record why and move
        // on; messages_synced_at stays null so it is retried on a later pass.
        failed += 1;
        await c.s.from('ghl_conversation')
          .update({ last_error: (e as Error).message, updated_date: new Date().toISOString() })
          .eq('id', conv.id);
      }
      await sleep(PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return { conversations_completed: convDone, messages_written: msgWritten, failed,
           left_in_batch: queue.length };
}

Deno.serve(async (req) => {
  const internal = await getSecret(svc(), 'CRON_SECRET');
  if (!internal || req.headers.get('x-internal-secret') !== internal) {
    return new Response('forbidden', { status: 401 });
  }
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const s = svc();
  const body = await req.json().catch(() => ({}));
  const mode = String(body.mode ?? 'both');
  const convLimit = Math.min(Number(body.conversation_limit ?? 25), 200);

  try {
    const token = await getSecret(s, 'GHL_PIT_TOKEN');
    if (!token) return Response.json({ ok: false, error: 'GHL_PIT_TOKEN is not set' }, { status: 503 });

    const { data: integ } = await s.from('integration').select('config').eq('key', 'ghl').maybeSingle();
    const locationId = integ?.config?.ghl_location_id;
    if (!locationId) return Response.json({ ok: false, error: 'ghl_location_id is not configured' }, { status: 503 });

    const c: Ctx = { s, token, locationId, deadline: Date.now() + TIME_BUDGET_MS };
    const out: Record<string, unknown> = { mode, location_id: locationId };

    if (mode === 'conversations' || mode === 'both') {
      out.conversations = await syncConversations(c);
    }
    if (mode === 'messages' || mode === 'both') {
      out.messages = await syncMessages(c, convLimit);
    }

    // Cheap, and it matters: a conversation pulled before its contact ever
    // became a lead would otherwise stay orphaned forever.
    const { data: linked } = await s.rpc('ghl_link_conversations_to_leads');
    out.linked = Array.isArray(linked) ? linked[0] : linked;

    const { count: convTotal } = await s.from('ghl_conversation').select('id', { count: 'exact', head: true });
    const { count: convPending } = await s.from('ghl_conversation')
      .select('id', { count: 'exact', head: true }).is('messages_synced_at', null);
    const { count: msgTotal } = await s.from('ghl_message').select('id', { count: 'exact', head: true });
    out.progress = {
      conversations_stored: convTotal ?? 0,
      conversations_awaiting_messages: convPending ?? 0,
      messages_stored: msgTotal ?? 0,
    };

    return Response.json({ ok: true, ...out });
  } catch (e) {
    console.error('ghlSync failed', (e as Error).message);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});
