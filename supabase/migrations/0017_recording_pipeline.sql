-- P7: AssemblyAI recording pipeline. Two small pieces of plumbing; the core recording
-- columns (recording_url/recording_status/recording_transcript_id/recording_analysis) already
-- exist on appointment. Audio reuses the existing public 'uploads' bucket under
-- appointment-recordings/{appointmentId}/, so no new bucket is needed.

-- BLOCKER fix: recording_duration (seconds) is written by the recorder + webhook + reconciler
-- and read by the UI, but was never captured in the generated schema (same class of gap as
-- P5's missing SMS columns). Without it every recording write 400s on an unknown column.
alter table public.appointment
  add column if not exists recording_duration integer;

-- Safety-net poll: every 5 min enqueue a reconcile job. The processJobs handler re-GETs
-- AssemblyAI status for appointments stuck in 'analyzing' (missed webhook / stranded rows)
-- and writes the analysis via the same shared builder the webhook uses. This is the durable
-- replacement for base44's retryStuckRecording 10-min in-request poll (edge fns cap ~150s).
select cron.schedule(
  'reconcile-stuck-recordings',
  '*/5 * * * *',
  $$ select public.enqueue_job('reconcile_stuck_recordings'); $$
);
