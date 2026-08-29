import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
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
    <label className={cn("flex items-start gap-3 py-2 rounded-md px-1 -mx-1 transition-colors", !disabled && "cursor-pointer", missing && "bg-red-50 ring-1 ring-red-200")}>
      <Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
      <span className={cn("text-sm", disabled ? "text-slate-400" : "text-slate-700")}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
    </label>
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
            <SignedImage src={url} alt="" onClick={() => setLightboxIndex(i)} className="w-16 h-16 object-cover rounded-lg border border-slate-200 cursor-pointer" />
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

function Section({ title, icon: Icon, children, warning }) {
  return (
    <div className={cn("rounded-xl border p-4 space-y-2", warning ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-white")}>
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
        <Icon className={cn("w-4 h-4", warning ? "text-red-500" : "text-indigo-500")} />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function JobStartChecklist({ checkpoint, projectId, onSubmitted, installerMode }) {
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

  const existingData = checkpoint?.checklist_data || {};
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
    if (!isValid) return;
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
      if (res.error || res.data?.error) {
        toast.error(res.data?.error || 'Failed to submit checklist. Please try again.');
        setSaving(false);
        return;
      }
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
      await base44.functions.invoke('submitCheckpoint', {
        action: 'approve',
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'job_start_checklist',
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      onSubmitted?.();
    } catch (e) {
      console.error('Approve failed', e);
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
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'job_start_checklist',
        rejection_notes: notes,
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
      setMode('form');
      onSubmitted?.();
    } catch (e) {
      console.error('Reject failed', e);
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
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                Collect {money(collection.amount_due)} before starting
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                {collection.collection_terms === 'financed'
                  ? 'Financed job — confirm the lender approval is on file rather than collecting cash.'
                  : 'The full balance is due before install begins. If it has already been taken, ask your coordinator to record it.'}
              </p>
              <p className="mt-1 text-xs text-amber-600">
                This does not block you — submit the checklist either way.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Status banner */}
      {checkpoint?.status === 'SubmittedForApproval' && (
        <div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
            <Clock className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">Submitted for Approval</p>
              <p className="text-xs text-amber-600">Submitted by {checkpoint.submitted_by_name} on {new Date(checkpoint.submitted_date).toLocaleString()}</p>
            </div>
          </div>
          {!installerMode && <FieldManagerNotificationBadge checkpoint={checkpoint} />}
        </div>
      )}
      {checkpoint?.status === 'Completed' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800">Completed & Approved</p>
            <p className="text-xs text-green-600">Approved by {checkpoint.approved_by_name} on {new Date(checkpoint.approved_date).toLocaleString()}</p>
          </div>
        </div>
      )}
      {checkpoint?.status === 'Rejected' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">Rejected — Revisions Needed</p>
            <p className="text-xs text-red-600">{checkpoint.rejection_notes}</p>
          </div>
        </div>
      )}
      {asbestosHalt && !isReadOnly && (
        <div className="bg-red-600 text-white rounded-xl p-4 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">HARD STOP — Asbestos suspected. Submitting will halt the job and alert the response team.</p>
        </div>
      )}

      {/* Section: Arrival & Presentation */}
      <Section title="Arrival & Presentation" icon={CheckCircle2}>
        <ChecklistRow label="Did you arrive to the job on time?" required checked={data.arrival.arrived_on_time} missing={submitAttempted && missing.arrived_on_time} onChange={v => update('arrival', 'arrived_on_time', v)} disabled={isReadOnly} />
        <ChecklistRow label="Are all installers wearing clean Floor Daddy shirts?" required checked={data.arrival.wearing_shirts} missing={submitAttempted && missing.wearing_shirts} onChange={v => update('arrival', 'wearing_shirts', v)} disabled={isReadOnly} />
        <ChecklistRow label="Did you put a Floor Daddy yard sign in the yard?" required checked={data.arrival.yard_sign_placed} missing={submitAttempted && missing.yard_sign_placed} onChange={v => update('arrival', 'yard_sign_placed', v)} disabled={isReadOnly} />
        <ChecklistRow label="Is your truck parked on the street, NOT in the customer's driveway? (Oil leak risk!)" required checked={data.arrival.truck_parked_properly} missing={submitAttempted && missing.truck_parked_properly} onChange={v => update('arrival', 'truck_parked_properly', v)} disabled={isReadOnly} />
        <ChecklistRow label="Who is the Crew Lead for this job?" required checked={data.arrival.crew_lead_confirmed} missing={submitAttempted && missing.crew_lead_confirmed} onChange={v => update('arrival', 'crew_lead_confirmed', v)} disabled={isReadOnly} />
        <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-3 pl-7">
          <div className="space-y-1">
            <Label className="text-xs">Crew Lead Name <span className="text-red-500">*</span></Label>
            <Input value={data.arrival.crew_lead_name} onChange={e => update('arrival', 'crew_lead_name', e.target.value)} disabled={isReadOnly} placeholder="Name" className={submitAttempted && missing.crew_lead_name ? 'border-red-400' : ''} />
            {submitAttempted && missing.crew_lead_name && <p className="text-xs text-red-500">Required</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Crew Lead Phone <span className="text-red-500">*</span></Label>
            <Input value={data.arrival.crew_lead_phone} onChange={e => update('arrival', 'crew_lead_phone', e.target.value)} disabled={isReadOnly} placeholder="Phone" className={submitAttempted && missing.crew_lead_phone ? 'border-red-400' : ''} />
            {submitAttempted && missing.crew_lead_phone && <p className="text-xs text-red-500">Required</p>}
          </div>
        </div>
      </Section>

      {/* Section: Protect Yourself — Take Photos First */}
      <Section title="Protect Yourself — Take Photos First" icon={Camera}>
        <p className="text-xs text-slate-500 italic -mt-1">Do this BEFORE you move or touch anything. These photos protect you if there is ever a problem or a claim.</p>
        <PhotoUpload label='Take a "before" video and photos of the whole work area' required missing={submitAttempted && missing.before_video_photos} photos={data.documentation.before_video_photos} onChange={urls => update('documentation', 'before_video_photos', urls)} disabled={isReadOnly} />
        <PhotoUpload label="Take photos of all customer furniture and belongings before you move them" required missing={submitAttempted && missing.furniture_photos} photos={data.documentation.furniture_photos} onChange={urls => update('documentation', 'furniture_photos', urls)} disabled={isReadOnly} />
        <PhotoUpload label="Take detailed photos of the refrigerator and any other appliances you will move or touch (look for dents and scratches first)" required missing={submitAttempted && missing.appliance_photos} photos={data.documentation.appliance_photos} onChange={urls => update('documentation', 'appliance_photos', urls)} disabled={isReadOnly} />
      </Section>

      {/* Section: Check the Job Before You Start */}
      <Section title="Check the Job Before You Start" icon={CheckCircle2}>
        <ChecklistRow label="Did you measure the job?" required checked={data.verification.measured_job} missing={submitAttempted && missing.measured_job} onChange={v => update('verification', 'measured_job', v)} disabled={isReadOnly} />
        <ChecklistRow label="Did you check all materials against the work order? (Right product, style, color, and amount)" required checked={data.verification.materials_verified} missing={submitAttempted && missing.materials_verified} onChange={v => update('verification', 'materials_verified', v)} disabled={isReadOnly} />

        {/* Material shortage conditional */}
        <div className="ml-6 mt-1 p-3 bg-red-50 rounded-lg space-y-2">
          <ChecklistRow label="⛔ Is any material missing or wrong? → Stop. Tell your Field Manager before you start." checked={data.verification.material_shortage} onChange={v => update('verification', 'material_shortage', v)} disabled={isReadOnly} />
          {data.verification.material_shortage && (
            <div className="grid grid-cols-2 gap-3 pl-7">
              <div className="space-y-1">
                <Label className="text-xs">Shortage count <span className="text-red-500">*</span></Label>
                <Input type="number" value={data.verification.shortage_count} onChange={e => update('verification', 'shortage_count', parseInt(e.target.value) || 0)} disabled={isReadOnly} className={submitAttempted && missing.shortage_count ? 'border-red-400' : ''} />
                {submitAttempted && missing.shortage_count && <p className="text-xs text-red-500">Required</p>}
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Shortage details (alerts Install Coordinator + Order Entry) <span className="text-red-500">*</span></Label>
                <Textarea value={data.verification.shortage_notes} onChange={e => update('verification', 'shortage_notes', e.target.value)} disabled={isReadOnly} rows={2} className={submitAttempted && missing.shortage_notes ? 'border-red-400' : ''} />
                {submitAttempted && missing.shortage_notes && <p className="text-xs text-red-500">Required</p>}
              </div>
            </div>
          )}
        </div>

        <ChecklistRow label="Do all work areas match the work order?" required checked={data.verification.work_areas_verified} missing={submitAttempted && missing.work_areas_verified} onChange={v => update('verification', 'work_areas_verified', v)} disabled={isReadOnly} />
        <ChecklistRow label="Did you read the work order for special instructions or patterns?" required checked={data.verification.special_instructions_reviewed} missing={submitAttempted && missing.special_instructions_reviewed} onChange={v => update('verification', 'special_instructions_reviewed', v)} disabled={isReadOnly} />
        <ChecklistRow label="Are the transitions, stair materials, and quarter round / shoe molding on site?" required checked={data.verification.transitions_confirmed} missing={submitAttempted && missing.transitions_confirmed} onChange={v => update('verification', 'transitions_confirmed', v)} disabled={isReadOnly} />
        <ChecklistRow label="Did you confirm the furniture plan with the customer?" required checked={data.verification.furniture_plan_confirmed} missing={submitAttempted && missing.furniture_plan_confirmed} onChange={v => update('verification', 'furniture_plan_confirmed', v)} disabled={isReadOnly} />
      </Section>

      {/* Section: Safety — Asbestos (STOP) */}
      <Section title="Safety — Asbestos (STOP)" icon={ShieldAlert} warning>
        <ChecklistRow label="Did you check the home for asbestos?" checked={data.safety.asbestos_checked} onChange={v => update('safety', 'asbestos_checked', v)} disabled={isReadOnly} />
        <div className="ml-6 mt-1 p-3 bg-red-50 rounded-lg">
          <ChecklistRow label="⛔ Do you think there is asbestos? → STOP the job right away. Do not cut, sand, or move it. Call your Field Manager now." checked={data.safety.asbestos_suspected} onChange={v => update('safety', 'asbestos_suspected', v)} disabled={isReadOnly} />
          {data.safety.asbestos_suspected && (
            <p className="text-xs text-red-600 pl-7 mt-1">
              Installation stops until customer engages a licensed abatement company and provides a clearance certificate. Per signed acknowledgment, Floor Daddy does not proceed.
            </p>
          )}
        </div>
      </Section>

      {/* Section: Site Care */}
      <Section title="Site Care" icon={CheckCircle2}>
        <PhotoUpload label="Did you take photos of everything covered before demo?" required missing={submitAttempted && missing.coverings_photos} photos={data.site_care.coverings_photos} onChange={urls => update('site_care', 'coverings_photos', urls)} disabled={isReadOnly} />
        <ChecklistRow label="Did you demo carefully and leave one working toilet for the customer?" required checked={data.site_care.careful_demolition} missing={submitAttempted && missing.careful_demolition} onChange={v => update('site_care', 'careful_demolition', v)} disabled={isReadOnly} />
        <ChecklistRow label="Trash plan: Never use the customer's trash can. Take all trash to the warehouse dumpster or the dump." required checked={data.site_care.trash_plan_acknowledged} missing={submitAttempted && missing.trash_plan_acknowledged} onChange={v => update('site_care', 'trash_plan_acknowledged', v)} disabled={isReadOnly} />
        <ChecklistRow label="Respect the home: Take breaks the right way. Never sit on customer furniture. Never take gifts. Never move personal items unless the furniture plan says so." required checked={data.site_care.conduct_standards_acknowledged} missing={submitAttempted && missing.conduct_standards_acknowledged} onChange={v => update('site_care', 'conduct_standards_acknowledged', v)} disabled={isReadOnly} />
        <PhotoUpload label="Did you take photos during demo?" required missing={submitAttempted && missing.demo_photos} photos={data.site_care.demo_photos} onChange={urls => update('site_care', 'demo_photos', urls)} disabled={isReadOnly} />
      </Section>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        {!isReadOnly && (
          <>
            {!isValid && (
              <p className="text-xs text-amber-600 mr-auto">
                {missingCount} required field{missingCount === 1 ? '' : 's'} remaining
              </p>
            )}
            <Button onClick={handleSubmit} disabled={saving || !isValid} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit for Approval
            </Button>
          </>
        )}
        {checkpoint?.status === 'SubmittedForApproval' && !installerMode && (
          <>
            <Button variant="outline" onClick={handleReject} disabled={saving} className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
              <XCircle className="w-4 h-4" />
              Reject
            </Button>
            <Button onClick={handleApprove} disabled={saving || asbestosHalt} className="gap-2 bg-green-600 hover:bg-green-700">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Approve & Advance
            </Button>
          </>
        )}
        {checkpoint?.status === 'SubmittedForApproval' && asbestosHalt && !installerMode && (
          <p className="text-xs text-red-600 mr-auto">Cannot approve — asbestos hard stop active</p>
        )}
      </div>
    </div>
  );
}