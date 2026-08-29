import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, MapPin, User, Calendar, Loader2, Building2, HardHat, Globe } from 'lucide-react';
import CheckpointProgressTracker from '@/components/journey/CheckpointProgressTracker';
import JobStartChecklist from '@/components/journey/checklists/JobStartChecklist';
import PreInstallChecklistView from '@/components/journey/checklists/PreInstallChecklistView';
import FloorPrepChecklist from '@/components/journey/checklists/FloorPrepChecklist';
import FinalWalkthroughChecklist from '@/components/journey/checklists/FinalWalkthroughChecklist';
import InstallationChecklist from '@/components/journey/checklists/InstallationChecklist';
import { LanguageProvider, useLanguage } from '@/lib/i18n/LanguageContext';

function JourneyProjectDetailInner() {
  const { t, language, changeLanguage } = useLanguage();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  // Accept BOTH names. The page only ever read `project_id`, but seven link sites
  // — including the asbestos hard-stop alert and the COD-hold notice, the two
  // things that must never fail to open — emit `?id=`. Fixing it here rather than
  // at those seven sites also repairs notifications ALREADY SENT and sitting in
  // the inbox, whose URLs cannot be rewritten.
  const projectId = urlParams.get('project_id') || urlParams.get('id');

  const [activeStep, setActiveStep] = useState('job_start_checklist');
  const [assigning, setAssigning] = useState(false);
  const installerMode = urlParams.get('mode') === 'installer';

  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: project, isLoading: projectLoading, isError: projectError } = useQuery({
    queryKey: ['journeyProject', projectId],
    queryFn: () => base44.entities.Project.get(projectId),
    enabled: !!projectId,
  });

  const { data: installers = [] } = useQuery({
    queryKey: ['installers'],
    queryFn: () => base44.entities.Installer.filter({ is_active: true }),
    enabled: !!projectId,
  });

  const handleAssignInstaller = async (crewId) => {
    if (!crewId) return;
    setAssigning(true);
    try {
      const installer = installers.find(i => String(i.crew_id) === crewId);
      await base44.entities.Project.update(projectId, {
        installer_crew_id: crewId,
        installer_crew_name: installer?.crew_name || crewId,
      });
      queryClient.invalidateQueries({ queryKey: ['journeyProject', projectId] });
      try {
        await base44.functions.invoke('notifyInstallerAssigned', { project_id: projectId, crew_id: crewId });
      } catch (e) {
        console.error('Installer notification failed', e);
      }
    } catch (e) {
      console.error('Failed to assign installer', e);
    } finally {
      setAssigning(false);
    }
  };

  const { data: customer } = useQuery({
    queryKey: ['journeyProjectCustomer', project?.customer],
    queryFn: () => base44.entities.Customer.get(project.customer),
    enabled: !!project?.customer,
  });

  const { data: sale } = useQuery({
    queryKey: ['journeyProjectSale', project?.sale],
    queryFn: () => base44.entities.Sale.get(project.sale),
    enabled: !!project?.sale,
  });

  const { data: checkpoints = [], isLoading: checkpointsLoading } = useQuery({
    queryKey: ['projectCheckpoints', projectId],
    queryFn: () => base44.entities.ProjectCheckpoint.filter({ project_id: projectId }),
    enabled: !!projectId,
  });

  const preInstallComplete = !!(project?.pre_install_checklist_signature_url && project?.pre_install_product_info) || !!(sale?.pre_install_checklist_signature_url && sale?.pre_install_product_info);

  const isStepComplete = (key) => {
    if (key === 'pre_install_checklist') return preInstallComplete;
    const cp = checkpoints.find(c => c.step_key === key);
    return cp?.status === 'Completed';
  };

  const defaultStep = isStepComplete('pre_install_checklist')
    ? isStepComplete('job_start_checklist')
      ? isStepComplete('floor_prep_checklist')
        ? isStepComplete('installation_checklist')
          ? 'final_walkthrough_checklist'
          : 'installation_checklist'
        : 'floor_prep_checklist'
      : 'job_start_checklist'
    : 'pre_install_checklist';

  useEffect(() => {
    setActiveStep(defaultStep);
  }, [defaultStep]);

  if (userLoading || projectLoading || checkpointsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // A failed fetch is NOT "no such project". Saying the wrong one sends a Field
  // Manager hunting for a job they think was deleted, when the real answer is one
  // bar of signal. refetchOnWindowFocus is off globally, so it never self-corrects.
  if (projectError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h2 className="mb-2 text-xl font-semibold text-foreground">{t('jpdLoadFailed')}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t('jpdLoadFailedBody')}</p>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['journeyProject', projectId] })}
            className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-muted"
          >
            {t('jpdRetry')}
          </button>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">{t('jpdProjectNotFound')}</h2>
          <Link to="/Journey" className="text-primary hover:underline">← {t('jpdBackJourney')}</Link>
        </div>
      </div>
    );
  }

  const activeCheckpoint = checkpoints.find(c => c.step_key === activeStep);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-4 sm:px-6 lg:px-8 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-3 flex items-center justify-between gap-3">
            <Link to={installerMode ? "/Journey?view=installer" : "/Journey"} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
              {installerMode ? t('jpdBackInstaller') : t('jpdBackJourney')}
            </Link>

            {/* The EN/ES toggle lived ONLY in the Journey sidebar — but the crew's
                assignment SMS deep-links straight to THIS page, so a Spanish-speaking
                installer arrived on the one screen that had no way to switch, and the
                checklist below is the whole job. 44px targets, because this is used
                on a phone. */}
            <div className="flex shrink-0 items-center gap-1">
              <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {['en', 'es'].map((lng) => (
                <button
                  key={lng}
                  type="button"
                  onClick={() => changeLanguage(lng)}
                  aria-pressed={language === lng}
                  className={cn(
                    'min-h-11 min-w-11 rounded px-2 text-[11px] font-medium transition-all',
                    language === lng ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {lng.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {customer?.first_name} {customer?.last_name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                {(customer?.address_line1 || sale?.location_address) && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {customer?.address_line1
                      ? `${customer.address_line1}, ${customer.city} ${customer.state}`
                      : sale.location_address}
                  </span>
                )}
                {sale?.invoice_number && (
                  <span className="flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5" />
                    {t('jpdJob', { number: sale.invoice_number })}
                    </span>
                )}
                {project.installation_date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {t('jpdInstall', { date: new Date(project.installation_date).toLocaleDateString() })}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right space-y-2">
              <span className="inline-block px-3 py-1 bg-secondary text-muted-foreground rounded-full text-xs font-medium">
                {project.status}
              </span>
              {installerMode ? (
                project.installer_crew_name && (
                  <div className="flex items-center gap-1.5 justify-end">
                    <HardHat className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{project.installer_crew_name}</span>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-1.5">
                  <HardHat className="w-3.5 h-3.5 text-muted-foreground" />
                  <select
                    value={project.installer_crew_id || ''}
                    onChange={e => handleAssignInstaller(e.target.value)}
                    disabled={assigning}
                    className="text-xs border border-border rounded-md px-2 py-1 bg-card text-foreground"
                  >
                    <option value="">{t('jpdAssignInstaller')}</option>
                    {installers.map(i => (
                      <option key={i.crew_id} value={String(i.crew_id)}>{i.crew_name}</option>
                    ))}
                  </select>
                  {assigning && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Progress Tracker */}
      <div className="bg-card border-b border-border px-4 sm:px-6 lg:px-8 py-3">
        <div className="max-w-4xl mx-auto">
          <CheckpointProgressTracker
            checkpoints={checkpoints}
            activeStep={activeStep}
            onStepClick={setActiveStep}
            preInstallComplete={preInstallComplete}
          />
        </div>
      </div>

      {/* Active Step Content */}
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          {activeStep === 'job_start_checklist' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t('jpdJobStartTitle')}</h2>
                <p className="text-sm text-muted-foreground">{t('jpdJobStartDesc')}</p>
              </div>
              <JobStartChecklist
                checkpoint={activeCheckpoint}
                projectId={projectId}
                installerMode={installerMode}
              />
            </div>
          )}

          {activeStep === 'pre_install_checklist' && (
            <PreInstallChecklistView
              project={project}
              sale={sale}
              customer={customer}
              installerMode={installerMode}
            />
          )}

          {activeStep === 'floor_prep_checklist' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t('jpdFloorPrepTitle')}</h2>
                <p className="text-sm text-muted-foreground">{t('jpdFloorPrepDesc')}</p>
              </div>
              <FloorPrepChecklist
                checkpoint={activeCheckpoint}
                projectId={projectId}
                installerMode={installerMode}
              />
            </div>
          )}

          {activeStep === 'installation_checklist' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Installation</h2>
                <p className="text-sm text-muted-foreground">Prep is approved — now let's lay a floor the customer brags about, Crew Lead. This is the part they see every day for years, so make every row tight and every detail clean. Work through each step in order. When you finish, you'll move to the Final Walk Through.</p>
              </div>
              <InstallationChecklist
                checkpoint={activeCheckpoint}
                projectId={projectId}
                installerMode={installerMode}
              />
            </div>
          )}

          {activeStep === 'final_walkthrough_checklist' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t('jpdFinalWalkTitle')}</h2>
                <p className="text-sm text-muted-foreground">{t('jpdFinalWalkDesc')}</p>
              </div>
              <FinalWalkthroughChecklist
                checkpoint={activeCheckpoint}
                projectId={projectId}
                installerMode={installerMode}
              />
            </div>
          )}
          </div>
          </div>
          </div>
          );
          }

          export default function JourneyProjectDetail() {
          return (
          <LanguageProvider>
          <JourneyProjectDetailInner />
          </LanguageProvider>
          );
          }