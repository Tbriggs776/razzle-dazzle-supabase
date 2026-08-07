import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { ChevronLeft, ChevronRight, X, Users, Calendar as CalendarIcon, ExternalLink, Loader2 } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import CopyTable from '@/components/projects/CopyTable';

const statusColors = {
  'Accepted': 'bg-blue-100 text-blue-800',
  'Materials Ordered': 'bg-purple-100 text-purple-800',
  'Scheduled': 'bg-yellow-100 text-yellow-800',
  'In Progress': 'bg-orange-100 text-orange-800',
  'Quality Checks': 'bg-indigo-100 text-indigo-800',
  'Completed': 'bg-green-100 text-green-800'
};

// Parse raw RFMS date string (e.g. '20260414') to 'YYYY-MM-DD' without timezone issues
const parseRFMSDate = (d) => {
  if (!d || d.length < 8) return null;
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
};

// Format raw RFMS date string directly without going through Date object (avoids UTC offset)
const formatRFMSDate = (d) => {
  if (!d || d.length < 8) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[parseInt(d.slice(4,6), 10) - 1];
  const day = parseInt(d.slice(6,8), 10);
  const year = d.slice(0,4);
  return `${month} ${day}, ${year}`;
};

export default function ProjectsCalendarView({ projects, customers, sales, enabled = true }) {
   const [currentMonth, setCurrentMonth] = useState(new Date());
   const [selectedProject, setSelectedProject] = useState(null);
   const queryClient = useQueryClient();

   // Only fetch RFMS for projects that have invoice numbers
   const projectsWithInvoice = projects.filter(p => {
     const sale = sales.find(s => s.id === p.sale);
     return !!sale?.invoice_number;
   });

   const invoiceToProjectMap = {};
   projectsWithInvoice.forEach(p => {
     const sale = sales.find(s => s.id === p.sale);
     if (sale?.invoice_number) invoiceToProjectMap[sale.invoice_number] = p;
   });

   const invoiceNumbers = [...new Set(projectsWithInvoice.map(p => sales.find(s => s.id === p.sale)?.invoice_number).filter(Boolean))];

   const rfmsQueries = useQueries({
     queries: invoiceNumbers.map(inv => ({
       queryKey: ['rfmsJobs', inv],
       queryFn: async () => {
         const { data } = await base44.functions.invoke('getRFMSJobs', { invoiceNumber: inv });
         return data.jobs || [];
       },
       staleTime: 5 * 60 * 1000,
       enabled: enabled
     }))
   });

  const allLoaded = rfmsQueries.every(q => !q.isLoading);

  // After RFMS loads, save any changed crew dates back to projects
  useEffect(() => {
    if (!allLoaded) return;

    invoiceNumbers.forEach((inv, i) => {
      const jobs = rfmsQueries[i]?.data || [];
      const firstJob = jobs.find(j => j.scheduledStart);
      const firstCrew = jobs.find(j => j.crewName);
      const project = invoiceToProjectMap[inv];
      if (!project) return;

      const newCrewDate = firstJob ? parseRFMSDate(firstJob.scheduledStart) : null;
      const newCrewName = firstCrew?.crewName || null;

      if (newCrewDate !== (project.rfms_crew_date || null) || newCrewName !== (project.rfms_crew_name || null)) {
        base44.entities.Project.update(project.id, {
          rfms_crew_date: newCrewDate || undefined,
          rfms_crew_name: newCrewName || undefined,
          rfms_crew_cached_at: new Date().toISOString()
        }).catch(() => {});
      }
    });
  }, [allLoaded]);

  // Build rfms data maps
  const rfmsJobsMap = {};
  invoiceNumbers.forEach((inv, i) => {
    rfmsJobsMap[inv] = rfmsQueries[i]?.data || [];
  });

  // Compute display date: RFMS crew date first, fallback to install date
  const projectsWithDates = projects.map(p => {
    const sale = sales.find(s => s.id === p.sale);
    const inv = sale?.invoice_number;
    const jobs = inv ? (rfmsJobsMap[inv] || []) : [];
    const firstJob = jobs.find(j => j.scheduledStart);
    const rfmsDateStr = firstJob ? parseRFMSDate(firstJob.scheduledStart) : null;
    const effectiveRfmsDate = rfmsDateStr || p.rfms_crew_date || null;
    const installDate = p.installation_date || null;
    const displayDateStr = effectiveRfmsDate || installDate;
    if (!displayDateStr) return null;

    const firstCrew = jobs.find(j => j.crewName);
    const crewName = firstCrew?.crewName || p.rfms_crew_name || null;

    const lines = sale?.rfms_order_data?.result?.lines || sale?.rfms_order_data?.order?.result?.lines;
    const isGlueDown = lines?.some(l => [l.styleName, l.supplierName, l.colorName, l.description].some(v => v?.toLowerCase().includes('glue')));

    return { ...p, displayDateStr, crewName, sale, isGlueDown, jobs };
  }).filter(Boolean);

  // Group by date string
  const byDate = {};
  projectsWithDates.forEach(p => {
    if (!byDate[p.displayDateStr]) byDate[p.displayDateStr] = [];
    byDate[p.displayDateStr].push(p);
  });

  // Build calendar grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  const days = [];
  let day = gridStart;
  while (day <= gridEnd) {
    days.push(day);
    day = addDays(day, 1);
  }

  const projectsWithoutDate = projects.filter(p => {
    const sale = sales.find(s => s.id === p.sale);
    const inv = sale?.invoice_number;
    const jobs = inv ? (rfmsJobsMap[inv] || []) : [];
    const firstJob = jobs.find(j => j.scheduledStart);
    const rfmsDateStr = firstJob ? parseRFMSDate(firstJob.scheduledStart) : null;
    const effectiveRfms = rfmsDateStr || p.rfms_crew_date;
    return !effectiveRfms && !p.installation_date;
  });

  if (!allLoaded) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
        <p className="text-slate-500 text-sm">Loading crew schedules from RFMS...</p>
        <p className="text-slate-400 text-xs">{rfmsQueries.filter(q => !q.isLoading).length} / {rfmsQueries.length} loaded</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-6 py-3">
        <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h2 className="text-lg font-semibold text-slate-800">{format(currentMonth, 'MMMM yyyy')}</h2>
        <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
          <ChevronRight className="w-5 h-5 text-slate-600" />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-slate-200">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const key = format(d, 'yyyy-MM-dd');
            const dayProjects = byDate[key] || [];
            const isToday = isSameDay(d, new Date());
            const inMonth = isSameMonth(d, currentMonth);

            return (
              <div
                key={i}
                className={cn(
                  'min-h-[100px] border-b border-r border-slate-100 p-1.5',
                  !inMonth && 'bg-slate-50',
                  isToday && 'bg-indigo-50/50'
                )}
              >
                <div className={cn(
                  'text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full',
                  isToday ? 'bg-indigo-600 text-white' : inMonth ? 'text-slate-700' : 'text-slate-400'
                )}>
                  {format(d, 'd')}
                </div>
                <div className="space-y-1">
                  {dayProjects.map(p => {
                    const customer = customers.find(c => c.id === p.customer);
                    const name = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
                    return (
                      <button
                        key={p.id}
                        onClick={(e) => { e.stopPropagation(); setSelectedProject(p); }}
                        className={cn(
                          'block w-full text-left text-[11px] font-medium px-1.5 py-0.5 rounded truncate leading-tight hover:opacity-80 transition-opacity',
                          p.isGlueDown ? 'bg-red-200 text-red-900' : (statusColors[p.status] || 'bg-slate-100 text-slate-700')
                        )}
                        title={`${name}${p.crewName ? ` — ${p.crewName}` : ''}${p.isGlueDown ? ' 🔧 Glue Down' : ''}`}
                      >
                        {p.isGlueDown && <span className="mr-0.5">🔧</span>}{name}
                        {p.crewName && <span className="opacity-70 ml-1 font-normal">· {p.crewName}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Project detail popup */}
      {selectedProject && (() => {
        const customer = customers.find(c => c.id === selectedProject.customer);
        const name = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
        const jobs = selectedProject.jobs || [];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedProject(null)}>
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{name}</h3>
                  {selectedProject.sale?.invoice_number && <p className="text-xs text-slate-500 mt-0.5">Invoice #{selectedProject.sale.invoice_number}</p>}
                </div>
                <button onClick={() => setSelectedProject(null)} className="p-1 hover:bg-slate-100 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                <Badge className={cn('border', statusColors[selectedProject.status] || 'bg-slate-100 text-slate-700')}>
                  {selectedProject.status}
                </Badge>
                {selectedProject.isGlueDown && (
                  <Badge className="bg-red-100 text-red-800 border border-red-200">🔧 Glue Down</Badge>
                )}
              </div>

              {jobs.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">RFMS Crew Schedule</p>
                  {jobs.map((job, i) => (
                    <div key={i} className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 space-y-1">
                      {job.crewName && (
                        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-800">
                          <Users className="w-4 h-4" />{job.crewName}
                        </div>
                      )}
                      {(job.scheduledStart || job.scheduledEnd) && (
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <CalendarIcon className="w-3.5 h-3.5 text-indigo-400" />
                          <span>
                            {job.scheduledStart && formatRFMSDate(job.scheduledStart)}
                            {job.scheduledEnd && job.scheduledEnd !== job.scheduledStart && (
                              <> &ndash; {formatRFMSDate(job.scheduledEnd)}</>
                            )}
                          </span>
                        </div>
                      )}
                      {job.jobStatus && <p className="text-xs text-indigo-600 font-medium">{job.jobStatus}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1 text-sm text-slate-500">
                  <p>No RFMS crew assigned.</p>
                  {selectedProject.installation_date && (
                    <p className="text-xs text-slate-400">Install date: {selectedProject.installation_date}</p>
                  )}
                </div>
              )}

              <Link
                to={createPageUrl('ProjectDetail') + `?id=${selectedProject.id}`}
                className="mt-4 flex items-center justify-center gap-2 w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" /> View Project
              </Link>
            </div>
          </div>
        );
      })()}

      {/* Copy Table */}
      <CopyTable
        projectsWithDates={projectsWithDates.filter(p => p.displayDateStr && p.displayDateStr.startsWith(format(currentMonth, 'yyyy-MM')))}
        customers={customers}
      />

      {/* Projects without any date */}
      {projectsWithoutDate.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">No Date Assigned ({projectsWithoutDate.length})</p>
          <div className="flex flex-wrap gap-2">
            {projectsWithoutDate.map(p => {
              const customer = customers.find(c => c.id === p.customer);
              const name = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
              return (
                <Link
                  key={p.id}
                  to={createPageUrl('ProjectDetail') + `?id=${p.id}`}
                  className={cn('text-xs font-medium px-2 py-1 rounded border hover:opacity-80 transition-opacity', statusColors[p.status] || 'bg-slate-100 text-slate-700')}
                >
                  {name}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}