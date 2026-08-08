// PDF-attachment email senders. Generates a PDF (jsPDF), uploads it to Storage,
// and enqueues a send_email job referencing the PDF by URL (so job payloads stay
// small; sendMessage fetches + attaches it). Auth: internal secret OR authed user.
// Add a PDF sender = one buildXPdf() + one case + one shim alias.
import { createClient } from 'jsr:@supabase/supabase-js@2';
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

function fmt(v: unknown): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v) || 0);
}

async function uploadPdf(s: any, bytes: Uint8Array, filename: string): Promise<string> {
  const path = `receipts/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${filename}`;
  const up = await s.storage.from('uploads').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error(`upload failed: ${up.error.message}`);
  const { data } = s.storage.from('uploads').getPublicUrl(path);
  return data.publicUrl;
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

async function handleType(s: any, type: string, p: any): Promise<Record<string, unknown>> {
  switch (type) {
    case 'receipt': {
      const { data: ss } = await s.from('sms_settings').select('divert_emails_to').limit(1);
      const recipient = ss?.[0]?.divert_emails_to || p.leadEmail;
      if (!recipient) return { error: 'no recipient email' };
      const lastName = String(p.leadName || 'customer').split(' ').slice(-1)[0].toLowerCase();
      const dateStr = new Date().toLocaleDateString('en-US').replaceAll('/', '-');
      const filename = `receipt-${lastName}-${dateStr}.pdf`;
      const url = await uploadPdf(s, buildReceiptPdf(p), filename);
      const amt = p.depositAmount ? parseFloat(p.depositAmount) : 0;
      const html =
        `<p>Hi ${p.leadName || 'there'},</p>` +
        `<p>Thank you for your deposit! Please find your receipt attached.</p>` +
        `<p><strong>Deposit Amount:</strong> ${fmt(amt)}<br/><strong>Payment Method:</strong> ${p.depositPaymentMethod || 'N/A'}</p>` +
        `<p>We look forward to working with you!</p><p style='color:#888;font-size:12px;'>- The Floor Daddy Team</p>`;
      await s.rpc('enqueue_job', {
        p_type: 'send_email',
        p_payload: { to: recipient, subject: 'Your Deposit Receipt - Floor Daddy', body: html, sent_by: 'System', attachments: [{ filename, url }] },
      });
      return { queued: true, type, pdf_url: url };
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
