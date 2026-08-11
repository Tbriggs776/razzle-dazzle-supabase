// In-house e-signature engine. One function, several actions:
//   create      (staff/internal) -> snapshot + hash the document, make a signature_request
//                with an unguessable token, email the signer the signing link.
//   get         (token)          -> load the document to display + consent text; log 'viewed'.
//   send_otp    (token)          -> text the signer a 6-digit code (if the type requires it).
//   verify_otp  (token, code)    -> verify the code.
//   submit      (token, ...)     -> record consent + signature, seal a PDF with an audit
//                certificate, hash it, stamp the record, email the signer their copy.
// Signer actions are authorized by the token itself (the capability). IP / device / time
// are captured SERVER-SIDE into signature_event, and the document hash makes tampering
// detectable. ESIGN/UETA-aligned; admin-configurable per document type.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64, decodeBase64 } from 'jsr:@std/encoding/base64';
import { jsPDF } from 'npm:jspdf@4.0.0';

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
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

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
async function sha256hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || null;
const fullName = (r: any) => `${r.customer_first_name || ''} ${r.customer_last_name || ''}`.trim();

// Per-type field mapping (code-level; the on/off + consent + OTP toggles live in DB config).
const DOC_MAP: Record<string, any> = {
  manual_sales_contract: {
    table: 'manual_sales_contract',
    signer: async (_s: any, r: any) => ({ name: fullName(r), email: r.customer_email, phone: r.customer_phone }),
    snapshot: (r: any) => ({ Customer: fullName(r), Email: r.customer_email, Phone: r.customer_phone, Address: r.customer_address, Consultant: r.consultant_name, 'Sale Date': r.sale_date, 'Install Date': r.install_date, Products: r.products_description, 'Sale Amount': r.sale_amount != null ? '$' + r.sale_amount : null, Deposit: r.deposit_amount != null ? '$' + r.deposit_amount : null, Notes: r.notes }),
    stamp: (url: string, name: string) => ({ status: 'signed', signed_at: new Date().toISOString(), customer_printed_name: name, customer_signature: url }),
  },
  design_mod: {
    table: 'design_mod',
    signer: async (s: any, r: any) => {
      let phone: string | null = null;
      if (r.customer_id) {
        const { data: c } = await s.from('customer').select('phone').eq('id', r.customer_id).maybeSingle();
        phone = c?.phone || null;
        if (!phone) { const { data: l } = await s.from('lead').select('phone').eq('id', r.customer_id).maybeSingle(); phone = l?.phone || null; }
      }
      return { name: fullName(r), email: r.customer_email, phone };
    },
    snapshot: (r: any) => ({ Customer: fullName(r), Email: r.customer_email, 'Job #': r.job_number, Changes: r.products_or_changes, 'Value Added Costs': r.value_added_costs != null ? '$' + r.value_added_costs : null, Terms: r.funds_collected_terms }),
    stamp: (url: string, name: string) => ({ status: 'signed', signed_at: new Date().toISOString(), customer_printed_name: name, customer_signature: url }),
  },
  pre_install: {
    table: 'standalone_pre_install_checklist',
    signer: async (_s: any, r: any) => ({ name: fullName(r), email: r.customer_email, phone: null }),
    snapshot: (r: any) => ({ Customer: fullName(r), Email: r.customer_email, 'Job #': r.job_number, Product: r.product_info }),
    stamp: (url: string, name: string) => ({ status: 'signed', signed_at: new Date().toISOString(), customer_printed_name: name, signature_url: url }),
  },
};

