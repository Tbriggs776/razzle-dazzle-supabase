import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Send, CheckCircle2, XCircle, Lock, ShieldCheck, DollarSign, Star, FileSignature, ClipboardCheck, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import FieldManagerNotificationBadge from './FieldManagerNotificationBadge';
import InstallerNotificationBadge from './InstallerNotificationBadge';
import PhotoLightboxModal from './PhotoLightboxModal';

function ChecklistRow({ label, checked, onChange, disabled, note, required, missing }) {
  return (
    <div>
      <label className={cn("flex items-start gap-3 py-2 rounded-md px-1 -mx-1 transition-colors", !disabled && "cursor-pointer", missing && "bg-red-50 ring-1 ring-red-200")}>
        <Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
        <div>
          <span className={cn("text-sm", disabled ? "text-slate-400" : "text-slate-700")}>
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </span>
          {note && <p className="text-xs text-slate-400 mt-0.5">{note}</p>}
        </div>
      </label>
    </div>
  );
}

function PhotoUpload({ label, photos, onChange, disabled, required, missing }) {
  const [uploading, setUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onChange([...photos, file_url]);
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn("space-y-2 rounded-md px-1 -mx-1 py-1 transition-colors", missing && "bg-red-50 ring-1 ring-red-200")}>
      <Label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      <div className="flex items-center gap-2 flex-wrap">
        {photos.map((url, i) => (
          <div key={i} className="relative group">
            <img src={url} alt="" onClick={() => setLightboxIndex(i)} className="w-16 h-16 object-cover rounded-lg border border-slate-200 cursor-pointer" />
            {!disabled && (
              <button
                onClick={() => onChange(photos.filter((_, idx) => idx !== i))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >×</button>
            )}
          </div>
        ))}
        {!disabled && (
          <label className="w-16 h-16 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
            {uploading ? <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" /> : <Camera className="w-4 h-4 text-slate-400" />}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleUpload} />
          </label>
        )}
      </div>
      {lightboxIndex !== null && (
        <PhotoLightboxModal urls={photos} index={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children, warning, accent }) {
  return (
    <div className={cn(
      "rounded-xl border p-4 space-y-2",
      warning ? "border-red-200 bg-red-50/50" :
      accent ? "border-blue-200 bg-blue-50/30" :
      "border-slate-200 bg-white"
    )}>
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
        <Icon className={cn("w-4 h-4", warning ? "text-red-500" : accent ? "text-blue-500" : "text-indigo-500")} />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function FinalWalkthroughChecklist({ checkpoint, projectId, onSubmitted, installerMode }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const existingData = checkpoint?.checklist_data || {};
  const status = checkpoint?.status;

  const isInstallerPhase = !status || status === 'Pending' || status === 'Rejected';
  const isReviewPhase = status === 'SubmittedForApproval';
  const isPaymentPhase = status === 'PrepApproved';
  const isCompleted = status === 'Completed';

  const readOnly = !isInstallerPhase;

  const [data, setData] = useState({
    pre_final: {
      fm_notified_day_before: existingData.pre_final?.fm_notified_day_before || false,
      customer_notified_nearing_completion: existingData.pre_final?.customer_notified_nearing_completion || false,
    },
    closeout_core: {
      work_areas_cleaned: existingData.closeout_core?.work_areas_cleaned || false,
      final_photos: existingData.closeout_core?.final_photos || [],
    },
    closeout_hard_surface: {
      applies: existingData.closeout_hard_surface?.applies || false,
      baseboards_completed: existingData.closeout_hard_surface?.baseboards_completed || false,
      transitions_seated: existingData.closeout_hard_surface?.transitions_seated || false,
      door_rehung: existingData.closeout_hard_surface?.door_rehung || false,
      door_notes: existingData.closeout_hard_surface?.door_notes || '',
    },
    closeout_carpet: { applies: existingData.closeout_carpet?.applies || false },
    closeout_tile: { applies: existingData.closeout_tile?.applies || false },
    walkthrough: {
      installer_present: existingData.walkthrough?.installer_present || false,
      fm_present: existingData.walkthrough?.fm_present || false,
      customer_present: existingData.walkthrough?.customer_present || false,
      blue_tape_walkthrough_completed: existingData.walkthrough?.blue_tape_walkthrough_completed || false,
      blue_tape_photos: existingData.walkthrough?.blue_tape_photos || [],
      punch_list_created: existingData.walkthrough?.punch_list_created || false,
      punch_list_completed: existingData.walkthrough?.punch_list_completed || false,
      punch_list_photos: existingData.walkthrough?.punch_list_photos || [],
    },
    materials_site: {
      leftover_materials_returned: existingData.materials_site?.leftover_materials_returned || false,
      trash_disposed: existingData.materials_site?.trash_disposed || false,
      opened_carton_left: existingData.materials_site?.opened_carton_left || false,
    },
    customer_signoff: {
      certificate_signed: existingData.customer_signoff?.certificate_signed || false,
      signer_matches_contract: existingData.customer_signoff?.signer_matches_contract || false,
    },
    five_star_review: {
      review_request_made: existingData.five_star_review?.review_request_made || false,
    },
  });

  const update = (section, field, value) => {
    if (readOnly) return;
    setSubmitAttempted(false);
    setData(d => ({ ...d, [section]: { ...d[section], [field]: value } }));
  };

  // Validation gates
  const customerSignoffGateMet = data.customer_signoff.certificate_signed;
  const blueTapeGateMet = !data.walkthrough.blue_tape_walkthrough_completed || data.walkthrough.blue_tape_photos.length > 0;
  const punchListGateMet = !data.walkthrough.punch_list_completed || data.walkthrough.punch_list_photos.length > 0;

  const missing = useMemo(() => ({
    fm_notified_day_before: !data.pre_final.fm_notified_day_before,
    customer_notified_nearing_completion: !data.pre_final.customer_notified_nearing_completion,
    work_areas_cleaned: !data.closeout_core.work_areas_cleaned,
    final_photos: data.closeout_core.final_photos.length === 0,
    baseboards_completed: data.closeout_hard_surface.applies && !data.closeout_hard_surface.baseboards_completed,
    transitions_seated: data.closeout_hard_surface.applies && !data.closeout_hard_surface.transitions_seated,
    door_rehung: data.closeout_hard_surface.applies && !data.closeout_hard_surface.door_rehung,
    installer_present: !data.walkthrough.installer_present,
    fm_present: !data.walkthrough.fm_present,
    customer_present: !data.walkthrough.customer_present,
    blue_tape_walkthrough_completed: !data.walkthrough.blue_tape_walkthrough_completed,
    blue_tape_photos: data.walkthrough.blue_tape_walkthrough_completed && data.walkthrough.blue_tape_photos.length === 0,
    punch_list_created: !data.walkthrough.punch_list_created,
    punch_list_completed: !data.walkthrough.punch_list_completed,
    punch_list_photos: data.walkthrough.punch_list_completed && data.walkthrough.punch_list_photos.length === 0,
    leftover_materials_returned: !data.materials_site.leftover_materials_returned,
    trash_disposed: !data.materials_site.trash_disposed,
    opened_carton_left: !data.materials_site.opened_carton_left,
    certificate_signed: !data.customer_signoff.certificate_signed,
    review_request_made: !data.five_star_review.review_request_made,
  }), [data]);
  const missingCount = Object.values(missing).filter(Boolean).length;
  const isValid = missingCount === 0;

  const handleSubmit = async () => {
    if (!isValid) {
      setSubmitAttempted(true);
      return;
    }
    setSaving(true);
    try {
      await base44.functions.invoke('submitCheckpoint', {
        action: 'submit',
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'final_walkthrough_checklist',
        checklist_data: data,
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      onSubmitted?.();
    } catch (e) {
      console.error('Submit failed', e);
      alert('Failed to submit. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleApproveFinal = async () => {
    setSaving(true);
    try {
      await base44.functions.invoke('submitCheckpoint', {
        action: 'approve_final',
        checkpoint_id: checkpoint.id,
        project_id: projectId,
        step_key: 'final_walkthrough_checklist',
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      onSubmitted?.();
    } catch (e) {
      console.error('Approve final failed', e);
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    const notes = prompt('Reason for rejection:');
    if (!notes) return;
    setSaving(true);
    try {
      await base44.functions.invoke('submitCheckpoint', {
        action: 'reject',
        checkpoint_id: checkpoint.id,
        project_id: projectId,
        step_key: 'final_walkthrough_checklist',
        rejection_notes: notes,
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      onSubmitted?.();
    } catch (e) {
      console.error('Reject failed', e);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForPayment = async () => {
    setSaving(true);
    try {
      await base44.functions.invoke('submitCheckpoint', {
        action: 'submit_for_payment',
        checkpoint_id: checkpoint.id,
        project_id: projectId,
        step_key: 'final_walkthrough_checklist',
        checklist_data: data,
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      onSubmitted?.();
    } catch (e) {
      console.error('Submit for payment failed', e);
      alert('Failed to submit for payment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status banners */}
      {isReviewPhase && (
        <div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
            <Lock className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">HARD LOCK — Final Walkthrough Submitted, FM Final Sign-Off Required</p>
              <p className="text-xs text-amber-600">
                Payment submission stays disabled until the zone Field Manager verifies the checklist, photos, punch list, and customer signature, then approves in-app.
                Submitted by {checkpoint.submitted_by_name} on {new Date(checkpoint.submitted_date).toLocaleString()}
              </p>
            </div>
          </div>
          {!installerMode && <FieldManagerNotificationBadge checkpoint={checkpoint} />}
        </div>
      )}
      {isPaymentPhase && (
        <div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800">FM Final Sign-Off Complete — Payment Submission Unlocked</p>
              <p className="text-xs text-blue-600">
                Approved by {existingData.final_approved_by_name || 'Field Manager'}
                {existingData.final_approved_date ? ` on ${new Date(existingData.final_approved_date).toLocaleString()}` : ''}.
                Installer has been notified. Payment submission is now unlocked.
              </p>
            </div>
          </div>
          {!installerMode && <InstallerNotificationBadge checkpoint={checkpoint} />}
        </div>
      )}
      {isCompleted && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800">Job Complete — Payment Submitted</p>
            <p className="text-xs text-green-600">
              Payment submitted by {existingData.payment_submitted_by_name || 'Manager'}
              {existingData.payment_submitted_date ? ` on ${new Date(existingData.payment_submitted_date).toLocaleString()}` : ''}.
              Install Coordinator, Order Entry, and Field Manager have been notified. Customer has been notified.
            </p>
          </div>
        </div>
      )}
      {status === 'Rejected' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">Rejected — Revisions Needed</p>
            <p className="text-xs text-red-600">{checkpoint.rejection_notes}</p>
          </div>
        </div>
      )}

      {/* Pre-Final */}
      <Section title="Pre-Final" icon={ClipboardCheck}>
        <ChecklistRow
          label="Notified Field Manager the day before finishing to schedule the final walk"
          required
          checked={data.pre_final.fm_notified_day_before}
          missing={submitAttempted && missing.fm_notified_day_before}
          onChange={v => update('pre_final', 'fm_notified_day_before', v)}
          disabled={readOnly}
        />
        <ChecklistRow
          label="Customer notified: Your project is nearing completion. A final walkthrough is being scheduled."
          required
          checked={data.pre_final.customer_notified_nearing_completion}
          missing={submitAttempted && missing.customer_notified_nearing_completion}
          onChange={v => update('pre_final', 'customer_notified_nearing_completion', v)}
          disabled={readOnly}
        />
      </Section>

      {/* Quality Closeout — Shared Core */}
      <Section title="Quality Closeout — Shared Core (All Product Types)" icon={CheckCircle2}>
        <ChecklistRow label="All work areas cleaned before leaving" required checked={data.closeout_core.work_areas_cleaned} missing={submitAttempted && missing.work_areas_cleaned} onChange={v => update('closeout_core', 'work_areas_cleaned', v)} disabled={readOnly} />
        <PhotoUpload label="Final photos of completed project (per area)" required missing={submitAttempted && missing.final_photos} photos={data.closeout_core.final_photos} onChange={urls => update('closeout_core', 'final_photos', urls)} disabled={readOnly} />
      </Section>

      {/* Quality Closeout — Hard Surface */}
      <Section title="Quality Closeout — Hard Surface (LVP / Laminate / Wood)" icon={CheckCircle2}>
        <div className="ml-6 p-3 bg-slate-50 rounded-lg">
          <ChecklistRow label="Applies to this job?" checked={data.closeout_hard_surface.applies} onChange={v => update('closeout_hard_surface', 'applies', v)} disabled={readOnly} />
        </div>
        {data.closeout_hard_surface.applies && (
          <>
            <ChecklistRow label="Baseboards completed correctly" required checked={data.closeout_hard_surface.baseboards_completed} missing={submitAttempted && missing.baseboards_completed} onChange={v => update('closeout_hard_surface', 'baseboards_completed', v)} disabled={readOnly} />
            <ChecklistRow label="Transitions / T-moldings seated correctly" required checked={data.closeout_hard_surface.transitions_seated} missing={submitAttempted && missing.transitions_seated} onChange={v => update('closeout_hard_surface', 'transitions_seated', v)} disabled={readOnly} />
            <ChecklistRow
              label="Door re-hung where possible"
              required
              checked={data.closeout_hard_surface.door_rehung}
              missing={submitAttempted && missing.door_rehung}
              onChange={v => update('closeout_hard_surface', 'door_rehung', v)}
              disabled={readOnly}
              note="Floor Daddy does not cut/adjust doors per customer acknowledgment."
            />
            <div className="space-y-1">
              <Label className="text-xs">Door notes (if applicable)</Label>
              <Textarea value={data.closeout_hard_surface.door_notes} onChange={e => update('closeout_hard_surface', 'door_notes', e.target.value)} disabled={readOnly} rows={2} placeholder="e.g., Door re-hung, no adjustment needed" />
            </div>
          </>
        )}
      </Section>

      {/* Quality Closeout — Carpet (placeholder) */}
      <Section title="Quality Closeout — Carpet Module" icon={Layers}>
        <div className="ml-6 p-3 bg-slate-50 rounded-lg">
          <ChecklistRow label="Applies to this job?" checked={data.closeout_carpet.applies} onChange={v => update('closeout_carpet', 'applies', v)} disabled={readOnly} />
        </div>
        {data.closeout_carpet.applies && (
          <p className="text-xs text-slate-500 pl-7">To be defined: tack strip / smooth-edge install, pad/cushion verification, seam placement + seam-iron quality, stretch/power-stretch verification, transition placement.</p>
        )}
      </Section>

      {/* Quality Closeout — Tile (placeholder) */}
      <Section title="Quality Closeout — Tile Module" icon={Layers}>
        <div className="ml-6 p-3 bg-slate-50 rounded-lg">
          <ChecklistRow label="Applies to this job?" checked={data.closeout_tile.applies} onChange={v => update('closeout_tile', 'applies', v)} disabled={readOnly} />
        </div>
        {data.closeout_tile.applies && (
          <p className="text-xs text-slate-500 pl-7">To be defined: grout joint size + tile spacing per manufacturer spec, layout/pattern verification, 12-hour no-foot-traffic window after setting, 12-hour window after grouting, mortar coverage check.</p>
        )}
      </Section>

      {/* Walkthrough (all parties present) */}
      <Section title="Walkthrough (All Parties Present)" icon={ClipboardCheck}>
        <ChecklistRow label="Installer / crew lead present" required checked={data.walkthrough.installer_present} missing={submitAttempted && missing.installer_present} onChange={v => update('walkthrough', 'installer_present', v)} disabled={readOnly} />
        <ChecklistRow label="Floor Daddy Field Manager present (onsite)" required checked={data.walkthrough.fm_present} missing={submitAttempted && missing.fm_present} onChange={v => update('walkthrough', 'fm_present', v)} disabled={readOnly} />
        <ChecklistRow label="Customer present" required checked={data.walkthrough.customer_present} missing={submitAttempted && missing.customer_present} onChange={v => update('walkthrough', 'customer_present', v)} disabled={readOnly} />
        <div className="ml-6 p-3 bg-slate-50 rounded-lg space-y-2">
          <ChecklistRow label="Blue-tape walkthrough completed" required checked={data.walkthrough.blue_tape_walkthrough_completed} missing={submitAttempted && missing.blue_tape_walkthrough_completed} onChange={v => update('walkthrough', 'blue_tape_walkthrough_completed', v)} disabled={readOnly} />
          {data.walkthrough.blue_tape_walkthrough_completed && (
            <PhotoUpload label="Blue-tape items photographed" required missing={submitAttempted && missing.blue_tape_photos} photos={data.walkthrough.blue_tape_photos} onChange={urls => update('walkthrough', 'blue_tape_photos', urls)} disabled={readOnly} />
          )}
        </div>
        <ChecklistRow label="Punch list created" required checked={data.walkthrough.punch_list_created} missing={submitAttempted && missing.punch_list_created} onChange={v => update('walkthrough', 'punch_list_created', v)} disabled={readOnly} />
        <div className="ml-6 p-3 bg-slate-50 rounded-lg space-y-2">
          <ChecklistRow label="Punch list completed" required checked={data.walkthrough.punch_list_completed} missing={submitAttempted && missing.punch_list_completed} onChange={v => update('walkthrough', 'punch_list_completed', v)} disabled={readOnly} />
          {data.walkthrough.punch_list_completed && (
            <PhotoUpload label="Completed punch-list items photographed" required missing={submitAttempted && missing.punch_list_photos} photos={data.walkthrough.punch_list_photos} onChange={urls => update('walkthrough', 'punch_list_photos', urls)} disabled={readOnly} />
          )}
        </div>
      </Section>

      {/* Materials & Site */}
      <Section title="Materials & Site" icon={ClipboardCheck}>
        <ChecklistRow label="Leftover materials returned to Floor Daddy warehouse" required checked={data.materials_site.leftover_materials_returned} missing={submitAttempted && missing.leftover_materials_returned} onChange={v => update('materials_site', 'leftover_materials_returned', v)} disabled={readOnly} />
        <ChecklistRow label="All trash disposed of properly (warehouse dumpster or dump — never customer's bins)" required checked={data.materials_site.trash_disposed} missing={submitAttempted && missing.trash_disposed} onChange={v => update('materials_site', 'trash_disposed', v)} disabled={readOnly} />
        <ChecklistRow label="Opened-carton remainder left for customer per policy" required checked={data.materials_site.opened_carton_left} missing={submitAttempted && missing.opened_carton_left} onChange={v => update('materials_site', 'opened_carton_left', v)} disabled={readOnly} />
      </Section>

      {/* Customer Sign-Off */}
      <Section title="Customer Sign-Off" icon={FileSignature} warning={!customerSignoffGateMet && isInstallerPhase} accent={customerSignoffGateMet}>
        {!customerSignoffGateMet && isInstallerPhase && (
          <p className="text-xs text-red-600 font-medium">⚠️ GATE: Certificate of Completion must be signed by customer before submitting.</p>
        )}
        <ChecklistRow
          label="Certificate of Completion signed by customer"
          required
          checked={data.customer_signoff.certificate_signed}
          missing={submitAttempted && missing.certificate_signed}
          onChange={v => update('customer_signoff', 'certificate_signed', v)}
          disabled={readOnly}
        />
        <div className="ml-6 p-3 bg-slate-50 rounded-lg">
          <ChecklistRow
            label="On financed jobs — signer validated to match contract signer"
            checked={data.customer_signoff.signer_matches_contract}
            onChange={v => update('customer_signoff', 'signer_matches_contract', v)}
            disabled={readOnly}
            note="If not a financed job, this can be skipped."
          />
        </div>
      </Section>

      {/* Five-Star Review */}
      <Section title="Five-Star Review" icon={Star}>
        <ChecklistRow
          label="Review request made — set the expectation onsite that if we earned 5 stars, we'd be grateful for one"
          required
          checked={data.five_star_review.review_request_made}
          missing={submitAttempted && missing.review_request_made}
          onChange={v => update('five_star_review', 'review_request_made', v)}
          disabled={readOnly}
        />
        <p className="text-xs text-slate-500 pl-7">If checked, the Razzle review team will be alerted to close the loop on job completion.</p>
      </Section>

      {/* FM Gate — Review buttons */}
      {isReviewPhase && !installerMode && (
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="outline" onClick={handleReject} disabled={saving} className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
            <XCircle className="w-4 h-4" /> Reject
          </Button>
          <Button onClick={handleApproveFinal} disabled={saving} className="gap-2 bg-blue-600 hover:bg-blue-700">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Approve Final Walkthrough
          </Button>
        </div>
      )}

      {/* Action: Submit for FM Approval */}
      {isInstallerPhase && (
        <div className="flex items-center justify-end gap-2 pt-2">
          {!isValid && (
            <p className="text-xs text-amber-600 mr-auto">
              {missingCount} required field{missingCount === 1 ? '' : 's'} remaining
            </p>
          )}
          <Button onClick={handleSubmit} disabled={saving || !isValid} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit for FM Final Approval
          </Button>
        </div>
      )}

      {/* Action: Submit for Payment (after FM approval) */}
      {isPaymentPhase && (
        <div className="flex items-center justify-end gap-2 pt-2">
          {installerMode ? (
            <p className="text-xs text-slate-500 text-right">Payment submission must be completed by a manager.</p>
          ) : (
            <Button onClick={handleSubmitForPayment} disabled={saving} className="gap-2 bg-green-600 hover:bg-green-700">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              Submit for Payment
            </Button>
          )}
        </div>
      )}
    </div>
  );
}