// Transactional SMS dispatcher — the SMS mirror of emailDispatch. One function for the
// base44 Twilio sender fleet: each `type` gathers entity data, renders an sms_settings
// template (or composes an alert), resolves recipient(s), and enqueues a durable send_sms
// job through the comms pipeline (enqueue_job -> processJobs -> sendMessage: suppression,
// delivery tracking, retry). It never calls Twilio directly.
//
// Two exceptions to the enqueue pattern:
//  - `direct` is SYNCHRONOUS: 13 legacy sendSMS call sites read {success, twilioStatus},
//    so it calls sendMessage inline and maps the response back to the legacy shape.
//  - internal alert types (cancellation_*, low_gp, past_due, pending_cancellation,
//    unassigned_dc) fan out one send_sms job per staff phone (roster from sms_settings).
//
// Auth: internal secret (server/tests) OR an authenticated user (browser invoke).
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

const HOLD_STATUSES = ['pending payment', 'pending contract', 'on hold', 'pending cancellation'];
const AZ_OFFSET_MS = 7 * 60 * 60 * 1000; // Phoenix is UTC-7 (no DST)

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

// {var} substitution; null-safe so an unconfigured template is an empty string, not a crash.
function render(tpl: string, vars: Record<string, unknown>): string {
  let r = tpl || '';
  for (const [k, v] of Object.entries(vars)) r = r.replaceAll(`{${k}}`, (v ?? 'N/A') as string);
  return r;
}

