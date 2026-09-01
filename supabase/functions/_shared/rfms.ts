// Shared RFMS client — the ONE place RFMS auth + the async envelope live, so the live spike
// (with real Store Queue + API Token) tunes a single file. Imported by processJobs (durable
// job handlers) and the rfmsQuery edge function.
//
// Fixes every base44 RFMS bug at once:
//  - Auth is documented HTTP BASIC, not Bearer. session/begin uses Basic base64(storeQueue:apiToken);
//    every subsequent call uses Basic base64(storeQueue:sessionToken) — SAME username, only the
//    password changes. base44 sent everything as Bearer.
//  - The API is ASYNC store-and-forward: every response is { status: 'success'|'waiting'|'failed',
//    result }. 'waiting' = the store's DB hasn't replied — poll again. base44 read results
//    synchronously and silently treated 'waiting' as empty data. rfmsCall handles all three.
//  - Sessions are cached in rfms_session and reused until (expiry - 5min), refreshed on 401.
//
// Graceful degrade: rfmsContext() returns null when the integration is disabled or a secret is
// missing, so callers emit { stub: true } like the other credential-gated clusters.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getSecret(s: any, name: string): Promise<string | null> {
  const { data, error } = await s.rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

export interface RfmsCtx {
  base: string;
  storeQueue: string;
  apiToken: string;
  tokenPosition: string; // 'password' (default) | 'username' — where the sessionToken sits in Basic
}

// Returns null when RFMS isn't configured yet (caller emits { stub: true }).
export async function rfmsContext(s: any): Promise<RfmsCtx | null> {
  const { data: integ } = await s.from('integration').select('is_enabled, config').eq('key', 'rfms').maybeSingle();
  if (!integ?.is_enabled) return null;
  const storeQueue = await getSecret(s, 'RFMS_STORE_QUEUE');
  const apiToken = await getSecret(s, 'RFMS_API_TOKEN');
  if (!storeQueue || !apiToken) return null;
  const cfg = (integ.config as Record<string, any>) || {};
  return {
    base: cfg.base_url || 'https://api.rfms.online/v2',
    storeQueue,
    apiToken,
    tokenPosition: cfg.session_token_position || 'password',
  };
}

interface Session { storeId: string | null; sessionToken: string; }

