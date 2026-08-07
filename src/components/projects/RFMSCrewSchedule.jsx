import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';

export default function RFMSCrewSchedule({ invoiceNumber }) {
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['rfmsJobs', invoiceNumber],
    queryFn: async () => {
      const { data } = await base44.functions.invoke('getRFMSJobs', { invoiceNumber });
      return data.jobs || [];
    },
    enabled: !!invoiceNumber,
    retry: 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false
  });

  if (!invoiceNumber) return null;

  const parseDate = (d) => {
    if (!d) return 'N/A';
    return format(new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`), 'MMM d, yyyy');
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2">
      <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
        RFMS Crew Schedule
      </h2>
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">No crew schedule found for invoice #{invoiceNumber}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {jobs.map((job) => (
            <div key={job.jobId} className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
              <p className="text-sm font-semibold text-indigo-800 mb-2">{job.crewName || 'Unassigned'}</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <CalendarIcon className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Start: <strong>{parseDate(job.scheduledStart)}</strong></span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <CalendarIcon className="w-3.5 h-3.5 text-indigo-400" />
                  <span>End: <strong>{parseDate(job.scheduledEnd)}</strong></span>
                </div>
                {job.jobStatus && (
                  <span className="inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                    {job.jobStatus}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}