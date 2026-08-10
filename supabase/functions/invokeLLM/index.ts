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

    // extractInvoiceTotal: pull the final grand total (a number) from a contract/invoice PDF,
    // used to auto-fill the sale/quote amount after a contract upload.
    case 'extract_invoice_total': {
      const url = p.pdfUrl || p.contractUrl || p.url;
      if (!url) return { error: 'pdfUrl is required', success: false };
      const result = await llmInvoke(s, {
        prompt: `This is a flooring contract/invoice PDF. Find the FINAL grand total the customer owes — the bottom-line amount, usually labeled "Invoice Total", "Total", "Grand Total", "Balance Due", or "Amount Due", after any discounts. Return it as a plain number with no currency symbol or commas. If several totals appear, choose the final bottom-line total. If none can be found, return 0.`,
        file_urls: [url],
        response_json_schema: {
          type: 'object',
          properties: { total: { type: 'number', description: 'The final grand total as a number, e.g. 8450.00' } },
          required: ['total'],
        },
      });
      if (result?.stub) return { stub: true, success: false };
      const total = Number(result?.total);
      if (!Number.isFinite(total) || total <= 0) return { success: false, error: 'Could not extract a total' };
      return { success: true, total };
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

    // analyzeValueAdds: check a call transcript for which sales "value adds" the DC offered.
    // Reads appointment.recording_analysis.utterances (from the AssemblyAI pipeline), runs one
    // batched LLM compliance pass, and merges the result into recording_analysis.value_adds.
    case 'analyze_value_adds': {
      const appointmentId = p.appointmentId || p.event?.entity_id;
      if (!appointmentId) return { error: 'appointmentId is required' };
      const appt = await one(s, 'appointment', appointmentId);
      if (!appt?.recording_analysis?.utterances) return { error: 'No transcript utterances to analyze' };

      const valueAdds = [
        { id: 'basic_floor_prep_included', canonical_title: 'Includes Basic Floor Prep', definition: 'The quoted installation includes basic floor preparation as part of the job, at no added charge (e.g., minor leveling, patching, scraping as defined by your policy).', must_have_any: ['prep', 'preparation', 'floor prep', 'prep work'], should_have_any: ['included', 'part of', 'we handle', 'no extra', 'standard', 'in the price', 'we take care of'], disallowed_any: ['subfloor replacement', 'major repair', 'extra charge', 'additional cost', 'change order', 'not included'] },
        { id: 'dustless_tile_demo', canonical_title: 'Dustless Tile Demo', definition: 'We remove/demo tile using dust-control methods (e.g., HEPA containment/vac systems) to minimize dust during demolition.', must_have_any: ['dustless', 'no dust', 'minimal dust', 'hepa', 'containment'], should_have_any: ['tile demo', 'tile removal', 'demolition', 'vacuum', 'negative air', 'dust control', 'cleaner process'], disallowed_any: ["it'll be dusty", 'lots of dust', 'no containment', 'standard demo'] },
        { id: 'financing_up_to_60_months_0_interest', canonical_title: 'Up to 60 Months 0% Interest', definition: 'We offer promotional financing with 0% interest for up to 60 months (subject to approval/terms).', must_have_any: ['0%', 'zero percent', 'no interest'], should_have_any: ['60 months', 'five years', 'financing', 'payment plan', 'monthly payments', 'on approved credit', 'promotional'], disallowed_any: ['high interest', 'apr', 'variable rate', 'deferred interest'] },
        { id: 'painted_base_provided', canonical_title: 'We can provide painted base', definition: 'We can supply and/or install baseboards that are already painted (or we handle painting the base), reducing extra steps for the homeowner.', must_have_any: ['base', 'baseboard'], should_have_any: ['painted', 'pre-painted', 'we paint', 'finish', 'white base', 'included', 'we can provide', 'we can handle'], disallowed_any: ['unpainted only', 'you paint', 'painter required', 'not included'] },
        { id: 'include_half_inch_carpet_pad_all_jobs', canonical_title: 'Include 1/2" carpet pad on all carpet jobs', definition: 'Every carpet installation includes 1/2-inch carpet pad as standard, with no add-on charge.', must_have_any: ['pad', 'padding'], should_have_any: ['half inch', '1/2', 'included', 'standard', 'comes with', 'all carpet jobs', 'every carpet install'], disallowed_any: ['upgrade', 'optional', 'extra cost', 'separate line item', 'choose your pad'] },
        { id: 'free_air_duct_cleaning_qualified_purchases', canonical_title: 'Clean Air Ducts For Free on Qualified Purchases', definition: 'For qualifying purchases/projects (as defined by your rules), air duct cleaning is included at no cost.', must_have_any: ['duct', 'ducts'], should_have_any: ['free', 'included', 'no charge', 'air duct cleaning', 'qualify', 'qualified purchase', 'threshold', 'minimum'], disallowed_any: ['add-on', 'optional', 'extra fee', 'additional charge', 'we can quote it'] },
        { id: 'field_manager_checkin_final_walkthrough', canonical_title: 'Field Manager Check in and Do Final Walkthrough', definition: 'A field manager will check in during the job and/or perform a final walkthrough/quality inspection with the homeowner at completion.', must_have_any: ['walkthrough', 'walk through', 'final inspection', 'quality check', 'field manager'], should_have_any: ['check in', 'site visit', 'project manager', 'ensure everything', 'punch list', 'before we leave', 'sign off'], disallowed_any: ['no walkthrough', 'you handle', 'installer only', 'no manager'] },
        { id: 'lifetime_labor_guarantee', canonical_title: 'Lifetime Labor Guarantee', definition: 'We provide lifetime coverage/guarantee on installation labor/workmanship (per your policy terms), not just materials.', must_have_any: ['lifetime', 'labor'], should_have_any: ['workmanship', 'installation', 'install', 'we stand behind', 'guarantee', 'covered', 'labor warranty'], disallowed_any: ['materials only', 'manufacturer only', 'one year labor', 'limited labor'] },
        { id: 'one_time_warranty_transfer_new_homeowner', canonical_title: 'One Time Transfer of Warranties To New Homeowner', definition: 'The warranty can be transferred one time to the next homeowner/new owner if the home is sold, so coverage continues for the new homeowner.', must_have_any: ['warranty', 'transfer'], should_have_any: ['one time', 'next owner', 'new homeowner', 'new owner', 'sell', 'selling', 'when you move', 'home sale'], disallowed_any: ['not transferable', 'non-transferable', 'only original owner', 'cannot transfer'] },
      ];

      // DC utterances only (speaker B or 1), with ids + second timestamps.
      const dcUtterances = (appt.recording_analysis.utterances as any[])
        .filter((u) => u.speaker === 'B' || u.speaker === '1')
        .map((u, idx) => ({ utterance_id: `u_${idx}`, timestamp: u.start / 1000, text: u.text }));
      const fullTranscript = dcUtterances.map((u) => `[${u.utterance_id}] ${u.text}`).join('\n');

      const batchPrompt = `You are a transcript compliance verifier for a flooring sales team.

Analyze the full Design Consultant transcript and identify which value adds were AFFIRMATIVELY OFFERED.

IMPORTANT PRINCIPLES
- Match the IDEA, not exact wording
- Value adds must be OFFERED as included, available, covered, or provided
- Do NOT mark matched=true if only mentioned hypothetically or as extra-cost add-on
- If explicitly negated (e.g., "not included"), matched MUST be false
- Evidence must be exact substrings from transcript

---

VALUE ADDS TO CHECK:
${valueAdds.map((va) => `
ID: ${va.id}
Title: ${va.canonical_title}
Definition: ${va.definition}
Must contain: ${va.must_have_any.join(', ')}
Should contain: ${va.should_have_any.join(', ')}
Disallowed: ${va.disallowed_any.join(', ')}
`).join('\n---\n')}

---

FULL TRANSCRIPT (Design Consultant):
${fullTranscript}

---

For each value add, determine:
1. matched: true only if clearly offered as included/free/standard
2. confidence: 0.0-1.0 (0.9+ = explicit, 0.7-0.89 = clear, 0.5-0.69 = ambiguous)
3. Find the best matching utterance(s) and extract exact phrases as evidence
4. If matched=false, leave highlights empty unless there's a negation

Return JSON array with results for ALL value adds.`;

      const analysis = await llmInvoke(s, {
        prompt: batchPrompt,
        response_json_schema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  value_add_id: { type: 'string' },
                  matched: { type: 'boolean' },
                  confidence: { type: 'number' },
                  utterance_ids: { type: 'array', items: { type: 'string' } },
                  highlights: { type: 'array', items: { type: 'object', properties: { utterance_id: { type: 'string' }, text: { type: 'string' } } } },
                  explanation: { type: 'string' },
                },
                required: ['value_add_id', 'matched'],
              },
            },
          },
        },
      });
      if (analysis?.stub) return { stub: true, success: false };

      const utteranceMap = new Map(dcUtterances.map((u) => [u.utterance_id, u]));
      const resultsWithTimestamps = ((analysis.results as any[]) || []).map((result) => {
        const va = valueAdds.find((v) => v.id === result.value_add_id);
        const mentions: any[] = [];
        if (result.matched && Array.isArray(result.highlights)) {
          for (const h of result.highlights) {
            const utt = utteranceMap.get(h.utterance_id);
            if (utt) mentions.push({ text: utt.text, timestamp: utt.timestamp, matchingWords: h.text, explanation: result.explanation });
          }
        }
        return { keyword: va?.canonical_title || result.value_add_id, mentioned: !!result.matched, confidence: Math.round((result.confidence || 0) * 100), mentions };
      });

      // Re-read + merge only value_adds so a concurrent webhook write isn't clobbered.
      const { data: fresh } = await s.from('appointment').select('recording_analysis').eq('id', appt.id).maybeSingle();
      await s.from('appointment').update({ recording_analysis: { ...(fresh?.recording_analysis || appt.recording_analysis), value_adds: resultsWithTimestamps } }).eq('id', appt.id);
      return { success: true, results: resultsWithTimestamps };
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
