import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, MapPin, Calendar, ChevronRight, Users, UserPlus, Filter } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function ManagerView() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filterUnassigned, setFilterUnassigned] = useState(false);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['journeyProjects'],
    queryFn: () => base44.entities.Project.filter({ status: { $nin: ['Cancelled', 'Completed'] } }, '-installation_date', 200),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['journeyCustomers'],
    queryFn: () => base44.entities.Customer.list('-updated_date', 300),
    staleTime: 5 * 60 * 1000,
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['journeyProjectSales'],
    queryFn: () => base44.entities.Sale.list('-updated_date', 300),
    staleTime: 5 * 60 * 1000,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembersManager'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }),
  });

  const { data: installers = [] } = useQuery({
    queryKey: ['journeyInstallers'],
    queryFn: () => base44.entities.Installer.filter({ is_active: true }),
  });

  const getCustomer = (id) => customers.find(c => c.id === id);
  const getSale = (id) => sales.find(s => s.id === id);

  const memberOptions = Array.isArray(teamMembers) ? teamMembers : [];
  const installerOptions = Array.isArray(installers) ? installers : [];

  const getMemberName = (id) => {
    const m = memberOptions.find(m => m.id === id);
    return m ? `${m.first_name} ${m.last_name}` : '—';
  };

  const handleAssign = async (projectId, field, value) => {
    await base44.entities.Project.update(projectId, { [field]: value || null });
    queryClient.invalidateQueries({ queryKey: ['journeyProjects'] });
  };

  const handleAssignInstaller = async (projectId, crewId) => {
    const installer = installerOptions.find(i => i.crew_id === crewId);
    await base44.entities.Project.update(projectId, {
      installer_crew_id: crewId || null,
      installer_crew_name: installer?.crew_name || null,
    });
    queryClient.invalidateQueries({ queryKey: ['journeyProjects'] });
    if (crewId) {
      try {
        await base44.functions.invoke('notifyInstallerAssigned', { project_id: projectId, crew_id: crewId });
      } catch (e) {
        console.error('Installer notification failed', e);
      }
    }
  };

  const filteredProjects = useMemo(() => {
    if (!filterUnassigned) return projects;
    return projects.filter(p =>
      !p.field_manager_id || !p.install_coordinator_id || !p.order_entry_id || !p.installer_crew_id
    );
  }, [projects, filterUnassigned]);

  const stats = useMemo(() => {
    const total = projects.length;
    const unassignedFM = projects.filter(p => !p.field_manager_id).length;
    const unassignedIC = projects.filter(p => !p.install_coordinator_id).length;
    const unassignedOE = projects.filter(p => !p.order_entry_id).length;
    const unassignedInst = projects.filter(p => !p.installer_crew_id).length;
    const fullyAssigned = projects.filter(p => p.field_manager_id && p.install_coordinator_id && p.order_entry_id && p.installer_crew_id).length;
    return { total, unassignedFM, unassignedIC, unassignedOE, unassignedInst, fullyAssigned };
  }, [projects]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
      </div>
    );
  }

  const ROLE_FIELDS = [
    { key: 'field_manager_id', label: 'Field Manager', short: 'FM' },
    { key: 'install_coordinator_id', label: 'Install Coordinator', short: 'IC' },
    { key: 'order_entry_id', label: 'Order Entry', short: 'OE' },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{t('mvTitle')}</h1>
          <p className="text-sm text-slate-500">{t('mvSubtitle')}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('mvTotalProjects')}</div>
          <div className="text-2xl font-black text-slate-800">{stats.total}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('mvFullyAssigned')}</div>
          <div className="text-2xl font-black text-green-600">{stats.fullyAssigned}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('mvNoFM')}</div>
          <div className="text-2xl font-black text-amber-600">{stats.unassignedFM}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('mvNoIC')}</div>
          <div className="text-2xl font-black text-amber-600">{stats.unassignedIC}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('mvNoOE')}</div>
          <div className="text-2xl font-black text-amber-600">{stats.unassignedOE}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('mvNoInstaller')}</div>
          <div className="text-2xl font-black text-amber-600">{stats.unassignedInst}</div>
        </div>
      </div>

      {/* Filter toggle */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => setFilterUnassigned(f => !f)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            filterUnassigned
              ? 'bg-amber-100 text-amber-700 border border-amber-200'
              : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          {filterUnassigned ? t('mvShowingIncomplete') : t('mvShowIncomplete')}
        </button>
        <span className="text-xs text-slate-400">{t('mvOfProjects', { shown: filteredProjects.length, total: projects.length })}</span>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 z-10 grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wide">
          <div className="col-span-2">{t('mvColCustomer')}</div>
          <div className="col-span-1">{t('mvColCG')}</div>
          <div className="col-span-2">{t('mvColInstallDate')}</div>
          <div className="col-span-2">{t('mvColFieldManager')}</div>
          <div className="col-span-2">{t('mvColInstallCoordinator')}</div>
          <div className="col-span-1">{t('mvColOrderEntry')}</div>
          <div className="col-span-1">{t('mvColInstaller')}</div>
          <div className="col-span-1 text-right"></div>
        </div>

        {/* Rows */}
        {filteredProjects.map(project => {
          const customer = getCustomer(project.customer);
          const sale = getSale(project.sale);
          const address = customer?.address_line1 || sale?.location_address || '';
          const city = customer?.city;
          const fullAddress = address ? (city ? `${address}, ${city}` : address) : '';

          return (
            <div
              key={project.id}
              className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors items-center"
            >
              <div className="col-span-2">
                <p className="text-sm font-medium text-slate-800">
                  {customer?.first_name} {customer?.last_name || t('mvUnknown')}
                </p>
                <p className="text-xs text-slate-400 flex items-center gap-1">
                  <MapPin className="w-3 h-3 shrink-0" />
                  {fullAddress || t('mvNoAddress')}
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
                  <span className="text-xs text-slate-400">{t('mvNotScheduled')}</span>
                  )}
                  </div>

                  {/* Field Manager */}
                  <div className="col-span-2">
                  <select
                  value={project.field_manager_id || ''}
                  onChange={e => handleAssign(project.id, 'field_manager_id', e.target.value)}
                  className={`w-full h-8 rounded-md border px-2 text-sm transition-colors ${
                  project.field_manager_id
                    ? 'border-slate-200 bg-white text-slate-700'
                    : 'border-amber-300 bg-amber-50 text-amber-600'
                  }`}
                  >
                  <option value="">{project.field_manager_id ? t('mvClear') : t('mvAssign')}</option>
                  {memberOptions.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.first_name} {m.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Install Coordinator */}
              <div className="col-span-2">
                <select
                  value={project.install_coordinator_id || ''}
                  onChange={e => handleAssign(project.id, 'install_coordinator_id', e.target.value)}
                  className={`w-full h-8 rounded-md border px-2 text-sm transition-colors ${
                    project.install_coordinator_id
                      ? 'border-slate-200 bg-white text-slate-700'
                      : 'border-amber-300 bg-amber-50 text-amber-600'
                  }`}
                >
                  <option value="">{project.install_coordinator_id ? t('mvClear') : t('mvAssign')}</option>
                  {memberOptions.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.first_name} {m.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Order Entry */}
              <div className="col-span-1">
                <select
                  value={project.order_entry_id || ''}
                  onChange={e => handleAssign(project.id, 'order_entry_id', e.target.value)}
                  className={`w-full h-8 rounded-md border px-2 text-sm transition-colors ${
                    project.order_entry_id
                      ? 'border-slate-200 bg-white text-slate-700'
                      : 'border-amber-300 bg-amber-50 text-amber-600'
                  }`}
                >
                  <option value="">{project.order_entry_id ? '—' : '—'}</option>
                  {memberOptions.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.first_name} {m.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Installer */}
              <div className="col-span-1">
                <select
                  value={project.installer_crew_id || ''}
                  onChange={e => handleAssignInstaller(project.id, e.target.value)}
                  className={`w-full h-8 rounded-md border px-1 text-sm transition-colors ${
                    project.installer_crew_id
                      ? 'border-slate-200 bg-white text-slate-700'
                      : 'border-amber-300 bg-amber-50 text-amber-600'
                  }`}
                >
                  <option value="">{project.installer_crew_id ? t('mvClear') : t('mvAssign')}</option>
                  {installerOptions.map(i => (
                    <option key={i.crew_id} value={i.crew_id}>
                      {i.crew_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-1 flex items-center justify-end gap-2">
                <button
                  onClick={() => navigate(`/JourneyProjectDetail?project_id=${project.id}`)}
                  className="text-slate-300 hover:text-indigo-500 transition-colors"
                  title={t('mvViewProject')}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}

        {filteredProjects.length === 0 && (
          <div className="py-12 text-center text-slate-400">
            <Users className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p>{filterUnassigned ? t('mvAllAssigned') : t('mvNoProjects')}</p>
          </div>
        )}
      </div>
    </div>
  );
}