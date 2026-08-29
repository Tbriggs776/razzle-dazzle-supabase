import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { compressImage } from '@/lib/compressImage';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, CheckCircle2, XCircle, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import PhotoLightboxModal from './PhotoLightboxModal';
import { SignedImage } from '@/lib/fileUrl';
import { toast } from 'sonner';

function ChecklistRow({ label, checked, onChange, disabled, required, missing }) {
  return (
    <label className={cn("flex items-start gap-3 py-2 rounded-md px-1 -mx-1 transition-colors", !disabled && "cursor-pointer", missing && "bg-crit/10 ring-1 ring-crit/30")}>
      <Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
      <span className={cn("text-sm", disabled ? "text-muted-foreground/70" : "text-foreground")}>
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
    <div className={cn("space-y-2 rounded-md px-1 -mx-1 py-1 transition-colors", missing && "bg-crit/10 ring-1 ring-crit/30")}>
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

function Section({ title, icon: Icon, children, warning, accent }) {
  return (
    <div className={cn(
      "rounded-xl border p-4 space-y-2",
      warning ? "border-crit/30 bg-crit/10" :
      accent ? "border-info/30 bg-info/10" :
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

export default function InstallationChecklist({ checkpoint, projectId, installerMode }) {
  const { t } = useLanguage();
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
      const res = await base44.functions.invoke('submitCheckpoint', {
        action: 'submit_install',
        checkpoint_id: checkpoint?.id,
        project_id: projectId,
        step_key: 'installation_checklist',
        checklist_data: data,
      });
      // invoke() returns { data, error } (no throw for deployed fns) — surface backend errors.
      if (res.error || res.data?.error) {
        toast.error(res.data?.error || 'Failed to submit. Please try again.');
        setSaving(false);
        return;
      }
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
        <div className="bg-good/10 border border-good/30 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-good shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-good">Installation Complete</p>
            <p className="text-xs text-muted-foreground">Install Coordinator has been notified. You're ready for the Final Walk Through.</p>
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

      {/* Installation — All Floor Types */}
      <Section title={t('ickSecAll')} icon={CheckCircle2}>
        <ChecklistRow label={t('ickConfirmLayout')} required checked={data.install_core.product_layout_confirmed} missing={submitAttempted && missing.product_layout_confirmed} onChange={v => update('install_core', 'product_layout_confirmed', v)} disabled={readOnly} />
        <PhotoUpload label={t('ickProgressPhotos')} required missing={submitAttempted && missing.install_photos} photos={data.install_core.install_photos} onChange={urls => update('install_core', 'install_photos', urls)} disabled={readOnly} />
        <ChecklistRow label={t('ickDailyClean')} required checked={data.install_core.work_area_cleaned_daily} missing={submitAttempted && missing.work_area_cleaned_daily} onChange={v => update('install_core', 'work_area_cleaned_daily', v)} disabled={readOnly} />
      </Section>

      {/* Installation — Hard Surface (LVP / Laminate / Wood) */}
      <Section
        title={t('ickSecHard')}
        icon={CheckCircle2}
        warning={isEditable && data.install_hard_surface.applies && !expansionGateMet}
      >
        <div className="ml-6 p-3 bg-muted rounded-lg">
          <ChecklistRow label={t('ickApplies')} checked={data.install_hard_surface.applies} onChange={v => update('install_hard_surface', 'applies', v)} disabled={readOnly} />
        </div>
        {data.install_hard_surface.applies && (
          <>
            <ChecklistRow label={t('ickExpansionGaps')} required checked={data.install_hard_surface.expansion_gaps_correct} missing={submitAttempted && missing.expansion_gaps_correct} onChange={v => update('install_hard_surface', 'expansion_gaps_correct', v)} disabled={readOnly} />
            <div className={cn("rounded-lg p-3", !expansionGateMet ? "bg-crit/10 border border-crit/30" : "bg-muted")}>
              <PhotoUpload
                label={t('ickGapPhotos')}
                photos={data.install_hard_surface.expansion_gap_photos}
                onChange={urls => update('install_hard_surface', 'expansion_gap_photos', urls)}
                disabled={readOnly}
                required
                missing={submitAttempted && missing.expansion_gap_photos}
              />
              {!expansionGateMet && (
                <p className="text-xs text-crit font-medium mt-1">⚠️ The job cannot move forward until these are uploaded.</p>
              )}
              {expansionGateMet && (
                <p className="text-xs text-good mt-1">✓ Photos uploaded — gate cleared.</p>
              )}
            </div>
            <ChecklistRow label={t('ickTMolding')} required checked={data.install_hard_surface.t_molding_transitions} missing={submitAttempted && missing.t_molding_transitions} onChange={v => update('install_hard_surface', 't_molding_transitions', v)} disabled={readOnly} />
            <PhotoUpload label={t('ickUnderlayment')} photos={data.install_hard_surface.underlayment_photos} onChange={urls => update('install_hard_surface', 'underlayment_photos', urls)} disabled={readOnly} />
          </>
        )}
      </Section>

      {/* Installation — Carpet (Unlocks if the job includes carpet) */}
      <Section title={t('ickSecCarpet')} icon={Layers}>
        <div className="ml-6 p-3 bg-muted rounded-lg">
          <ChecklistRow label={t('ickApplies')} checked={data.install_carpet.applies} onChange={v => update('install_carpet', 'applies', v)} disabled={readOnly} />
        </div>
        {data.install_carpet.applies && (
          <p className="text-xs text-muted-foreground pl-7">Carpet-specific checkpoints to be defined.</p>
        )}
      </Section>

      {/* Installation — Tile (Unlocks if the job includes tile) */}
      <Section title={t('ickSecTile')} icon={Layers}>
        <div className="ml-6 p-3 bg-muted rounded-lg">
          <ChecklistRow label={t('ickApplies')} checked={data.install_tile.applies} onChange={v => update('install_tile', 'applies', v)} disabled={readOnly} />
        </div>
        {data.install_tile.applies && (
          <p className="text-xs text-muted-foreground pl-7">Tile-specific checkpoints to be defined.</p>
        )}
      </Section>

      {/* Action: Complete Installation */}
      {isEditable && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {!valid && (
            <p className="text-xs text-warn mr-auto">
              {missingCount} required field{missingCount === 1 ? '' : 's'} remaining
            </p>
          )}
          {/* Affirmative "complete" action keeps its green reading, but on the semantic good
              token so it tracks the theme. --good has no paired foreground token, so the label
              colour is a choice: text-white here follows the existing app-wide filled-semantic-
              button convention (MyTasks.jsx, ProjectDetail.jsx, and the two buttons in
              FinalWalkthroughChecklist.jsx). NOTE it is not an accessible choice in dark mode —
              white on --good (152 52% 54%) measures 2.13:1, vs 3.71:1 in light. text-background
              would give 8.92:1 dark / 3.62:1 light, which is what JobStartChecklist.jsx's approve
              button uses. Left as-is only because changing it here alone would split the
              convention; it needs one kit-wide decision, not a per-file fix. */}
          <Button onClick={handleSubmit} disabled={saving || !valid} className="gap-2 bg-good text-background hover:bg-good/90">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Complete Installation
          </Button>
        </div>
      )}
    </div>
  );
}