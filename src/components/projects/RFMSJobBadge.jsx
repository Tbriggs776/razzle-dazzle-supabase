import React from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Users, Calendar as CalendarIcon } from 'lucide-react';

const parseDate = (d) => {
  if (!d) return null;
  return format(new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`), 'MMM d');
};

export default function RFMSJobBadge({ invoiceNumber }) {
  const { data: jobs = [] } = useQuery({
    queryKey: ['rfmsJobs', invoiceNumber],
    queryFn: async () => {
      const res = await base44.functions.invoke('getRFMSJobs', { invoiceNumber });
      // Was `const { data } = ...` with no check: on failure data is
      // null and this threw a TypeError, or silently returned [].
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      const data = res.data;
      return data.jobs || [];
    },
    enabled: !!invoiceNumber,
    staleTime: 10 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: false
  });

  if (!invoiceNumber || jobs.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {jobs.map((job) => (
        <div key={job.jobId} className="flex items-center gap-3 text-xs bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-1.5">
          {job.crewName && (
            <span className="flex items-center gap-1 text-indigo-700 font-medium">
              <Users className="w-3 h-3" />
              {job.crewName}
            </span>
          )}
          {(job.scheduledStart || job.scheduledEnd) && (
            <span className="flex items-center gap-1 text-slate-600">
              <CalendarIcon className="w-3 h-3 text-indigo-400" />
              {parseDate(job.scheduledStart)}
              {job.scheduledEnd && job.scheduledEnd !== job.scheduledStart && (
                <> – {parseDate(job.scheduledEnd)}</>
              )}
            </span>
          )}
          {job.jobStatus && (
            <span className="text-indigo-500">{job.jobStatus}</span>
          )}
        </div>
      ))}
    </div>
  );
}