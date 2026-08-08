// PDF-attachment email senders. Generates a PDF (jsPDF), uploads it to Storage,
// and enqueues a send_email job referencing the PDF by URL (job payloads stay small;
// sendMessage fetches + attaches it). Auth: internal secret OR authed user.
// Types: receipt, inspection, claim. Add one = one buildXPdf() + one case + one alias.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { jsPDF } from 'npm:jspdf@4.0.0';

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

const fmt = (v: unknown) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v) || 0);
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sanitizeName = (v: unknown) => (String(v || 'customer').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'customer');

async function one(s: any, table: string, id: string | null) {
  if (!id) return null;
  const { data } = await s.from(table).select('*').eq('id', id).maybeSingle();
  return data;
}

// Recipients: a record's email_recipients list, overridable by a single divert address.
async function recipientsFor(s: any, list: any): Promise<string[]> {
  const arr: string[] = Array.isArray(list) ? list : [];
  const { data: ss } = await s.from('sms_settings').select('divert_emails_to').limit(1);
  const divert = ss?.[0]?.divert_emails_to;
  return divert ? [divert] : arr;
}

async function uploadPdf(s: any, bytes: Uint8Array, filename: string): Promise<string> {
  const path = `receipts/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${filename}`;
  const up = await s.storage.from('uploads').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error(`upload failed: ${up.error.message}`);
  const { data } = s.storage.from('uploads').getPublicUrl(path);
  return data.publicUrl;
}

// Fetch an image (URL or data-URI) to a jsPDF-ready { data, format }.
async function fetchImg(url: any): Promise<{ data: string; format: string } | null> {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('data:')) return { data: url, format: url.includes('image/png') ? 'PNG' : 'JPEG' };
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    const b64 = encodeBase64(new Uint8Array(await r.arrayBuffer()));
    const format = ct.includes('png') ? 'PNG' : 'JPEG';
    return { data: `data:image/${format === 'PNG' ? 'png' : 'jpeg'};base64,${b64}`, format };
  } catch (_) { return null; }
}

async function prefetchPhotos(images: any): Promise<Array<{ data: string; format: string; desc: any }>> {
  const arr = Array.isArray(images) ? images : [];
  const out: Array<{ data: string; format: string; desc: any }> = [];
  for (const img of arr) {
    const url = typeof img === 'string' ? img : img?.url;
    const desc = typeof img === 'object' ? img?.description : null;
    const f = await fetchImg(url);
    if (f) out.push({ ...f, desc });
  }
  return out;
}

