// Installer onboarding: fire the notifications when an application is approved. Called by the
// staff review page right after it flips status to 'approved'. It (1) creates the e-sign requests
// for the applicable agreements the applicant hasn't signed yet — Master + Claims always, ACH if
// they elected direct deposit — suppressing each doc's own email; (2) sends the applicant ONE
// consolidated "you're approved, sign here" email with every signing link; and (3) pings the team.
//
// Nothing actually leaves the building until Resend is configured at /Integrations (all sends
// enqueue on the durable job queue and gracefully skip while the provider is off).
//
// Auth mirrors esign 'create': an authenticated staffer with edit on sales/appointments/projects
// or org-admin, or an internal (x-internal-secret) caller. verify_jwt off at the gateway.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const APP_URL = Deno.env.get('APP_URL') || 'https://razzle-dazzle-supabase.vercel.app';
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const esc = (x: unknown) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const internal = await getSecret('CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  let user: any = null;
  if (!isInternal) {
    user = await currentUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
    const [{ data: eSales }, { data: eAppts }, { data: eProjects }, { data: isAdmin }] = await Promise.all([
      asUser.rpc('can_edit', { m: 'sales' }), asUser.rpc('can_edit', { m: 'appointments' }),
      asUser.rpc('can_edit', { m: 'projects' }), asUser.rpc('is_org_admin'),
    ]);
    if (!eSales && !eAppts && !eProjects && !isAdmin) return Response.json({ error: 'Not authorized' }, { status: 403, headers: cors });
  }

  try {
    const { application_id } = await req.json();
    if (!application_id) return Response.json({ error: 'application_id required' }, { status: 400, headers: cors });

    const s = svc();
    const { data: app } = await s.from('installer_application').select('*').eq('id', application_id).maybeSingle();
    if (!app) return Response.json({ error: 'application not found' }, { status: 404, headers: cors });

    // Agreements still needing a signature.
    const docs: { type: string; label: string }[] = [];
    if (!app.master_packet_signed_at) docs.push({ type: 'installer_master', label: 'Independent Subcontractor Master Agreement' });
    if (!app.claims_signed_at) docs.push({ type: 'installer_claims', label: 'Claims & Warranty Agreement' });
    if (app.elect_direct_deposit && !app.ach_signed_at) docs.push({ type: 'installer_ach', label: 'Direct Deposit / ACH Authorization' });

    // Create each e-sign request (suppressing its own email — we send one combined email below).
    const links: { label: string; url: string }[] = [];
    for (const d of docs) {
      const r = await fetch(`${FUNCTIONS_BASE}/esign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': internal || '' },
        body: JSON.stringify({ action: 'create', document_type: d.type, document_id: application_id, suppress_email: true }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (j?.sign_url) links.push({ label: d.label, url: j.sign_url });
    }

    // 1) Applicant email.
    const to = app.contact_email as string | null;
    const name = app.contact_name || app.signatory_name || 'there';
    if (to && links.length) {
      const linkHtml = links.map((l) =>
        `<p style='margin:14px 0;'><a href='${l.url}' style='background:#4F46E5;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;'>Review &amp; sign: ${esc(l.label)}</a></p>`).join('');
      const body =
        `<div style='font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;'>` +
        `<h2 style='color:#0f172a;'>You're approved to install with Floor Daddy 🎉</h2>` +
        `<p>Hi ${esc(name)}, congratulations — your installer application has been approved. The last step is to review and e-sign your agreement${links.length > 1 ? 's' : ''} below. When you open each one, we'll text you a 6-digit code to confirm it's you.</p>` +
        linkHtml +
        `<p style='color:#64748b;font-size:13px;margin-top:18px;'>Once everything is signed, you'll be ready to receive work orders. Reply to this email if you have any questions.</p>` +
        `<p style='color:#94a3b8;font-size:12px;'>— The Floor Daddy Team</p></div>`;
      await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to, subject: "You're approved — sign your Floor Daddy agreements", body, sent_by: 'System' } });
    } else if (to) {
      const body = `<p>Hi ${esc(name)}, your installer application is approved and all your agreements are signed — you're all set. Welcome aboard!</p><p style='color:#94a3b8;font-size:12px;'>— The Floor Daddy Team</p>`;
      await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to, subject: "You're approved — Floor Daddy", body, sent_by: 'System' } });
    }

    // 2) Team notification (best-effort, to the internal alert email list if configured).
    const { data: ss } = await s.from('sms_settings').select('inbound_sms_alert_emails').limit(1);
    const staff: string[] = Array.isArray(ss?.[0]?.inbound_sms_alert_emails) ? ss[0].inbound_sms_alert_emails : [];
    if (staff.length) {
      const who = user?.user_metadata?.full_name || user?.email || 'A team member';
      const body =
        `<p>${esc(who)} approved the installer application for <strong>${esc(app.legal_business_name || app.roc_business_name || 'an applicant')}</strong> (ROC ${esc(app.roc_license_no || '—')}).</p>` +
        `<p>${links.length} agreement${links.length === 1 ? '' : 's'} sent for signature to ${esc(to || 'the applicant')}.</p>` +
        `<p><a href='${APP_URL}/InstallerApplications'>Open Installer Applications &rarr;</a></p>`;
      await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: staff[0], bcc: staff.slice(1), subject: `Installer approved: ${app.legal_business_name || app.roc_business_name || ''}`.trim(), body, sent_by: 'System' } });
    }

    return Response.json({ ok: true, agreements_sent: links.length, applicant_emailed: !!to, team_notified: staff.length > 0 }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
