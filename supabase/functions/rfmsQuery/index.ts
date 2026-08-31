// RFMS read/dispatch edge function — the on-demand half of the RFMS integration (the async
// background half lives in processJobs). One function, `type` discriminator (mirrors
// emailDispatch/smsDispatch). Reads run a bounded in-request poll via rfmsCall; write paths
// enqueue durable jobs. All Basic-auth + envelope handling is centralized in _shared/rfms.ts.
//
// Graceful degrade: rfmsContext() null (integration off / no creds) -> { stub: true }.
// Auth: internal secret OR an authenticated user; a couple of types additionally require org-admin.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireModules } from '../_shared/authz.ts';
import { rfmsContext, rfmsCall, svcClient, getSecret } from '../_shared/rfms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

// RFMS advanced-find expects MM-DD-YYYY; callers send ISO yyyy-MM-dd (base44's OrderPool bug).
function toRFMSDate(d: any): any {
  if (!d) return d;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  return m ? `${m[2]}-${m[3]}-${m[1]}` : d;
}

async function handle(s: any, type: string, p: any, req: Request, isInternal: boolean): Promise<Record<string, unknown>> {
  const ctx = await rfmsContext(s);
  if (!ctx) return { stub: true };
  const pollSync = { poll: { inRequest: true } };

  switch (type) {
    case 'order_search': { // getRFMSOrders
      const body = p.searchText
        ? { searchText: p.searchText }
        : p.dateField === 'install'
          ? { estimatedDeliveryFrom: toRFMSDate(p.orderDateFrom), estimatedDeliveryTo: toRFMSDate(p.orderDateTo) }
          : { orderDateFrom: toRFMSDate(p.orderDateFrom), orderDateTo: toRFMSDate(p.orderDateTo) };
      const res = await rfmsCall(s, ctx, '/order/find/advanced', { method: 'POST', body, ...pollSync });
      if (res.waiting) return { success: false, waiting: true, orders: [] };
      const arr = Array.isArray(res.result) ? res.result : (res.result?.detail || res.raw?.detail || []);
      return { success: true, orders: arr.filter((o: any) => !o.voided) };
    }
    case 'crews': { // getRFMSCrews
      const res = await rfmsCall(s, ctx, '/crews', pollSync);
      if (res.waiting) return { waiting: true, crews: { detail: [] } };
      return { crews: { detail: Array.isArray(res.result) ? res.result : (res.result?.detail || []) } };
    }
    case 'jobs': { // getRFMSJobs
      const res = await rfmsCall(s, ctx, `/order/jobs/${p.invoiceNumber}`, pollSync);
      if (res.waiting) return { success: false, waiting: true, jobs: [] };
      return { success: true, jobs: Array.isArray(res.result) ? res.result : (res.result?.detail || []) };
    }
    case 'order_notes': { // getRFMSOrderNotes
      const doc = p.documentNumber;
      const isQuote = String(doc).toUpperCase().startsWith('ES');
      const res = await rfmsCall(s, ctx, isQuote ? `/quote/${doc}` : `/order/${doc}`, pollSync);
      if (res.waiting) return { success: false, waiting: true };
      const r: any = res.result || {};
      const lineNotes = (r.lines || []).filter((l: any) => l.notes && String(l.notes).trim()).map((l: any) => ({ lineNumber: l.lineNumber, styleName: l.styleName, notes: l.notes }));
      return { success: true, privateNotes: r.privateNotes || '', publicNotes: r.publicNotes || '', workOrderNotes: r.workOrderNotes || '', lineNotes };
    }
    case 'order_get': { // testOrderDirect / SaleDetail manual fetch
      const doc = p.documentNumber || p.invoiceNumber;
      const isQuote = String(doc).toUpperCase().startsWith('ES');
      const res = await rfmsCall(s, ctx, isQuote ? `/quote/${doc}` : `/order/${doc}`, pollSync);
      if (res.waiting) return { success: false, waiting: true };
      return { success: true, order: res.raw };
    }
    case 'customers_search': { // getRFMSCustomers (admin)
      if (!isInternal && !(await isOrgAdmin(req))) return { error: 'Forbidden', success: false };
      const body: any = {};
      const from = p.orderDateFrom || p.dateCreatedFrom, to = p.orderDateTo || p.dateCreatedTo;
      if (from) body.orderDateFrom = toRFMSDate(from);
      if (to) body.orderDateTo = toRFMSDate(to);
      if (p.searchText) body.searchText = p.searchText;
      if (p.salespersonName) body.salespersonName = p.salespersonName;
      const res = await rfmsCall(s, ctx, '/order/find/advanced', { method: 'POST', body, ...pollSync });
      if (res.waiting) return { success: false, waiting: true, data: { result: [] } };
      return { success: true, data: { result: Array.isArray(res.result) ? res.result : (res.result?.detail || []) } };
    }
    case 'check_order': { // getRFMSOrder (admin) -> enqueue per-doc on-hold cache writes
      if (!isInternal && !(await isOrgAdmin(req))) return { error: 'Forbidden', success: false };
      const docs = Array.isArray(p.documentNumbers) ? p.documentNumbers : [];
      for (const doc of docs) await s.rpc('enqueue_job', { p_type: 'rfms_check_order', p_payload: { documentNumber: doc } });
      return { success: true, queued: docs.length };
    }
    case 'send_customer': { // sendToRFMS -> stamp syncing + enqueue direct customer create
      if (!p.appointmentId) return { error: 'appointmentId required', success: false };
      await s.from('appointment').update({ rfms_sync_status: 'syncing' }).eq('id', p.appointmentId);
      await s.rpc('enqueue_job', { p_type: 'rfms_customer_create', p_payload: { appointmentId: p.appointmentId } });
      return { success: true, status: 'syncing' };
    }
    case 'append_note': { // appendRFMSOrderNotes (synchronous — UI awaits + refetches)
      if (!p.documentNumber || !p.noteText) return { error: 'documentNumber and noteText required', success: false };
      const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' });
      const res = await rfmsCall(s, ctx, '/order/notes', { method: 'POST', body: { number: p.documentNumber, [p.noteType || 'publicNotes']: `[${p.userName || 'System'} - ${ts}]\n${p.noteText}` }, ...pollSync });
      if (res.waiting) return { success: false, waiting: true };
      return { success: true };
    }
    case 'jobs_find': { // getRFMSJobsFind -> enqueue durable cache enrichment
      await s.rpc('enqueue_job', { p_type: 'sync_rfms_jobs', p_payload: { startDate: toRFMSDate(p.startDate), endDate: toRFMSDate(p.endDate) } });
      return { success: true, queued: true };
    }
    default:
      return { error: `Unknown rfms type ${type}`, success: false };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const s = svcClient();
  const internal = await getSecret(s, 'CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  if (!isInternal) {
    const user = await currentUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
    // 0114 punch list: a JWT alone is not authorization. This also excludes
    // crew logins (active, role-less) and inactive signups (see _shared/authz.ts).
    const denied = await requireModules(req, cors, ['order_processing','projects','journey','finance','sales'], 'view');
    if (denied) return denied;
  }

  try {
    const p = await req.json();
    if (!p?.type) return Response.json({ error: 'type required' }, { status: 400, headers: cors });
    const result = await handle(s, p.type, p, req, isInternal);
    const status = result.error ? (result.error === 'Forbidden' ? 403 : 400) : 200;
    return Response.json(result, { status, headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
