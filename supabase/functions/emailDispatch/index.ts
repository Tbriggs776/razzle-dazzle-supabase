// Transactional email dispatcher. One function for the base44 email-sender fleet:
// each `type` gathers its entity data, renders a template (from settings or inline),
// resolves recipients (+ divert), and enqueues a durable send_email job through the
// comms pipeline (suppression, delivery tracking, retry). It does NOT call Resend
// directly — sendMessage does, so a transient failure retries instead of double-sending.
//
// Auth: an internal secret (server/tests) OR an authenticated user (browser invoke).
// Add a new sender = add a case here + a shim alias; no new deploy per sender.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const APP_URL = 'https://razzle-dazzle-supabase.vercel.app';
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
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data } = await asUser.auth.getUser();
  return data?.user ?? null;
}

function render(tpl: string, vars: Record<string, unknown>): string {
  let r = tpl || '';
  for (const [k, v] of Object.entries(vars)) r = r.replaceAll(`{${k}}`, (v ?? 'N/A') as string);
  return r;
}

async function one(s: any, table: string, id: string | null) {
  if (!id) return null;
  const { data } = await s.from(table).select('*').eq('id', id).maybeSingle();
  return data;
}

// Enqueue a send_email job, splitting a recipient list into to + bcc (hidden list).
async function enqueueEmail(s: any, recipients: string[], subject: string, body: string, refs: Record<string, unknown>) {
  await s.rpc('enqueue_job', {
    p_type: 'send_email',
    p_payload: { to: recipients[0], bcc: recipients.slice(1), subject, body, sent_by: 'System', ...refs },
  });
  return recipients.length;
}

async function handleType(s: any, type: string, p: any): Promise<Record<string, unknown>> {
  switch (type) {
    case 'sale_confirmation': {
      // Internal ops notification when a sale closes. Recipients = email_settings.cc_emails.
      const sale = await one(s, 'sale', p.saleId);
      if (!sale) return { error: 'Sale not found' };
      const { data: esList } = await s.from('email_settings').select('*').limit(1);
      const es: any = esList?.[0] || {};
      if (es.send_sale_confirmation_email === false) return { skipped: 'disabled' };
      const cc: string[] = Array.isArray(es.cc_emails) ? es.cc_emails : [];
      const recipients = es.divert_all_emails_to ? [es.divert_all_emails_to] : cc;
      if (!recipients.length) return { skipped: 'no recipients configured' };

      const customer = await one(s, 'customer', sale.customer);
      const appt = await one(s, 'appointment', sale.appointment);
      const dc = await one(s, 'team_member', sale.assigned_dc);
      const vars = {
        customer_name: customer ? `${customer.first_name} ${customer.last_name}` : 'N/A',
        sale_amount: sale.sale_amount ?? 'TBD',
        consultant_name: dc ? `${dc.first_name} ${dc.last_name}` : 'N/A',
        appointment_date: appt?.appointment_date ?? 'N/A',
        location_address: appt?.location_address ?? 'N/A',
        sale_detail_url: `${APP_URL}/SaleDetail?id=${sale.id}`,
      };
      const body = render(es.sale_confirmation_template, vars);
      const n = await enqueueEmail(s, recipients, `New Sale Closed - ${vars.customer_name}`, body, { customer_id: sale.customer });
      return { queued: true, type, recipients: n };
    }
    default:
      return { error: `Unknown email type "${type}"` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const internal = await getSecret('CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  if (!isInternal) {
    const user = await currentUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  try {
    const p = await req.json();
    if (!p?.type) return Response.json({ error: 'type required' }, { status: 400, headers: cors });
    const result = await handleType(svc(), p.type, p);
    const status = result.error ? 400 : 200;
    return Response.json(result, { status, headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
