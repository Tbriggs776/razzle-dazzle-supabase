// Transactional email dispatcher. One function for the base44 email-sender fleet:
// each `type` gathers its entity data, renders a template (settings or inline),
// resolves recipients (+ divert), and enqueues a durable send_email job through the
// comms pipeline (suppression, delivery tracking, retry). It does NOT call Resend
// directly — sendMessage does, so a transient failure retries instead of double-sending.
//
// Auth: an internal secret (server/tests) OR an authenticated user (browser invoke).
// Add a sender = add a case here + a shim alias; no new deploy per sender.
// HTML uses single-quoted attributes throughout (deploy-safe, valid HTML).
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

function money(n: unknown): string {
  return n != null && n !== '' ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—';
}

// Long human date (e.g. "Monday, August 10, 2026"); date-only strings are read as
// local midnight so the weekday doesn't drift a day.
function fmtDate(d: unknown): string {
  if (!d) return 'N/A';
  const dt = new Date(typeof d === 'string' && d.length === 10 ? d + 'T00:00:00' : (d as string));
  if (isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

async function one(s: any, table: string, id: string | null) {
  if (!id) return null;
  const { data } = await s.from(table).select('*').eq('id', id).maybeSingle();
  return data;
}

// Shorten a URL via Short.io (Vault keys); fall back to the long URL until configured.
async function shorten(url: string): Promise<string> {
  const apiKey = await getSecret('SHORTIO_API_KEY');
  const domain = await getSecret('SHORTIO_DOMAIN');
  if (!apiKey || !domain) return url;
  try {
    const r = await fetch('https://api.short.io/links', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ allowDuplicates: false, originalURL: url, domain }),
    });
    if (r.ok) { const d = await r.json(); return d.shortURL || url; }
  } catch (_) { /* fall through */ }
  return url;
}

// Enqueue a send_email job, splitting a recipient list into to + bcc (hidden list).
async function enqueueEmail(s: any, recipients: string[], subject: string, body: string, refs: Record<string, unknown>) {
  await s.rpc('enqueue_job', {
    p_type: 'send_email',
    p_payload: { to: recipients[0], bcc: recipients.slice(1), subject, body, sent_by: 'System', ...refs },
  });
  return recipients.length;
}

// Customer-facing notification: one visible `to`, the team CC list carried as bcc, and
// an optional reply_to. Drops the recipient from the CC list so they aren't doubled.
async function enqueueNotify(s: any, to: string, ccList: string[], replyTo: string | null, subject: string, body: string, refs: Record<string, unknown>) {
  const bcc = (ccList || []).filter((e) => e && e !== to);
  await s.rpc('enqueue_job', {
    p_type: 'send_email',
    p_payload: { to, bcc, ...(replyTo ? { reply_to: replyTo } : {}), subject, body, sent_by: 'System', ...refs },
  });
}

