// Installer onboarding, Phase 1 ingest. Fetches the official AZ ROC "posting list" CSV (all
// current active Arizona contractor licenses, ~58k rows) and atomically loads it into
// public.roc_licensee via a staging table, so roc_lookup() can validate a subcontractor's
// license instantly with no live scraping.
//
// The ROC site sits behind Cloudflare; a plain server fetch is challenged (403), but sending a
// browser User-Agent returns the static CSV. We first read the posting-list page to discover the
// current date-stamped file URL, then download and parse it.
//
// Auth: internal only — x-internal-secret must equal the Vault CRON_SECRET (the weekly pg_cron
// job calls this via post_internal_fn). Public, verify_jwt off at the gateway.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Tolerant RFC4180-ish CSV parser. The official AZ ROC posting list has real-world dirt (stray
// unescaped quotes, the occasional short row), which strict parsers reject wholesale. This one
// quotes a field only when it BEGINS with a quote (so 6" reads literally), tolerates junk after a
// closing quote, keeps embedded newlines inside quoted fields, and never enforces a column count.
function parseCsv(text: string): string[][] {
  const recs: string[][] = [];
  let i = 0; const n = text.length; let rec: string[] = [];
  while (i < n) {
    let field = '';
    if (text[i] === '"') {
      i++;
      while (i < n) {
        const c = text[i];
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } i++; break; }
        field += c; i++;
      }
      while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') { field += text[i]; i++; }
    } else {
      while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') { field += text[i]; i++; }
    }
    rec.push(field);
    if (i < n && text[i] === ',') { i++; continue; }
    if (i < n && text[i] === '\r') i++;
    if (i < n && text[i] === '\n') i++;
    recs.push(rec); rec = [];
  }
  if (rec.length) recs.push(rec);
  return recs;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const POSTING_LIST_PAGE = 'https://roc.az.gov/posting-list';
const CSV_URL_RE = /https:\/\/roc\.az\.gov\/sites\/default\/files\/ROC_Posting-List_[0-9-]+\.csv/;
const BATCH = 1000;

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

const nn = (v: unknown) => { const s = (v == null ? '' : String(v)).trim(); return s === '' ? null : s; };
// Only accept a real YYYY-MM-DD date (else null) so a shifted/garbage cell can't break the insert.
const dt = (v: unknown) => { const s = nn(v); return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  const internal = await getSecret('CRON_SECRET');
  if (!internal || req.headers.get('x-internal-secret') !== internal) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const s = svc();

    // Acquire the CSV text. Preferred: a file already uploaded to the private 'roc-imports' bucket
    // (a browser clears Cloudflare; a datacenter edge IP does not). Fallback: best-effort direct
    // fetch (works only if the ROC site ever drops its Cloudflare bot challenge for server IPs).
    let csvText: string;
    let source: string;
    const path = typeof body.path === 'string' ? body.path : null;
    if (path) {
      const { data, error } = await s.storage.from('roc-imports').download(path);
      if (error || !data) return Response.json({ error: `storage download failed: ${error?.message || 'not found'}`, path }, { status: 502 });
      csvText = await data.text();
      source = `storage:${path}`;
    } else {
      const pageRes = await fetch(POSTING_LIST_PAGE, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
      if (!pageRes.ok) return Response.json({ error: `posting-list page ${pageRes.status} (Cloudflare likely blocks datacenter IPs — upload the CSV to the roc-imports bucket and pass {path} instead)` }, { status: 502 });
      const pageHtml = await pageRes.text();
      const m = pageHtml.match(CSV_URL_RE);
      if (!m) return Response.json({ error: 'could not find current CSV link on posting-list page' }, { status: 502 });
      const csvUrl = m[0];
      const csvRes = await fetch(csvUrl, { headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*' } });
      if (!csvRes.ok) return Response.json({ error: `csv fetch ${csvRes.status}`, csvUrl }, { status: 502 });
      csvText = await csvRes.text();
      source = csvUrl;
    }

    // Slice off the title row so parsing starts at the real header ("#","License No",...).
    const headerIdx = csvText.indexOf('"License No"');
    if (headerIdx < 0) return Response.json({ error: 'header row not found in CSV', source }, { status: 502 });
    const headerStart = csvText.lastIndexOf('\n', headerIdx) + 1;
    // Real-world government CSV: lazyQuotes tolerates stray/unescaped quotes inside fields, and
    // fieldsPerRecord:-1 disables the per-row column-count check so one malformed row (e.g. a
    // dropped trailing field) doesn't abort the whole 58k-row load.
    const recs = parseCsv(csvText.slice(headerStart));
    const rows = recs.slice(1); // drop the header row (# , License No , Business Name , ...)
    if (rows.length < 1000) return Response.json({ error: `only ${rows.length} rows parsed; aborting`, source }, { status: 502 });

    // Fresh staging.
    { const { error } = await s.rpc('reset_roc_staging'); if (error) throw new Error(`reset_roc_staging: ${error.message}`); }

    // 5) Map + load in chunks (keeps peak memory down).
    let loaded = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      // Column order: 0=# 1=License No 2=Business Name 3=DBA 4=Class 5=Class Detail
      // 6=Class Type 7=Address 8=City 9=State 10=Zip 11=Qualifying Party 12=Issued Date
      // 13=Expiration Date 14=Status
      const chunk = rows.slice(i, i + BATCH).map((r) => ({
        license_no: nn(r[1]),
        business_name: nn(r[2]),
        dba: nn(r[3]),
        class: nn(r[4]),
        class_detail: nn(r[5]),
        class_type: nn(r[6]),
        address: nn(r[7]),
        city: nn(r[8]),
        state: nn(r[9]),
        zip: nn(r[10]),
        qualifying_party: nn(r[11]),
        issued_date: dt(r[12]),
        expiration_date: dt(r[13]),
        status: nn(r[14]),
      })).filter((x) => x.license_no);
      const { error } = await s.from('roc_licensee_staging').insert(chunk);
      if (error) throw new Error(`staging insert @${i}: ${error.message}`);
      loaded += chunk.length;
    }

    // 6) Atomic swap into the live table.
    const { data: swapped, error: swapErr } = await s.rpc('swap_roc_licensee');
    if (swapErr) throw new Error(`swap_roc_licensee: ${swapErr.message}`);

    return Response.json({ ok: true, source, parsed: rows.length, loaded, live_rows: swapped });
  } catch (error) {
    console.error('ingestRocPostingList error:', (error as Error).message);
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
