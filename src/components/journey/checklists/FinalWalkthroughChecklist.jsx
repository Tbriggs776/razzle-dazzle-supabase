import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { compressImage } from '@/lib/compressImage';
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
import { SignedImage } from '@/lib/fileUrl';

function ChecklistRow({ label, checked, onChange, disabled, note, required, missing }) {
  return (
    <div>
      <label className={cn("flex items-start gap-3 py-2 rounded-md px-1 -mx-1 transition-colors", !disabled && "cursor-pointer", missing && "bg-crit/10 ring-1 ring-crit/30")}>
        <Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
        <div>
          <span className={cn("text-sm", disabled ? "text-muted-foreground" : "text-foreground")}>
            {label}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </span>
          {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
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
    // Reset the input straight away so re-picking the SAME photo after a failure
    // still fires a change event.
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      // Camera originals are 3-12MB each and this asks for several. On a job site
      // that is minutes per photo, and the usual failure is the crew giving up.
      const shrunk = await compressImage(file);
      const { file_url } = await base44.integrations.Core.UploadFile({ file: shrunk });
      if (!file_url) throw new Error('the upload returned no file');
      onChange([...photos, file_url]);
    } catch (err) {
      // Was console.error only: the photo silently never appeared, and a crew that
      // believes it uploaded moves on without the evidence.
      console.error('Upload failed', err);
      toast.error('That photo did not upload. Check your signal and try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn("space-y-2 rounded-md px-1 -mx-1 py-1 transition-colors", missing && "bg-crit/10 ring-1 ring-crit/30")}>
      <Label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="flex items-center gap-2 flex-wrap">
        {photos.map((url, i) => (
          <div key={i} className="relative group">
            <SignedImage src={url} alt="" onClick={() => setLightboxIndex(i)} className="w-16 h-16 object-cover rounded-lg border border-border cursor-pointer" />
            {/* Was opacity-0 group-hover:opacity-100 at 20px: invisible on a touch
                screen yet still tappable, so evidence photos were deleted by accident
                and could not be deleted on purpose. Always visible, 44px target,
                and it asks first. */}
            {!disabled && (
              <button
                type="button"
                aria-label="Remove this photo"
                onClick={() => {
                  if (window.confirm('Remove this photo?')) {
                    onChange(photos.filter((_, idx) => idx !== i));
                  }
                }}
                className="absolute -top-2 -right-2 flex h-11 w-11 items-center justify-center"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-sm leading-none text-destructive-foreground shadow ring-2 ring-background">×</span>
              </button>
            )}
          </div>
        ))}
        {!disabled && (
          <label className="w-16 h-16 border-2 border-dashed border-input rounded-lg flex items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/10 transition-colors">
            {uploading ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> : <Camera className="w-4 h-4 text-muted-foreground" />}
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
      warning ? "border-crit/30 bg-crit/5" :
      accent ? "border-info/30 bg-info/5" :
      "border-border bg-card"
    )}>
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Icon className={cn("w-4 h-4", warning ? "text-crit" : accent ? "text-info" : "text-primary")} />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
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
      const res = await base44.functions.invoke('submitCheckpoint', {
        action: 'submit',
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'final_walkthrough_checklist',
        checklist_data: data,
      });
      // invoke() returns { data, error } (no throw for deployed fns) — surface backend errors.
      if (res.error || res.data?.error) {
        toast.error(res.data?.error || 'Failed to submit. Please try again.');
        setSaving(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      onSubmitted?.();
    } catch (e) {
      console.error('Submit failed', e);
      toast.error('Failed to submit. Please try again.');
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
      const res = await base44.functions.invoke('submitCheckpoint', {
        action: 'submit_for_payment',
        checkpoint_id: checkpoint.id,
        project_id: projectId,
        step_key: 'final_walkthrough_checklist',
        checklist_data: data,
      });
      // invoke() returns { data, error } (no throw for deployed fns) — surface backend errors.
      if (res.error || res.data?.error) {
        toast.error(res.data?.error || 'Failed to submit for payment. Please try again.');
        setSaving(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      onSubmitted?.();
    } catch (e) {
      console.error('Submit for payment failed', e);
      toast.error('Failed to submit for payment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status banners */}
      {isReviewPhase && (
        <div>
          <div className="bg-warn/10 border border-warn/30 rounded-xl p-4 flex items-center gap-3">
            <Lock className="w-5 h-5 text-warn shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-warn">HARD LOCK — Final Walkthrough Submitted, FM Final Sign-Off Required</p>
              <p className="text-xs text-muted-foreground">
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
          <div className="bg-info/10 border border-info/30 rounded-xl p-4 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-info shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-info">FM Final Sign-Off Complete — Payment Submission Unlocked</p>
              <p className="text-xs text-muted-foreground">
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
        <div className="bg-good/10 border border-good/30 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-good shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-good">Job Complete — Payment Submitted</p>
            <p className="text-xs text-muted-foreground">
              Payment submitted by {existingData.payment_submitted_by_name || 'Manager'}
              {existingData.payment_submitted_date ? ` on ${new Date(existingData.payment_submitted_date).toLocaleString()}` : ''}.
              Install Coordinator, Order Entry, and Field Manager have been notified. Customer has been notified.
            </p>
          </div>
        </div>
      )}
      {status === 'Rejected' && (
        <div className="bg-crit/10 border border-crit/30 rounded-xl p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-crit shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-crit">Rejected — Revisions Needed</p>
            <p className="text-xs text-muted-foreground">{checkpoint.rejection_notes}</p>
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
        <div className="ml-6 p-3 bg-muted rounded-lg">
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
        <div className="ml-6 p-3 bg-muted rounded-lg">
          <ChecklistRow label="Applies to this job?" checked={data.closeout_carpet.applies} onChange={v => update('closeout_carpet', 'applies', v)} disabled={readOnly} />
        </div>
        {data.closeout_carpet.applies && (
          <p className="text-xs text-muted-foreground pl-7">To be defined: tack strip / smooth-edge install, pad/cushion verification, seam placement + seam-iron quality, stretch/power-stretch verification, transition placement.</p>
        )}
      </Section>

      {/* Quality Closeout — Tile (placeholder) */}
      <Section title="Quality Closeout — Tile Module" icon={Layers}>
        <div className="ml-6 p-3 bg-muted rounded-lg">
          <ChecklistRow label="Applies to this job?" checked={data.closeout_tile.applies} onChange={v => update('closeout_tile', 'applies', v)} disabled={readOnly} />
        </div>
        {data.closeout_tile.applies && (
          <p className="text-xs text-muted-foreground pl-7">To be defined: grout joint size + tile spacing per manufacturer spec, layout/pattern verification, 12-hour no-foot-traffic window after setting, 12-hour window after grouting, mortar coverage check.</p>
        )}
      </Section>

      {/* Walkthrough (all parties present) */}
      <Section title="Walkthrough (All Parties Present)" icon={ClipboardCheck}>
        <ChecklistRow label="Installer / crew lead present" required checked={data.walkthrough.installer_present} missing={submitAttempted && missing.installer_present} onChange={v => update('walkthrough', 'installer_present', v)} disabled={readOnly} />
        <ChecklistRow label="Floor Daddy Field Manager present (onsite)" required checked={data.walkthrough.fm_present} missing={submitAttempted && missing.fm_present} onChange={v => update('walkthrough', 'fm_present', v)} disabled={readOnly} />
        <ChecklistRow label="Customer present" required checked={data.walkthrough.customer_present} missing={submitAttempted && missing.customer_present} onChange={v => update('walkthrough', 'customer_present', v)} disabled={readOnly} />
        <div className="ml-6 p-3 bg-muted rounded-lg space-y-2">
          <ChecklistRow label="Blue-tape walkthrough completed" required checked={data.walkthrough.blue_tape_walkthrough_completed} missing={submitAttempted && missing.blue_tape_walkthrough_completed} onChange={v => update('walkthrough', 'blue_tape_walkthrough_completed', v)} disabled={readOnly} />
          {data.walkthrough.blue_tape_walkthrough_completed && (
            <PhotoUpload label="Blue-tape items photographed" required missing={submitAttempted && missing.blue_tape_photos} photos={data.walkthrough.blue_tape_photos} onChange={urls => update('walkthrough', 'blue_tape_photos', urls)} disabled={readOnly} />
          )}
        </div>
        <ChecklistRow label="Punch list created" required checked={data.walkthrough.punch_list_created} missing={submitAttempted && missing.punch_list_created} onChange={v => update('walkthrough', 'punch_list_created', v)} disabled={readOnly} />
        <div className="ml-6 p-3 bg-muted rounded-lg space-y-2">
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
          <p className="text-xs text-crit font-medium">⚠️ GATE: Certificate of Completion must be signed by customer before submitting.</p>
        )}
        <ChecklistRow
          label="Certificate of Completion signed by customer"
          required
          checked={data.customer_signoff.certificate_signed}
          missing={submitAttempted && missing.certificate_signed}
          onChange={v => update('customer_signoff', 'certificate_signed', v)}
          disabled={readOnly}
        />
        <div className="ml-6 p-3 bg-muted rounded-lg">
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
        <p className="text-xs text-muted-foreground pl-7">If checked, the Razzle review team will be alerted to close the loop on job completion.</p>
      </Section>

      {/* FM Gate — Review buttons */}
      {isReviewPhase && !installerMode && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={handleReject} disabled={saving} className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive">
            <XCircle className="w-4 h-4" /> Reject
          </Button>
          {/* text-background is intentional: matches the app-wide filled-semantic-button pattern (bg-info/bg-good + text-background). */}
          <Button onClick={handleApproveFinal} disabled={saving} className="gap-2 bg-info text-background hover:bg-info/90">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Approve Final Walkthrough
          </Button>
        </div>
      )}

      {/* Action: Submit for FM Approval */}
      {isInstallerPhase && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {!isValid && (
            <p className="text-xs text-warn mr-auto">
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
            <p className="text-xs text-muted-foreground text-right">Payment submission must be completed by a manager.</p>
          ) : (
            /* text-white is intentional: same filled-semantic-button pattern as the FM approve action above. */
            <Button onClick={handleSubmitForPayment} disabled={saving} className="gap-2 bg-good text-background hover:bg-good/90">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              Submit for Payment
            </Button>
          )}
        </div>
      )}
    </div>
  );
}