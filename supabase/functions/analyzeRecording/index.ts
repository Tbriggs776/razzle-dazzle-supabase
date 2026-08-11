// AssemblyAI submit path (ports base44 analyzeRecording). Given an appointmentId, submits
// the appointment's public recording_url to AssemblyAI for async transcription + analysis,
// stamps recording_status='analyzing' + recording_transcript_id, and returns immediately
// (<1s — no upload, no poll). Delivery is handled by assemblyAIWebhook (fast path) and the
// reconcile_stuck_recordings cron (safety net). Also the target of the triggerAnalysis and
// retryStuckRecording shim aliases (a fresh submit re-writes the transcript id).
//
// Graceful degrade: { stub: true } when the assemblyai integration is disabled / no key.
// Auth: internal secret (server/job) OR an authenticated user (browser invoke).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AAI_BASE, AAI_ANALYSIS_FLAGS } from '../_shared/recordingAnalysis.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

async function currentUser(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data } = await asUser.auth.getUser();
  return data?.user ?? null;
}

async function one(s: any, table: string, id: string | null | undefined) {
  if (!id) return null;
  const { data } = await s.from(table).select('*').eq('id', id).maybeSingle();
  return data;
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
    const { appointmentId } = await req.json();
    if (!appointmentId) return Response.json({ error: 'appointmentId is required', success: false }, { status: 400, headers: cors });

    const s = svc();
    const appt = await one(s, 'appointment', appointmentId);
    if (!appt) return Response.json({ error: 'Appointment not found', success: false }, { status: 404, headers: cors });
    if (!appt.recording_url) return Response.json({ error: 'No recording to analyze', success: false }, { status: 400, headers: cors });

    const { data: integ } = await s.from('integration').select('is_enabled').eq('key', 'assemblyai').maybeSingle();
    const apiKey = await getSecret('ASSEMBLYAI_API_KEY');
    if (!integ?.is_enabled || !apiKey) return Response.json({ stub: true, success: false }, { headers: cors });
    const webhookSecret = await getSecret('ASSEMBLYAI_WEBHOOK_SECRET');

    const lead = await one(s, 'lead', appt.customer);
    const dc = await one(s, 'team_member', appt.assigned_dc);
    const knownNames = [lead?.first_name, dc?.first_name].filter(Boolean);

    // The 'uploads' bucket is private (ST1) — AssemblyAI is an EXTERNAL fetcher and can't read a
    // private path, so mint a short-lived SIGNED URL for it (it downloads the audio at submit
    // time). Tolerates a stored path OR a legacy public/sign uploads URL.
    const PUB = '/object/public/uploads/';
    const SIG = '/object/sign/uploads/';
    let recPath = appt.recording_url as string;
    if (/^https?:\/\//i.test(recPath)) {
      const p = recPath.indexOf(PUB);
      const g = recPath.indexOf(SIG);
      if (p !== -1) recPath = decodeURIComponent(recPath.slice(p + PUB.length).split('?')[0]);
      else if (g !== -1) recPath = decodeURIComponent(recPath.slice(g + SIG.length).split('?')[0]);
    } else {
      recPath = recPath.replace(/^\/+/, '');
    }
    const { data: signedRec } = await s.storage.from('uploads').createSignedUrl(recPath, 60 * 60 * 6);
    if (!signedRec?.signedUrl) return Response.json({ error: 'Could not sign the recording for analysis', success: false }, { status: 500, headers: cors });

    const submitBody: any = {
      audio_url: signedRec.signedUrl,
      ...AAI_ANALYSIS_FLAGS,
    };
    // Register the completion webhook only when a secret is configured; otherwise the
    // reconcile cron is the sole (still reliable) delivery path.
    if (webhookSecret) {
      submitBody.webhook_url = `${SUPABASE_URL}/functions/v1/assemblyAIWebhook`;
      submitBody.webhook_auth_header_name = 'X-Webhook-Secret';
      submitBody.webhook_auth_header_value = webhookSecret;
    }
    if (knownNames.length > 0) {
      submitBody.speech_understanding = { request: { speaker_identification: { speaker_type: 'name', known_values: knownNames } } };
    }

    const r = await fetch(`${AAI_BASE}/transcript`, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(submitBody),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `AssemblyAI submit HTTP ${r.status}`);

    await s.from('appointment').update({ recording_status: 'analyzing', recording_transcript_id: data.id }).eq('id', appointmentId);
    return Response.json({ success: true, transcriptId: data.id, status: 'analyzing' }, { headers: cors });
  } catch (e) {
    return Response.json({ error: (e as Error).message, success: false }, { status: 500, headers: cors });
  }
});