// ---- shared jsPDF layout helpers (a4, mm; margin 20; usable width 170) ----
function headerBar(doc: any, title: string, C: number[]) {
  doc.setFillColor(C[0], C[1], C[2]); doc.rect(0, 0, 210, 14, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(255, 255, 255);
  doc.text(title, 20, 9.5); doc.setTextColor(30, 30, 30);
}
function section(doc: any, title: string, y: number, C: number[]): number {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(C[0], C[1], C[2]);
  doc.text(title, 20, y); y += 2;
  doc.setDrawColor(C[0], C[1], C[2]); doc.setLineWidth(0.4); doc.line(20, y, 190, y); y += 6;
  doc.setTextColor(30, 30, 30); return y;
}
function labelValue(doc: any, label: string, value: any, x: number, y: number, maxW: number): number {
  if (value == null || value === '') return y;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
  doc.text(String(label).toUpperCase(), x, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
  y += 5; const lines = doc.splitTextToSize(String(value), maxW); doc.text(lines, x, y);
  return y + lines.length * 5 + 4;
}
function renderFields(doc: any, pairs: any[][], x: number, y: number, maxW: number): number {
  for (const [label, value] of pairs) y = labelValue(doc, label, value, x, y, maxW);
  return y;
}
function banner(doc: any, text: string, y: number): number {
  doc.setFillColor(16, 185, 129); doc.roundedRect(20, y, 170, 10, 2, 2, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(text, 26, y + 6.5); doc.setTextColor(30, 30, 30); return y + 16;
}
function cb(doc: any, y: number, need: number): number { if (y + need > 277) { doc.addPage(); return 20; } return y; }
function photosGrid(doc: any, title: string, photos: any[], y: number, C: number[]): number {
  y = section(doc, title, y, C);
  const imgW = (170 - 6) / 3, imgH = imgW * 0.75;
  const xs = [20, 20 + imgW + 3, 20 + 2 * (imgW + 3)];
  let col = 0;
  for (const ph of photos) {
    if (col === 0) y = cb(doc, y, imgH + 14);
    try { doc.addImage(ph.data, ph.format, xs[col], y, imgW, imgH); } catch (_) { /* skip bad image */ }
    if (ph.desc) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(80, 80, 80);
      doc.text(doc.splitTextToSize(String(ph.desc), imgW), xs[col], y + imgH + 3); doc.setTextColor(30, 30, 30);
    }
    col++;
    if (col === 3) { col = 0; y += imgH + 12; }
  }
  if (col > 0) y += imgH + 12;
  return y;
}

function buildReceiptPdf(p: any): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();
  doc.setFillColor(79, 70, 229); doc.rect(0, 0, pw, 42, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(22); doc.setFont('helvetica', 'bold');
  doc.text('FLOOR DADDY', 14, 18);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text('RAZZLE DAZZLE', 14, 26); doc.text('Deposit Receipt', 14, 34);
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text('Receipt #' + (p.receiptNumber || 'R-' + Date.now().toString().slice(-6)), pw - 14, 18, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Date: ' + new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), pw - 14, 26, { align: 'right' });

  doc.setTextColor(30, 30, 30); doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text('Received From:', 14, 56); doc.setFont('helvetica', 'normal');
  let yy = 64;
  if (p.leadName) { doc.text(String(p.leadName), 14, yy); yy += 7; }
  if (p.leadEmail) { doc.text(String(p.leadEmail), 14, yy); yy += 7; }
  if (p.leadPhone) { doc.text(String(p.leadPhone), 14, yy); yy += 7; }
  if (p.dcName) {
    doc.setFont('helvetica', 'bold'); doc.text('Design Consultant:', pw / 2 + 10, 56);
    doc.setFont('helvetica', 'normal'); doc.text(String(p.dcName), pw / 2 + 10, 64);
  }
  doc.setDrawColor(200, 200, 220); doc.setLineWidth(0.5); doc.line(14, 94, pw - 14, 94);

  const amt = p.depositAmount ? parseFloat(p.depositAmount) : 0;
  let y = 104;
  doc.setFillColor(243, 244, 246); doc.rect(14, y - 7, pw - 28, 12, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(80, 80, 100);
  doc.text('Description', 18, y); doc.text('Amount', pw - 18, y, { align: 'right' }); y += 10;
  doc.setTextColor(30, 30, 30); doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text('Deposit - Flooring Installation', 18, y); doc.setFont('helvetica', 'bold'); doc.text(fmt(amt), pw - 18, y, { align: 'right' }); y += 16;
  doc.setFillColor(79, 70, 229); doc.roundedRect(14, y, pw - 28, 20, 3, 3, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('DEPOSIT RECEIVED', 22, y + 13); doc.text(fmt(amt), pw - 22, y + 13, { align: 'right' }); y += 30;

  doc.setTextColor(30, 30, 30); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Payment Details', 14, y); y += 7;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(60, 60, 80); doc.setFontSize(10);
  if (p.depositPaymentMethod) { doc.text('Method: ' + p.depositPaymentMethod, 14, y); y += 7; }
  if (p.checkNumber) { doc.text('Check Number: ' + p.checkNumber, 14, y); y += 7; }
  if (p.locationAddress) { doc.text('Job Site: ' + p.locationAddress, 14, y); y += 7; }

  y += 8; doc.setTextColor(120, 120, 140); doc.setFontSize(9); doc.setFont('helvetica', 'italic');
  doc.text('Thank you for choosing Floor Daddy! This receipt confirms your deposit only.', 14, y);
  return new Uint8Array(doc.output('arraybuffer'));
}

function buildInspectionPdf(r: any, photos: any[], sig: any): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const C = [79, 70, 229];
  headerBar(doc, 'FLOOR DADDY - INSPECTION REPORT', C);
  let y = 24;
  y = section(doc, 'General Information', y, C);
  const insts = (Array.isArray(r.installers) && r.installers.length) ? r.installers : (r.installer_name ? [r.installer_name] : []);
  {
    const yl = renderFields(doc, [['Customer Name', r.customer_name], ['Address', r.address], ['Phone Primary', r.phone_primary], ['Phone Secondary', r.phone_secondary]], 20, y, 80);
    const yr = renderFields(doc, [['Job #', r.job_number], ['Inspected By', r.inspected_by], ['Inspection Date', r.inspected_on], [insts.length > 1 ? 'Installers' : 'Installer', insts.length ? insts.join(', ') : null], ['Installation Date', r.installation_date]], 110, y, 80);
    y = Math.max(yl, yr) + 4;
  }
  y = cb(doc, y, 30); y = section(doc, 'Issue Details', y, C);
  y = renderFields(doc, [['Issue To Inspect', r.issue_to_inspect], ['Material Installed', r.material_installed], ['Action / Materials / Labor Cost', r.action_materials_labor_cost]], 20, y, 170);
  y = cb(doc, y, 30); y = section(doc, 'Resolution', y, C);
  {
    const yl = renderFields(doc, [['Send Original Installer Back?', r.send_original_installer_back], ['Back Charge Date', r.back_charge_date]], 20, y, 80);
    const yr = renderFields(doc, [['Back Charge Installer', r.back_charge_installer], ['Payment To Different Installer', r.payment_to_different_installer]], 110, y, 80);
    y = Math.max(yl, yr);
  }
  y = renderFields(doc, [['Time To Resolve', r.time_to_resolve], ['Resolution', r.resolution]], 20, y, 170);
  if (r.materials_order_needs) { y = cb(doc, y, 20); y = section(doc, 'Materials to Order', y, C); y = labelValue(doc, 'Materials Needed', r.materials_order_needs, 20, y, 170); }
  if (r.worry_free_guarantee) { y = cb(doc, y, 14); y = labelValue(doc, 'Worry Free Guarantee', 'Yes', 20, y, 170); }
  if (sig) { y = cb(doc, y, 50); y = section(doc, 'Customer Signature', y, C); try { doc.addImage(sig.data, sig.format, 20, y, 80, 30); } catch (_) { /* skip */ } y += 36; }
  if (photos.length) { y = cb(doc, y, 20); y = photosGrid(doc, 'Photos', photos, y, C); }
  return new Uint8Array(doc.output('arraybuffer'));
}

function buildClaimPdf(claim: any, photos: any[]): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const type = claim.claim_type || 'Claim';
  const C = type === 'Claim' ? [220, 38, 38] : type === 'Repair' ? [217, 119, 6] : [37, 99, 235];
  headerBar(doc, 'FLOOR DADDY - ' + String(type).toUpperCase(), C);
  let y = 24;
  y = section(doc, 'General Information', y, C);
  {
    const yl = renderFields(doc, [['Customer Name', claim.customer_name], ['Address', claim.address]], 20, y, 80);
    const yr = renderFields(doc, [['Job #', claim.job_number], ['Submitted By', claim.submitted_by], ['Submitted On', claim.submitted_on]], 110, y, 80);
    y = Math.max(yl, yr) + 4;
  }
  const insts = (Array.isArray(claim.installers) && claim.installers.length) ? claim.installers : (claim.installer_name ? [claim.installer_name] : []);
  if (insts.length) { y = cb(doc, y, 16); y = section(doc, 'Installer(s)', y, C); y = labelValue(doc, insts.length > 1 ? 'Installers' : 'Installer', insts.join(', '), 20, y, 170); }
  y = cb(doc, y, 24); y = section(doc, 'Details', y, C);
  y = labelValue(doc, 'Notes', claim.notes, 20, y, 170);
  if (claim.need_to_order_material) y = labelValue(doc, 'Need To Order Material', 'Yes', 20, y, 170);
  y = labelValue(doc, 'Material Details', claim.material_details, 20, y, 170);
  if (claim.billable_repair || claim.is_back_charge || claim.back_charge_party || claim.payment_status) {
    y = cb(doc, y, 24); y = section(doc, 'Billing Information', y, C);
    const yl = renderFields(doc, [['Billable Repair', claim.billable_repair ? 'Yes' : null], ['Back Charge', claim.is_back_charge ? 'Yes' : null]], 20, y, 80);
    const yr = renderFields(doc, [['Back Charge Party', claim.back_charge_party], ['Payment Status', claim.payment_status]], 110, y, 80);
    y = Math.max(yl, yr) + 4;
  }
  if (claim.is_completed || claim.reference_number || claim.eta || claim.completed_by) {
    y = cb(doc, y, 30); y = section(doc, 'Status & Resolution', y, C);
    if (claim.is_completed) y = banner(doc, 'COMPLETED', y);
    const yl = renderFields(doc, [['Reference #', claim.reference_number], ['ETA', claim.eta]], 20, y, 80);
    const yr = renderFields(doc, [['Completed By', claim.completed_by], ['Completed On', claim.completed_on]], 110, y, 80);
    y = Math.max(yl, yr) + 4;
  }
  if (photos.length) { y = cb(doc, y, 20); y = photosGrid(doc, 'Photos', photos, y, C); }
  return new Uint8Array(doc.output('arraybuffer'));
}

async function handleType(s: any, type: string, p: any): Promise<Record<string, unknown>> {
  switch (type) {
    case 'receipt': {
      const recipient = (await recipientsFor(s, []))[0] || p.leadEmail;
      if (!recipient) return { error: 'no recipient email' };
      const lastName = sanitizeName(String(p.leadName || 'customer').split(' ').slice(-1)[0]);
      const dateStr = new Date().toLocaleDateString('en-US').replaceAll('/', '-');
      const filename = `receipt-${lastName}-${dateStr}.pdf`;
      const url = await uploadPdf(s, buildReceiptPdf(p), filename);
      const amt = p.depositAmount ? parseFloat(p.depositAmount) : 0;
      const html =
        `<p>Hi ${esc(p.leadName || 'there')},</p>` +
        `<p>Thank you for your deposit! Please find your receipt attached.</p>` +
        `<p><strong>Deposit Amount:</strong> ${fmt(amt)}<br/><strong>Payment Method:</strong> ${esc(p.depositPaymentMethod || 'N/A')}</p>` +
        `<p>We look forward to working with you!</p><p style='color:#888;font-size:12px;'>- The Floor Daddy Team</p>`;
      await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: recipient, subject: 'Your Deposit Receipt - Floor Daddy', body: html, sent_by: 'System', attachments: [{ filename, url }] } });
      return { queued: true, type, pdf_url: url };
    }

    case 'inspection': {
      const r = await one(s, 'inspection_report', p.reportId);
      if (!r) return { error: 'Report not found' };
      const recipients = await recipientsFor(s, r.email_recipients);
      if (!recipients.length) return { skipped: 'no recipients' };
      const photos = await prefetchPhotos(r.images);
      const sig = r.customer_signature ? await fetchImg(r.customer_signature) : null;
      const url = await uploadPdf(s, buildInspectionPdf(r, photos, sig), `inspection-report-${sanitizeName(r.customer_name)}-${r.inspected_on || new Date().toISOString().slice(0, 10)}.pdf`);
      const customerName = r.customer_name || 'Customer';
      const inspectedOn = r.inspected_on || new Date().toISOString().slice(0, 10);
      const lastName = customerName.split(' ').slice(-1)[0] || customerName;
      const subject = `Inspection Report - ${r.job_number ? r.job_number + ' - ' + lastName : lastName} (${inspectedOn})`;
      const html =
        `<p>Please find attached the inspection report for <strong>${esc(customerName)}</strong> inspected on <strong>${esc(inspectedOn)}</strong>.</p>` +
        (r.issue_to_inspect ? `<p><strong>Issue:</strong> ${esc(r.issue_to_inspect)}</p>` : '') +
        (r.resolution ? `<p><strong>Resolution:</strong> ${esc(r.resolution)}</p>` : '') +
        `<p style='color:#888;font-size:12px;'>- Floor Daddy Team</p>`;
      await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: recipients[0], bcc: recipients.slice(1), subject, body: html, sent_by: 'System', attachments: [{ filename: `inspection-report-${sanitizeName(customerName)}-${inspectedOn}.pdf`, url }] } });
      return { queued: true, type, recipients: recipients.length, pdf_url: url };
    }

    case 'claim': {
      const claim = await one(s, 'project_claim', p.claimId);
      if (!claim) return { error: 'Claim not found' };
      const recipients = await recipientsFor(s, claim.email_recipients);
      if (!recipients.length) return { skipped: 'no recipients' };
      const photos = await prefetchPhotos(claim.images);
      const t = claim.claim_type || 'Claim';
      const customerName = claim.customer_name || 'Customer';
      const submittedOn = claim.submitted_on || new Date().toISOString().slice(0, 10);
      const filename = `${sanitizeName(t)}-${sanitizeName(customerName)}-${submittedOn}.pdf`;
      const url = await uploadPdf(s, buildClaimPdf(claim, photos), filename);
      const lastName = customerName.split(' ').slice(-1)[0] || customerName;
      const subject = `${t} - ${claim.job_number ? claim.job_number + ' - ' + lastName : lastName} (${submittedOn})`;
      const billing: string[] = [];
      if (claim.billable_repair) billing.push('Billable Repair');
      if (claim.is_back_charge) billing.push('Back Charge' + (claim.back_charge_party ? ' - ' + claim.back_charge_party : ''));
      if (claim.payment_status) billing.push('Payment Status: ' + claim.payment_status);
      const html =
        `<p>Please find attached the <strong>${esc(t)}</strong> report for <strong>${esc(customerName)}</strong> submitted on <strong>${esc(submittedOn)}</strong>.</p>` +
        (claim.notes ? `<p><strong>Notes:</strong> ${esc(claim.notes)}</p>` : '') +
        (claim.need_to_order_material ? `<p><strong style='color:#dc2626;'>Material needs to be ordered.</strong>${claim.material_details ? ' ' + esc(claim.material_details) : ''}</p>` : '') +
        (billing.length ? `<p><strong>Billing:</strong> ${esc(billing.join(' | '))}</p>` : '') +
        (claim.eta ? `<p><strong>ETA:</strong> ${esc(claim.eta)}</p>` : '') +
        `<p style='color:#888;font-size:12px;'>- Floor Daddy Team</p>`;
      await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: recipients[0], bcc: recipients.slice(1), subject, body: html, sent_by: 'System', attachments: [{ filename, url }] } });
      return { queued: true, type, recipients: recipients.length, pdf_url: url };
    }

    default:
      return { error: `Unknown pdf type ${type}` };
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
    return Response.json(result, { status: result.error ? 400 : 200, headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
