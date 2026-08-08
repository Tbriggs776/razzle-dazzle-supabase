// LLM bridge — replaces base44's InvokeLLM (the app's only true vendor lock-in) with
// Anthropic Claude. Two modes:
//   - no `task`: the raw InvokeLLM contract used by integrations.Core.InvokeLLM
//     ({ prompt, response_json_schema, file_urls }). Returns the LLM result DIRECTLY:
//     the parsed object when a schema is given, otherwise the plain text string.
//   - a `task`: a ported server function that calls the bridge then updates a record
//     (extract_contract -> extractContractData, analyze_not_sold -> analyzeNotSoldReason).
//
// Graceful degrade: when the anthropic integration is disabled or no key is set, returns
// { stub: true } so the existing frontend "not available yet" fallbacks keep working.
// Auth: internal secret (server) OR an authenticated user (browser invoke).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_MODEL = 'claude-sonnet-5';
const LOSS_REASONS = [
  'Price Too High', 'Going with Competitor', 'Not Ready to Buy / Timing', 'Budget Constraints',
  'Product/Service Not Right Fit', 'Decision Maker Not Present', 'Needs More Time to Think',
  'Other Priorities', 'Quality Concerns', 'Installation Timeline Concerns',
  'Customer No-Show / Unresponsive', 'Other',
];

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

async function one(s: any, table: string, id: string | null | undefined) {
  if (!id) return null;
  const { data } = await s.from(table).select('*').eq('id', id).maybeSingle();
  return data;
}

// Fetch a file URL and turn it into a Claude content block (PDF -> document, else image).
async function fileBlock(url: string): Promise<any | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const b64 = encodeBase64(new Uint8Array(await r.arrayBuffer()));
    if (ct.includes('pdf') || url.toLowerCase().split('?')[0].endsWith('.pdf')) {
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
    }
    let media = ct.startsWith('image/') ? ct.split(';')[0].trim() : '';
    if (!media) {
      const ext = url.toLowerCase().split('?')[0].split('.').pop();
      media = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    }
    return { type: 'image', source: { type: 'base64', media_type: media, data: b64 } };
  } catch (_) { return null; }
}

// The Claude bridge. Returns { stub:true } when unconfigured, the parsed object when a
// response_json_schema is given (via a forced tool call), else the plain text string.
async function llmInvoke(s: any, args: any): Promise<any> {
  const { data: integ } = await s.from('integration').select('is_enabled, config').eq('key', 'anthropic').single();
  if (!integ?.is_enabled) return { stub: true };
  const key = await getSecret('ANTHROPIC_API_KEY');
  if (!key) return { stub: true };
  const cfg = (integ.config as Record<string, any>) || {};
  const model = args.model || cfg.model || DEFAULT_MODEL;

  const content: any[] = [];
  for (const url of Array.isArray(args.file_urls) ? args.file_urls : []) {
    const blk = await fileBlock(url);
    if (blk) content.push(blk);
  }
  content.push({ type: 'text', text: args.prompt || '' });

  const body: any = { model, max_tokens: args.max_tokens || 8192, messages: [{ role: 'user', content }] };
  if (args.system) body.system = args.system;
  if (args.response_json_schema) {
    body.tools = [{ name: 'result', description: 'Return the structured result in the required schema.', input_schema: args.response_json_schema }];
    body.tool_choice = { type: 'tool', name: 'result' };
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || `Anthropic HTTP ${r.status}`);

  if (args.response_json_schema) {
    const tu = (d.content || []).find((b: any) => b.type === 'tool_use');
    return tu ? tu.input : {};
  }
  return (d.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}

async function handleTask(s: any, task: string, p: any): Promise<Record<string, unknown>> {
  switch (task) {
    // extractContractData: pull invoice # + line items from a contract PDF, stamp the sale.
    case 'extract_contract': {
      if (!p.contractUrl) return { error: 'Contract URL is required', success: false };
      const result = await llmInvoke(s, {
        prompt: `Extract the following information from this invoice/contract PDF:

1. Invoice Number: Look for "Invoice #" or similar label near the top of the document
2. Line Items: List all items between the "Item" header and "Invoice Total" section

For each line item, extract:
- description: The main text/description of the item
- area: If there's an "Area:" line immediately following (like "Area: MBR CLOSET"), capture it. Otherwise leave blank.

Preserve the exact text as it appears. Include warranties, discounts, products, services, etc. Return all items in order.`,
        add_context_from_internet: false,
        file_urls: [p.contractUrl],
        response_json_schema: {
          type: 'object',
          properties: {
            invoice_number: { type: 'string' },
            line_items: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, area: { type: 'string' } }, required: ['description'] } },
          },
        },
      });
      if (result?.stub) return { stub: true, success: false };
      if (p.saleId) {
        await s.from('sale').update({ invoice_number: result.invoice_number || '', invoice_line_items: result.line_items || [], contract_extraction_status: 'completed' }).eq('id', p.saleId);
      }
      return { success: true, invoice_number: result.invoice_number || '', line_items: result.line_items || [] };
    }

    // analyzeNotSoldReason: categorize a lost appointment's last note into one loss reason.
    case 'analyze_not_sold': {
      const appointmentId = p.appointmentId || p.event?.entity_id;
      if (!appointmentId) return { error: 'appointmentId is required' };
      const appt = await one(s, 'appointment', appointmentId);
      if (!appt) return { error: 'Appointment not found' };
      const lostStatuses = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline'];
      if (!lostStatuses.includes(appt.status)) return { message: 'Appointment status is not a lost status, skipping analysis', status: appt.status };
      if (appt.analyzed_not_sold_reason) return { message: 'Already analyzed', analyzed_reason: appt.analyzed_not_sold_reason };
      const notes = Array.isArray(appt.notes) ? appt.notes : [];
      const lastNote = notes.length ? notes[notes.length - 1] : null;
      if (!lastNote?.content) return { error: 'No note content to analyze', analyzed_reason: 'No Note Available' };
      const response = await llmInvoke(s, {
        prompt: `You are analyzing why a flooring sales appointment did not result in a sale.

The last note from the appointment is:
"${lastNote.content}"

Based on this note, categorize the primary reason the sale was lost into ONE of these categories:
${LOSS_REASONS.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Respond with ONLY the category name from the list above, nothing else.`,
      });
      if (response?.stub) return { stub: true, success: false };
      let analyzedReason = String(response).trim();
      if (!LOSS_REASONS.includes(analyzedReason)) {
        const match = LOSS_REASONS.find((r) => r.toLowerCase() === analyzedReason.toLowerCase());
        analyzedReason = match || 'Other';
      }
      await s.from('appointment').update({ analyzed_not_sold_reason: analyzedReason }).eq('id', appointmentId);
      return { success: true, analyzed_reason: analyzedReason, original_note: lastNote.content };
    }

    default:
      return { error: `Unknown task ${task}` };
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
    // Task mode -> {success,...}; raw mode -> the LLM result directly (string | object | {stub}).
    const result = p?.task ? await handleTask(svc(), p.task, p) : await llmInvoke(svc(), p);
    const status = result && typeof result === 'object' && (result as any).error && (result as any).success === undefined ? 400 : 200;
    return Response.json(result, { status, headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
