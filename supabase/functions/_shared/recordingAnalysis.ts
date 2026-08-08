// Shared AssemblyAI transcript helpers used by BOTH assemblyAIWebhook (fast path) and the
// processJobs reconcile_stuck_recordings handler (safety net) so both emit byte-identical
// recording_analysis. base44 kept two copies of this shaper in sync by hand — this is the fix.
export const AAI_BASE = 'https://api.assemblyai.com/v2';

// Analysis features requested with every transcript: speaker diarization, sentiment,
// auto-chapters (used as the summary), entity detection, and IAB topic categories.
export const AAI_ANALYSIS_FLAGS = {
  speaker_labels: true,
  sentiment_analysis: true,
  auto_chapters: true,
  entity_detection: true,
  iab_categories: true,
};

// Reshape a finished AssemblyAI transcript into the recording_analysis object the frontend
// (RecordingDetail tabs) already expects. NOTE: utterance/chapter start/end are MILLISECONDS
// (the UI divides by 1000); audio_duration is SECONDS; topics is an { label: score } map.
export function shapeAnalysis(t: any): Record<string, unknown> {
  return {
    transcript: t.text,
    utterances: (t.utterances || []).map((u: any) => ({ speaker: u.speaker, text: u.text, start: u.start, end: u.end, confidence: u.confidence })),
    sentiment: t.sentiment_analysis_results,
    summary: (t.chapters || []).map((c: any) => ({ gist: c.gist, headline: c.headline, summary: c.summary, start: c.start, end: c.end })),
    entities: t.entities,
    topics: t.iab_categories_result?.summary,
    duration: t.audio_duration,
    analyzedAt: new Date().toISOString(),
  };
}

export async function fetchTranscript(transcriptId: string, apiKey: string): Promise<any> {
  const r = await fetch(`${AAI_BASE}/transcript/${transcriptId}`, { headers: { authorization: apiKey } });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error || `AssemblyAI GET HTTP ${r.status}`);
  return d;
}
