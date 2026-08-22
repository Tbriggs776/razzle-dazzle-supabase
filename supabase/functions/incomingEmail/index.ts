// Inbound email webhook (public, verify_jwt off). Resend POSTs an `email.received` event
// when a customer replies to a lead message. We resolve the lead/customer, fetch the body
// from Resend's API, and store ONE inbound communication row so the reply threads into the
// conversation (My Results unread badge, ContactCustomerDialog, Communication Hub).
//
// Routing: outbound lead emails (sendLeadMessage) set Reply-To to
// reply+{leadId}@reply.floordaddy.com, so the reply's To address carries the lead id. If it
// doesn't, we fall back to matching the sender's email against leads/customers.
//
// Auth: Resend signs webhooks with Svix. We verify svix-id / svix-timestamp / svix-signature
// against RESEND_WEBHOOK_SECRET (the endpoint signing secret pasted at /Integrations).
// Internal/test callers use the x-internal-secret header. No secret is accepted in the URL
// query string. Point the Resend inbound webhook at <SUPABASE_URL>/functions/v1/incomingEmail.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifySvix } from '../_shared/svix.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

// "Name <email@x.com>" -> email@x.com
function extractEmail(addr: string): string {
  if (!addr) return '';
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  try {
    const raw = await req.text();

    // Gate: Svix signature (real Resend) OR x-internal-secret (internal/test).
    const webhookSecret = await getSecret('RESEND_WEBHOOK_SECRET');
    const internal = await getSecret('CRON_SECRET');
    const internalHdr = req.headers.get('x-internal-secret');
    const svixOk = !!webhookSecret && await verifySvix(
      webhookSecret,
      { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') },
      raw,
    );
    if (!svixOk && !(internal && internalHdr === internal)) {
      return Response.json({ error: 'forbidden' }, { status: 401 });
    }

    let event: any = {};
    try { event = JSON.parse(raw); } catch (_) { event = {}; }
    if (event.type !== 'email.received') {
      return Response.json({ ok: true, ignored: event.type || 'unknown' });
    }

    const data = event.data || {};
    const emailId: string | undefined = data.email_id;
    const fromAddr = data.from ? extractEmail(data.from) : '';
    const toAddrs: string[] = Array.isArray(data.to) ? data.to : (data.to ? [data.to] : []);
    const subject: string = data.subject || '';

    const s = svc();

    // Idempotency: a webhook retry carries the same email_id — no-op if already stored.
    if (emailId) {
      const { data: dup } = await s.from('communication').select('id')
        .eq('direction', 'inbound').eq('provider_message_id', emailId).maybeSingle();
      if (dup) return Response.json({ ok: true, duplicate: true });
    }

    // Extract lead id from a reply+{leadId}@reply.floordaddy.com address.
    let leadId: string | null = null;
    for (const addr of toAddrs) {
      const email = extractEmail(addr);
      const m = email.match(/^reply\+([a-zA-Z0-9-]+)@/i);
      if (m) { leadId = m[1]; break; }
    }

    // Fetch the email body (the webhook payload does not include it).
    let textBody = '';
    let htmlBody = '';
    if (emailId) {
      const resendKey = await getSecret('RESEND_API_KEY');
      if (resendKey) {
        try {
          const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
            headers: { 'Authorization': `Bearer ${resendKey}` },
          });
          if (res.ok) {
            const emailData = await res.json();
            textBody = emailData.text || '';
            htmlBody = emailData.html || '';
          }
        } catch (e) {
          console.error('Failed to fetch email body:', (e as Error).message);
        }
      }
    }
    const body = textBody || (htmlBody ? htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');

    // Match sender email to a lead/customer for name + fallback lead id.
    let matchedLead: any = null;
    let matchedCustomer: any = null;
    if (fromAddr) {
      const { data: leadRows } = await s.from('lead').select('id, first_name, last_name, email').ilike('email', fromAddr).limit(1);
      matchedLead = leadRows?.[0] || null;
      const { data: custRows } = await s.from('customer').select('id, first_name, last_name, email').ilike('email', fromAddr).limit(1);
      matchedCustomer = custRows?.[0] || null;
    }

    const finalLeadId = leadId || matchedLead?.id || null;
    const contactName = matchedLead
      ? `${matchedLead.first_name || ''} ${matchedLead.last_name || ''}`.trim()
      : matchedCustomer
      ? `${matchedCustomer.first_name || ''} ${matchedCustomer.last_name || ''}`.trim()
      : fromAddr;

    await s.from('communication').insert({
      type: 'Email',
      direction: 'inbound',
      contact_email: fromAddr,
      contact_name: contactName || fromAddr,
      subject,
      body: body.substring(0, 3000),
      status: 'received',
      delivery_status: 'received',
      status_updated_at: new Date().toISOString(),
      lead_id: finalLeadId,
      customer_id: matchedCustomer?.id || null,
      provider: 'resend',
      provider_message_id: emailId || null,
    });

    console.log(`Inbound email from ${fromAddr} for lead ${finalLeadId}: ${subject}`);
    return Response.json({ ok: true, from: fromAddr, leadId: finalLeadId });
  } catch (error) {
    console.error('incomingEmail error:', (error as Error).message);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