// Reuse the newest cached session until it's within 5 min of expiry; else begin a new one.
async function getSession(s: any, ctx: RfmsCtx, forceNew = false): Promise<Session> {
  if (!forceNew) {
    const { data: rows } = await s.from('rfms_session').select('*').order('created_date', { ascending: false }).limit(1);
    const sess = rows?.[0];
    if (sess?.session_token && sess.session_expires && new Date(sess.session_expires) > new Date(Date.now() + 5 * 60 * 1000)) {
      return { storeId: sess.store_id, sessionToken: sess.session_token };
    }
  }
  const r = await fetch(`${ctx.base}/session/begin`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${ctx.storeQueue}:${ctx.apiToken}`), 'Content-Type': 'application/json' },
  });
  const text = await r.text();
  let d: any; try { d = JSON.parse(text); } catch { d = text; }
  if (!r.ok) throw new Error(`RFMS session/begin HTTP ${r.status}: ${typeof d === 'string' ? d : JSON.stringify(d).slice(0, 300)}`);
  // storeId is NOT part of the documented session/begin response and is expected to be
  // null. It is recorded only if RFMS volunteers one; nothing authenticates with it.
  const storeId = d.storeId ?? d.result?.storeId ?? null;
  const sessionToken = d.sessionToken ?? d.result?.sessionToken;
  const sessionExpires = d.sessionExpires ?? d.result?.sessionExpires;
  if (!sessionToken) throw new Error(`RFMS session/begin returned no sessionToken: ${JSON.stringify(d).slice(0, 300)}`);
  await s.from('rfms_session').insert({ store_id: storeId, session_token: sessionToken, session_expires: sessionExpires, bearer_token: btoa(`${ctx.storeQueue}:${sessionToken}`) });
  return { storeId, sessionToken };
}

// Basic credential for every post-session call.
//
// THE USERNAME IS THE STORE QUEUE, BOTH TIMES. RFMS states it without ambiguity: "The
// session token must be sent with all API requests as the password using HTTP Basic
// Auth. User name should be set using the same user name you used in the first step."
// So the pair is (storeQueue : sessionToken) and the ONLY thing that changes between
// session/begin and everything after it is the password.
//
// This previously read `sess.storeId`, which session/begin does not return -- that call
// responds {authorized, sessionToken, sessionExpires}. `storeId` is a field on a STORE
// RECORD (GET /v2/stores/:id -> [{storeId, isDefault}]), not a credential. So the value
// was always undefined and every authenticated request would have gone out as
// Basic base64("undefined:<sessionToken>").
//
// It has never actually fired, which is why it survived review: rfms_session holds zero
// rows because session/begin itself 403s while Web API is unchecked on install 61152.
// One bug was standing in front of the other. The moment that box is ticked, the first
// call would have succeeded and every call after it failed -- presenting as "the API
// still doesn't work" and sending us back to re-check credentials that were fine.
//
// tokenPosition stays as an escape hatch, but the default is now the documented behaviour
// rather than a guess awaiting a live spike.
function sessionAuth(sess: Session, ctx: RfmsCtx): string {
  const pair = ctx.tokenPosition === 'username'
    ? `${sess.sessionToken}:${sess.sessionToken}`
    : `${ctx.storeQueue}:${sess.sessionToken}`;
  return 'Basic ' + btoa(pair);
}

// Collapse RFMS's result/detail/order.result scatter to one canonical payload.
export function normalizeResult(d: any): any {
  if (d == null) return null;
  return d.result ?? d.detail ?? d?.order?.result ?? d;
}

export interface RfmsResult { waiting: boolean; result: any; raw: any; }

// The single RFMS entry point. Handles Basic auth, 401-refresh, 429 backoff, and the async
// { status } envelope. Synchronous callers pass poll.inRequest=true (bounded in-request poll);
// job handlers pass poll.inRequest=false and re-enqueue themselves on { waiting: true }.
export async function rfmsCall(
  s: any,
  ctx: RfmsCtx,
  path: string,
  opts: { method?: string; body?: any; poll?: { inRequest?: boolean; maxAttempts?: number } } = {},
): Promise<RfmsResult> {
  const method = opts.method || 'GET';
  const poll = opts.poll || {};
  let sess = await getSession(s, ctx);

  const doFetch = async () => {
    const init: RequestInit = { method, headers: { Authorization: sessionAuth(sess, ctx), 'Content-Type': 'application/json' } };
    if (opts.body != null) init.body = JSON.stringify(opts.body);
    return await fetch(`${ctx.base}${path}`, init);
  };

  let attempt = 0;
  const maxAttempts = poll.maxAttempts ?? 5;
  while (true) {
    let r = await doFetch();
    if (r.status === 401) { sess = await getSession(s, ctx, true); r = await doFetch(); }
    if (r.status === 429) {
      const ra = parseInt(r.headers.get('retry-after') || '2', 10);
      if (poll.inRequest && attempt < maxAttempts) { await sleep(Math.min(ra || 2, 10) * 1000); attempt++; continue; }
      throw new Error('RFMS rate limited (429)');
    }
    const text = await r.text();
    let d: any; try { d = JSON.parse(text); } catch { d = text; }
    if (!r.ok) throw new Error(`RFMS ${path} HTTP ${r.status}: ${typeof d === 'string' ? d : JSON.stringify(d).slice(0, 300)}`);

    const status = d?.status;
    if (status === 'waiting') {
      if (poll.inRequest && attempt < maxAttempts) { await sleep(Math.min(2 ** attempt, 10) * 1000); attempt++; continue; }
      return { waiting: true, result: null, raw: d };
    }
    if (status === 'failed') throw new Error(`RFMS ${path} failed: ${JSON.stringify(d.result ?? d).slice(0, 300)}`);
    return { waiting: false, result: normalizeResult(d), raw: d };
  }
}

// Convenience for edge functions: build a service client from env.
export function svcClient(): any {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}