function fmtDateLong(d: unknown): string {
  if (!d) return 'N/A';
  const dt = new Date(typeof d === 'string' && (d as string).length === 10 ? d + 'T00:00:00' : (d as string));
  if (isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtMMDDYYYY(d: unknown): string {
  if (!d) return 'N/A';
  const dt = new Date(typeof d === 'string' && (d as string).length === 10 ? d + 'T00:00:00' : (d as string));
  if (isNaN(dt.getTime())) return 'N/A';
  return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`;
}

// Normalize a phone to E.164 (assume US when no country code).
function normE164(p: unknown): string | null {
  if (!p) return null;
  const s = String(p).trim();
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('1') ? `+${digits}` : `+1${digits}`;
}

async function one(s: any, table: string, id: string | null | undefined) {
  if (!id) return null;
  const { data } = await s.from(table).select('*').eq('id', id).maybeSingle();
  return data;
}

// Divert customer-facing texts to a QA number when enabled (test wins over customer).
function divertCustomer(cfg: any, phone: string): string {
  if (cfg?.test_divert_enabled && cfg.test_divert_phone) return cfg.test_divert_phone;
  if (cfg?.customer_divert_enabled && cfg.customer_divert_phone) return cfg.customer_divert_phone;
  return phone;
}

// Resolve a jsonb array of team_member ids -> their phone numbers.
async function resolveStaffPhones(s: any, ids: unknown): Promise<string[]> {
  const arr = Array.isArray(ids) ? ids : [];
  if (!arr.length) return [];
  const { data } = await s.from('team_member').select('id,phone').in('id', arr);
  return (data || []).map((m: any) => m.phone).filter(Boolean);
}

async function enqueueSms(s: any, to: string, body: string, refs: Record<string, unknown>): Promise<boolean> {
  const e164 = normE164(to);
  if (!e164) return false;
  await s.rpc('enqueue_job', { p_type: 'send_sms', p_payload: { to: e164, body, sent_by: 'System', ...refs } });
  return true;
}

// Business days between a start date and now in Phoenix time, excluding weekends; 0 if the
// project is currently on a hold status (ported verbatim from base44 sendPastDueProjectsAlert).
function calcBusinessDays(startDate: unknown, installStatus: string | null, holdCleared: unknown): number {
  if (installStatus && HOLD_STATUSES.includes(installStatus)) return 0;
  const eff = holdCleared || startDate;
  if (!eff) return 0;
  const toAZ = (ms: number) => { const d = new Date(ms - AZ_OFFSET_MS); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const start = toAZ(new Date(eff as string).getTime());
  const now = toAZ(Date.now());
  if (isNaN(start)) return 0;
  let count = 0;
  let cur = start + 86400000;
  while (cur <= now) { const dow = new Date(cur).getUTCDay(); if (dow !== 0 && dow !== 6) count++; cur += 86400000; }
  return count;
}

// Build the {placeholder} map for the appointment/customer template family.
function apptVars(appt: any, lead: any, dc: any, customer: any, project: any): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  if (lead) {
    v.lead_first_name = lead.first_name; v.lead_last_name = lead.last_name;
    v.lead_name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
    v.lead_phone = lead.phone; v.lead_email = lead.email;
  }
  if (appt) {
    v.appointment_date = fmtDateLong(appt.appointment_date);
    v.appointment_time = appt.appointment_block || 'N/A';
    v.appointment_block = appt.appointment_block || 'N/A';
    v.appointment_address = appt.location_address || 'N/A';
    v.lead_tracking_url = appt.lead_short_url || `${APP_URL}/LeadAppointmentView?id=${appt.id}`;
    v.consultant_tracking_url = appt.consultant_short_url || `${APP_URL}/ConsultantAppointmentView?id=${appt.id}`;
  }
  if (dc) {
    v.consultant_first_name = dc.first_name; v.consultant_last_name = dc.last_name;
    v.consultant_name = `${dc.first_name || ''} ${dc.last_name || ''}`.trim();
    v.dc_first_name = dc.first_name; v.dc_last_name = dc.last_name;
  }
  if (customer) {
    v.customer_first_name = customer.first_name; v.customer_last_name = customer.last_name;
    v.customer_name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
  }
  if (project) {
    v.project_tracker_url = project.project_tracker_url || `${APP_URL}/CustomerProjectView?id=${project.id}`;
    v.project_tracker_with_video_url = `${APP_URL}/CustomerProjectView?id=${project.id}&showCeoVideo=true`;
  }
  return v;
}

// Chunk report lines into messages under maxLen; continuation chunks are marked.
function chunkLines(lines: string[], header: string, maxLen: number): string[] {
  const out: string[] = [];
  let cur = header;
  for (const ln of lines) {
    if ((cur + '\n' + ln).length > maxLen) { out.push(cur); cur = "(cont'd)\n" + ln; }
    else cur = cur + '\n' + ln;
  }
  out.push(cur);
  return out;
}

// The 12 appointment/customer lifecycle SMS types (ported from sendAppointmentSMS).
const APPT: Record<string, { tmpl: string; toggle: string | null; to: 'lead' | 'consultant' | 'customer'; dc?: boolean; project?: boolean }> = {
  lead:                       { tmpl: 'lead_appointment_created_template', toggle: 'send_lead_sms',            to: 'lead' },
  lead_rescheduled:           { tmpl: 'lead_rescheduled_template',         toggle: null,                       to: 'lead' },
  lead_cancelled:             { tmpl: 'lead_cancelled_template',           toggle: null,                       to: 'lead' },
  lead_consultant_assigned:   { tmpl: 'lead_consultant_assigned_template', toggle: null,                       to: 'lead',       dc: true },
  lead_not_sold:              { tmpl: 'lead_not_sold_template',            toggle: 'send_lead_not_sold_sms',   to: 'lead' },
  consultant:                 { tmpl: 'consultant_assigned_template',      toggle: 'send_consultant_sms',      to: 'consultant', dc: true },
  consultant_rescheduled:     { tmpl: 'consultant_rescheduled_template',   toggle: null,                       to: 'consultant', dc: true },
  consultant_cancelled:       { tmpl: 'consultant_cancelled_template',     toggle: null,                       to: 'consultant', dc: true },
  consultant_on_my_way:       { tmpl: 'consultant_on_my_way_template',     toggle: null,                       to: 'lead',       dc: true },
  consultant_arrived:         { tmpl: 'consultant_arrived_template',       toggle: null,                       to: 'lead',       dc: true },
  customer_sale_confirmation: { tmpl: 'customer_sale_confirmation_template', toggle: 'send_customer_sale_sms', to: 'customer',   project: true },
  customer_project_created:   { tmpl: 'customer_project_created_template', toggle: 'send_customer_project_sms', to: 'customer',  project: true },
};

async function handleType(s: any, type: string, p: any, user: any): Promise<Record<string, unknown>> {
  const { data: ssList } = await s.from('sms_settings').select('*').limit(1);
  const cfg: any = ssList?.[0] || {};
  const userName = user?.user_metadata?.full_name || user?.email || 'System';

  // ── Appointment / customer lifecycle SMS ─────────────────────────────────────────────
  if (APPT[type]) {
    const spec = APPT[type];
    if (spec.toggle && cfg[spec.toggle] === false) return { skipped: 'disabled', type };
    const appt = await one(s, 'appointment', p.appointmentId);
    if (!appt && spec.to !== 'customer') return { error: 'Appointment not found' };
    const lead = appt ? await one(s, 'lead', appt.customer) : null;
    const dc = spec.dc && appt?.assigned_dc ? await one(s, 'team_member', appt.assigned_dc) : null;
    const customer = spec.to === 'customer' ? await one(s, 'customer', p.customerId) : null;
    let project: any = null;
    if (spec.project && p.customerId) {
      const { data } = await s.from('project').select('*').eq('customer', p.customerId).limit(1);
      project = data?.[0] || null;
    }
    let phone: string | null | undefined;
    if (spec.to === 'lead') phone = lead?.phone;
    else if (spec.to === 'consultant') { if (!dc) return { skipped: 'no consultant assigned', type }; phone = dc.phone; }
    else phone = customer?.phone;
    if (!phone) return { skipped: 'no recipient phone', type };
    const to = spec.to === 'consultant' ? phone : divertCustomer(cfg, phone);
    const body = render(cfg[spec.tmpl], apptVars(appt, lead, dc, customer, project));
    if (!body.trim()) return { skipped: 'empty template', type };
    const ok = await enqueueSms(s, to, body, { lead_id: lead?.id ?? null, customer_id: customer?.id ?? null, appointment_id: appt?.id ?? null });
    return ok ? { queued: true, type, to } : { skipped: 'invalid phone', type };
  }

  switch (type) {
    // ── Generic direct sender (SYNCHRONOUS — legacy sendSMS shape) ──────────────────────
    case 'direct': {
      if (!p.to || !p.message) return { success: false, error: 'Missing required fields: to, message', to: p.to ?? null };
      const internal = await getSecret('CRON_SECRET');
      const r = await fetch(`${FUNCTIONS_BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': internal || '' },
        body: JSON.stringify({ channel: 'sms', to: p.to, body: p.message, sent_by: user?.email || 'System' }),
      });
      const d = await r.json().catch(() => ({} as any));
      return { success: d.ok === true, messageSid: d.provider_message_id ?? null, twilioStatus: d.delivery_status ?? d.skipped ?? null, to: p.to, error: d.error ?? d.skipped ?? null };
    }

    // ── Ticket-reply notification ───────────────────────────────────────────────────────
    case 'ticket_message': {
      if (cfg.send_ticket_message_sms === false) return { skipped: 'disabled', type };
      const ticket = await one(s, 'ticket', p.ticketId);
      if (!ticket) return { error: 'Ticket not found' };
      const isDC = p.senderRole === 'DC';
      const recipientId = isDC ? ticket.requester : ticket.assigned_dc;
      if (!recipientId) return { skipped: 'no recipient party', type };
      const rec = await one(s, 'team_member', recipientId);
      if (!rec?.phone) return { skipped: 'no recipient phone', type };
      const shortUrl = (isDC ? ticket.requester_short_url : ticket.dc_short_url) || '';
      const vars = {
        requester_first_name: rec.first_name, dc_first_name: rec.first_name,
        order_number: ticket.order_number ?? '', sender_name: p.senderName ?? '', message: p.message ?? '',
        ticket_url: shortUrl, requester_ticket_url: shortUrl,
      };
      const body = render(isDC ? cfg.requester_new_message_template : cfg.dc_new_message_template, vars);
      if (!body.trim()) return { skipped: 'empty template', type };
      const ok = await enqueueSms(s, rec.phone, body, {});
      return ok ? { queued: true, type, to: rec.phone } : { skipped: 'invalid phone', type };
    }

    // ── Cancellation staff alerts (roster = pending_cancellation_alert_member_ids) ───────
    case 'cancellation_save_attempt':
    case 'cancellation_update': {
      const project = await one(s, 'project', p.project_id);
      if (!project) return { error: 'Project not found' };
      const customer = await one(s, 'customer', project.customer);
      const sale = await one(s, 'sale', project.sale);
      const customerName = customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Unknown' : 'Unknown';
      const cg = sale?.invoice_number || 'N/A';
      const phones = await resolveStaffPhones(s, cfg.pending_cancellation_alert_member_ids);
      let body: string;
      if (type === 'cancellation_update') {
        const msg = (p.message || '').trim();
        if (!msg) return { error: 'message required' };
        const capped = msg.length > 300 ? msg.slice(0, 297) + '...' : msg;
        body = `📢 Cancellation Update from ${userName}:\nJob: ${customerName} | CG#: ${cg}\n${capped}`;
      } else {
        const installDate = project.installation_date ? fmtMMDDYYYY(project.installation_date) : 'No Install Date';
        body = `🛠️ ${userName} is working this cancellation request — trying to save.\nJob: ${customerName} | CG#: ${cg} | Install: ${installDate}`;
      }
      let sent = 0;
      for (const ph of phones) if (await enqueueSms(s, ph, body, { customer_id: project.customer })) sent++;
      return { queued: true, type, sent };
    }

    case 'cancellation_status': {
      const phones = await resolveStaffPhones(s, cfg.pending_cancellation_alert_member_ids);
      const customerName = p.customerName || 'Unknown';
      const inv = p.invoiceNumber || 'N/A';
      const inst = p.installDate || 'N/A';
      const body = p.subtype === 'cancelled'
        ? `🚫 Project CANCELLED\nCustomer: ${customerName}\nCG#: ${inv}\nInstall: ${inst}` + (p.reason ? `\nReason: ${p.reason}` : '')
        : `✅ Pending Cancellation CLEARED\nCustomer: ${customerName}\nCG#: ${inv}\nInstall: ${inst}` + (p.clearedBy ? `\nCleared by: ${p.clearedBy}` : '');
      let sent = 0;
      for (const ph of phones) if (await enqueueSms(s, ph, body, {})) sent++;
      return { queued: true, type, subtype: p.subtype, sent };
    }

    // ── Low gross-profit alert ──────────────────────────────────────────────────────────
    case 'low_gp': {
      const threshold = cfg.gp_alert_threshold ?? 30;
      const gp = Number(p.gpPercent);
      if (!isNaN(gp) && gp >= Number(threshold)) return { skipped: 'above threshold', type, gpPercent: gp, threshold };
      const ids = Array.isArray(cfg.gp_alert_member_ids) ? [...cfg.gp_alert_member_ids] : [];
      if (cfg.gp_alert_include_dc && p.consultantId) ids.push(p.consultantId);
      const phones = await resolveStaffPhones(s, ids);
      const orderTotal = p.orderTotal != null ? `$${Number(p.orderTotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$N/A';
      const body = `⚠️ LOW GP ALERT\nCustomer: ${p.customerName || 'N/A'}\nConsultant: ${p.consultantName || 'N/A'}\nInvoice: ${p.invoiceNumber || 'N/A'}\nGP%: ${isNaN(gp) ? 'N/A' : gp.toFixed(1)}% (threshold: ${threshold}%)\nOrder Total: ${orderTotal}`;
      let sent = 0;
      for (const ph of phones) if (await enqueueSms(s, ph, body, {})) sent++;
      return { queued: true, type, sent };
    }

    // ── Past-due projects report ────────────────────────────────────────────────────────
    case 'past_due': {
      const memberIds = Array.isArray(cfg.past_due_alert_member_ids) ? cfg.past_due_alert_member_ids : [];
      let phones = memberIds.length
        ? await resolveStaffPhones(s, memberIds)
        : (Array.isArray(cfg.past_due_alert_phones) ? cfg.past_due_alert_phones : []).filter(Boolean);
      if (!phones.length) return { skipped: 'no recipients', type, sent: 0 };
      const { data: projects } = await s.from('project').select('*');
      const { data: customers } = await s.from('customer').select('id,first_name,last_name');
      const { data: sales } = await s.from('sale').select('id,invoice_number');
      const cMap: any = Object.fromEntries((customers || []).map((c: any) => [c.id, c]));
      const sMap: any = Object.fromEntries((sales || []).map((x: any) => [x.id, x]));
      const due = (projects || []).filter((pr: any) => {
        const onHold = pr.installation_date_status && HOLD_STATUSES.includes(pr.installation_date_status);
        const bd = calcBusinessDays(pr.created_date, pr.installation_date_status, pr.hold_cleared_date);
        return !onHold && bd >= 3 && (pr.status === 'Accepted' || pr.status === 'Scheduled');
      }).sort((a: any, b: any) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime());
      const lines = due.map((pr: any) => {
        const c = cMap[pr.customer]; const sl = sMap[pr.sale];
        const jobName = c ? `${c.first_name} ${c.last_name}` : 'Unknown';
        const cg = sl?.invoice_number || 'N/A';
        const status = pr.installation_date_status || pr.status;
        const inst = pr.installation_date ? fmtMMDDYYYY(pr.installation_date) : 'No Install Date';
        const bd = calcBusinessDays(pr.created_date, pr.installation_date_status, pr.hold_cleared_date);
        return `Job: ${jobName} | CG#: ${cg} | Created: ${fmtMMDDYYYY(pr.created_date)} | Install: ${inst} | Status: ${status} | Days: ${bd}`;
      });
      const nowAZ = new Date(Date.now() - AZ_OFFSET_MS);
      const yStart = Date.UTC(nowAZ.getUTCFullYear(), nowAZ.getUTCMonth(), nowAZ.getUTCDate() - 1);
      const tStart = Date.UTC(nowAZ.getUTCFullYear(), nowAZ.getUTCMonth(), nowAZ.getUTCDate());
      const matCount = (from: number, to: number | null) => (projects || []).filter((pr: any) => {
        if (pr.status !== 'Materials Ordered' || !pr.updated_date) return false;
        const u = new Date(pr.updated_date).getTime() - AZ_OFFSET_MS; // timestamptz parses directly (offset OR Z form)
        return to ? u >= from && u < to : u >= from;
      }).length;
      const matToday = matCount(tStart, null);
      const matYesterday = matCount(yStart, tStart);
      if (!lines.length && !matYesterday) return { skipped: 'nothing past due', type, sent: 0 };
      const body = `📦 Jobs Ordered Material Today: ${matToday}\n📦 Jobs Ordered Material Yesterday: ${matYesterday}\n\n⚠️ Past Due Projects (${lines.length}):\n\n${lines.join('\n')}`;
      let sent = 0;
      for (const ph of phones) if (await enqueueSms(s, ph, body, {})) sent++;
      return { queued: true, type, sent, jobCount: lines.length };
    }

    // ── Pending-cancellation report (chunked) ───────────────────────────────────────────
    case 'pending_cancellation': {
      const phones = await resolveStaffPhones(s, cfg.pending_cancellation_alert_member_ids);
      if (!phones.length) return { skipped: 'no recipients', type, sent: 0, jobCount: 0 };
      const { data: projects } = await s.from('project').select('*').eq('installation_date_status', 'pending cancellation').limit(500);
      const list = projects || [];
      if (!list.length) return { skipped: 'none pending', type, sent: 0, jobCount: 0 };
      const custIds = [...new Set(list.map((p2: any) => p2.customer).filter(Boolean))];
      const saleIds = [...new Set(list.map((p2: any) => p2.sale).filter(Boolean))];
      const { data: customers } = await s.from('customer').select('id,first_name,last_name').in('id', custIds.length ? custIds : ['_none_']);
      const { data: sales } = await s.from('sale').select('id,invoice_number').in('id', saleIds.length ? saleIds : ['_none_']);
      const cMap: any = Object.fromEntries((customers || []).map((c: any) => [c.id, c]));
      const sMap: any = Object.fromEntries((sales || []).map((x: any) => [x.id, x]));
      const lines = list.map((pr: any) => {
        const c = cMap[pr.customer]; const sl = sMap[pr.sale];
        const jobName = c ? `${c.first_name} ${c.last_name}` : 'Unknown';
        const cg = sl?.invoice_number || 'N/A';
        const inst = pr.installation_date ? fmtMMDDYYYY(pr.installation_date) : 'No Install Date';
        const pendFrom = pr.pending_cancellation_date || pr.created_date;
        const daysStr = pendFrom ? ` | Days Pending: ${Math.floor((Date.now() - new Date(pendFrom).getTime()) / 86400000)}` : '';
        return `Job: ${jobName} | CG#: ${cg} | Install: ${inst}${daysStr}`;
      });
      const chunks = chunkLines(lines, `⚠️ Pending Cancellation (${lines.length} total)`, 1200);
      let jobs = 0;
      for (const ph of phones) for (const body of chunks) if (await enqueueSms(s, ph, body, {})) jobs++;
      return { queued: true, type, jobCount: lines.length, recipients: phones.length, jobs };
    }

    // ── Unassigned-DC alert (tomorrow, + Sunday when run on a Friday) ────────────────────
    case 'unassigned_dc': {
      const phones = await resolveStaffPhones(s, cfg.unassigned_dc_alert_phones); // column holds member ids
      if (!phones.length) return { skipped: 'no recipients', type, sent: 0 };
      const nowAZ = new Date(Date.now() - AZ_OFFSET_MS);
      const ymd = (dt: Date) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      const targets = [{ label: 'Tomorrow', date: ymd(new Date(Date.UTC(nowAZ.getUTCFullYear(), nowAZ.getUTCMonth(), nowAZ.getUTCDate() + 1))) }];
      if (nowAZ.getUTCDay() === 5) targets.push({ label: 'Sunday', date: ymd(new Date(Date.UTC(nowAZ.getUTCFullYear(), nowAZ.getUTCMonth(), nowAZ.getUTCDate() + 2))) });
      const { data: appts } = await s.from('appointment').select('*')
        .in('status', ['Scheduled', 'Rescheduled', 'Awaiting Assignment']).in('appointment_date', targets.map((t) => t.date)).is('assigned_dc', null);
      const list = appts || [];
      if (!list.length) return { skipped: 'none unassigned', type, sent: 0 };
      const leadIds = [...new Set(list.map((a: any) => a.customer).filter(Boolean))];
      const { data: leads } = await s.from('lead').select('id,first_name,last_name').in('id', leadIds.length ? leadIds : ['_none_']);
      const lMap: any = Object.fromEntries((leads || []).map((l: any) => [l.id, l]));
      let body = '⚠️ Unassigned DC Alert:\n';
      for (const t of targets) {
        const forDate = list.filter((a: any) => a.appointment_date === t.date);
        if (!forDate.length) continue;
        body += `\n📅 ${t.label} (${forDate.length} appt${forDate.length > 1 ? 's' : ''} without DC):\n`;
        for (const a of forDate) {
          const l = lMap[a.customer];
          body += `• ${l ? `${l.first_name} ${l.last_name}` : 'Unknown'} (${a.appointment_block || 'TBD'})\n`;
        }
      }
      let sent = 0;
      for (const ph of phones) if (await enqueueSms(s, ph, body, {})) sent++;
      return { queued: true, type, sent, appointments: list.length };
    }

    default:
      return { error: `Unknown sms type ${type}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const internal = await getSecret('CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  let user: any = null;
  if (!isInternal) {
    user = await currentUser(req);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors });
  }

  try {
    const p = await req.json();
    if (!p?.type) return Response.json({ error: 'type required' }, { status: 400, headers: cors });
    const result = await handleType(svc(), p.type, p, user);
    // `direct` always returns 200 (legacy shape carries success/error in-body); other types
    // 400 only on a real dispatch error.
    const status = result?.error && result.success === undefined ? 400 : 200;
    return Response.json(result, { status, headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