async function logEvent(s: any, requestId: string, event: string, req: Request, meta: any = null) {
  await s.from('signature_event').insert({ request_id: requestId, event, ip: clientIp(req), user_agent: req.headers.get('user-agent'), meta });
}
async function reqByToken(s: any, token: string) {
  if (!token) return null;
  const { data } = await s.from('signature_request').select('*').eq('token', token).maybeSingle();
  return data;
}
// Signed artifacts live in the PRIVATE 'esign' bucket. We store the storage PATH on the
// record and mint short-lived signed URLs on demand (client download, email attach, admin view)
// — never a public URL.
const ESIGN_BUCKET = 'esign';
async function uploadPrivate(s: any, bytes: Uint8Array, path: string, contentType: string): Promise<string> {
  const up = await s.storage.from(ESIGN_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (up.error) throw new Error(`upload failed: ${up.error.message}`);
  return path;
}
async function signedUrl(s: any, path: string, ttlSeconds = 3600): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await s.storage.from(ESIGN_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error) return null;
  return data.signedUrl;
}

// ---- sealed PDF (document snapshot + signature + audit certificate) ----
function secH(doc: any, title: string, y: number, C: number[]): number {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(C[0], C[1], C[2]);
  doc.text(title, 20, y); y += 2; doc.setDrawColor(C[0], C[1], C[2]); doc.setLineWidth(0.4); doc.line(20, y, 190, y);
  y += 6; doc.setTextColor(30, 30, 30); return y;
}
function lv(doc: any, label: string, value: any, x: number, y: number, maxW: number): number {
  if (value == null || value === '') return y;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(100, 100, 100); doc.text(String(label).toUpperCase(), x, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 30, 30); y += 5;
  const lines = doc.splitTextToSize(String(value), maxW); doc.text(lines, x, y); return y + lines.length * 5 + 4;
}
function cbrk(doc: any, y: number, need: number): number { if (y + need > 277) { doc.addPage(); return 20; } return y; }

async function buildSealedPdf(s: any, request: any, config: any, events: any[]): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const C = [79, 70, 229];
  doc.setFillColor(C[0], C[1], C[2]); doc.rect(0, 0, 210, 14, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(255, 255, 255);
  doc.text('FLOOR DADDY - ' + String(config.label).toUpperCase(), 20, 9.5); doc.setTextColor(30, 30, 30);
  let y = 24;
  y = secH(doc, 'Document', y, C);
  for (const [label, value] of Object.entries(request.document_snapshot || {})) { y = cbrk(doc, y, 16); y = lv(doc, label, value, 20, y, 170); }

  // P11: embed the per-document agreement / terms the signer accepted, prominently on the document
  // page (the audit certificate below also records it as the consent statement).
  if (request.consent_text) {
    y = cbrk(doc, y, 24); y = secH(doc, 'Agreement', y, C);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
    for (const ln of doc.splitTextToSize(String(request.consent_text), 170)) { y = cbrk(doc, y, 6); doc.text(ln, 20, y); y += 4.6; }
    doc.setTextColor(30, 30, 30);
  }

  y = cbrk(doc, y, 60); y = secH(doc, 'Signature', y, C);
  y = lv(doc, 'Electronically signed by', request.signer_printed_name || request.signer_name, 20, y, 170);
  // signature_image_url holds the private-bucket PATH; download the bytes server-side.
  if (request.signature_image_url) { try { const { data: blob } = await s.storage.from(ESIGN_BUCKET).download(request.signature_image_url); if (blob) { const b = encodeBase64(new Uint8Array(await blob.arrayBuffer())); doc.addImage(`data:image/png;base64,${b}`, 'PNG', 20, y, 70, 26); y += 30; } } catch (_) { /* skip */ } }
  y = lv(doc, 'Signed at', request.signed_at, 20, y, 170);

  // Audit certificate page.
  doc.addPage(); y = 20;
  y = secH(doc, 'Signature Certificate', y, C);
  y = lv(doc, 'Document', `${config.label} (${request.document_type} / ${request.document_id})`, 20, y, 170);
  y = lv(doc, 'Signer', `${request.signer_name || ''} <${request.signer_email || ''}>`, 20, y, 170);
  y = lv(doc, 'Consent agreed', request.consent_agreed ? 'Yes' : 'No', 20, y, 170);
  if (request.otp_verified_at) y = lv(doc, 'Identity (SMS code) verified at', request.otp_verified_at, 20, y, 170);
  y = lv(doc, 'Document integrity (SHA-256)', request.document_hash, 20, y, 170);
  y = lv(doc, 'Consent statement', request.consent_text, 20, y, 170);
  y = cbrk(doc, y, 30); y = secH(doc, 'Audit Trail', y, C);
  for (const e of events) { y = cbrk(doc, y, 10); y = lv(doc, `${e.event}`, `${e.at}  |  IP ${e.ip || '-'}  |  ${(e.user_agent || '-').slice(0, 60)}`, 20, y, 170); }
  return new Uint8Array(doc.output('arraybuffer'));
}

