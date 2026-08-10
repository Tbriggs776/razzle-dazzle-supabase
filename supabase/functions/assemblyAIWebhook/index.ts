// AssemblyAI completion webhook (public, verify_jwt off). AssemblyAI POSTs { transcript_id,
// status } when a transcript finishes; we find the appointment by recording_transcript_id,
// fetch the transcript, shape it (shared builder), and stamp recording_analysis +
// recording_status='completed' + recording_duration, then enqueue the value-adds analysis.
// A missed webhook is caught by the reconcile_stuck_recordings cron (same shared builder).
//
// Auth: the X-Webhook-Secret header we registered at submit time (== ASSEMBLYAI_WEBHOOK_SECRET),
// or the x-internal-secret header (== CRON_SECRET) for manual replay/testing. No secret is
// accepted in the URL query string.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchTranscript, shapeAnalysis } from '../_shared/recordingAnalysis.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function getSecret(name: string): Promise<string | null> {
  const { data, error } = await svc().rpc('get_secret', { p_name: name });
  if (!error && data) return data as string;
  return Deno.env.get(name) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  const webhookSecret = await getSecret('ASSEMBLYAI_WEBHOOK_SECRET');
  const cronSecret = await getSecret('CRON_SECRET');
  const headerSecret = req.headers.get('X-Webhook-Secret');
  const internalHdr = req.headers.get('x-internal-secret');
  const ok = (webhookSecret && headerSecret === webhookSecret) || (cronSecret && internalHdr === cronSecret);
  if (!ok) return new Response('forbidden', { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const transcriptId = body.transcript_id;
  const status = body.status;
  if (!transcriptId) return Response.json({ error: 'transcript_id required' }, { status: 400 });

  const s = svc();
  const { data: appt } = await s.from('appointment').select('*').eq('recording_transcript_id', transcriptId).maybeSingle();
  if (!appt) return Response.json({ skipped: 'no matching appointment' });

  // Idempotency: a re-delivered webhook must not clobber a value_adds merge already applied.
  if (appt.recording_status === 'completed' && appt.recording_analysis?.transcript) {
    return Response.json({ skipped: 'already completed' });
  }

  try {
    if (status === 'error') {
      await s.from('appointment').update({ recording_analysis: { error: 'Transcription failed', details: body.error || 'Unknown error' }, recording_status: 'completed' }).eq('id', appt.id);
      return Response.json({ ok: true, status: 'error', appointmentId: appt.id });
    }

    const apiKey = await getSecret('ASSEMBLYAI_API_KEY');
    if (!apiKey) return Response.json({ error: 'ASSEMBLYAI_API_KEY not set' }, { status: 500 });
    const t = await fetchTranscript(transcriptId, apiKey);
    const analysis = shapeAnalysis(t);
    await s.from('appointment').update({ recording_analysis: analysis, recording_status: 'completed', recording_duration: t.audio_duration }).eq('id', appt.id);

    if (analysis.transcript) {
      await s.rpc('enqueue_job', { p_type: 'analyze_value_adds', p_payload: { appointmentId: appt.id } });
    }
    return Response.json({ ok: true, appointmentId: appt.id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
