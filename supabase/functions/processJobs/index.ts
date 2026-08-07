// Job runner. Invoked every minute by pg_cron (via tick_jobs -> pg_net) with the
// shared CRON_SECRET. Claims due jobs, dispatches by type, and marks each
// succeeded or failed-with-retry. Handlers for real work (send_sms, send_email,
// syncs, recording processing) are added as the provider modules land.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

// Dispatch table. Each handler returns a result object or throws (-> retry).
async function handle(job: any): Promise<Record<string, unknown>> {
  const s = svc();
  switch (job.type) {
    case 'noop':
      return { ok: true };
    case 'log':
      await s.from('log').insert({
        type: 'job', level: 'info', function_name: 'processJobs',
        message: job.payload?.message || 'job log',
        details: { job_id: job.id, ...job.payload },
      });
      return { logged: true };
    case 'send_sms':
    case 'send_email': {
      // Delegate to the unified send path. A skip/suppress/failed delivery is a
      // valid terminal outcome (recorded in communication); only a transport
      // error retries — so we never re-send on a provider rejection.
      const channel = job.type === 'send_sms' ? 'sms' : 'email';
      const internal = await getSecret('CRON_SECRET');
      const r = await fetch(`${FUNCTIONS_BASE}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': internal || '' },
        body: JSON.stringify({ channel, ...(job.payload || {}) }),
      });
      if (r.status >= 500) throw new Error(`sendMessage HTTP ${r.status}`);
      return await r.json();
    }
    default:
      throw new Error(`No handler for job type "${job.type}"`);
  }
}

Deno.serve(async (req) => {
  const cronSecret = await getSecret('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('forbidden', { status: 401 });
  }

  const s = svc();
  const { data: jobs, error } = await s.rpc('claim_jobs', { p_limit: 10 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results: any[] = [];
  for (const job of jobs || []) {
    try {
      const r = await handle(job);
      await s.rpc('complete_job', { p_id: job.id, p_result: r ?? {} });
      results.push({ id: job.id, type: job.type, ok: true });
    } catch (e) {
      await s.rpc('fail_job', { p_id: job.id, p_error: (e as Error).message });
      results.push({ id: job.id, type: job.type, ok: false, error: (e as Error).message });
    }
  }
  return Response.json({ processed: results.length, results });
});
