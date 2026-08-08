// Daily finance report — emails the finance recipient list a table of every project
// currently in "pending payment", so nothing slips. Cron-triggered daily via
// post_internal_fn() -> net.http_post with the internal secret. Builds the report
// and enqueues a durable send_email job (sendMessage does the actual send).
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

// Dual auth: the daily cron passes the internal secret; the manual "Send Report Now"
// button passes an authenticated admin's JWT. Either is allowed.
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

function money(n: unknown): string {
  return n != null && n !== '' ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const internal = await getSecret('CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  if (!isInternal) {
    const user = await currentUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  const s = svc();
  const { data: ss } = await s.from('sms_settings').select('finance_report_emails').limit(1);
  const recipients: string[] = Array.isArray(ss?.[0]?.finance_report_emails) ? ss[0].finance_report_emails : [];
  if (!recipients.length) return Response.json({ skipped: 'no finance recipients configured' }, { headers: cors });

  const { data: projects } = await s.from('project').select('*').eq('installation_date_status', 'pending payment');
  if (!projects || !projects.length) return Response.json({ skipped: 'no pending-payment projects' }, { headers: cors });

  const custIds = [...new Set(projects.map((p: any) => p.customer).filter(Boolean))];
  const saleIds = [...new Set(projects.map((p: any) => p.sale).filter(Boolean))];
  const { data: custs } = await s.from('customer').select('id,first_name,last_name,address_line1,city').in('id', custIds.length ? custIds : ['_none_']);
  const { data: sales } = await s.from('sale').select('id,sale_amount,invoice_number').in('id', saleIds.length ? saleIds : ['_none_']);
  const cMap: any = Object.fromEntries((custs || []).map((c: any) => [c.id, c]));
  const sMap: any = Object.fromEntries((sales || []).map((x: any) => [x.id, x]));

  const rows = projects.map((p: any) => {
    const c = cMap[p.customer]; const sale = sMap[p.sale];
    const name = c ? `${c.first_name} ${c.last_name}` : 'Unknown';
    const addr = c?.address_line1 ? `${c.address_line1}${c.city ? ', ' + c.city : ''}` : '—';
    const inst = p.installation_date ? new Date(p.installation_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const td = `padding:8px 12px;border-bottom:1px solid #e2e8f0;`;
    return `<tr><td style='${td}'>${name}</td><td style='${td}'>${sale?.invoice_number || '—'}</td>` +
      `<td style='${td}'>${addr}</td><td style='${td}'>${inst}</td>` +
      `<td style='${td}color:#059669;font-weight:600;'>${money(sale?.sale_amount)}</td></tr>`;
  }).join('');

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const th = `padding:8px 12px;text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;`;
  const html =
    `<div style='font-family:-apple-system,Segoe UI,sans-serif;max-width:800px;margin:0 auto;color:#1e293b;'>` +
    `<h2 style='color:#059669;'>💰 Finance Report — ${today}</h2>` +
    `<p>${projects.length} project(s) currently have a <strong>Pending Payment</strong> status.</p>` +
    `<table style='width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8f0;border-radius:8px;'>` +
    `<thead><tr style='background:#f8fafc;'><th style='${th}'>Customer</th><th style='${th}'>Invoice #</th>` +
    `<th style='${th}'>Address</th><th style='${th}'>Install</th><th style='${th}'>Amount</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<p style='margin-top:20px;'><a href='${APP_URL}/Finance' style='background:#10b981;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;'>View Finance Page</a></p></div>`;

  await s.rpc('enqueue_job', {
    p_type: 'send_email',
    p_payload: { to: recipients[0], bcc: recipients.slice(1), subject: `Finance Report: ${projects.length} Pending Payment Project(s) — ${today}`, body: html, sent_by: 'System' },
  });

  return Response.json({ queued: true, projects: projects.length, recipients: recipients.length }, { headers: cors });
});
