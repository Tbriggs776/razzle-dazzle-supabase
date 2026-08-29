import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { compressImage } from '@/lib/compressImage';
import { invokeFailure } from '@/lib/invokeResult';
import { draftKeyFor, loadDraft, clearDraft, useChecklistDraft } from '@/lib/checklistDraft';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Send, CheckCircle2, XCircle, Clock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import FieldManagerNotificationBadge from './FieldManagerNotificationBadge';
import PhotoLightboxModal from './PhotoLightboxModal';
import { SignedImage } from '@/lib/fileUrl';
import { toast } from 'sonner';

const money = (n) =>
  '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ChecklistRow({ label, checked, onChange, disabled, required, missing }) {
  return (
    <label data-missing={missing ? 'true' : undefined}
      className={cn("flex items-start gap-3 py-2 rounded-md px-1 -mx-1 transition-colors", !disabled && "cursor-pointer", missing && "bg-crit/10 ring-1 ring-crit/30")}>
      <Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
      <span className={cn("text-sm", disabled ? "text-muted-foreground" : "text-foreground")}>
        {label}
        {required && <span className="text-crit ml-0.5">*</span>}
      </span>
    </label>
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
      const { file_url } = await base44.integrations.Core.UploadFile({ file: shrunk, prefix: 'journey' });
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
    <div data-missing={missing ? 'true' : undefined}
      className={cn("space-y-2 rounded-md px-1 -mx-1 py-1 transition-colors", missing && "bg-crit/10 ring-1 ring-crit/30")}>
      <Label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-crit ml-0.5">*</span>}
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

function Section({ title, icon: Icon, children, warning }) {
  return (
    <div className={cn("rounded-xl border p-4 space-y-2", warning ? "border-crit/30 bg-crit/5" : "border-border bg-card")}>
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Icon className={cn("w-4 h-4", warning ? "text-crit" : "text-primary")} />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function JobStartChecklist({ checkpoint, projectId, onSubmitted, installerMode }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  // Collection state via a narrow RPC, NOT a direct ledger read: whoever opens
  // this screen is often a subcontract installer whose role cannot read the
  // payment table at all. The RPC returns the amount and nothing else — no
  // customer PII, no job costs, no other jobs.
  const { data: collection } = useQuery({
    queryKey: ['installCollection', projectId],
    queryFn: async () => {
      const { data, error } = await base44.functions.invoke('installCollectionStatus', { projectId });
      if (error) return null; // never let a money lookup break the checklist
      return data;
    },
    enabled: !!projectId,
    staleTime: 30000,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [mode, setMode] = useState(checkpoint?.status === 'SubmittedForApproval' ? 'review' : 'form');

  // A draft only ever wins for a checklist still being filled in. Once it is
  // submitted or completed the server copy is the truth, so a stale draft on one
  // device can never overwrite what was actually filed.
  const draftKey = draftKeyFor(projectId, 'job_start_checklist');
  const draftEligible = !(checkpoint?.status === 'SubmittedForApproval' || checkpoint?.status === 'Completed');
  // useMemo, not a bare call: this reads localStorage and would otherwise run on
  // every render. useState ignores anything after the first value anyway.
  const restoredDraft = useMemo(
    () => (draftEligible ? loadDraft(draftKey) : null),
    [draftKey, draftEligible],
  );

  const existingData = restoredDraft || checkpoint?.checklist_data || {};
  const [data, setData] = useState({
    arrival: {
      arrived_on_time: existingData.arrival?.arrived_on_time || false,
      wearing_shirts: existingData.arrival?.wearing_shirts || false,
      yard_sign_placed: existingData.arrival?.yard_sign_placed || false,
      truck_parked_properly: existingData.arrival?.truck_parked_properly || false,
      crew_lead_confirmed: existingData.arrival?.crew_lead_confirmed || false,
      crew_lead_name: existingData.arrival?.crew_lead_name || '',
      crew_lead_phone: existingData.arrival?.crew_lead_phone || '',
    },
    documentation: {
      before_video_photos: existingData.documentation?.before_video_photos || [],
      furniture_photos: existingData.documentation?.furniture_photos || [],
      appliance_photos: existingData.documentation?.appliance_photos || [],
    },
    verification: {
      measured_job: existingData.verification?.measured_job || false,
      materials_verified: existingData.verification?.materials_verified || false,
      material_shortage: existingData.verification?.material_shortage || false,
      shortage_count: existingData.verification?.shortage_count || 0,
      shortage_notes: existingData.verification?.shortage_notes || '',
      work_areas_verified: existingData.verification?.work_areas_verified || false,
      special_instructions_reviewed: existingData.verification?.special_instructions_reviewed || false,
      transitions_confirmed: existingData.verification?.transitions_confirmed || false,
      furniture_plan_confirmed: existingData.verification?.furniture_plan_confirmed || false,
    },
    safety: {
      asbestos_checked: existingData.safety?.asbestos_checked || false,
      asbestos_suspected: existingData.safety?.asbestos_suspected || false,
    },
    site_care: {
      coverings_photos: existingData.site_care?.coverings_photos || [],
      careful_demolition: existingData.site_care?.careful_demolition || false,
      trash_plan_acknowledged: existingData.site_care?.trash_plan_acknowledged || false,
      conduct_standards_acknowledged: existingData.site_care?.conduct_standards_acknowledged || false,
      demo_photos: existingData.site_care?.demo_photos || [],
    },
  });

  const isReadOnly = checkpoint?.status === 'SubmittedForApproval' || checkpoint?.status === 'Completed';

  // Survives a tab switch, a backgrounded phone and a back-swipe. Cleared the
  // moment the checklist is actually filed.
  useChecklistDraft(draftKey, data, !isReadOnly);
  const asbestosHalt = data.safety.asbestos_suspected;

  const update = (section, field, value) => {
    if (isReadOnly) return;
    setSubmitAttempted(false);
    setData(d => ({ ...d, [section]: { ...d[section], [field]: value } }));
  };

  // Required-field validation — every field EXCEPT the asbestos/safety section
  const missing = {
    arrived_on_time: !data.arrival.arrived_on_time,
    wearing_shirts: !data.arrival.wearing_shirts,
    yard_sign_placed: !data.arrival.yard_sign_placed,
    truck_parked_properly: !data.arrival.truck_parked_properly,
    crew_lead_confirmed: !data.arrival.crew_lead_confirmed,
    crew_lead_name: !data.arrival.crew_lead_name?.trim(),
    crew_lead_phone: !data.arrival.crew_lead_phone?.trim(),
    before_video_photos: !data.documentation.before_video_photos?.length,
    furniture_photos: !data.documentation.furniture_photos?.length,
    appliance_photos: !data.documentation.appliance_photos?.length,
    measured_job: !data.verification.measured_job,
    materials_verified: !data.verification.materials_verified,
    shortage_count: data.verification.material_shortage && (!data.verification.shortage_count || data.verification.shortage_count <= 0),
    shortage_notes: data.verification.material_shortage && !data.verification.shortage_notes?.trim(),
    work_areas_verified: !data.verification.work_areas_verified,
    special_instructions_reviewed: !data.verification.special_instructions_reviewed,
    transitions_confirmed: !data.verification.transitions_confirmed,
    furniture_plan_confirmed: !data.verification.furniture_plan_confirmed,
    coverings_photos: !data.site_care.coverings_photos?.length,
    careful_demolition: !data.site_care.careful_demolition,
    trash_plan_acknowledged: !data.site_care.trash_plan_acknowledged,
    conduct_standards_acknowledged: !data.site_care.conduct_standards_acknowledged,
    demo_photos: !data.site_care.demo_photos?.length,
  };
  const missingCount = Object.values(missing).filter(Boolean).length;
  const isValid = missingCount === 0;

  const handleSubmit = async () => {
    setSubmitAttempted(true);

    // ASBESTOS BYPASSES VALIDATION. The 23 required fields include
    // careful_demolition and its photos — evidence of the very work this row tells
    // the crew to stop. Requiring them meant the hard stop could only be reported
    // by someone who had ignored it, so in practice it was never reported at all:
    // handleSubmit returned here, the footer said "3 required fields remaining",
    // and submitCheckpoint was never called. No project hold, no alert, no email,
    // and there is no other asbestos path in the app.
    if (!asbestosHalt && !isValid) {
      // B8: this is now reachable, because the button is no longer disabled while
      // invalid. Take them to the first thing that is missing rather than making
      // them re-scan 23 rows on a phone in daylight.
      requestAnimationFrame(() => {
        document.querySelector('[data-missing="true"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('submitCheckpoint', {
        action: 'submit',
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'job_start_checklist',
        checklist_data: data,
      });
      // invoke() returns { data, error } and does NOT throw for a deployed function, so the
      // catch below never sees a backend error — check the result before advancing.
      const failed = invokeFailure(res);
      if (failed) {
        toast.error(failed);
        setSaving(false);
        return;
      }
      // Filed successfully, so the local copy is no longer the source of truth.
      clearDraft(draftKey);
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      queryClient.invalidateQueries({ queryKey: ['installCollection', projectId] });
      if (res.data?.asbestos_halt) {
        toast('⚠️ HARD STOP: Asbestos suspected. Installation halted. Field Manager, Zone Manager, and Ops have been alerted.');
      }
      // Observe-only: the submit succeeded and the crew is NOT blocked. Say so
      // plainly, so nobody stands in a driveway wondering whether to start.
      if (res.data?.cod_hold) {
        toast.warning(`Balance outstanding: ${money(res.data.amount_due)}`, {
          description: 'Your coordinator has been notified. This does not stop you — carry on with the install.',
          duration: 10000,
        });
      }
      setMode('review');
      onSubmitted?.();
    } catch (e) {
      console.error('Submit failed', e);
      toast.error('Failed to submit checklist. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke('submitCheckpoint', {
        action: 'approve',
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'job_start_checklist',
      });
      // invoke() never throws, so the old catch was dead code AND had no toast:
      // a 403 or a timeout advanced the panel in silence and the crew was told to
      // proceed on an approval that was never recorded. Nothing here was written
      // locally first, so blocking is right — the panel must not move.
      const failed = invokeFailure(res);
      if (failed) {
        toast.error(`Not approved — ${failed}. The crew has not been cleared to continue.`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      onSubmitted?.();
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    const notes = prompt('Reason for rejection:');
    if (!notes) return;
    setSaving(true);
    try {
      const res = await base44.functions.invoke('submitCheckpoint', {
        action: 'reject',
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'job_start_checklist',
        rejection_notes: notes,
      });
      // A rejection that silently failed is the worse half of this pair: the FM
      // believes they sent it back, the crew never sees it, and the reason they
      // typed is gone.
      const failed = invokeFailure(res);
      if (failed) {
        toast.error(`Not sent back — ${failed}. Your reason was not saved, so please try again.`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      setMode('form');
      onSubmitted?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Balance due — first thing on the page, above the 23 fields, so the crew
          reads it at the curb while they still have signal. There is no offline
          mode anywhere in this app; the money fact has to arrive on the way IN,
          not at submit. */}
      {collection?.gate_applies && collection?.satisfied === false && (
        <div className="rounded-xl border border-warn/30 bg-warn/10 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-warn">
                Collect {money(collection.amount_due)} before starting
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {collection.collection_terms === 'financed'
                  ? 'Financed job — confirm the lender approval is on file rather than collecting cash.'
                  : 'The full balance is due before install begins. If it has already been taken, ask your coordinator to record it.'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This does not block you — submit the checklist either way.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Status banner */}
      {checkpoint?.status === 'SubmittedForApproval' && (
        <div>
          <div className="bg-warn/10 border border-warn/30 rounded-xl p-4 flex items-center gap-3">
            <Clock className="w-5 h-5 text-warn shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-warn">Submitted for Approval</p>
              <p className="text-xs text-muted-foreground">Submitted by {checkpoint.submitted_by_name} on {new Date(checkpoint.submitted_date).toLocaleString()}</p>
            </div>
          </div>
          {!installerMode && <FieldManagerNotificationBadge checkpoint={checkpoint} />}
        </div>
      )}
      {checkpoint?.status === 'Completed' && (
        <div className="bg-good/10 border border-good/30 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-good shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-good">Completed & Approved</p>
            <p className="text-xs text-muted-foreground">Approved by {checkpoint.approved_by_name} on {new Date(checkpoint.approved_date).toLocaleString()}</p>
          </div>
        </div>
      )}
      {checkpoint?.status === 'Rejected' && (
        <div className="bg-crit/10 border border-crit/30 rounded-xl p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-crit shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-crit">Rejected — Revisions Needed</p>
            <p className="text-xs text-muted-foreground">{checkpoint.rejection_notes}</p>
          </div>
        </div>
      )}
      {/* Solid destructive fill, not a tint: this is the one banner that must read as a stop
          sign at arm's length in daylight. bg-destructive / text-destructive-foreground is a
          defined pair in both themes, so it stays legible where a /10 tint would not. */}
      {asbestosHalt && !isReadOnly && (
        <div className="bg-destructive text-destructive-foreground rounded-xl p-4 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">HARD STOP — Asbestos suspected. Submitting will halt the job and alert the response team.</p>
        </div>
      )}

      {/* Section: Arrival & Presentation */}
      <Section title={t('jscSecArrival')} icon={CheckCircle2}>
        <ChecklistRow label={t('jscOnTime')} required checked={data.arrival.arrived_on_time} missing={submitAttempted && missing.arrived_on_time} onChange={v => update('arrival', 'arrived_on_time', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscShirts')} required checked={data.arrival.wearing_shirts} missing={submitAttempted && missing.wearing_shirts} onChange={v => update('arrival', 'wearing_shirts', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscYardSign')} required checked={data.arrival.yard_sign_placed} missing={submitAttempted && missing.yard_sign_placed} onChange={v => update('arrival', 'yard_sign_placed', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscTruck')} required checked={data.arrival.truck_parked_properly} missing={submitAttempted && missing.truck_parked_properly} onChange={v => update('arrival', 'truck_parked_properly', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscCrewLead')} required checked={data.arrival.crew_lead_confirmed} missing={submitAttempted && missing.crew_lead_confirmed} onChange={v => update('arrival', 'crew_lead_confirmed', v)} disabled={isReadOnly} />
        <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
          {/* htmlFor/id pairing: the labels were visually present but not
              programmatically associated, so a screen reader announced two bare
              text fields. data-missing lets the submit handler scroll here too. */}
          <div className="space-y-1" data-missing={submitAttempted && missing.crew_lead_name ? 'true' : undefined}>
            <Label htmlFor="jsc-crew-lead-name" className="text-xs">Crew Lead Name <span className="text-crit">*</span></Label>
            <Input
              id="jsc-crew-lead-name"
              autoComplete="name"
              aria-required="true"
              aria-invalid={submitAttempted && missing.crew_lead_name ? 'true' : undefined}
              value={data.arrival.crew_lead_name}
              onChange={e => update('arrival', 'crew_lead_name', e.target.value)}
              disabled={isReadOnly}
              placeholder="Name"
              className={submitAttempted && missing.crew_lead_name ? 'border-crit' : ''}
            />
            {submitAttempted && missing.crew_lead_name && <p className="text-xs text-crit">Required</p>}
          </div>
          <div className="space-y-1" data-missing={submitAttempted && missing.crew_lead_phone ? 'true' : undefined}>
            <Label htmlFor="jsc-crew-lead-phone" className="text-xs">Crew Lead Phone <span className="text-crit">*</span></Label>
            {/* type=tel + inputMode=tel: this opened a full QWERTY keyboard on a
                phone, for a field that only ever takes digits, for a user standing
                in a doorway. */}
            <Input
              id="jsc-crew-lead-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              aria-required="true"
              aria-invalid={submitAttempted && missing.crew_lead_phone ? 'true' : undefined}
              value={data.arrival.crew_lead_phone}
              onChange={e => update('arrival', 'crew_lead_phone', e.target.value)}
              disabled={isReadOnly}
              placeholder="Phone"
              className={submitAttempted && missing.crew_lead_phone ? 'border-crit' : ''}
            />
            {submitAttempted && missing.crew_lead_phone && <p className="text-xs text-crit">Required</p>}
          </div>
        </div>
      </Section>

      {/* Section: Protect Yourself — Take Photos First */}
      <Section title={t('jscSecPhotos')} icon={Camera}>
        <p className="text-xs text-muted-foreground italic -mt-1">Do this BEFORE you move or touch anything. These photos protect you if there is ever a problem or a claim.</p>
        <PhotoUpload label='Take a "before" video and photos of the whole work area' required missing={submitAttempted && missing.before_video_photos} photos={data.documentation.before_video_photos} onChange={urls => update('documentation', 'before_video_photos', urls)} disabled={isReadOnly} />
        <PhotoUpload label={t('jscFurniturePhotos')} required missing={submitAttempted && missing.furniture_photos} photos={data.documentation.furniture_photos} onChange={urls => update('documentation', 'furniture_photos', urls)} disabled={isReadOnly} />
        <PhotoUpload label={t('jscAppliancePhotos')} required missing={submitAttempted && missing.appliance_photos} photos={data.documentation.appliance_photos} onChange={urls => update('documentation', 'appliance_photos', urls)} disabled={isReadOnly} />
      </Section>

      {/* Section: Check the Job Before You Start */}
      <Section title={t('jscSecVerify')} icon={CheckCircle2}>
        <ChecklistRow label={t('jscMeasured')} required checked={data.verification.measured_job} missing={submitAttempted && missing.measured_job} onChange={v => update('verification', 'measured_job', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscMaterials')} required checked={data.verification.materials_verified} missing={submitAttempted && missing.materials_verified} onChange={v => update('verification', 'materials_verified', v)} disabled={isReadOnly} />

        {/* Material shortage conditional */}
        <div className="ml-6 mt-1 p-3 bg-crit/10 rounded-lg space-y-2">
          <ChecklistRow label={t('jscShortage')} checked={data.verification.material_shortage} onChange={v => update('verification', 'material_shortage', v)} disabled={isReadOnly} />
          {data.verification.material_shortage && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
              <div className="space-y-1">
                <Label className="text-xs">Shortage count <span className="text-crit">*</span></Label>
                <Input type="number" inputMode="numeric" aria-label="How many pieces are short?" value={data.verification.shortage_count} onChange={e => update('verification', 'shortage_count', parseInt(e.target.value) || 0)} disabled={isReadOnly} className={submitAttempted && missing.shortage_count ? 'border-crit' : ''} />
                {submitAttempted && missing.shortage_count && <p className="text-xs text-crit">Required</p>}
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Shortage details (alerts Install Coordinator + Order Entry) <span className="text-crit">*</span></Label>
                <Textarea value={data.verification.shortage_notes} onChange={e => update('verification', 'shortage_notes', e.target.value)} disabled={isReadOnly} rows={2} className={submitAttempted && missing.shortage_notes ? 'border-crit' : ''} />
                {submitAttempted && missing.shortage_notes && <p className="text-xs text-crit">Required</p>}
              </div>
            </div>
          )}
        </div>

        <ChecklistRow label={t('jscWorkAreas')} required checked={data.verification.work_areas_verified} missing={submitAttempted && missing.work_areas_verified} onChange={v => update('verification', 'work_areas_verified', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscSpecialInstructions')} required checked={data.verification.special_instructions_reviewed} missing={submitAttempted && missing.special_instructions_reviewed} onChange={v => update('verification', 'special_instructions_reviewed', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscTransitions')} required checked={data.verification.transitions_confirmed} missing={submitAttempted && missing.transitions_confirmed} onChange={v => update('verification', 'transitions_confirmed', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscFurniturePlan')} required checked={data.verification.furniture_plan_confirmed} missing={submitAttempted && missing.furniture_plan_confirmed} onChange={v => update('verification', 'furniture_plan_confirmed', v)} disabled={isReadOnly} />
      </Section>

      {/* Section: Safety — Asbestos (STOP) */}
      <Section title={t('jscSecAsbestos')} icon={ShieldAlert} warning>
        <ChecklistRow label={t('jscAsbestosChecked')} checked={data.safety.asbestos_checked} onChange={v => update('safety', 'asbestos_checked', v)} disabled={isReadOnly} />
        <div className="ml-6 mt-1 p-3 bg-crit/10 rounded-lg">
          <ChecklistRow label={t('jscAsbestosSuspected')} checked={data.safety.asbestos_suspected} onChange={v => update('safety', 'asbestos_suspected', v)} disabled={isReadOnly} />
          {data.safety.asbestos_suspected && (
            <p className="text-xs text-crit pl-7 mt-1">
              Installation stops until customer engages a licensed abatement company and provides a clearance certificate. Per signed acknowledgment, Floor Daddy does not proceed.
            </p>
          )}
        </div>
      </Section>

      {/* Section: Site Care */}
      <Section title={t('jscSecSiteCare')} icon={CheckCircle2}>
        <PhotoUpload label={t('jscCoverPhotos')} required missing={submitAttempted && missing.coverings_photos} photos={data.site_care.coverings_photos} onChange={urls => update('site_care', 'coverings_photos', urls)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscCarefulDemo')} required checked={data.site_care.careful_demolition} missing={submitAttempted && missing.careful_demolition} onChange={v => update('site_care', 'careful_demolition', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscTrashPlan')} required checked={data.site_care.trash_plan_acknowledged} missing={submitAttempted && missing.trash_plan_acknowledged} onChange={v => update('site_care', 'trash_plan_acknowledged', v)} disabled={isReadOnly} />
        <ChecklistRow label={t('jscConduct')} required checked={data.site_care.conduct_standards_acknowledged} missing={submitAttempted && missing.conduct_standards_acknowledged} onChange={v => update('site_care', 'conduct_standards_acknowledged', v)} disabled={isReadOnly} />
        <PhotoUpload label={t('jscDemoPhotos')} required missing={submitAttempted && missing.demo_photos} photos={data.site_care.demo_photos} onChange={urls => update('site_care', 'demo_photos', urls)} disabled={isReadOnly} />
      </Section>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        {!isReadOnly && (
          <>
            {!isValid && !asbestosHalt && (
              <p className="text-xs text-warn mr-auto">
                {missingCount} required field{missingCount === 1 ? '' : 's'} remaining
              </p>
            )}
            {asbestosHalt && (
              <p className="text-xs font-semibold text-crit mr-auto">
                Report this now — the rest of the checklist can wait.
              </p>
            )}
            {/* NOT disabled when invalid. Disabling it was what made the missing-field
                highlighting unreachable: only handleSubmit sets submitAttempted, and
                it could never run. Pressing it now marks the attempt, highlights what
                is missing and scrolls to the first one. */}
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className={cn('gap-2', asbestosHalt && 'bg-crit text-background hover:bg-crit/90')}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" />
                : asbestosHalt ? <ShieldAlert className="w-4 h-4" />
                : <Send className="w-4 h-4" />}
              {asbestosHalt ? 'Report asbestos and stop work' : 'Submit for Approval'}
            </Button>
          </>
        )}
        {checkpoint?.status === 'SubmittedForApproval' && !installerMode && (
          <>
            <Button variant="outline" onClick={handleReject} disabled={saving} className="gap-2 text-crit border-crit/30 hover:bg-crit/10">
              <XCircle className="w-4 h-4" />
              Reject
            </Button>
            <Button onClick={handleApprove} disabled={saving || asbestosHalt} className="gap-2 bg-good text-background hover:bg-good/90">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve & Advance
            </Button>
          </>
        )}
        {checkpoint?.status === 'SubmittedForApproval' && asbestosHalt && !installerMode && (
          <p className="text-xs text-crit mr-auto">Cannot approve — asbestos hard stop active</p>
        )}
      </div>
    </div>
  );
}