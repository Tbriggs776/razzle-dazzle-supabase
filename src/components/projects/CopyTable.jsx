import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const formatRFMSDate = (d) => {
  if (!d || d.length < 8) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const month = months[parseInt(d.slice(4,6), 10) - 1];
  const day = parseInt(d.slice(6,8), 10);
  const year = d.slice(0,4);
  return `${month} ${day}, ${year}`;
};

const formatTime = (t) => {
  if (!t) return '';
  // t may be like "0800" or "14:00:00" or "08:00"
  const clean = t.replace(/:/g, '').slice(0, 4);
  if (clean.length < 4) return t;
  const h = parseInt(clean.slice(0,2), 10);
  const m = clean.slice(2,4);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
};

export default function CopyTable({ projectsWithDates, customers }) {
  const [copied, setCopied] = useState(false);

  if (!projectsWithDates || projectsWithDates.length === 0) return null;

  // Flatten rows: one row per job (or one row per project if no jobs)
  const rows = [];
  projectsWithDates.forEach(p => {
    const customer = customers.find(c => c.id === p.customer);
    const name = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
    const invoice = p.sale?.invoice_number || '';
    const address = p.sale?.location_address || '';

    // Find glue line items
    const lines = p.sale?.rfms_order_data?.result?.lines || p.sale?.rfms_order_data?.order?.result?.lines || [];
    const glueLines = lines.filter(l =>
      [l.styleName, l.supplierName, l.colorName, l.description].some(v => v?.toLowerCase().includes('glue'))
    );
    const glueDesc = glueLines.map(l => l.styleName || l.description || 'Glue Down').join(', ');

    const jobs = p.jobs || [];
    if (jobs.length === 0) {
      rows.push({
        name, invoice, address,
        crew: p.crewName || '',
        date: p.displayDateStr || '',
        startTime: '', endTime: '',
        status: p.status,
        isGlueDown: p.isGlueDown,
        glueDesc
      });
    } else {
      jobs.forEach(job => {
        rows.push({
          name, invoice, address,
          crew: job.crewName || p.crewName || '',
          date: job.scheduledStart ? `${job.scheduledStart.slice(0,4)}-${job.scheduledStart.slice(4,6)}-${job.scheduledStart.slice(6,8)}` : p.displayDateStr || '',
          dateRaw: job.scheduledStart || '',
          endDateRaw: job.scheduledEnd || '',
          startTime: job.startTime || '',
          endTime: job.endTime || '',
          jobStatus: job.jobStatus || '',
          status: p.status,
          isGlueDown: p.isGlueDown,
          glueDesc
        });
      });
    }
  });

  // Sort by date
  rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const handleCopy = () => {
    const header = ['Customer', 'Invoice #', 'Address', 'Crew', 'Date', 'End Date', 'Start Time', 'End Time', 'Job Status', 'Project Status', 'Glue Down', 'Glue Item'].join('\t');
    const body = rows.map(r => [
      r.name,
      r.invoice,
      r.address,
      r.crew,
      r.dateRaw ? formatRFMSDate(r.dateRaw) : r.date,
      r.endDateRaw ? formatRFMSDate(r.endDateRaw) : '',
      formatTime(r.startTime),
      formatTime(r.endTime),
      r.jobStatus,
      r.status,
      r.isGlueDown ? 'YES' : '',
      r.glueDesc
    ].join('\t')).join('\n');

    navigator.clipboard.writeText(header + '\n' + body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <p className="text-sm font-semibold text-slate-700">Schedule Table ({rows.length} jobs)</p>
        <button
          onClick={handleCopy}
          className={cn(
            'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors',
            copied
              ? 'bg-green-50 border-green-300 text-green-700'
              : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
          )}
        >
          {copied ? <><Check className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Table</>}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Customer','Invoice #','Address','Crew','Date','End Date','Start','End','Job Status','Status','Glue?','Glue Item'].map(h => (
                <th key={h} className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className={cn('hover:bg-slate-50 transition-colors', r.isGlueDown && 'bg-red-50')}>
                <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{r.name}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.invoice}</td>
                <td className="px-3 py-2 text-slate-500 max-w-[180px] truncate">{r.address}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{r.crew}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{r.dateRaw ? formatRFMSDate(r.dateRaw) : r.date}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{r.endDateRaw ? formatRFMSDate(r.endDateRaw) : ''}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatTime(r.startTime)}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatTime(r.endTime)}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.jobStatus}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">{r.status}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.isGlueDown && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">🔧 YES</span>}
                </td>
                <td className="px-3 py-2 text-slate-500 max-w-[150px] truncate">{r.glueDesc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}