import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, MapPin, Calendar, ChevronRight, HardHat, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const STEP_LABELS = ['PIC', 'JSC', 'FPC', 'FWC'];
const STEP_KEYS = ['pre_install_checklist', 'job_start_checklist', 'floor_prep_checklist', 'final_walkthrough_checklist'];

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
        <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <HardHat className="w-5 h-5 text-indigo-600" />
          {t('ivTitle')}
        </h1>
        <p className="text-sm text-slate-500">
          {selectedInstaller ? t('ivJobsAssigned', { crew: selectedInstaller.crew_name }) : t('ivSelectCrew')}
        </p>
      </div>

      {/* Crew Selector */}
      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs font-medium text-slate-500">{t('ivViewingAs')}</label>
        <select
          value={selectedCrewId || ''}
          onChange={e => setSelectedCrewId(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700"
        >
          <option value="">{t('ivSelectInstaller')}</option>
          {installers.map(i => (
            <option key={i.crew_id} value={String(i.crew_id)}>{i.crew_name}</option>
          ))}
        </select>
      </div>

      {!selectedCrewId ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 text-center">
          <HardHat className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">{t('ivSelectCrewPrompt')}</p>
        </div>
      ) : projectsLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
        </div>
      ) : sortedProjects.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <p className="text-slate-500">{t('ivNoJobs')}</p>
        </div>
      ) : (
        <>
          {/* Legend */}
          <div className="flex items-center gap-4 mb-3 text-xs text-slate-500">
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-slate-200" /> {t('ivLegendPending')}</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-300" /> {t('ivLegendAwaiting')}</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-300" /> {t('ivLegendInProgress')}</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-400" /> {t('ivLegendCompleted')}</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-300" /> {t('ivLegendRejected')}</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl">
            <div className="sticky top-0 z-10 grid grid-cols-12 gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200 rounded-t-xl text-xs font-medium text-slate-500 uppercase tracking-wide">
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
                  className="w-full grid grid-cols-12 gap-3 px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left items-center"
                >
                  <div className="col-span-4">
                    <p className="text-sm font-medium text-slate-800">
                      {customer?.first_name} {customer?.last_name || t('ivUnknown')}
                    </p>
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {fullAddress || t('ivNoAddress')}
                    </p>
                  </div>
                  <div className="col-span-2">
                    {sale?.invoice_number ? (
                      <span className="text-sm text-slate-600 font-mono">{sale.invoice_number}</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </div>
                  <div className="col-span-2">
                    {project.installation_date ? (
                      <span className="text-sm text-slate-600 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {new Date(project.installation_date).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">{t('ivNotScheduled')}</span>
                    )}
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5">
                    {stepStatuses.map((status, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                          style={{
                            backgroundColor: status === 'Completed' ? '#86efac' : status === 'PrepApproved' ? '#93c5fd' : status === 'SubmittedForApproval' ? '#fcd34d' : status === 'Rejected' ? '#fca5a5' : '#e2e8f0',
                            color: status === 'Completed' ? '#15803d' : status === 'PrepApproved' ? '#1d4ed8' : status === 'SubmittedForApproval' ? '#b45309' : status === 'Rejected' ? '#b91c1c' : '#94a3b8'
                          }}
                          title={`${STEP_LABELS[i]}: ${status}`}
                        >
                          {STEP_LABELS[i].charAt(0)}
                        </span>
                        {i < 3 && <span className="text-slate-200 text-xs">→</span>}
                      </div>
                    ))}
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-2">
                    {pendingCount > 0 ? (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        {stepStatuses.some(s => s === 'SubmittedForApproval') ? <Clock className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {stepStatuses.some(s => s === 'SubmittedForApproval') ? t('ivAwaitingApproval') : t('ivRejected')}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 px-2 py-0.5 rounded-full bg-slate-100">{project.status}</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-300" />
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