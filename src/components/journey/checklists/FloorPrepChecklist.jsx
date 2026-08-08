import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Send, CheckCircle2, XCircle, Lock, DollarSign, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import FieldManagerNotificationBadge from './FieldManagerNotificationBadge';
import PhotoLightboxModal from './PhotoLightboxModal';

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

export default function FloorPrepChecklist({ checkpoint, projectId, installerMode }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [fmAcknowledged, setFmAcknowledged] = useState(false);

  const existingData = checkpoint?.checklist_data || {};
  const status = checkpoint?.status;

  // Phase determination
  const isPrepPhase = !status || status === 'Pending' || status === 'Rejected';
  const isReviewPhase = status === 'SubmittedForApproval';
  const isApproved = status === 'Completed' || status === 'PrepApproved';

  const prepReadOnly = !isPrepPhase;

  const [data, setData] = useState({
    prep: {
      moisture_reading_photos: existingData.prep?.moisture_reading_photos || [],
      moisture_reading_value: existingData.prep?.moisture_reading_value || '',
      subfloor_flat_level: existingData.prep?.subfloor_flat_level || false,
      floor_patch_complete: existingData.prep?.floor_patch_complete || false,
      grinding_complete: existingData.prep?.grinding_complete || false,
      self_leveler_used: existingData.prep?.self_leveler_used || false,
      self_leveler_dry_time: existingData.prep?.self_leveler_dry_time || false,
      second_moisture_reading_photos: existingData.prep?.second_moisture_reading_photos || [],
      debris_removed: existingData.prep?.debris_removed || false,
      floor_prep_photos: existingData.prep?.floor_prep_photos || [],
      underlayment_photos: existingData.prep?.underlayment_photos || [],
    },
    change_order: {
      is_chargeable: existingData.change_order?.is_chargeable || false,
      called_in_before_work: existingData.change_order?.called_in_before_work || false,
      what_prep: existingData.change_order?.what_prep || '',
      amount: existingData.change_order?.amount || '',
    },
  });

  const update = (section, field, value) => {
    if (prepReadOnly) return;
    setSubmitAttempted(false);
    setData(d => ({ ...d, [section]: { ...d[section], [field]: value } }));
  };

  // Prep validation — all required fields
  const prepMissing = useMemo(() => ({
    moisture_reading_photos: data.prep.moisture_reading_photos.length === 0,
    moisture_reading_value: !data.prep.moisture_reading_value,
    subfloor_flat_level: !data.prep.subfloor_flat_level,
    floor_patch_complete: !data.prep.floor_patch_complete,
    grinding_complete: !data.prep.grinding_complete,
    self_leveler_dry_time: data.prep.self_leveler_used && !data.prep.self_leveler_dry_time,
    second_moisture_reading_photos: data.prep.second_moisture_reading_photos.length === 0,
    debris_removed: !data.prep.debris_removed,
    floor_prep_photos: data.prep.floor_prep_photos.length === 0,
    underlayment_photos: data.prep.underlayment_photos.length === 0,
  }), [data]);
  const prepMissingCount = Object.values(prepMissing).filter(Boolean).length;
  const prepValid = prepMissingCount === 0;

  // Change order validation (only when chargeable)
  const changeOrderMissing = useMemo(() => ({
    called_in_before_work: !data.change_order.called_in_before_work,
    what_prep: !data.change_order.what_prep,
    amount: !data.change_order.amount,
  }), [data]);
  const changeOrderMissingCount = data.change_order.is_chargeable
    ? Object.values(changeOrderMissing).filter(Boolean).length
    : 0;
  const changeOrderValid = changeOrderMissingCount === 0;

  const allValid = prepValid && changeOrderValid;
  const totalMissing = prepMissingCount + changeOrderMissingCount;

  const handleSubmitPrep = async () => {
    if (!allValid) {
      setSubmitAttempted(true);
      return;
    }
    setSaving(true);
    try {
      await base44.functions.invoke('submitCheckpoint', {
        action: 'submit',
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'floor_prep_checklist',
        checklist_data: { prep: data.prep, change_order: data.change_order },
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
    } catch (e) {
      console.error('Submit failed', e);
      toast.error('Failed to submit. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleApprovePrep = async () => {
    if (!fmAcknowledged) return;
    setSaving(true);
    try {
      await base44.functions.invoke('submitCheckpoint', {
        action: 'approve_prep',
        checkpoint_id: checkpoint.id,
        project_id: projectId,
        step_key: 'floor_prep_checklist',
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
    } catch (e) {
      console.error('Approve prep failed', e);
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
        step_key: 'floor_prep_checklist',
        rejection_notes: notes,
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
    } catch (e) {
      console.error('Reject failed', e);
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
              <p className="text-sm font-medium text-amber-800">HARD LOCK — Prep Submitted, FM Approval Required</p>
              <p className="text-xs text-amber-600">
                Floor cannot be installed until the Field Manager reviews prep + photos and approves in-app.
                Submitted by {checkpoint.submitted_by_name} on {new Date(checkpoint.submitted_date).toLocaleString()}
              </p>
            </div>
          </div>
          {!installerMode && <FieldManagerNotificationBadge checkpoint={checkpoint} />}
        </div>
      )}
      {isApproved && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800">Floor Prep Approved</p>
            <p className="text-xs text-green-600">
              Approved by {existingData.prep_approved_by_name || 'Field Manager'}
              {existingData.prep_approved_date ? ` on ${new Date(existingData.prep_approved_date).toLocaleString()}` : ''}.
              Prep is complete — installation is unlocked as the next step.
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

      {/* Floor Prep — Verification (Crew Lead QC) */}
      <Section title="Floor Prep — Verification (Crew Lead QC)" icon={CheckCircle2}>
        <PhotoUpload
          label="Take a moisture reading — photo of the meter"
          photos={data.prep.moisture_reading_photos}
          onChange={urls => update('prep', 'moisture_reading_photos', urls)}
          disabled={prepReadOnly}
          required
          missing={submitAttempted && prepMissing.moisture_reading_photos}
        />
        <div className="space-y-1">
          <Label className="text-xs">Moisture reading number <span className="text-red-500">*</span></Label>
          <Input
            value={data.prep.moisture_reading_value}
            onChange={e => update('prep', 'moisture_reading_value', e.target.value)}
            disabled={prepReadOnly}
            placeholder="e.g., 3.2%"
            className={submitAttempted && prepMissing.moisture_reading_value ? 'border-red-400' : ''}
          />
        </div>
        <ChecklistRow label="Is the subfloor flat and level? (Check before you start)" required checked={data.prep.subfloor_flat_level} missing={submitAttempted && prepMissing.subfloor_flat_level} onChange={v => update('prep', 'subfloor_flat_level', v)} disabled={prepReadOnly} />
        <ChecklistRow label="Is floor patching complete?" required checked={data.prep.floor_patch_complete} missing={submitAttempted && prepMissing.floor_patch_complete} onChange={v => update('prep', 'floor_patch_complete', v)} disabled={prepReadOnly} />
        <ChecklistRow label="Is grinding complete?" required checked={data.prep.grinding_complete} missing={submitAttempted && prepMissing.grinding_complete} onChange={v => update('prep', 'grinding_complete', v)} disabled={prepReadOnly} />
        <div className="ml-6 p-3 bg-slate-50 rounded-lg space-y-2">
          <ChecklistRow label="Did you use self-leveler?" checked={data.prep.self_leveler_used} onChange={v => update('prep', 'self_leveler_used', v)} disabled={prepReadOnly} />
          {data.prep.self_leveler_used && (
            <ChecklistRow label="Did you give it enough time to fully dry?" required checked={data.prep.self_leveler_dry_time} missing={submitAttempted && prepMissing.self_leveler_dry_time} onChange={v => update('prep', 'self_leveler_dry_time', v)} disabled={prepReadOnly} />
          )}
        </div>
        <PhotoUpload label="Second moisture reading (after prep is done) — add a photo" required missing={submitAttempted && prepMissing.second_moisture_reading_photos} photos={data.prep.second_moisture_reading_photos} onChange={urls => update('prep', 'second_moisture_reading_photos', urls)} disabled={prepReadOnly} />
        <ChecklistRow label="Is all debris removed and the work area clean?" required checked={data.prep.debris_removed} missing={submitAttempted && prepMissing.debris_removed} onChange={v => update('prep', 'debris_removed', v)} disabled={prepReadOnly} />
        <PhotoUpload label="Add photos of all floor prep" required missing={submitAttempted && prepMissing.floor_prep_photos} photos={data.prep.floor_prep_photos} onChange={urls => update('prep', 'floor_prep_photos', urls)} disabled={prepReadOnly} />
        <PhotoUpload label="Add photos of any underlayment" required missing={submitAttempted && prepMissing.underlayment_photos} photos={data.prep.underlayment_photos} onChange={urls => update('prep', 'underlayment_photos', urls)} disabled={prepReadOnly} />
      </Section>

      {/* Billable Prep / Change Order */}
      <Section title="Billable Prep / Change Order" icon={DollarSign} warning={data.change_order.is_chargeable && !changeOrderValid}>
        <ChecklistRow
          label="Is there extra prep that needs to be charged? (Chargeable change order)"
          checked={data.change_order.is_chargeable}
          onChange={v => update('change_order', 'is_chargeable', v)}
          disabled={prepReadOnly}
        />
        {data.change_order.is_chargeable && (
          <div className="ml-6 space-y-3 border-l-2 border-slate-200 pl-4">
            <ChecklistRow
              label="Did you call it in for approval BEFORE doing the work?"
              required
              checked={data.change_order.called_in_before_work}
              missing={submitAttempted && changeOrderMissing.called_in_before_work}
              onChange={v => update('change_order', 'called_in_before_work', v)}
              disabled={prepReadOnly}
            />
            <div className="space-y-1">
              <Label className="text-xs">What prep is being charged for? <span className="text-red-500">*</span></Label>
              <Textarea
                value={data.change_order.what_prep}
                onChange={e => update('change_order', 'what_prep', e.target.value)}
                disabled={prepReadOnly}
                rows={2}
                placeholder="e.g., 200 sq ft of floor patch, self-leveler in kitchen"
                className={submitAttempted && changeOrderMissing.what_prep ? 'border-red-400' : ''}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount called in for approval ($) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                value={data.change_order.amount}
                onChange={e => update('change_order', 'amount', e.target.value)}
                disabled={prepReadOnly}
                placeholder="0.00"
                className={submitAttempted && changeOrderMissing.amount ? 'border-red-400' : ''}
              />
            </div>
            <p className="text-xs text-slate-500">Order Entry and Install Coordinator will be notified when submitted.</p>
          </div>
        )}
      </Section>

      {/* FM Gate — Review & approve */}
      {isReviewPhase && !installerMode && (
        <Section title="Field Manager Approval Gate" icon={ShieldCheck} accent>
          <p className="text-xs text-slate-600">
            When every item above is done, your Field Manager will review your prep photos and moisture readings and approve the job before you install.
          </p>
          <label className={cn("flex items-start gap-3 py-2 rounded-md px-1 -mx-1 cursor-pointer", !fmAcknowledged && "bg-amber-50 ring-1 ring-amber-200")}>
            <Checkbox checked={fmAcknowledged} onCheckedChange={setFmAcknowledged} className="mt-0.5" />
            <span className="text-sm text-slate-700">
              I reviewed the moisture readings and floor prep photos. Prep meets Floor Daddy standard. Approved to install.
            </span>
          </label>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={handleReject} disabled={saving} className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
              <XCircle className="w-4 h-4" /> Reject
            </Button>
            <Button onClick={handleApprovePrep} disabled={saving || !fmAcknowledged} className="gap-2 bg-blue-600 hover:bg-blue-700">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Approve Prep
            </Button>
          </div>
        </Section>
      )}

      {/* Action: Submit Prep */}
      {isPrepPhase && (
        <div className="flex items-center justify-end gap-2 pt-2">
          {!allValid && (
            <p className="text-xs text-amber-600 mr-auto">
              {totalMissing} required field{totalMissing === 1 ? '' : 's'} remaining
            </p>
          )}
          <Button onClick={handleSubmitPrep} disabled={saving || !allValid} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit for Field Manager Approval
          </Button>
        </div>
      )}
    </div>
  );
}