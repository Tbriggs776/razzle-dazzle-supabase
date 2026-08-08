// Google Sheets reader (marketing dashboards: getAdSpend + getMarketingBudget). Ported off
// base44's managed OAuth connector to the service account (share the sheet with the SA email).
// Read-only. type = ad_spend (parse daily spend by platform) | marketing_budget (raw values).
//
// Graceful degrade: { stub: true } when google is disabled / no service-account JSON.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { googleContext, googleToken, svcClient, getSecret, SHEETS_SCOPE } from '../_shared/google.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function currentUser(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data } = await u.auth.getUser();
  return data?.user ?? null;
}

async function readValues(token: string, spreadsheetId: string, range: string): Promise<any[][]> {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (!r.ok) throw new Error(`Google Sheets API ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
  return d.values || [];
}

const parseAmount = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, '').replace(/[()]/g, '-')); return isNaN(n) ? 0 : n; };
function parseDate(v: any): string | null {
  const s = String(v ?? '').trim(); if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const md = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/); if (md) { let [, m, d, y] = md; if (y.length === 2) y = '20' + y; return `${y.padStart(4, '2')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; }
  const num = Number(s); if (!isNaN(num) && num > 30000 && num < 80000) return new Date(Date.UTC(1899, 11, 30) + num * 86400000).toISOString().slice(0, 10);
  const p = new Date(s); return isNaN(p.getTime()) ? null : p.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const s = svcClient();
  const internal = await getSecret(s, 'CRON_SECRET');
  const isInternal = !!internal && req.headers.get('x-internal-secret') === internal;
  if (!isInternal) { const user = await currentUser(req); if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors }); }

  try {
    const p = await req.json().catch(() => ({}));
    if (!p.spreadsheet_id) return Response.json({ error: 'spreadsheet_id is required' }, { status: 400, headers: cors });
    const ctx = await googleContext(s);
    if (!ctx) return Response.json({ stub: true }, { headers: cors });
    const token = await googleToken(ctx.saJson, [SHEETS_SCOPE]);

    // Resolve a gid to its sheet name for the range prefix, if provided.
    let range = p.range || 'A1:Z5000';
    if (p.gid != null && !/!/.test(range)) {
      const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p.spreadsheet_id}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${token}` } })).json();
      const sheet = (meta.sheets || []).find((sh: any) => String(sh.properties.sheetId) === String(p.gid));
      if (sheet) range = `'${sheet.properties.title}'!${range}`;
    }

    const rows = await readValues(token, p.spreadsheet_id, range);
    if (!rows.length) return Response.json({ entries: [], headers: [], values: [] }, { headers: cors });

    if (p.type === 'marketing_budget') return Response.json({ values: rows, headers: rows[0] }, { headers: cors });

    // ad_spend: header row + a detected date column, sum non-date numeric columns per day.
    const headers = rows[0].map((h: any) => String(h ?? '').trim());
    const firstData = rows[1] || [];
    let dateColIdx = 0;
    for (let i = 0; i < firstData.length; i++) { const v = String(firstData[i] ?? '').trim(); if (v && (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(v) || /\d{4}-\d{2}-\d{2}/.test(v))) { dateColIdx = i; break; } }
    const entries: any[] = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; if (!row?.length) continue;
      const date = parseDate(row[dateColIdx]); if (!date) continue;
      const platforms: Record<string, number> = {}; let total = 0;
      for (let c = 0; c < headers.length; c++) { if (c === dateColIdx || !headers[c]) continue; const amt = parseAmount(row[c]); if (amt !== 0 || (row[c] !== undefined && row[c] !== '')) { platforms[headers[c]] = (platforms[headers[c]] || 0) + amt; if (amt > 0) total += amt; } }
      const totalKey = Object.keys(platforms).find((k) => ['total', 'total spend', 'total daily spend', 'daily total', 'grand total'].includes(k.toLowerCase().trim()));
      const platformEntries: Record<string, number> = {};
      for (const [k, v] of Object.entries(platforms)) if (k !== totalKey) platformEntries[k] = v;
      entries.push({ date, platforms: platformEntries, total: totalKey ? platforms[totalKey] : total });
    }
    return Response.json({ entries, headers: headers.filter(Boolean), row_count: entries.length }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: cors });
  }
});