// ---- actions ----
async function actCreate(s: any, req: Request, p: any) {
  const config = (await s.from('esign_document_type').select('*').eq('document_type', p.document_type).maybeSingle()).data;
  if (!config) return json({ error: 'unknown document type' }, 400);
  if (!config.esign_enabled) return json({ error: 'e-sign disabled for this document type' }, 400);
  const map = DOC_MAP[p.document_type];
  if (!map) return json({ error: 'no mapping for document type' }, 400);
  const rec = (await s.from(map.table).select('*').eq('id', p.document_id).maybeSingle()).data;
  if (!rec) return json({ error: 'document not found' }, 404);

  const signer = await map.signer(s, rec);
  const snapshot = map.snapshot(rec);
  const document_hash = await sha256hex(JSON.stringify(snapshot));
  const expires = new Date(Date.now() + (config.expiry_days || 14) * 86400000).toISOString();
  const ins = await s.from('signature_request').insert({
    document_type: p.document_type, document_id: p.document_id,
    signer_name: signer.name, signer_email: signer.email, signer_phone: signer.phone,
    document_hash, document_snapshot: snapshot, consent_text: config.consent_text,
    require_sms_otp: config.require_sms_otp, expires_at: expires,
  }).select('id, token').single();
  if (ins.error) return json({ error: ins.error.message }, 500);
  const { id, token } = ins.data;
  const signUrl = `${APP_URL}/SignDocument?token=${token}`;
  await logEvent(s, id, 'sent', req, { signer_email: signer.email });
  if (signer.email) {
    const body = `<p>Hi ${signer.name || 'there'},</p><p>Please review and sign your ${config.label} using the secure link below:</p>` +
      `<p><a href='${signUrl}' style='background:#4F46E5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;'>Review &amp; Sign</a></p>` +
      `<p>Or copy this link: ${signUrl}</p><p style='color:#888;font-size:12px;'>- Floor Daddy Team</p>`;
    await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: signer.email, subject: `Please sign: ${config.label}`, body, sent_by: 'System' } });
  }
  return json({ created: true, token, sign_url: signUrl, request_id: id });
}

async function actGet(s: any, req: Request, p: any) {
  const r = await reqByToken(s, p.token);
  if (!r) return json({ error: 'not found' }, 404);
  if (r.status === 'signed') return json({ status: 'signed', signed_at: r.signed_at, sealed_pdf_url: await signedUrl(s, r.sealed_pdf_url, 3600) });
  if (r.expires_at && new Date(r.expires_at) < new Date()) { await s.from('signature_request').update({ status: 'expired' }).eq('id', r.id); return json({ status: 'expired' }); }
  if (r.status === 'sent') await s.from('signature_request').update({ status: 'viewed', viewed_at: new Date().toISOString() }).eq('id', r.id);
  await logEvent(s, r.id, 'viewed', req);
  const config = (await s.from('esign_document_type').select('label').eq('document_type', r.document_type).maybeSingle()).data;
  const phoneMask = r.signer_phone ? '***-***-' + String(r.signer_phone).replace(/\D/g, '').slice(-4) : null;
  return json({ status: r.status === 'sent' ? 'viewed' : r.status, label: config?.label, document: r.document_snapshot, consent_text: r.consent_text, require_sms_otp: r.require_sms_otp, otp_verified: !!r.otp_verified_at, signer_name: r.signer_name, phone_mask: phoneMask });
}

