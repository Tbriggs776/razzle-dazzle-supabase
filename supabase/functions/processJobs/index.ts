// Job runner. Invoked every minute by pg_cron (via tick_jobs -> pg_net) with the
// shared CRON_SECRET. Claims due jobs, dispatches by type, and marks each
// succeeded or failed-with-retry. Handlers for real work (sends, dispatchers)
// delegate to the unified sendMessage path via queued send_sms/send_email jobs.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchTranscript, shapeAnalysis } from '../_shared/recordingAnalysis.ts';

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

// Lead-messaging template vars for an appointment + its lead. Hydrates the real
// appointment/lead fields (base44 hardcoded most of these to the string 'N/A').
function leadVars(appt: any, lead: any): Record<string, unknown> {
  return {
    lead_first_name: lead.first_name, lead_last_name: lead.last_name,
    lead_name: `${lead.first_name} ${lead.last_name}`, lead_email: lead.email, lead_phone: lead.phone,
    appointment_date: fmtApptDate(appt.appointment_date), appointment_time: appt.appointment_block || 'TBD',
    appointment_block: appt.appointment_block, location_address: appt.location_address,
    lead_tracking_url: appt.lead_short_url || `${APP_URL}/LeadAppointmentView?id=${appt.id}`,
  };
}

// Day-N post-appointment follow-up (email + SMS). Selects appointments CREATED N
// Phoenix-days ago that are still Scheduled/Rescheduled and not yet day-N stamped,
// renders the lead templates, enqueues send jobs through the comms pipeline, and
// stamps. Filtering on dayN_followup_email_sent_at IS NULL (the stamp base44 wrote
// but never read) fixes base44's same-day double-send.
async function dispatchFollowup(s: any, cfg: any, dayN: number): Promise<Record<string, unknown>> {
  const emailOn = cfg[`send_lead_day${dayN}_followup_email`] !== false;
  const smsOn = cfg[`send_lead_day${dayN}_followup_sms`] !== false;
  if (!emailOn && !smsOn) return { skipped: `day${dayN} disabled` };
  const emailSubj = cfg[`lead_day${dayN}_followup_email_subject`];
  const emailBody = cfg[`lead_day${dayN}_followup_email_template`];
  const smsBody = cfg[`lead_day${dayN}_followup_sms_template`];
  const stampCol = `day${dayN}_followup_email_sent_at`;

  // Phoenix (UTC-7) calendar day N days before today, expressed as a UTC window.
  const nowP = new Date(Date.now() - 7 * 3600 * 1000);
  const target = new Date(nowP.getTime() - dayN * 24 * 3600 * 1000);
  const dayStr = target.toISOString().slice(0, 10);
  const winStart = `${dayStr}T07:00:00.000Z`;
  const winEnd = new Date(Date.parse(winStart) + 24 * 3600 * 1000).toISOString();

  const { data: appts } = await s.from('appointment').select('*')
    .in('status', ['Scheduled', 'Rescheduled'])
    .gte('appointment_created_date', winStart)
    .lt('appointment_created_date', winEnd)
    .is(stampCol, null);

  let enqueued = 0;
  for (const appt of appts || []) {
    const { data: lead } = await s.from('lead').select('*').eq('id', appt.customer).maybeSingle();
    if (!lead) continue;
    const vars = leadVars(appt, lead);
    let did = false;
    if (emailOn && emailBody && lead.email) {
      const to = (cfg[`divert_lead_day${dayN}_followup_email`] && cfg.divert_emails_to) ? cfg.divert_emails_to : lead.email;
      await s.rpc('enqueue_job', { p_type: 'send_email', p_payload: { to, subject: render(emailSubj, vars), body: render(emailBody, vars), lead_id: lead.id, appointment_id: appt.id, sent_by: 'System' } });
      enqueued++; did = true;
    }
    if (smsOn && smsBody && lead.phone) {
      await s.rpc('enqueue_job', { p_type: 'send_sms', p_payload: { to: lead.phone, body: render(smsBody, vars), lead_id: lead.id, appointment_id: appt.id, sent_by: 'System' } });
      enqueued++; did = true;
    }
    // Stamp only if we actually queued something, so a contactless lead can still
    // send if an email/phone is added later within the same day window.
    if (did) {
      await s.from('appointment').update({ [stampCol]: new Date().toISOString() }).eq('id', appt.id);
      await s.from('appointment_log').insert({ appointment: appt.id, action: `Day ${dayN} follow-up queued`, details: `Day ${dayN} follow-up queued for ${lead.first_name} ${lead.last_name}`, user_name: 'System' });
    }
  }
  return { day: dayN, appointments: (appts || []).length, jobs_enqueued: enqueued };
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
    case 'dispatch_day1_followups':
    case 'dispatch_day2_followups':
    case 'dispatch_day3_followups': {
      const dayN = job.type === 'dispatch_day1_followups' ? 1 : job.type === 'dispatch_day2_followups' ? 2 : 3;
      const { data: sset } = await s.from('sms_settings').select('*').limit(1);
      return await dispatchFollowup(s, sset?.[0] || {}, dayN);
    }
    case 'dispatch_dc_followup_reminders': {
      // Per-consultant aggregate SMS of their pending Follow-Up appointments.
      // The new dc_followup_reminded_at stamp (IS NULL filter + set) means a DC is
      // reminded once per set, not re-texted every run like base44.
      const { data: sset } = await s.from('sms_settings').select('*').limit(1);
      const cfg: any = sset?.[0] || {};
      if (cfg.send_dc_followup_reminder_sms === false) return { skipped: 'dc reminders disabled' };
      const { data: appts } = await s.from('appointment').select('*')
        .eq('status', 'Follow-Up').not('assigned_dc', 'is', null).is('dc_followup_reminded_at', null);
      if (!appts || appts.length === 0) return { dc_count: 0, jobs_enqueued: 0 };
      const dcIds = [...new Set(appts.map((a: any) => a.assigned_dc).filter(Boolean))];
      const custIds = [...new Set(appts.map((a: any) => a.customer).filter(Boolean))];
      const { data: dcs } = await s.from('team_member').select('id,first_name,phone').in('id', dcIds);
      const { data: leads } = await s.from('lead').select('id,last_name').in('id', custIds);
      const dcMap: any = Object.fromEntries((dcs || []).map((d: any) => [d.id, d]));
      const leadMap: any = Object.fromEntries((leads || []).map((l: any) => [l.id, l]));
      const byDc: any = {};
      for (const a of appts) (byDc[a.assigned_dc] ||= []).push(a);
      const tpl = cfg.dc_followup_reminder_template || 'Hi {dc_first_name}! You have {count} follow-up appointment(s) pending: {customer_last_names}. View your tasks: {tasks_url}';
      let enqueued = 0;
      for (const dcId of Object.keys(byDc)) {
        const list = byDc[dcId];
        const dc = dcMap[dcId];
        if (!dc || !dc.phone) continue;
        const names = list.map((a: any) => leadMap[a.customer]?.last_name).filter(Boolean).join(', ');
        const vars = { dc_first_name: dc.first_name, count: list.length, customer_last_names: names || 'N/A', tasks_url: `${APP_URL}/MyTasks` };
        await s.rpc('enqueue_job', { p_type: 'send_sms', p_payload: { to: dc.phone, body: render(tpl, vars), sent_by: 'System' } });
        enqueued++;
        const ids = list.map((a: any) => a.id);
        await s.from('appointment').update({ dc_followup_reminded_at: new Date().toISOString() }).in('id', ids);
        for (const a of list) {
          await s.from('appointment_log').insert({ appointment: a.id, action: 'DC follow-up reminder queued', details: `Reminder to ${dc.first_name} for pending follow-up`, user_name: 'System' });
        }
      }
      return { dc_count: Object.keys(byDc).length, jobs_enqueued: enqueued };
    }
    case 'create_followup_tasks': {
      // Idempotent set-based backfill (partial unique index + ON CONFLICT DO
      // NOTHING) — one open follow_up task per Follow-Up appointment, no re-spawn.
      const { data, error } = await s.rpc('backfill_followup_tasks');
      if (error) throw new Error(error.message);
      return { created: data ?? 0 };
    }
    case 'reconcile_stuck_recordings': {
      // Safety net for the AssemblyAI pipeline (replaces retryStuckRecording's 10-min
      // in-request loop). Polls AssemblyAI once per stuck appointment per tick; writes the
      // analysis via the SAME shared builder the webhook uses. Bounded (limit 25) + age-gated
      // so a just-submitted row isn't polled and the tick stays under the edge wall clock.
      const { data: integ } = await s.from('integration').select('is_enabled').eq('key', 'assemblyai').maybeSingle();
      if (!integ?.is_enabled) return { skipped: 'assemblyai disabled' };
      const apiKey = await getSecret('ASSEMBLYAI_API_KEY');
      if (!apiKey) return { skipped: 'no assemblyai key' };
      const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: stuck } = await s.from('appointment').select('id,recording_transcript_id,updated_date')
        .eq('recording_status', 'analyzing').not('recording_transcript_id', 'is', null).lt('updated_date', cutoff).limit(25);
      let done = 0, errored = 0, still = 0;
      for (const appt of stuck || []) {
        try {
          const t = await fetchTranscript(appt.recording_transcript_id, apiKey);
          if (t.status === 'completed') {
            await s.from('appointment').update({ recording_analysis: shapeAnalysis(t), recording_status: 'completed', recording_duration: t.audio_duration }).eq('id', appt.id);
            if (t.text) await s.rpc('enqueue_job', { p_type: 'analyze_value_adds', p_payload: { appointmentId: appt.id } });
            done++;
          } else if (t.status === 'error') {
            await s.from('appointment').update({ recording_analysis: { error: 'Transcription failed', details: t.error || 'Unknown error' }, recording_status: 'completed' }).eq('id', appt.id);
            errored++;
          } else {
            // Still queued/processing. Time out after ~30 min so nothing is stuck forever.
            if (Date.now() - new Date(appt.updated_date).getTime() > 30 * 60 * 1000) {
              await s.from('appointment').update({ recording_analysis: { error: 'Transcription timed out' }, recording_status: 'completed' }).eq('id', appt.id);
              errored++;
            } else still++;
          }
        } catch (_) { still++; }
      }
      return { reconciled: (stuck || []).length, done, errored, still };
    }
    case 'analyze_value_adds': {
      // Delegate to the LLM bridge (task 'analyze_value_adds'), which reads the transcript
      // utterances + runs the value-add compliance check. Enqueued after transcription lands.
      const internal = await getSecret('CRON_SECRET');
      const r = await fetch(`${FUNCTIONS_BASE}/invokeLLM`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': internal || '' },
        body: JSON.stringify({ task: 'analyze_value_adds', appointmentId: job.payload?.appointmentId }),
      });
      if (r.status >= 500) throw new Error(`invokeLLM HTTP ${r.status}`);
      return await r.json();
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
