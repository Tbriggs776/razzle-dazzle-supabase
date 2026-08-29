import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, MapPin, Calendar, ChevronRight, HardHat, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const STEP_LABELS = ['PIC', 'JSC', 'FPC', 'FWC'];
const STEP_KEYS = ['pre_install_checklist', 'job_start_checklist', 'floor_prep_checklist', 'final_walkthrough_checklist'];

// Checkpoint dot styling only — replaces the previous hardcoded hex fills so the
// dots resolve in both themes. Any status outside this map falls back to neutral,
// exactly as the old default branch did. The legend below reuses the same fills.
const STEP_DOT_TONES = {
  Completed: 'bg-good/20 text-good',
  PrepApproved: 'bg-info/20 text-info',
  SubmittedForApproval: 'bg-warn/20 text-warn',
  Rejected: 'bg-crit/20 text-crit',
};
const STEP_DOT_NEUTRAL = 'bg-muted text-muted-foreground';

export default function InstallerView() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [selectedCrewId, setSelectedCrewId] = useState(null);

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: installers = [], isLoading: installersLoading } = useQuery({
    queryKey: ['installers'],
    queryFn: () => base44.entities.Installer.filter({ is_active: true }),
  });

  // Try to match logged-in user to an installer by email
  useEffect(() => {
    if (!selectedCrewId && installers.length > 0 && user?.email) {
      const match = installers.find(i => i.email?.toLowerCase() === user.email.toLowerCase());
      if (match) setSelectedCrewId(String(match.crew_id));
    }
  }, [installers, user, selectedCrewId]);

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['installerProjects', selectedCrewId],
    queryFn: () => base44.entities.Project.filter({ status: { $nin: ['Cancelled', 'Completed'] } }, '-installation_date', 200),
    enabled: !!selectedCrewId,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['journeyCustomers'],
    queryFn: () => base44.entities.Customer.list('-updated_date', 200),
    staleTime: 5 * 60 * 1000,
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['journeyProjectSales'],
    queryFn: () => base44.entities.Sale.list('-updated_date', 200),
    staleTime: 5 * 60 * 1000,
  });

  const { data: allCheckpoints = [] } = useQuery({
    queryKey: ['allProjectCheckpoints'],
    queryFn: () => base44.entities.ProjectCheckpoint.list('-updated_date', 500),
  });

  const getCustomer = (id) => customers.find(c => c.id === id);
  const getSale = (id) => sales.find(s => s.id === id);
  const getCheckpoints = (projectId) => allCheckpoints.filter(c => c.project_id === projectId);

  const getStepDots = (projectId, project, sale) => {
    const cps = getCheckpoints(projectId);
    return STEP_KEYS.map(key => {
      const cp = cps.find(c => c.step_key === key);
      if (key === 'pre_install_checklist' && !cp) {
        const hasPreInstall = (project?.pre_install_checklist_signature_url && project?.pre_install_product_info) ||
          (sale?.pre_install_checklist_signature_url && sale?.pre_install_product_info);
        if (hasPreInstall) return 'Completed';
      }
      return cp?.status || 'Pending';
    });
  };

  const myProjects = projects.filter(p => String(p.installer_crew_id) === selectedCrewId);

  const sortedProjects = [...myProjects].sort((a, b) => {
    const aPending = getStepDots(a.id, a, getSale(a.sale)).filter(s => s === 'SubmittedForApproval' || s === 'Rejected').length;
    const bPending = getStepDots(b.id, b, getSale(b.sale)).filter(s => s === 'SubmittedForApproval' || s === 'Rejected').length;
    return bPending - aPending;
  });

  const selectedInstaller = installers.find(i => String(i.crew_id) === selectedCrewId);

  if (installersLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        className="mb-4"
        title={
          <span className="flex items-center gap-2">
            <HardHat className="w-5 h-5 shrink-0 text-primary" />
            {t('ivTitle')}
          </span>
        }
        subtitle={selectedInstaller ? t('ivJobsAssigned', { crew: selectedInstaller.crew_name }) : t('ivSelectCrew')}
      />

      {/* Crew Selector */}
      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs font-medium text-muted-foreground">{t('ivViewingAs')}</label>
        <select
          value={selectedCrewId || ''}
          onChange={e => setSelectedCrewId(e.target.value)}
          className="text-sm border border-input rounded-lg px-3 py-1.5 bg-card text-foreground"
        >
          <option value="">{t('ivSelectInstaller')}</option>
          {installers.map(i => (
            <option key={i.crew_id} value={String(i.crew_id)}>{i.crew_name}</option>
          ))}
        </select>
      </div>

      {!selectedCrewId ? (
        <div className="bg-card border border-border rounded-xl py-12 text-center">
          <HardHat className="w-12 h-12 text-muted-foreground/60 mx-auto mb-3" />
          <p className="text-muted-foreground">{t('ivSelectCrewPrompt')}</p>
        </div>
      ) : projectsLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : sortedProjects.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-good mx-auto mb-3" />
          <p className="text-muted-foreground">{t('ivNoJobs')}</p>
        </div>
      ) : (
        <>
          {/* Legend — swatches use the same fills as the checkpoint dots below */}
          <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-muted" /> {t('ivLegendPending')}</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-warn/20" /> {t('ivLegendAwaiting')}</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-info/20" /> {t('ivLegendInProgress')}</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-good/20" /> {t('ivLegendCompleted')}</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-crit/20" /> {t('ivLegendRejected')}</div>
          </div>

          <div className="bg-card border border-border rounded-xl">
            <div className="sticky top-0 z-10 grid grid-cols-12 gap-3 px-4 py-2.5 bg-muted border-b border-border rounded-t-xl text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <div className="col-span-4">{t('ivColCustomer')}</div>
              <div className="col-span-2">{t('ivColCG')}</div>
              <div className="col-span-2">{t('ivColInstallDate')}</div>
              <div className="col-span-2">{t('ivColCheckpoints')}</div>
              <div className="col-span-2 text-right">{t('ivColStatus')}</div>
            </div>

            {sortedProjects.map(project => {
              const customer = getCustomer(project.customer);
              const sale = getSale(project.sale);
              const address = customer?.address_line1 || sale?.location_address || '';
              const city = customer?.city;
              const fullAddress = address ? (city ? `${address}, ${city}` : address) : '';
              const stepStatuses = getStepDots(project.id, project, sale);
              const pendingCount = stepStatuses.filter(s => s === 'SubmittedForApproval' || s === 'Rejected').length;

              return (
                <button
                  key={project.id}
                  onClick={() => navigate(`/JourneyProjectDetail?project_id=${project.id}&mode=installer`)}
                  className="w-full grid grid-cols-12 gap-3 px-4 py-3 border-b border-border hover:bg-muted/60 transition-colors text-left items-center"
                >
                  <div className="col-span-4">
                    <p className="text-sm font-medium text-foreground">
                      {customer?.first_name} {customer?.last_name || t('ivUnknown')}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {fullAddress || t('ivNoAddress')}
                    </p>
                  </div>
                  <div className="col-span-2">
                    {sale?.invoice_number ? (
                      <span className="text-sm text-muted-foreground font-mono">{sale.invoice_number}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="col-span-2">
                    {project.installation_date ? (
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                        {new Date(project.installation_date).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('ivNotScheduled')}</span>
                    )}
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5">
                    {stepStatuses.map((status, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold",
                            STEP_DOT_TONES[status] || STEP_DOT_NEUTRAL
                          )}
                          title={`${STEP_LABELS[i]}: ${status}`}
                        >
                          {STEP_LABELS[i].charAt(0)}
                        </span>
                        {i < 3 && <span className="text-muted-foreground/40 text-xs">→</span>}
                      </div>
                    ))}
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2">
                    {pendingCount > 0 ? (
                      // The source styled awaiting-approval and rejected with one amber
                      // chip and let the icon carry the difference — kept as a single
                      // warn tone rather than inventing a crit branch that was not there.
                      <StatusPill tone="warn">
                        {stepStatuses.some(s => s === 'SubmittedForApproval') ? <Clock className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {stepStatuses.some(s => s === 'SubmittedForApproval') ? t('ivAwaitingApproval') : t('ivRejected')}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral">{project.status}</StatusPill>
                    )}
                    <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