async function actSendOtp(s: any, req: Request, p: any) {
  const r = await reqByToken(s, p.token);
  if (!r) return json({ error: 'not found' }, 404);
  if (!r.require_sms_otp) return json({ error: 'otp not required' }, 400);
  if (!r.signer_phone) return json({ error: 'no phone on file for SMS verification' }, 400);
  if (r.status === 'signed') return json({ error: 'already signed' }, 400);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const otp_hash = await sha256hex(`${r.token}:${code}`);
  await s.from('signature_request').update({ otp_hash, otp_expires_at: new Date(Date.now() + 600000).toISOString(), otp_attempts: 0, status: 'otp_sent' }).eq('id', r.id);
  await s.rpc('enqueue_job', { p_type: 'send_sms', p_payload: { to: r.signer_phone, body: `Your Floor Daddy signing code is ${code}. It expires in 10 minutes.`, sent_by: 'System' } });
  await logEvent(s, r.id, 'otp_sent', req);
  return json({ sent: true });
}

async function actVerifyOtp(s: any, req: Request, p: any) {
  const r = await reqByToken(s, p.token);
  if (!r) return json({ error: 'not found' }, 404);
  if (r.otp_verified_at) return json({ verified: true });
  if (!r.otp_hash || !r.otp_expires_at || new Date(r.otp_expires_at) < new Date()) return json({ error: 'code expired - request a new one' }, 400);
  if ((r.otp_attempts || 0) >= 5) return json({ error: 'too many attempts - request a new code' }, 400);
  const ok = (await sha256hex(`${r.token}:${String(p.code || '')}`)) === r.otp_hash;
  if (!ok) { await s.from('signature_request').update({ otp_attempts: (r.otp_attempts || 0) + 1 }).eq('id', r.id); return json({ error: 'incorrect code' }, 400); }
  await s.from('signature_request').update({ otp_verified_at: new Date().toISOString(), status: 'otp_verified' }).eq('id', r.id);
  await logEvent(s, r.id, 'otp_verified', req);
  return json({ verified: true });
}

