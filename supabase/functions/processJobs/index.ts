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

const APP_URL = 'https://razzle-dazzle-supabase.vercel.app';
function render(tpl: string, vars: Record<string, unknown>): string {
  let r = tpl || '';
  for (const [k, v] of Object.entries(vars)) r = r.replaceAll(`{${k}}`, (v as string) ?? 'N/A');
  return r;
}
function fmtApptDate(d: string): string {
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return d; }
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
    case 'dispatch_appointment_reminders': {
      // Tomorrow (Phoenix, UTC-7): remind Scheduled/Rescheduled appts not yet
      // reminded. Filtering on reminder_email_sent_at fixes base44's double-send.
      const nowP = new Date(Date.now() - 7 * 3600 * 1000);
      const tomorrow = new Date(nowP.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
      const { data: sset } = await s.from('sms_settings').select('*').limit(1);
      const cfg: any = sset?.[0] || {};
      if (cfg.send_reminders === false) return { skipped: 'reminders disabled' };
      const { data: appts } = await s.from('appointment').select('*')
        .in('status', ['Scheduled', 'Rescheduled']).eq('appointment_date', tomorrow).is('reminder_email_sent_at', null);
      let enqueued = 0;
      for (const appt of appts || []) {
        const { data: lead } = await s.from('lead').select('*').eq('id', appt.customer).maybeSingle();
        if (!lead) continue;
        const vars = {
          lead_first_name: lead.first_name, lead_name: `${lead.first_name} ${lead.last_name}`,
          appointment_date: fmtApptDate(appt.appointment_date), appointment_time: appt.appointment_block || 'TBD',
          lead_tracking_url: appt.lead_short_url || `${APP_URL}/LeadAppointmentView?id=${appt.id}`,
        };
        if (lead.phone) {
          await s.rpc('enqueue_job', { p_type: 'send_sms', p_payload: { to: lead.phone, body: render(cfg.lead_reminder_template, vars), lead_id: lead.id, appointment_id: appt.id } });
          enqueued++;
        }
        if (lead.email) {
          await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to: lead.email, subject: render(cfg.lead_reminder_email_subject, vars), body: render(cfg.lead_reminder_email_template, vars), lead_id: lead.id, appointment_id: appt.id } });
          enqueued++;
        }
        await s.from('appointment').update({ reminder_email_sent_at: new Date().toISOString() }).eq('id', appt.id);
        await s.from('appointment_log').insert({ appointment: appt.id, action: 'Reminder queued', details: `Reminder queued for ${lead.first_name} ${lead.last_name}`, user_name: 'System' });
      }
      return { appointments: (appts || []).length, jobs_enqueued: enqueued };
    }
    default:
      throw new Error(`No handler for job type ${job.type}`);
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