// When e-sign is enabled for a document type, hand off to the signature engine
// (creates a signature_request + emails the secure signing link). Returns null when
// e-sign is off for that type, so the caller falls back to the legacy sign-link email.
async function maybeEsign(s: any, docType: string, docId: string): Promise<Record<string, unknown> | null> {
  const { data: cfg } = await s.from('esign_document_type').select('esign_enabled').eq('document_type', docType).maybeSingle();
  if (!cfg?.esign_enabled) return null;
  const internal = await getSecret('CRON_SECRET');
  const r = await fetch(`${FUNCTIONS_BASE}/esign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': internal || '' },
    body: JSON.stringify({ action: 'create', document_type: docType, document_id: docId }),
  });
  return { esign: true, ...(await r.json()) };
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

    case 'funds_received': {
      // Internal notification: payment cleared, ok to proceed. Recipients = finance list.
      const project = await one(s, 'project', p.projectId);
      if (!project) return { error: 'Project not found' };
      const { data: ss } = await s.from('sms_settings').select('finance_report_emails').limit(1);
      const recipients: string[] = Array.isArray(ss?.[0]?.finance_report_emails) ? ss[0].finance_report_emails : [];
      if (!recipients.length) return { skipped: 'no finance recipients configured' };
      const customer = await one(s, 'customer', project.customer);
      const sale = await one(s, 'sale', project.sale);
      const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
      const invoiceNumber = sale?.invoice_number || '—';
      const address = customer?.address_line1 ? `${customer.address_line1}${customer.city ? ', ' + customer.city : ''}` : '—';
      const installDate = project.installation_date
        ? new Date(project.installation_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      const projectUrl = `${APP_URL}/ProjectDetail?id=${project.id}`;
      const html =
        `<div style='font-family:-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;'>` +
        `<h2 style='color:#059669;'>✅ Funds Received</h2>` +
        `<p>Payment has been received for the following project. It is now clear to proceed in order processing.</p>` +
        `<p><strong>Customer:</strong> ${customerName}<br/><strong>Invoice #:</strong> ${invoiceNumber}<br/>` +
        `<strong>Address:</strong> ${address}<br/><strong>Install Date:</strong> ${installDate}<br/>` +
        `<strong>Sale Amount:</strong> ${money(sale?.sale_amount)}</p>` +
        `<p><a href='${projectUrl}' style='background:#10b981;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;'>View Project</a></p></div>`;
      const n = await enqueueEmail(s, recipients, `✅ Funds Received — ${customerName} (Invoice #${invoiceNumber})`, html, { customer_id: project.customer });
      return { queued: true, type, recipients: n };
    }

    case 'project_claim_completed': {
      // Internal notification: a claim was completed. Recipients on the claim record.
      const claim = await one(s, 'project_claim', p.claimId);
      if (!claim) return { error: 'Claim not found' };
      const recipients: string[] = Array.isArray(claim.email_recipients) ? claim.email_recipients : [];
      if (!recipients.length) return { skipped: 'no recipients' };
      const customerName = claim.customer_name || 'Customer';
      const claimType = claim.claim_type || 'Claim';
      const lastName = customerName.split(' ').slice(-1)[0] || customerName;
      const jobNumber = claim.job_number || '';
      const subjectPrefix = jobNumber ? `${jobNumber} - ${lastName}` : lastName;
      const referenceNumber = p.referenceNumber || claim.reference_number || '';
      const eta = p.eta || claim.eta || '';
      const completedBy = claim.completed_by || 'System';
      const completedOn = claim.completed_on
        ? new Date(claim.completed_on).toLocaleDateString('en-US', { timeZone: 'America/Phoenix' })
        : new Date().toLocaleDateString('en-US', { timeZone: 'America/Phoenix' });
      const html =
        `<p>The <strong>${claimType}</strong> for <strong>${customerName}</strong> has been marked as <strong style='color:#16a34a;'>COMPLETED</strong>.</p>` +
        (referenceNumber ? `<p><strong>Reference #:</strong> ${referenceNumber}</p>` : '') +
        (eta ? `<p><strong>ETA:</strong> ${eta}</p>` : '') +
        `<p><strong>Completed By:</strong> ${completedBy}</p><p><strong>Completed On:</strong> ${completedOn}</p>` +
        (jobNumber ? `<p><strong>Job #:</strong> ${jobNumber}</p>` : '') +
        (claim.notes ? `<p><strong>Original Notes:</strong> ${claim.notes}</p>` : '') +
        `<p style='color:#888;font-size:12px;'>— Floor Daddy Team</p>`;
      const n = await enqueueEmail(s, recipients, `✅ ${claimType} COMPLETED — ${subjectPrefix}`, html, {});
      return { queued: true, type, recipients: n };
    }

    case 'design_mod': {
      const es = await maybeEsign(s, 'design_mod', p.designModId);
      if (es) return es;
      // Legacy sign-link email (e-sign off). Stamp the record, then email the sign link.
      const mod = await one(s, 'design_mod', p.designModId);
      if (!mod) return { error: 'Design mod not found' };
      const shortUrl = await shorten(`${APP_URL}/DesignModView?id=${mod.id}`);
      await s.from('design_mod').update({ status: 'sent', short_url: shortUrl, email_sent_at: new Date().toISOString() }).eq('id', mod.id);
      if (!mod.customer_email) return { updated: true, queued: false, skipped: 'no customer email', short_url: shortUrl };
      const customerName = `${mod.customer_first_name || ''} ${mod.customer_last_name || ''}`.trim();
      const html =
        `<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;'>` +
        `<h2 style='color:#2563eb;'>Design Modification Request</h2>` +
        `<p>Hi ${mod.customer_first_name},</p>` +
        `<p>We have prepared a design modification for your project. Please review and sign off using the link below:</p>` +
        `<p><a href='${shortUrl}' style='background:#2563eb;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;'>Review &amp; Sign Design Modification</a></p>` +
        (mod.products_or_changes ? `<p><strong>Changes:</strong> ${mod.products_or_changes}</p>` : '') +
        (mod.value_added_costs ? `<p><strong>Value Added Costs:</strong> ${money(mod.value_added_costs)}</p>` : '') +
        `<p>If the button does not work, copy and paste this link: ${shortUrl}</p><p>Thank you,<br/>Floor Daddy Team</p></div>`;
      await enqueueEmail(s, [mod.customer_email], `Design Modification for ${customerName} - Please Review & Sign`, html, { customer_id: mod.customer_id });
      return { queued: true, type, recipients: 1, short_url: shortUrl };
    }

    case 'pre_install': {
      const es = await maybeEsign(s, 'pre_install', p.checklistId);
      if (es) return es;
      const cl = await one(s, 'standalone_pre_install_checklist', p.checklistId);
      if (!cl) return { error: 'Checklist not found' };
      const shortUrl = await shorten(`${APP_URL}/PreInstallChecklistView?id=${cl.id}`);
      await s.from('standalone_pre_install_checklist').update({ status: 'sent', short_url: shortUrl, email_sent_at: new Date().toISOString() }).eq('id', cl.id);
      if (!cl.customer_email) return { updated: true, queued: false, skipped: 'no customer email', short_url: shortUrl };
      const html =
        `<div style='font-family:Arial,sans-serif;max-width:600px;margin:0 auto;'>` +
        `<h2 style='color:#2563eb;'>Pre-Installation Checklist</h2>` +
        `<p>Hi ${cl.customer_first_name},</p>` +
        `<p>Please review and sign your Pre-Installation Checklist before your installation begins.</p>` +
        `<p><a href='${shortUrl}' style='background:#2563eb;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;'>Review &amp; Sign Pre-Install Checklist</a></p>` +
        (cl.product_info ? `<p><strong>Product:</strong> ${cl.product_info}</p>` : '') +
        `<p>If the button does not work, copy and paste this link: ${shortUrl}</p><p>Thank you,<br/>Floor Daddy Team</p></div>`;
      await enqueueEmail(s, [cl.customer_email], `Pre-Installation Checklist - Please Review & Sign`, html, {});
      return { queued: true, type, recipients: 1, short_url: shortUrl };
    }

    case 'manual_sales_contract': {
      const es = await maybeEsign(s, 'manual_sales_contract', p.contractId);
      if (es) return es;
      const c = await one(s, 'manual_sales_contract', p.contractId);
      if (!c) return { error: 'Contract not found' };
      const shortUrl = await shorten(`${APP_URL}/ManualSalesContractView?id=${c.id}`);
      await s.from('manual_sales_contract').update({ status: 'sent', short_url: shortUrl, email_sent_at: new Date().toISOString() }).eq('id', c.id);
      if (!c.customer_email) return { updated: true, queued: false, skipped: 'no customer email', short_url: shortUrl };
      const html =
        `<p>Hi ${c.customer_first_name},</p>` +
        `<p>Thank you for your commitment to Floor Daddy! Please click the link below to review and sign your sales contract.</p>` +
        `<p><a href='${shortUrl}' style='background:#4F46E5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;'>Review &amp; Sign Contract</a></p>` +
        `<p>Or copy this link: ${shortUrl}</p><p>Thank you,<br/>Floor Daddy Team</p>`;
      await enqueueEmail(s, [c.customer_email], 'Your Sales Contract - Please Sign', html, {});
      return { queued: true, type, recipients: 1, short_url: shortUrl };
    }

    case 'notification': {
      // Generic customer-facing notification dispatcher (ported from base44's
      // sendNotificationEmail). notify_type selects entity + sms_settings template.
      // Sends to the lead/customer, carries the team CC list as bcc, honors per-type
      // send/divert toggles, and stamps confirmation timestamps like the original.
      const nt = p.notify_type === 'customer_sale_confirmation' ? 'sale_confirmed' : p.notify_type;
      const { data: ssList } = await s.from('sms_settings').select('*').limit(1);
      const cfg: any = ssList?.[0] || {};
      const cc: string[] = Array.isArray(cfg.cc_emails) ? cfg.cc_emails : [];
      const replyTo: string | null = cfg.reply_to_email || null;
      const appUrl: string = p.appUrl || APP_URL;

      if (nt === 'appointment_created' || nt === 'appointment_rescheduled' || nt === 'appointment_cancelled') {
        const appt = await one(s, 'appointment', p.entityId);
        if (!appt) return { error: 'Appointment not found' };
        const lead = await one(s, 'lead', appt.customer);
        if (!lead) return { error: 'Lead not found' };
        const key = nt === 'appointment_created' ? 'lead_appointment_created'
          : nt === 'appointment_rescheduled' ? 'lead_rescheduled' : 'lead_cancelled';
        if (cfg[`send_${key}_email`] === false) return { skipped: 'disabled', notify_type: nt };
        const dc = await one(s, 'team_member', appt.assigned_dc);
        const csr = await one(s, 'team_member', appt.assigned_csr);
        const vars = {
          lead_name: `${lead.first_name} ${lead.last_name}`, lead_first_name: lead.first_name, lead_last_name: lead.last_name,
          lead_phone: lead.phone, lead_email: lead.email,
          appointment_date: fmtDate(appt.appointment_date), appointment_time: appt.appointment_block || 'N/A', appointment_block: appt.appointment_block || 'N/A',
          location_address: appt.location_address || 'N/A',
          dc_name: dc ? `${dc.first_name} ${dc.last_name}` : 'N/A', csr_name: csr ? `${csr.first_name} ${csr.last_name}` : 'N/A',
          appointment_detail_url: `${appUrl}/AppointmentDetail?id=${appt.id}`,
          lead_tracking_url: appt.lead_short_url || `${appUrl}/LeadAppointmentView?id=${appt.id}`,
        };
        const to = (cfg[`divert_${key}_email`] && cfg.divert_emails_to) ? cfg.divert_emails_to : lead.email;
        if (!to) return { error: 'No lead email available' };
        await enqueueNotify(s, to, cc, replyTo, render(cfg[`${key}_email_subject`] || 'Appointment update', vars), render(cfg[`${key}_email_template`], vars), { lead_id: lead.id, appointment_id: appt.id });
        if (nt !== 'appointment_cancelled') await s.from('appointment').update({ confirmation_email_sent_at: new Date().toISOString() }).eq('id', appt.id);
        return { queued: true, notify_type: nt, to };
      }

      if (nt === 'sale_confirmed') {
        const sale = await one(s, 'sale', p.entityId);
        if (!sale) return { error: 'Sale not found' };
        if (cfg.send_customer_sale_confirmation_email === false) return { skipped: 'disabled', notify_type: nt };
        const customer = await one(s, 'customer', sale.customer);
        const appt = await one(s, 'appointment', sale.appointment);
        const dc = await one(s, 'team_member', sale.assigned_dc);
        // Prefer the lead email (via appointment), else fall back to the customer email.
        let email = customer?.email || null;
        if (appt?.customer) { const lead = await one(s, 'lead', appt.customer); if (lead?.email) email = lead.email; }
        if (!email) return { error: 'No lead/customer email available' };
        let tracker = 'N/A';
        const { data: projs } = await s.from('project').select('id,project_tracker_url').eq('sale', sale.id).limit(1);
        if (projs?.[0]) tracker = projs[0].project_tracker_url || `${appUrl}/CustomerProjectView?id=${projs[0].id}`;
        const vars = {
          customer_name: customer ? `${customer.first_name} ${customer.last_name}` : 'N/A',
          customer_first_name: customer?.first_name || 'N/A', customer_last_name: customer?.last_name || 'N/A',
          sale_amount: money(sale.sale_amount), consultant_name: dc ? `${dc.first_name} ${dc.last_name}` : 'N/A',
          appointment_date: appt ? fmtDate(appt.appointment_date) : 'N/A', location_address: appt?.location_address || 'N/A',
          sale_detail_url: `${appUrl}/SaleDetail?id=${sale.id}`, project_tracker_url: tracker,
        };
        const to = (cfg.divert_customer_sale_confirmation_email && cfg.divert_emails_to) ? cfg.divert_emails_to : email;
        await enqueueNotify(s, to, cc, replyTo, render(cfg.customer_sale_confirmation_email_subject, vars), render(cfg.customer_sale_confirmation_email_template, vars), { customer_id: customer?.id ?? null });
        return { queued: true, notify_type: nt, to };
      }

      if (nt === 'not_sold') {
        const appt = await one(s, 'appointment', p.entityId);
        if (!appt) return { error: 'Appointment not found' };
        const lead = await one(s, 'lead', appt.customer);
        if (!lead?.email) return { error: 'No lead email available' };
        if (cfg.send_lead_not_sold_email === false) return { skipped: 'disabled', notify_type: nt };
        const vars = { lead_name: `${lead.first_name} ${lead.last_name}`, lead_first_name: lead.first_name, lead_last_name: lead.last_name };
        const to = (cfg.divert_lead_not_sold_email && cfg.divert_emails_to) ? cfg.divert_emails_to : lead.email;
        await enqueueNotify(s, to, cc, replyTo, render(cfg.lead_not_sold_email_subject, vars), render(cfg.lead_not_sold_email_template, vars), { lead_id: lead.id, appointment_id: appt.id });
        return { queued: true, notify_type: nt, to };
      }

      if (nt === 'project_created') {
        const project = await one(s, 'project', p.entityId);
        if (!project) return { error: 'Project not found' };
        const customer = await one(s, 'customer', project.customer);
        if (!customer?.email) return { error: 'Customer email not found' };
        if (cfg.send_customer_project_created_email === false) return { skipped: 'disabled', notify_type: nt };
        const sale = await one(s, 'sale', project.sale);
        const pm = await one(s, 'team_member', project.project_manager);
        const im = await one(s, 'team_member', project.installation_manager);
        let locationAddress = 'N/A';
        if (sale?.appointment) { const a = await one(s, 'appointment', sale.appointment); locationAddress = a?.location_address || 'N/A'; }
        const fullTracker = `${appUrl}/CustomerProjectView?id=${project.id}`;
        const tracker = project.project_tracker_url || await shorten(fullTracker);
        const vars = {
          customer_name: `${customer.first_name} ${customer.last_name}`, customer_first_name: customer.first_name, customer_last_name: customer.last_name,
          project_manager_name: pm ? `${pm.first_name} ${pm.last_name}` : 'N/A', installation_manager_name: im ? `${im.first_name} ${im.last_name}` : 'N/A',
          installation_date: project.installation_date ? fmtDate(project.installation_date) : 'N/A', location_address: locationAddress,
          project_detail_url: `${appUrl}/ProjectDetail?id=${project.id}`, project_tracker_url: tracker,
          project_tracker_with_video_url: await shorten(`${fullTracker}&showCeoVideo=true`),
        };
        const to = (cfg.divert_customer_project_created_email && cfg.divert_emails_to) ? cfg.divert_emails_to : customer.email;
        await enqueueNotify(s, to, cc, replyTo, render(cfg.customer_project_created_email_subject, vars), render(cfg.customer_project_created_email_template, vars), { customer_id: customer.id });
        return { queued: true, notify_type: nt, to };
      }

      return { error: `Unknown notify_type ${p.notify_type}` };
    }

    case 'test_email': {
      // Admin template preview (ported from base44 sendTestEmail): render the chosen
      // notification template with fixed dummy data and send a [TEST]-prefixed copy to
      // the configured divert address. Reuses the durable send pipeline like everything else.
      const { data: ssList } = await s.from('sms_settings').select('*').limit(1);
      const cfg: any = ssList?.[0] || {};
      const to: string | null = cfg.divert_emails_to || null;
      if (!to) return { error: 'No divert email configured' };
      const MAP: Record<string, [string, string]> = {
        appointment_created:     ['lead_appointment_created_email_subject', 'lead_appointment_created_email_template'],
        appointment_rescheduled: ['lead_rescheduled_email_subject', 'lead_rescheduled_email_template'],
        appointment_cancelled:   ['lead_cancelled_email_subject', 'lead_cancelled_email_template'],
        sale_confirmed:          ['customer_sale_confirmation_email_subject', 'customer_sale_confirmation_email_template'],
        not_sold:                ['lead_not_sold_email_subject', 'lead_not_sold_email_template'],
        reminder:                ['lead_reminder_email_subject', 'lead_reminder_email_template'],
        project_created:         ['customer_project_created_email_subject', 'customer_project_created_email_template'],
        day1_followup:           ['lead_day1_followup_email_subject', 'lead_day1_followup_email_template'],
        day2_followup:           ['lead_day2_followup_email_subject', 'lead_day2_followup_email_template'],
        day3_followup:           ['lead_day3_followup_email_subject', 'lead_day3_followup_email_template'],
      };
      const pair = MAP[p.emailType];
      if (!pair) return { error: `Invalid email type: ${p.emailType}` };
      const DUMMY = {
        lead_name: 'John Doe', lead_first_name: 'John', lead_last_name: 'Doe', lead_phone: '(602) 555-0100', lead_email: 'john.doe@example.com',
        customer_name: 'John Doe', customer_first_name: 'John', customer_last_name: 'Doe',
        appointment_date: 'Monday, February 15, 2026', appointment_time: '9am to 11am', appointment_block: '9am to 11am',
        location_address: '123 Main St, Phoenix, AZ 85001', dc_name: 'Jane Smith', csr_name: 'Mike Johnson',
        consultant_name: 'Jane Smith', sale_amount: '$12,500.00',
        project_manager_name: 'Sarah Williams', installation_manager_name: 'Tom Brown', installation_date: 'Friday, February 26, 2026',
        appointment_detail_url: `${APP_URL}/AppointmentDetail?id=test`, lead_tracking_url: `${APP_URL}/LeadAppointmentView?id=test`,
        sale_detail_url: `${APP_URL}/SaleDetail?id=test`, project_detail_url: `${APP_URL}/ProjectDetail?id=test`,
        project_tracker_url: `${APP_URL}/CustomerProjectView?id=test`, project_tracker_with_video_url: `${APP_URL}/CustomerProjectView?id=test`,
      };
      const subject = `[TEST] ${render(cfg[pair[0]] || 'Test Email', DUMMY)}`;
      const body = render(cfg[pair[1]], DUMMY);
      await enqueueEmail(s, [to], subject, body, {});
      return { queued: true, type: 'test_email', emailType: p.emailType, to };
    }

    default:
      return { error: `Unknown email type ${type}` };
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