async function actSubmit(s: any, req: Request, p: any) {
  const r = await reqByToken(s, p.token);
  if (!r) return json({ error: 'not found' }, 404);
  if (r.status === 'signed') return json({ error: 'already signed' }, 400);
  if (r.expires_at && new Date(r.expires_at) < new Date()) return json({ error: 'expired' }, 400);
  if (r.require_sms_otp && !r.otp_verified_at) return json({ error: 'SMS verification required' }, 400);
  if (!p.consent) return json({ error: 'consent is required' }, 400);
  if (!p.signature || !p.printed_name) return json({ error: 'signature and printed name are required' }, 400);
  const map = DOC_MAP[r.document_type];
  if (!map) return json({ error: 'no mapping' }, 400);

  const now = new Date().toISOString();
  // store the drawn signature image in the private bucket (path on the record)
  const sigBytes = decodeBase64(String(p.signature).split(',').pop() || '');
  const sigPath = await uploadPrivate(s, sigBytes, `signatures/${r.id}/signature.png`, 'image/png');

  await s.from('signature_request').update({ status: 'signed', signed_at: now, consent_agreed: true, signer_printed_name: p.printed_name, signature_image_url: sigPath, updated_date: now }).eq('id', r.id);
  await logEvent(s, r.id, 'consented', req);
  await logEvent(s, r.id, 'signed', req, { printed_name: p.printed_name });

  const fresh = await reqByToken(s, p.token);
  const config = (await s.from('esign_document_type').select('*').eq('document_type', r.document_type).maybeSingle()).data;
  const { data: events } = await s.from('signature_event').select('event, at, ip, user_agent').eq('request_id', r.id).order('at', { ascending: true });
  const sealed = await buildSealedPdf(s, fresh, config, events || []);
  const sealedPath = await uploadPrivate(s, sealed, `signatures/${r.id}/signed.pdf`, 'application/pdf');
  const sealedHash = await sha256hex(sealed);
  await s.from('signature_request').update({ sealed_pdf_url: sealedPath, sealed_pdf_hash: sealedHash }).eq('id', r.id);

  // Short-lived signed URL for the client download + email attachment (the send job fetches within
  // ~1 min). ES3: the business-record signature thumbnail is stamped with the esign-bucket PATH
  // (prefixed), NOT a 365-day bearer URL — it renders via a short-lived signed URL minted on demand
  // (<SignedImage>/resolveFileUrl), backed by the signature-only authenticated read policy.
  const sealedDownloadUrl = await signedUrl(s, sealedPath, 3600);
  await s.from(map.table).update(map.stamp(`esign:${sigPath}`, p.printed_name)).eq('id', r.document_id);

  // email the signer their sealed copy + notify internal recipients
  const filename = `${r.document_type}-signed-${r.document_id}.pdf`;
  if (r.signer_email && sealedDownloadUrl) {
    const body = `<p>Hi ${r.signer_printed_name || 'there'},</p><p>Thank you for signing your ${config.label}. A copy is attached for your records.</p><p style='color:#888;font-size:12px;'>- Floor Daddy Team</p>`;
    await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: r.signer_email, subject: `Signed: ${config.label}`, body, sent_by: 'System', attachments: [{ filename, url: sealedDownloadUrl }] } });
  }
  const notify: string[] = Array.isArray(config?.notify_emails) ? config.notify_emails : [];
  if (notify.length && sealedDownloadUrl) {
    const body = `<p>${config.label} signed by ${r.signer_name || r.signer_printed_name} on ${now}.</p>`;
    await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: notify[0], bcc: notify.slice(1), subject: `Signed: ${config.label} - ${r.signer_name || ''}`, body, sent_by: 'System', attachments: [{ filename, url: sealedDownloadUrl }] } });
  }
  return json({ signed: true, sealed_pdf_url: sealedDownloadUrl });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let p: any;
  try { p = await req.json(); } catch (_) { return json({ error: 'bad request' }, 400); }
  const action = p?.action;
  const s = svc();
  try {
    // 'create' is staff/server-triggered; token actions are authorized by the token.
    if (action === 'create') {
      const internal = await getSecret('CRON_SECRET');
      const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
      if (!isInternal) {
        const user = await currentUser(req);
        if (!user) return json({ error: 'Unauthorized' }, 401);
        // Creating a signature request reads the target doc via the service role and fires a
        // customer-facing email/SMS on a legally-framed document — so a pure VIEW-ONLY staffer
        // who knows a doc UUID must NOT be able to mint one. Require edit on some module in the
        // sales/ops flow (covers DCs who sign in person via appointments:edit, sales staff,
        // PMs/ops via projects) or org-admin. Internal (server) callers are trusted above.
        const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
        const [{ data: eSales }, { data: eAppts }, { data: eProjects }, { data: isAdmin }] = await Promise.all([
          asUser.rpc('can_edit', { m: 'sales' }),
          asUser.rpc('can_edit', { m: 'appointments' }),
          asUser.rpc('can_edit', { m: 'projects' }),
          asUser.rpc('is_org_admin'),
        ]);
        if (!eSales && !eAppts && !eProjects && !isAdmin) return json({ error: 'Not authorized to send this document for signature' }, 403);
      }
      return await actCreate(s, req, p);
    }
    if (action === 'get') return await actGet(s, req, p);
    if (action === 'send_otp') return await actSendOtp(s, req, p);
    if (action === 'verify_otp') return await actVerifyOtp(s, req, p);
    if (action === 'submit') return await actSubmit(s, req, p);
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
