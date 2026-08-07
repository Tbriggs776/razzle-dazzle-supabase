import React, { useState, useEffect } from 'react';
import { Sparkles, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { base44 } from '@/api/base44Client';

function LocalTextarea({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return <Textarea {...props} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => onBlur(local)} />;
}

export default function AISummarySection({ formData, onChange }) {
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  const buildPrompt = () => {
    const parts = [];
    parts.push(`You are summarizing a flooring appointment-setting call for a company called Floor Daddy / Razzle Dazzle. Write a concise, professional call summary (3–5 sentences) that a sales team member or design consultant can quickly read before the appointment. Include the key details below.\n`);

    if (formData.customer_first_name || formData.customer_last_name)
      parts.push(`Customer: ${[formData.customer_first_name, formData.customer_last_name].filter(Boolean).join(' ')}`);
    if (formData.customer_phone) parts.push(`Phone: ${formData.customer_phone}`);
    if (formData.customer_email) parts.push(`Email: ${formData.customer_email}`);
    if (formData.customer_street) parts.push(`Address: ${[formData.customer_street, formData.city, formData.state, formData.postal_code].filter(Boolean).join(', ')}`);
    if (formData.lives_at_address) parts.push(`Lives at address: ${formData.lives_at_address}`);
    if (formData.home_built_era) parts.push(`Home built: ${formData.home_built_era}`);
    if (formData.owner_occupied_status) parts.push(`Occupancy: ${formData.owner_occupied_status}`);

    if (formData.discovery_q1) parts.push(`Current flooring/space: ${formData.discovery_q1}`);
    if (formData.discovery_q2) parts.push(`Reason for replacing: ${formData.discovery_q2}`);
    if (formData.discovery_q3) parts.push(`Vision for space: ${formData.discovery_q3}`);
    if (formData.discovery_q4) parts.push(`Timing/urgency: ${formData.discovery_q4}`);
    if (formData.discovery_q5) parts.push(`Emotional outcome: ${formData.discovery_q5}`);

    if ((formData.scope_flooring_products || []).length > 0)
      parts.push(`Flooring products of interest: ${formData.scope_flooring_products.join(', ')}`);
    if (formData.scope_gap_fill_notes) parts.push(`Scope notes: ${formData.scope_gap_fill_notes}`);
    if (formData.scope_pets_kids_notes) parts.push(`Pets/kids notes: ${formData.scope_pets_kids_notes}`);

    if (formData.prequal_dm_track) parts.push(`Decision-maker track: ${formData.prequal_dm_track}`);
    if (formData.work_from_home) parts.push(`Works from home: ${formData.work_from_home}`);
    if (formData.financing_notes) parts.push(`Financing notes: ${formData.financing_notes}`);
    if (formData.credit_score_range) parts.push(`Credit score range: ${formData.credit_score_range}`);
    if (formData.project_timeframe) parts.push(`Project timeframe: ${formData.project_timeframe}`);
    if (formData.collected_other_estimates) parts.push(`Has other estimates: ${formData.collected_other_estimates}${formData.other_companies_estimates ? ` (${formData.other_companies_estimates})` : ''}`);

    if (formData.preferred_appointment_date) parts.push(`Preferred appointment date: ${formData.preferred_appointment_date}`);
    if (formData.preferred_appointment_block) parts.push(`Preferred time block: ${formData.preferred_appointment_block}`);
    if (formData.two_hour_window_confirmation) parts.push(`2-hour window confirmed: ${formData.two_hour_window_confirmation}`);
    if (formData.customer_scheduling_requests) parts.push(`Scheduling requests: ${formData.customer_scheduling_requests}`);

    if (formData.heard_about_us) parts.push(`Lead source: ${formData.heard_about_us}${formData.heard_about_us_other ? ` — ${formData.heard_about_us_other}` : ''}`);

    if (formData.additional_address_details) parts.push(`Additional address details: ${formData.additional_address_details}`);
    if (formData.scope_flag_over_tile) parts.push(`Flag: Customer wants to install over existing tile`);
    if (formData.scope_flag_out_of_scope) parts.push(`Flag: Customer mentioned out-of-scope work`);
    if (formData.scope_baseboards) parts.push(`Including new baseboards: ${formData.scope_baseboards}`);
    if (formData.scope_tile_removal) parts.push(`Pulling tile as part of project: ${formData.scope_tile_removal}`);
    if (formData.availability_notes) parts.push(`Availability notes: ${formData.availability_notes}`);
    if (formData.appointment_day) parts.push(`Preferred appointment day: ${formData.appointment_day}`);
    if (formData.prequal_below_minimum) parts.push(`Flag: Caller appears to be below project minimum`);
    if (formData.prequal_ladder_covered) parts.push(`Consequence ladder covered for solo DM: Yes`);
    if (formData.super_sale_delivered) parts.push(`Super Sale pitch delivered: Yes`);
    if (formData.value_stack_delivered) parts.push(`Value stack walkthrough delivered: Yes`);

    return parts.join('\n');
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError('');
    try {
      const summary = await base44.integrations.Core.InvokeLLM({ prompt: buildPrompt() });
      onChange('ai_summary', summary);
    } catch (err) {
      console.error('AI summary failed:', err);
      setGenerateError(
        err?.message?.includes?.('credit') || err?.message?.includes?.('quota')
          ? 'AI summary is unavailable right now due to a platform credit limit. You can still type a summary manually below.'
          : 'Failed to generate AI summary. You can type one manually below.'
      );
    } finally {
      setGenerating(false);
    }
  };

  const isComplete = !!formData.ai_summary;

  return (
    <div className="border-2 border-purple-200 rounded-xl overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-green-50 border-b border-green-200" : "bg-purple-50 border-b border-purple-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isComplete ? "bg-green-100" : "bg-purple-100")}>
            {isComplete ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <Sparkles className="w-5 h-5 text-purple-600" />}
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 16 — AI Call Summary</p>
            <p className="text-xs text-slate-500">Auto-generated summary for the design consultant</p>
          </div>
        </div>
        {isComplete && <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>}
      </div>

      <div className="p-5 bg-white space-y-4">
        <Button
          onClick={handleGenerate}
          disabled={generating}
          variant="outline"
          className="w-full border-purple-300 text-purple-700 hover:bg-purple-50 gap-2"
        >
          {generating ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Generating Summary...</>
          ) : (
            <><RefreshCw className="w-4 h-4" /> {isComplete ? 'Regenerate AI Summary' : 'Generate AI Summary'}</>
          )}
        </Button>

        {generateError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{generateError}</p>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Summary (edit as needed)</p>
          <LocalTextarea
            value={formData.ai_summary || ''}
            onBlur={(v) => onChange('ai_summary', v)}
            placeholder="Click 'Generate AI Summary' above, or type your own summary here..."
            className="min-h-[140px] text-sm leading-relaxed resize-y"
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Additional Notes</p>
          <LocalTextarea
            value={formData.other_project_notes || ''}
            onBlur={(v) => onChange('other_project_notes', v)}
            placeholder="Anything else the DC should know before the appointment..."
            className="min-h-[80px] text-sm resize-y"
          />
        </div>
      </div>
    </div>
  );
}