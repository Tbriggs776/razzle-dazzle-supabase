// Pull RFMS customer orders into public.rfms_order_summary.
//
// A DEDICATED FUNCTION, not another action on rfmsQuery, and that is deliberate.
// rfmsQuery is the operational client: it is gated on integration.is_enabled, it
// writes to sale/project caches, and enabling it arms trg_sale_rfms_fetch. This does
// one thing, reads secrets directly, and writes to exactly one table. Keeping it
// separate means "refresh the order history" can never be confused with, or
// accidentally acquire, an operational side effect.
//
// IT WRITES TO rfms_order_summary AND NOTHING ELSE. No sale rows, no projects, no
// tasks, no jobs. That matters because of the owner's rule: orders older than
// 2026-01-01 are for reporting only and must not reach automation. The boundary is
// enforced in the schema (is_historical, rfms_order_actionable), but the cheapest
// guarantee is that this function has no vocabulary for creating work.
//
//   POST { from: '2026-01-01', to: '2026-09-30' }
//
// Auth: internal secret, or an org admin.
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

async function isOrgAdmin(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const u = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
  });
  const { data } = await u.rpc('is_org_admin');
  return data === true;
}

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const internal = await getSecret('CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  if (!isInternal && !(await isOrgAdmin(req))) {
    return Response.json({ error: 'Forbidden' }, { status: 403, headers: cors });
  }

  const s = svc();
  try {
    const p = await req.json().catch(() => ({}));
    // Default window is the current year. Deliberately NOT "everything": RFMS history
    // starts 2024-04-09 and a full re-pull is ~4,100 orders, which is a spike to ask
    // for on purpose rather than to get by leaving the body empty.
    const from = String(p.from || `${new Date().getFullYear()}-01-01`);
    const to = String(p.to || new Date().toISOString().slice(0, 10));

    const storeQueue = await getSecret('RFMS_STORE_QUEUE');
    const apiToken = await getSecret('RFMS_API_TOKEN');
    if (!storeQueue || !apiToken) return Response.json({ stub: true, reason: 'no RFMS credentials' }, { headers: cors });

    const base = 'https://api.rfms.online/v2';

    // Session. The store queue is the username at BOTH steps -- only the password
    // changes. It must carry its `store-` prefix; a bare GUID returns an opaque 403
    // that looks identical to an entitlement problem and cost a morning once.
    const sr = await fetch(`${base}/session/begin`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${storeQueue}:${apiToken}`), 'Content-Type': 'application/json' },
    });
    if (!sr.ok) return Response.json({ error: `session/begin ${sr.status}: ${(await sr.text()).slice(0, 200)}` }, { status: 502, headers: cors });
    const sd = await sr.json();
    const storeId = sd.storeId ?? storeQueue;
    const sessionToken = sd.sessionToken;
    if (!sessionToken) return Response.json({ error: 'session/begin returned no sessionToken' }, { status: 502, headers: cors });

    const orderRes = await fetch(`${base}/order/find/advanced`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${storeId}:${sessionToken}`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderDateFrom: from, orderDateTo: to }),
    });
    if (!orderRes.ok) return Response.json({ error: `order/find/advanced ${orderRes.status}: ${(await orderRes.text()).slice(0, 200)}` }, { status: 502, headers: cors });

    const od = await orderRes.json();
    // The async store-and-forward envelope: success | waiting | failed. 'waiting'
    // means the store has not replied yet and is NOT an empty result -- treating it
    // as one would silently wipe a window of orders on the next upsert.
    if (od?.status === 'waiting') return Response.json({ ok: true, waiting: true, note: 'RFMS has not replied yet — call again' }, { headers: cors });
    if (od?.status === 'failed') return Response.json({ error: `RFMS refused: ${JSON.stringify(od.result).slice(0, 200)}` }, { status: 502, headers: cors });

    const orders: any[] = od?.result ?? [];
    const rows = orders
      .filter((o) => o?.documentNumber)
      .map((o) => ({
        document_number: o.documentNumber,
        order_date: (o.orderDate || '').slice(0, 10) || null,
        invoice_date: (o.invoiceDate || '').slice(0, 10) || null,
        order_total: num(o.orderTotal),
        grand_total: num(o.grandTotal),
        balance_due: num(o.balanceDue),
        paid: num(o.paid),
        voided: String(o.voided ?? '').toLowerCase() === 'true',
        store: o.store ?? null,
        job_number: o.jobNumber ?? null,
        po_number: o.poNumber ?? null,
        salesperson1: o.salesperson1 ?? null,
        customer_id: o.customer?.customerId != null ? String(o.customer.customerId) : null,
        customer_name: [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || null,
        customer_phone: o.customer?.phone1 ?? null,
        customer_email: o.customer?.email ?? null,
        customer_city: o.customer?.city ?? null,
        customer_state: o.customer?.state ?? null,
        synced_at: new Date().toISOString(),
      }));

    let written = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await s.from('rfms_order_summary').upsert(chunk, { onConflict: 'document_number' });
      if (error) return Response.json({ error: `write failed at row ${i}: ${error.message}`, written }, { status: 500, headers: cors });
      written += chunk.length;
    }

    return Response.json({
      ok: true, from, to, returned: orders.length, written,
      note: 'rfms_order_summary only — no sales, projects, tasks or jobs were created',
    }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
