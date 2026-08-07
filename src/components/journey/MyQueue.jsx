import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, MapPin, Calendar, ChevronRight, Bell, CheckCircle2, AlertCircle, ClipboardList, HardHat, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const STEP_LABELS = ['PIC', 'JSC', 'FPC', 'FWC'];
const STEP_KEYS = ['pre_install_checklist', 'job_start_checklist', 'floor_prep_checklist', 'final_walkthrough_checklist'];

export default function MyQueue() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all'); // 'all' | 'pending'

  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: teamMember } = useQuery({
    queryKey: ['currentTeamMember', user?.email],
    queryFn: async () => {
      const result = await base44.entities.TeamMember.filter({ email: user.email });
      return result?.[0] || null;
    },
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['journeyProjects'],
    queryFn: () => base44.entities.Project.filter({ status: { $nin: ['Cancelled', 'Completed'] } }, '-installation_date', 100),
    enabled: !!user,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['journeyCustomers'],
    queryFn: () => base44.entities.Customer.list('-updated_date', 200),
    staleTime: 5 * 60 * 1000,
    enabled: !!user,
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['journeyProjectSales'],
    queryFn: () => base44.entities.Sale.list('-updated_date', 200),
    staleTime: 5 * 60 * 1000,
    enabled: !!user,
  });

  const { data: allCheckpoints = [] } = useQuery({
    queryKey: ['allProjectCheckpoints'],
    queryFn: () => base44.entities.ProjectCheckpoint.list('-updated_date', 500),
    enabled: !!user,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['journeyTeamMembers'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }),
    staleTime: 5 * 60 * 1000,
    enabled: !!user,
  });

  const getCustomer = (id) => customers.find(c => c.id === id);
  const getSale = (id) => sales.find(s => s.id === id);
  const getMemberName = (id) => {
    if (!id) return null;
    const m = teamMembers.find(t => t.id === id);
    return m ? `${m.first_name} ${m.last_name}` : null;
  };
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

  const zoneProjects = projects.filter(project =>
    teamMember && project.field_manager_id === teamMember.id
  );

  const queuedProjects = zoneProjects.filter(project => {
    const stepStatuses = getStepDots(project.id, project, getSale(project.sale));
    return stepStatuses.some(s => s === 'SubmittedForApproval' || s === 'Rejected');
  });

  const displayedProjects = filter === 'pending' ? queuedProjects : zoneProjects;

  if (userLoading || projectsLoading) {
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
          <Bell className="w-5 h-5 text-indigo-600" />
          {t('mqTitle')}
        </h1>
        <p className="text-sm text-slate-500">
          {t('mqSubtitle')}
        </p>
      </div>

      {/* Filter toggle */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setFilter('all')}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            filter === 'all' ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50"
          )}
        >
          <ClipboardList className="w-3.5 h-3.5" />
          {t('mqAll', { count: zoneProjects.length })}
        </button>
        <button
          onClick={() => setFilter('pending')}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            filter === 'pending' ? "bg-amber-50 text-amber-700" : "text-slate-500 hover:bg-slate-50"
          )}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          {t('mqNeedsApproval', { count: queuedProjects.length })}
        </button>
      </div>

      {displayedProjects.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <p className="text-slate-500">{t('mqNoProjects')}</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl">
          <div className="sticky top-0 z-10 grid grid-cols-12 gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200 rounded-t-xl text-xs font-medium text-slate-500 uppercase tracking-wide">
            <div className="col-span-3">{t('mqColCustomer')}</div>
            <div className="col-span-1">{t('mqColCG')}</div>
            <div className="col-span-2">{t('mqColInstallDate')}</div>
            <div className="col-span-3">{t('mqColAssigned')}</div>
            <div className="col-span-2">{t('mqColCheckpoints')}</div>
            <div className="col-span-1 text-right">{t('mqColStatus')}</div>
          </div>

          {[...displayedProjects].sort((a, b) => {
            const aPending = getStepDots(a.id, a, getSale(a.sale)).filter(s => s === 'SubmittedForApproval' || s === 'Rejected').length;
            const bPending = getStepDots(b.id, b, getSale(b.sale)).filter(s => s === 'SubmittedForApproval' || s === 'Rejected').length;
            return bPending - aPending;
          }).map(project => {
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
                onClick={() => navigate(`/JourneyProjectDetail?project_id=${project.id}`)}
                className="w-full grid grid-cols-12 gap-3 px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left items-center"
              >
                <div className="col-span-3">
                  <p className="text-sm font-medium text-slate-800">
                    {customer?.first_name} {customer?.last_name || t('mqUnknown')}
                  </p>
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3 shrink-0" />
                    {fullAddress || t('mqNoAddress')}
                  </p>
                </div>
                <div className="col-span-1">
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
                    <span className="text-xs text-slate-400">{t('mqNotScheduled')}</span>
                  )}
                </div>
                <div className="col-span-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <UserCog className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{getMemberName(project.field_manager_id) || t('mqNoFieldManager')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <HardHat className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{project.installer_crew_name || t('mqNoInstallerCrew')}</span>
                  </div>
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
                <div className="col-span-1 flex items-center justify-end gap-1">
                  {pendingCount > 0 ? (
                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1" title={t('mqPendingApproval', { count: pendingCount })}>
                      <AlertCircle className="w-3 h-3" />
                      {pendingCount}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 px-1.5 py-0.5 rounded-full bg-slate-100 truncate" title={project.status}>{project.status}</span>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}