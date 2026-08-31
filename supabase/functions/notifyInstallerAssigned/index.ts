// notifyInstallerAssigned — ports base44's installer-assignment notification. When a manager
// assigns an installer crew to a project (Journey), this texts + emails that crew the job
// details (customer, address, install date). Routes through the durable queue
// (enqueue_job send_sms/send_email -> sendMessage: suppression, tracking, retry, skip-when-
// unconfigured) and honors test/customer divert — same pattern as submitCheckpoint.
// Non-fatal by contract: the caller wraps this in try/catch, so it must never block the
// assignment. Auth: an authenticated user (manager) OR the internal secret.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireModules } from '../_shared/authz.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const APP_URL = Deno.env.get('APP_URL') || 'https://razzle-dazzle-supabase.vercel.app';
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function getSecret(s: any, name: string): Promise<string | null> {
  const { data, error } = await s.rpc('get_secret', { p_name: name });
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
function divertEmail(cfg: any, to: string): string | null {
  if (cfg.test_divert_enabled && cfg.test_divert_email) return cfg.test_divert_email;
  return to || null;
}
function divertSms(cfg: any, to: string): string | null {
  if (cfg.test_divert_enabled && cfg.test_divert_phone) return cfg.test_divert_phone;
  return to || null;
}
async function qEmail(s: any, cfg: any, to: string, subject: string, body: string): Promise<boolean> {
  const dest = divertEmail(cfg, to);
  if (!dest) return false;
  await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: dest, subject, body, sent_by: 'System' } });
  return true;
}
async function qSms(s: any, cfg: any, to: string, body: string): Promise<boolean> {
  const dest = divertSms(cfg, to);
  if (!dest) return false;
  await s.rpc('enqueue_job', { p_type: 'send_sms', p_payload: { to: dest, body, sent_by: 'System' } });
  return true;
}
function fmtDate(d: string | null): string {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const s = svc();
  const internal = await getSecret(s, 'CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  if (!isInternal && !(await currentUser(req))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }
  if (!isInternal) {
    // 0114 punch list: assigning-crew notifications are a projects/journey action.
    const denied = await requireModules(req, cors, ['projects','journey'], 'edit');
    if (denied) return denied;
  }

  try {
    const { project_id, crew_id } = await req.json();
    if (!project_id || !crew_id) return Response.json({ error: 'project_id and crew_id are required' }, { status: 400, headers: cors });

    const { data: project } = await s.from('project').select('*').eq('id', project_id).maybeSingle();
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404, headers: cors });

    const { data: installer } = await s.from('installer').select('*').eq('crew_id', crew_id).maybeSingle();
    if (!installer) return Response.json({ success: true, notified: false, skipped: 'installer not found' }, { headers: cors });

    const { data: customer } = project.customer
      ? await s.from('customer').select('first_name, last_name, address_line1, city, state').eq('id', project.customer).maybeSingle()
      : { data: null };
    const { data: cfgRow } = await s.from('sms_settings').select('*').limit(1).maybeSingle();
    const cfg = cfgRow || {};

    const customerName = customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'a customer' : 'a customer';
    const addr = [customer?.address_line1, customer?.city, customer?.state].filter(Boolean).join(', ');
    const dateStr = fmtDate(project.installation_date);
    const link = `${APP_URL}/JourneyProjectDetail?project_id=${project_id}`;

    const smsBody = `Floor Daddy: You're assigned to install for ${customerName}`
      + (addr ? ` at ${addr}` : '') + (dateStr ? ` on ${dateStr}` : '') + `. Details: ${link}`;
    const emailBody = `<p>Hi ${installer.crew_name || 'there'},</p>`
      + `<p>You've been assigned to a Floor Daddy installation:</p>`
      + `<ul>`
      + `<li><strong>Customer:</strong> ${customerName}</li>`
      + (addr ? `<li><strong>Address:</strong> ${addr}</li>` : '')
      + (dateStr ? `<li><strong>Install date:</strong> ${dateStr}</li>` : '')
      + `</ul>`
      + `<p><a href="${link}">View the project details</a></p>`;

    const sms = installer.phone ? await qSms(s, cfg, installer.phone, smsBody) : false;
    const email = installer.email ? await qEmail(s, cfg, installer.email, `[Installer] New Assignment — ${customerName}`, emailBody) : false;

    return Response.json({ success: true, notified: sms || email, sms, email }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
