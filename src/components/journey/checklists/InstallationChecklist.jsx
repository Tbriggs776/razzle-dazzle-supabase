import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, CheckCircle2, XCircle, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import PhotoLightboxModal from './PhotoLightboxModal';
import { toast } from 'sonner';

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

export default function InstallationChecklist({ checkpoint, projectId, installerMode }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const existingData = checkpoint?.checklist_data || {};
  const status = checkpoint?.status;

  const isEditable = !status || status === 'Pending' || status === 'Rejected';
  const isCompleted = status === 'Completed';
  const readOnly = !isEditable;

  const [data, setData] = useState({
    install_core: {
      product_layout_confirmed: existingData.install_core?.product_layout_confirmed || false,
      install_photos: existingData.install_core?.install_photos || [],
      work_area_cleaned_daily: existingData.install_core?.work_area_cleaned_daily || false,
    },
    install_hard_surface: {
      applies: existingData.install_hard_surface?.applies || false,
      expansion_gaps_correct: existingData.install_hard_surface?.expansion_gaps_correct || false,
      expansion_gap_photos: existingData.install_hard_surface?.expansion_gap_photos || [],
      t_molding_transitions: existingData.install_hard_surface?.t_molding_transitions || false,
      underlayment_photos: existingData.install_hard_surface?.underlayment_photos || [],
    },
    install_carpet: { applies: existingData.install_carpet?.applies || false },
    install_tile: { applies: existingData.install_tile?.applies || false },
  });

  const update = (section, field, value) => {
    if (readOnly) return;
    setSubmitAttempted(false);
    setData(d => ({ ...d, [section]: { ...d[section], [field]: value } }));
  };

  // Expansion gap photo gate (hard upload gate)
  const expansionGateMet = !data.install_hard_surface.applies || data.install_hard_surface.expansion_gap_photos.length > 0;

  const missing = useMemo(() => ({
    product_layout_confirmed: !data.install_core.product_layout_confirmed,
    install_photos: data.install_core.install_photos.length === 0,
    work_area_cleaned_daily: !data.install_core.work_area_cleaned_daily,
    expansion_gaps_correct: data.install_hard_surface.applies && !data.install_hard_surface.expansion_gaps_correct,
    expansion_gap_photos: data.install_hard_surface.applies && data.install_hard_surface.expansion_gap_photos.length === 0,
    t_molding_transitions: data.install_hard_surface.applies && !data.install_hard_surface.t_molding_transitions,
  }), [data]);
  const missingCount = Object.values(missing).filter(Boolean).length;
  const valid = missingCount === 0;

  const handleSubmit = async () => {
    if (!valid) {
      setSubmitAttempted(true);
      return;
    }
    setSaving(true);
    try {
      await base44.functions.invoke('submitCheckpoint', {
        action: 'submit_install',
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'installation_checklist',
        checklist_data: data,
      });
      queryClient.invalidateQueries({ queryKey: ['projectCheckpoints', projectId] });
    } catch (e) {
      console.error('Submit failed', e);
      toast.error('Failed to submit. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status banners */}
      {isCompleted && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800">Installation Complete</p>
            <p className="text-xs text-green-600">Install Coordinator has been notified. You're ready for the Final Walk Through.</p>
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

      {/* Installation — All Floor Types */}
      <Section title="Installation — All Floor Types" icon={CheckCircle2}>
        <ChecklistRow label="Did you confirm the product and layout with the homeowner? (If they are home)" required checked={data.install_core.product_layout_confirmed} missing={submitAttempted && missing.product_layout_confirmed} onChange={v => update('install_core', 'product_layout_confirmed', v)} disabled={readOnly} />
        <PhotoUpload label="Take photos during installation" required missing={submitAttempted && missing.install_photos} photos={data.install_core.install_photos} onChange={urls => update('install_core', 'install_photos', urls)} disabled={readOnly} />
        <ChecklistRow label="Is the work area cleaned at the end of every day?" required checked={data.install_core.work_area_cleaned_daily} missing={submitAttempted && missing.work_area_cleaned_daily} onChange={v => update('install_core', 'work_area_cleaned_daily', v)} disabled={readOnly} />
      </Section>

      {/* Installation — Hard Surface (LVP / Laminate / Wood) */}
      <Section
        title="Installation — Hard Surface (LVP / Laminate / Wood)"
        icon={CheckCircle2}
        warning={isEditable && data.install_hard_surface.applies && !expansionGateMet}
      >
        <div className="ml-6 p-3 bg-slate-50 rounded-lg">
          <ChecklistRow label="Does this apply to this job?" checked={data.install_hard_surface.applies} onChange={v => update('install_hard_surface', 'applies', v)} disabled={readOnly} />
        </div>
        {data.install_hard_surface.applies && (
          <>
            <ChecklistRow label="Are expansion gaps correct around the whole edge and around all fixed objects? (Follow the spec)" required checked={data.install_hard_surface.expansion_gaps_correct} missing={submitAttempted && missing.expansion_gaps_correct} onChange={v => update('install_hard_surface', 'expansion_gaps_correct', v)} disabled={readOnly} />
            <div className={cn("rounded-lg p-3", !expansionGateMet ? "bg-red-50 border border-red-200" : "bg-slate-50")}>
              <PhotoUpload
                label="⛔ Upload photos of your expansion gaps / spacers — HARD UPLOAD GATE"
                photos={data.install_hard_surface.expansion_gap_photos}
                onChange={urls => update('install_hard_surface', 'expansion_gap_photos', urls)}
                disabled={readOnly}
                required
                missing={submitAttempted && missing.expansion_gap_photos}
              />
              {!expansionGateMet && (
                <p className="text-xs text-red-600 font-medium mt-1">⚠️ The job cannot move forward until these are uploaded.</p>
              )}
              {expansionGateMet && (
                <p className="text-xs text-green-600 mt-1">✓ Photos uploaded — gate cleared.</p>
              )}
            </div>
            <ChecklistRow label="For laminate runs over 1,000 sq ft: Are T-molding transitions placed where required?" required checked={data.install_hard_surface.t_molding_transitions} missing={submitAttempted && missing.t_molding_transitions} onChange={v => update('install_hard_surface', 't_molding_transitions', v)} disabled={readOnly} />
            <PhotoUpload label="Add photos of underlayment (if you did not already do this in prep)" photos={data.install_hard_surface.underlayment_photos} onChange={urls => update('install_hard_surface', 'underlayment_photos', urls)} disabled={readOnly} />
          </>
        )}
      </Section>

      {/* Installation — Carpet (Unlocks if the job includes carpet) */}
      <Section title="Installation — Carpet (Unlocks if the job includes carpet)" icon={Layers}>
        <div className="ml-6 p-3 bg-slate-50 rounded-lg">
          <ChecklistRow label="Does this apply to this job?" checked={data.install_carpet.applies} onChange={v => update('install_carpet', 'applies', v)} disabled={readOnly} />
        </div>
        {data.install_carpet.applies && (
          <p className="text-xs text-slate-500 pl-7">Carpet-specific checkpoints to be defined.</p>
        )}
      </Section>

      {/* Installation — Tile (Unlocks if the job includes tile) */}
      <Section title="Installation — Tile (Unlocks if the job includes tile)" icon={Layers}>
        <div className="ml-6 p-3 bg-slate-50 rounded-lg">
          <ChecklistRow label="Does this apply to this job?" checked={data.install_tile.applies} onChange={v => update('install_tile', 'applies', v)} disabled={readOnly} />
        </div>
        {data.install_tile.applies && (
          <p className="text-xs text-slate-500 pl-7">Tile-specific checkpoints to be defined.</p>
        )}
      </Section>

      {/* Action: Complete Installation */}
      {isEditable && (
        <div className="flex items-center justify-end gap-2 pt-2">
          {!valid && (
            <p className="text-xs text-amber-600 mr-auto">
              {missingCount} required field{missingCount === 1 ? '' : 's'} remaining
            </p>
          )}
          <Button onClick={handleSubmit} disabled={saving || !valid} className="gap-2 bg-green-600 hover:bg-green-700">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Complete Installation
          </Button>
        </div>
      )}
    </div>
  );
}