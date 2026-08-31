// opsFlowAdvise — the flow bot. Proposals only, never publishes, never applies.
//
// Deliberately NOT invokeLLM (razzle-ops-flow-spec.md): this function has its
// own gate — org admin, full stop — and assembles its own input from the
// database rather than accepting a free-form prompt as the only source. The
// model's output is forced through a JSON schema, then SANITIZED: only the
// structured proposal kinds survive, anything that smells like a predicate or
// classifier change is downgraded to kind='other' ("needs engineering"), and
// at most 8 rows are inserted. Everything lands as an OPEN ops_change_proposal
// for a human to accept or reject — the same inbox the checker writes to.
//
// The bot cannot: publish a flow version, edit predicates, touch flow.js or
// migrations, call money RPCs, enable comms rules, email customers, or run
// more than once per hour (mash-proof: the limit is checked against the last
// bot proposal's timestamp BEFORE any model call).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireOrgAdmin } from '../_shared/authz.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_MODEL = 'claude-sonnet-5';
// Kinds the bot may file. Anything else the model invents is coerced to 'other'.
const BOT_KINDS = new Set([
  'sla_mismatch', 'missing_edge', 'add_stage', 'clone_role',
  'new_task_rule', 'disable_rule', 'other',
]);
const SEVERITIES = new Set(['info', 'warn', 'crit']);

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Org admin only. No internal-secret path, no cron writer — a human presses
  // Suggest. (A future weekday job would go through this same gate with a real
  // admin session, or not at all.)
  const denied = await requireOrgAdmin(req, cors);
  if (denied) return denied;

  const s = svc();
  try {
    // ── Rate limit FIRST: once per hour, however hard Suggest is mashed. ────
    const { data: lastBot } = await s
      .from('ops_change_proposal').select('created_date')
      .eq('source', 'bot').order('created_date', { ascending: false })
      .limit(1).maybeSingle();
    if (lastBot?.created_date) {
      const ageMs = Date.now() - new Date(lastBot.created_date).getTime();
      if (ageMs < 60 * 60 * 1000) {
        const mins = Math.ceil((60 * 60 * 1000 - ageMs) / 60000);
        return Response.json(
          { error: `The advisor ran recently — try again in ~${mins} min`, rate_limited: true },
          { status: 429, headers: cors },
        );
      }
    }

    // ── Availability (same integration + key invokeLLM uses). ───────────────
    const { data: integ } = await s.from('integration').select('is_enabled, config').eq('key', 'anthropic').maybeSingle();
    const key = integ?.is_enabled ? await getSecret('ANTHROPIC_API_KEY') : null;
    if (!key) return Response.json({ stub: true, inserted: 0, message: 'Anthropic is not configured' }, { headers: cors });

    // ── Assemble the input from the database, not from the request. ─────────
    const { data: flow } = await s.from('ops_flow').select('*').limit(1).maybeSingle();
    if (!flow) return Response.json({ error: 'No published flow' }, { status: 400, headers: cors });
    const { data: versions } = await s
      .from('ops_flow_version').select('version, graph, note, published_at')
      .eq('flow_id', flow.id).order('version', { ascending: false }).limit(2);
    const current = versions?.[0];
    const previous = versions?.[1] ?? null;

    const { data: openProposals } = await s
      .from('ops_change_proposal').select('source, kind, severity, title, status')
      .eq('status', 'open').order('created_date', { ascending: false }).limit(50);

    const { data: rules } = await s
      .from('task_rule').select('rule_key, label, stage, dept, assigned_role, due_in_hours, escalate_after_hours, is_active');

    // Live aggregates from THE classifier — counts, holds, over-SLA per stage.
    const { data: jobRows } = await s
      .from('job_stage').select('stage, stage_since, on_hold, sla_hours, is_terminal');
    const agg: Record<string, { count: number; on_hold: number; over_sla: number }> = {};
    const now = Date.now();
    for (const r of jobRows ?? []) {
      const a = (agg[r.stage] ??= { count: 0, on_hold: 0, over_sla: 0 });
      a.count += 1;
      if (r.on_hold) a.on_hold += 1;
      if (r.sla_hours != null && r.stage_since
          && now - new Date(r.stage_since).getTime() > r.sla_hours * 3600_000) a.over_sla += 1;
    }

    // ── One schema-forced model call. ───────────────────────────────────────
    const body = {
      model: (integ?.config as Record<string, unknown>)?.model || DEFAULT_MODEL,
      max_tokens: 4096,
      system:
        'You advise on a flooring company’s operational stage graph. You may ONLY file structured ' +
        'change proposals for a human to review. You can NEVER publish, NEVER change classifier ' +
        'predicates (those are SQL, owned by engineering), and NEVER touch money, customer messaging, ' +
        'or code. Allowed kinds and payloads:\n' +
        '- sla_mismatch / new_task_rule / disable_rule: payload {"task_rule":{"rule_key":string,"due_in_hours":number}} ' +
        'or {"disable_rule":{"rule_key":string}}\n' +
        '- add_stage: payload {"add_stage":{"key":snake_case,"label":string,"blurb":string,"owner_dept":string,"sla_hours":number|null}} ' +
        '— planning-only sketches; never claim a classifier_key\n' +
        '- missing_edge: payload {"edge":{"from":string,"to":string}}\n' +
        '- clone_role: payload {"clone_role":{"from_key":string,"new_key":string}} (applied out of band)\n' +
        '- other: anything that needs engineering (e.g. a new predicate) — describe it, no payload\n' +
        'File 1–8 proposals, each with a one-line title and a short body_md that cites the numbers ' +
        'you saw. Do not repeat an already-open proposal.',
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: JSON.stringify({
            published_graph: current?.graph ?? null,
            current_version: current?.version ?? null,
            previous_version_graph: previous?.graph ?? null,
            open_proposals: openProposals ?? [],
            task_rules: rules ?? [],
            live_job_aggregates_by_stage: agg,
          }),
        }],
      }],
      tools: [{
        name: 'proposals',
        description: 'File the change proposals.',
        input_schema: {
          type: 'object',
          properties: {
            proposals: {
              type: 'array', minItems: 1, maxItems: 8,
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  severity: { type: 'string', enum: ['info', 'warn', 'crit'] },
                  title: { type: 'string' },
                  body_md: { type: 'string' },
                  payload: { type: 'object' },
                },
                required: ['kind', 'title'],
              },
            },
          },
          required: ['proposals'],
        },
      }],
      tool_choice: { type: 'tool', name: 'proposals' },
    };

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || `Anthropic HTTP ${r.status}`);
    const tu = (d.content || []).find((b: { type: string }) => b.type === 'tool_use');
    const raw: Array<Record<string, unknown>> = Array.isArray(tu?.input?.proposals) ? tu.input.proposals : [];

    // ── Sanitize: structured kinds only; predicates never sneak through. ────
    const rows = raw.slice(0, 8).map((p) => {
      let kind = String(p.kind || 'other');
      let payload = (p.payload && typeof p.payload === 'object') ? p.payload as Record<string, unknown> : null;
      let body_md = typeof p.body_md === 'string' ? p.body_md : null;
      if (!BOT_KINDS.has(kind)) { kind = 'other'; }
      // A payload that tries to name a classifier/predicate is an engineering
      // request, not an applicable patch.
      const pj = payload ? JSON.stringify(payload) : '';
      if (/classifier_key|predicate|job_stage|case\s+when/i.test(pj)) {
        kind = 'other';
        body_md = `${body_md ? body_md + '\n\n' : ''}_Filed as needs-engineering: the advisor proposed a classifier/predicate change, which only engineering can make._`;
        payload = null;
      }
      if (kind === 'add_stage' && payload && typeof payload.add_stage === 'object' && payload.add_stage) {
        // Belt and braces with resolve_ops_proposal: sketches only.
        delete (payload.add_stage as Record<string, unknown>).classifier_key;
        delete (payload.add_stage as Record<string, unknown>).is_terminal;
      }
      return {
        org_id: flow.org_id,
        source: 'bot',
        kind,
        severity: SEVERITIES.has(String(p.severity)) ? String(p.severity) : 'info',
        title: String(p.title || 'Untitled proposal').slice(0, 300),
        body_md,
        payload,
        flow_version_from: current?.version ?? null,
      };
    });

    if (rows.length === 0) return Response.json({ inserted: 0 }, { headers: cors });

    const { error: insErr } = await s.from('ops_change_proposal').insert(rows);
    if (insErr) throw new Error(insErr.message);

    await s.from('ops_flow_audit').insert({
      org_id: flow.org_id, action: 'bot_advise',
      detail: { inserted: rows.length, kinds: rows.map((x) => x.kind) },
    });

    return Response.json({ inserted: rows.length }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
