import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, X, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO, subDays } from 'date-fns';
import { getDistinctCategories } from './productCodes';
import { useLanguage } from '@/lib/i18n/LanguageContext';

// ── Job helpers ───────────────────────────────────────────────────────────────
function getJobKey(job) { return String(job.jobId || job.documentNumber || Math.random()); }
function getJobName(job) { return (job._customerName || job.jobName || job.documentNumber || '—').trim(); }
function getJobZip(job) { return (job._zip || job.ZIP || '').trim(); }
function getJobTotal(job) { return job._orderTotal || job.laborTotal || 0; }
function getJobScheduledStart(job) {
  const s = job.scheduledStart;
  if (!s || s.length !== 8) return null;
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

function fmtMoney(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Draggable chip ────────────────────────────────────────────────────────────
// The chip fill is a per-region colour that comes from the data (RegionAssignment.color),
// so it is an inline style, not a token, and its text stays white in both themes. Anything
// layered ON the chip therefore needs an opaque fill too — a translucent StatusPill
// (bg-warn/15) would blend into whatever arbitrary region colour sits underneath.
function JobChip({ label, jobId, color, subtitle, installDate, onRemove, orderTotal, highValue, categories }) {
  return (
    <div
      draggable
      onDragStart={e => e.dataTransfer.setData('jobId', jobId)}
      className="group flex flex-col px-3 py-2 rounded-md text-white text-xs font-medium cursor-grab active:cursor-grabbing shadow-sm mb-1.5 select-none gap-0.5"
      style={{ backgroundColor: color }}
    >
      <div className="flex items-center gap-1 min-w-0">
        {highValue && (
          <span className="shrink-0 bg-brand-gold-light text-brand-navy text-[9px] font-bold px-1 py-0.5 rounded">HIGH&nbsp;$</span>
        )}
        <span className="truncate flex-1 font-semibold">{label}</span>
        {onRemove && (
          <button
            onClick={e => { e.stopPropagation(); onRemove(jobId); }}
            className="opacity-0 group-hover:opacity-100 hover:bg-black/20 rounded p-0.5 transition-opacity shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {orderTotal > 0 && <span className="text-[10px] opacity-90 font-semibold">${fmtMoney(orderTotal)}</span>}
      {categories?.length > 0 && (
        <span className="text-[10px] opacity-80 truncate">{categories.join(' · ')}</span>
      )}
      {subtitle && <span className="text-[10px] opacity-75 truncate">{subtitle}</span>}
      {installDate && <span className="text-[10px] opacity-90 font-semibold mt-0.5">📅 {installDate}</span>}
    </div>
  );
}

// ── Region pool section ───────────────────────────────────────────────────────
function RegionPool({ region, jobs, highValueThreshold }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(true);
  // Literal hex fallback stays: this feeds a chip fill that always carries white text, so a
  // theme-reactive token (which lightens in dark mode) would break that contrast contract.
  const color = region?.color || '#94a3b8';

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors text-left"
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold text-foreground flex-1 truncate">{region.region_name}</span>
        <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 shrink-0">{jobs.length}</span>
        {open ? <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="ml-2 mt-0.5 max-h-64 overflow-y-auto pr-1">
          {jobs.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/60 px-2 py-1 italic">{t('jcNoJobs')}</p>
          ) : (
            jobs.map(job => (
              <JobChip
                key={getJobKey(job)}
                jobId={getJobKey(job)}
                label={getJobName(job)}
                subtitle={[job.documentNumber, (job.crewName || '').trim()].filter(Boolean).join(' · ')}
                installDate={getJobScheduledStart(job)}
                color={color}
                orderTotal={getJobTotal(job)}
                highValue={getJobTotal(job) >= highValueThreshold}
                categories={getDistinctCategories(job._lineItems)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Unmatched pool ────────────────────────────────────────────────────────────
function UnmatchedPool({ jobs, highValueThreshold }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  if (jobs.length === 0) return null;
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors text-left"
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-muted-foreground/40" />
        <span className="text-xs font-semibold text-muted-foreground flex-1">{t('jcNoRegionMatch')}</span>
        <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 shrink-0">{jobs.length}</span>
        {open ? <ChevronUp className="w-3 h-3 text-muted-foreground/60 shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/60 shrink-0" />}
      </button>
      {open && (
        <div className="ml-2 mt-0.5 max-h-48 overflow-y-auto pr-1">
          {jobs.map(job => (
            <JobChip
              key={getJobKey(job)}
              jobId={getJobKey(job)}
              label={getJobName(job)}
              subtitle={[job.documentNumber, (job.crewName || '').trim()].filter(Boolean).join(' · ')}
              installDate={getJobScheduledStart(job)}
              color="#94a3b8" /* same fixed chip fill as the region fallback — white chip text needs a theme-stable colour */
              orderTotal={getJobTotal(job)}
              highValue={getJobTotal(job) >= highValueThreshold}
              categories={getDistinctCategories(job._lineItems)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Day column ────────────────────────────────────────────────────────────────
function DayColumn({ date, scheduledOrders, regionByOrderId, onDrop, onUnschedule, onClearDay, highValueThreshold }) {
  const { t } = useLanguage();
  const [dragOver, setDragOver] = useState(false);
  const isToday = isSameDay(date, new Date());

  return (
    <div
      className={cn(
        "flex-1 flex flex-col min-w-0 border-r border-border last:border-r-0 transition-colors",
        dragOver && "bg-primary/5 ring-2 ring-inset ring-primary/40"
      )}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        const jobId = e.dataTransfer.getData('jobId');
        if (jobId) onDrop(jobId, format(date, 'yyyy-MM-dd'));
      }}
    >
      <div className={cn("text-center py-2 border-b border-border shrink-0 relative", isToday ? "bg-primary" : "bg-muted/50")}>
        <div className={cn("text-[10px] font-semibold uppercase tracking-wide", isToday ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {format(date, 'EEE')}
        </div>
        <div className={cn("text-sm font-bold mt-0.5", isToday ? "text-primary-foreground" : "text-foreground")}>
          {format(date, 'd')}
        </div>
        {scheduledOrders.length > 0 && (
          <div className={cn("text-[10px] mt-0.5", isToday ? "text-primary-foreground/70" : "text-muted-foreground")}>
            {t('jcJobs', { count: scheduledOrders.length })}
          </div>
        )}
        {scheduledOrders.length > 0 && (
          <button
            onClick={() => onClearDay(scheduledOrders.map(jo => jo.id))}
            title={t('jcClearDay')}
            className={cn(
              "absolute top-1 right-1 rounded p-0.5 transition-colors",
              isToday
                ? "text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/20"
                : "text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
            )}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="flex-1 p-1.5 overflow-y-auto min-h-0">
        {scheduledOrders.length === 0 ? (
          <div className="h-full min-h-[3rem] flex items-center justify-center border-2 border-dashed border-border rounded-lg m-1">
            <span className="text-[10px] text-muted-foreground/60">{t('jcDropHere')}</span>
          </div>
        ) : (
          scheduledOrders.map(jo => {
            const region = regionByOrderId[jo.rfms_order_id];
            const total = jo.order_total || 0;
            return (
              <JobChip
                key={jo.id}
                jobId={jo.rfms_order_id}
                label={jo.customer_name || jo.invoice_number || jo.rfms_order_id}
                subtitle={[jo.region_name || '', jo.zip_code || ''].filter(Boolean).join(' · ')}
                installDate={jo.install_date || null}
                color={region?.color || '#94a3b8'}
                onRemove={() => onUnschedule(jo.id)}
                orderTotal={total}
                highValue={total >= highValueThreshold}
                categories={getDistinctCategories(jo.line_items)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function JourneyCalendar({ journeyOrders, regions }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));

  const today = new Date();
  const [jobsFrom, setJobsFrom] = useState(format(subDays(today, 7), 'yyyy-MM-dd'));
  const [jobsTo, setJobsTo] = useState(format(addDays(today, 7), 'yyyy-MM-dd'));
  const [jobsFromInput, setJobsFromInput] = useState(format(subDays(today, 7), 'yyyy-MM-dd'));
  const [jobsToInput, setJobsToInput] = useState(format(addDays(today, 7), 'yyyy-MM-dd'));

  const { data: settingsData } = useQuery({
    queryKey: ['smsSettingsJourney'],
    queryFn: async () => {
      const all = await base44.entities.SMSSettings.list();
      return all[0] || null;
    },
    staleTime: 60 * 1000,
  });

  const highValueThreshold = settingsData?.journey_high_value_threshold ?? 20000;

  const handleThresholdChange = async (val) => {
    try {
      if (settingsData) {
        await base44.entities.SMSSettings.update(settingsData.id, { journey_high_value_threshold: val });
        queryClient.invalidateQueries({ queryKey: ['smsSettingsJourney'] });
      }
    } catch (err) {
      console.error('Failed to save threshold', err);
    }
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const toRFMSDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}-${d}-${y}`;
  };

  const { data: jobsData, isLoading, error: fetchError, refetch } = useQuery({
    queryKey: ['rfmsJobsFind', jobsFrom, jobsTo],
    queryFn: async () => {
      const res = await base44.functions.invoke('getRFMSJobsFind', {
        startDate: toRFMSDate(jobsFrom),
        endDate: toRFMSDate(jobsTo),
      });
      return res.data?.jobs || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const handleJobsSearch = (e) => {
    e.preventDefault();
    setJobsFrom(jobsFromInput);
    setJobsTo(jobsToInput);
  };

  const rfmsJobs = jobsData || [];

  // Build ZIP → region map
  const zipToRegion = useMemo(() => {
    const map = {};
    regions.forEach(r => {
      (r.zip_codes || []).forEach(z => { map[z] = r; });
    });
    return map;
  }, [regions]);

  // Group jobs by region using enriched ZIP from order detail
  const { regionJobsMap, unmatchedJobs } = useMemo(() => {
    const rMap = {};
    regions.forEach(r => { rMap[r.id] = []; });
    const unmatched = [];
    rfmsJobs.forEach(job => {
      const zip = getJobZip(job);
      const region = zipToRegion[zip] || null;
      if (region) {
        rMap[region.id]?.push(job);
      } else {
        unmatched.push(job);
      }
    });
    return { regionJobsMap: rMap, unmatchedJobs: unmatched };
  }, [rfmsJobs, zipToRegion, regions]);

  // Build region lookup by rfms_order_id for calendar chips
  const regionByOrderId = useMemo(() => {
    const map = {};
    journeyOrders.forEach(jo => {
      const region = regions.find(r => r.id === jo.region_assignment_id);
      if (region) map[jo.rfms_order_id] = region;
    });
    return map;
  }, [journeyOrders, regions]);

  const getOrdersForDay = (date) =>
    journeyOrders.filter(jo => {
      if (!jo.install_date) return false;
      try { return isSameDay(parseISO(jo.install_date), date); } catch { return false; }
    });

  // Drop handler: fetch job from pool, create JourneyOrder
  const handleDrop = async (jobId, dateStr) => {
    const alreadyOnDate = journeyOrders.find(jo => jo.rfms_order_id === jobId && jo.install_date === dateStr);
    if (alreadyOnDate) return;

    const job = rfmsJobs.find(j => getJobKey(j) === jobId);
    if (!job) return;

    const zip = getJobZip(job);
    const matchedRegion = zipToRegion[zip] || null;

    const address = [(job._address || '').trim(), (job._city || '').trim(), (job._state || '').trim(), zip].filter(Boolean).join(', ');

    const created = await base44.entities.JourneyOrder.create({
      rfms_order_id: jobId,
      invoice_number: job.documentNumber || '',
      customer_name: getJobName(job),
      address: (job._address || '').trim(),
      city: (job._city || '').trim(),
      state: (job._state || '').trim(),
      zip_code: zip,
      install_date: dateStr,
      order_date: getJobScheduledStart(job) || '',
      order_total: getJobTotal(job),
      region_assignment_id: matchedRegion?.id || '',
      region_name: matchedRegion?.region_name || '',
      field_manager_id: matchedRegion?.field_manager_id || '',
      install_coordinator_id: matchedRegion?.install_coordinator_id || '',
      order_entry_id: matchedRegion?.order_entry_id || '',
      preferred_installer_crew_id: matchedRegion?.preferred_installer_crew_id || '',
      preferred_installer_crew_name: (job.crewName || '').trim() || matchedRegion?.preferred_installer_crew_name || '',
      status: matchedRegion ? 'assigned' : 'unassigned',
      line_items: job._lineItems || [],
      rfms_raw: job,
    });
    queryClient.invalidateQueries({ queryKey: ['journeyOrders'] });

    // Geocode in background
    if (address) {
      base44.functions.invoke('journeyGeocode', { address }).then(res => {
        if (res.data?.success && res.data.lat && res.data.lng) {
          base44.entities.JourneyOrder.update(created.id, { lat: res.data.lat, lng: res.data.lng }).then(() => {
            queryClient.invalidateQueries({ queryKey: ['journeyOrders'] });
          });
        }
      }).catch(() => {});
    }
  };

  const handleUnschedule = async (journeyOrderId) => {
    await base44.entities.JourneyOrder.update(journeyOrderId, { install_date: null });
    queryClient.invalidateQueries({ queryKey: ['journeyOrders'] });
  };

  const handleClearDay = async (journeyOrderIds) => {
    await Promise.all(journeyOrderIds.map(id => base44.entities.JourneyOrder.update(id, { install_date: null })));
    queryClient.invalidateQueries({ queryKey: ['journeyOrders'] });
  };

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: Job Pool ── */}
      <div className="w-56 shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{t('jcJobPool')}</p>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="p-1 rounded hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
              title={t('jcRefresh')}
            >
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>
          <form onSubmit={handleJobsSearch} className="space-y-1">
            <input
              type="date"
              value={jobsFromInput}
              onChange={e => setJobsFromInput(e.target.value)}
              className="w-full px-2 py-1 text-[11px] bg-background text-foreground border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="date"
              value={jobsToInput}
              onChange={e => setJobsToInput(e.target.value)}
              className="w-full px-2 py-1 text-[11px] bg-background text-foreground border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button type="submit" className="w-full py-1 bg-primary text-primary-foreground rounded-md text-[10px] font-medium hover:bg-primary/90">{t('jcSearch')}</button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <span className="text-[10px] text-muted-foreground">{t('jcLoadingJobs')}</span>
            </div>
          )}
          {fetchError && (
            <div className="flex flex-col items-center py-6 gap-1 text-center px-2">
              <AlertCircle className="w-4 h-4 text-destructive" />
              <span className="text-[10px] text-destructive">{t('jcFailedLoad')}</span>
            </div>
          )}
          {!isLoading && !fetchError && (
            <>
              {regions.map(region => (
                <RegionPool
                  key={region.id}
                  region={region}
                  jobs={regionJobsMap[region.id] || []}
                  highValueThreshold={highValueThreshold}
                />
              ))}
              <UnmatchedPool jobs={unmatchedJobs} highValueThreshold={highValueThreshold} />
              {rfmsJobs.length === 0 && (
                <p className="text-[10px] text-muted-foreground text-center mt-8 px-2">{t('jcNoJobsRange')}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Right: Calendar ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card shrink-0">
          <button onClick={() => setWeekStart(w => subWeeks(w, 1))} className="p-1 rounded hover:bg-muted/60">
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <button onClick={() => setWeekStart(w => addWeeks(w, 1))} className="p-1 rounded hover:bg-muted/60">
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
          <span className="text-sm font-semibold text-foreground">
            {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
          </span>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }))}
            className="ml-1 text-xs text-primary hover:underline"
          >
            {t('jcToday')}
          </button>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            {/* Threshold control is warn-toned because it sets the "high $" alert line, not for decoration. */}
            <label className="flex items-center gap-1.5 bg-warn/10 border border-warn/30 rounded-lg px-2 py-1">
              <span className="text-[10px] text-warn font-medium whitespace-nowrap">{t('jcHighValue')}</span>
              <input
                type="number"
                min="0"
                step="1000"
                value={highValueThreshold}
                onChange={e => {
                  handleThresholdChange(Number(e.target.value));
                }}
                className="w-16 px-1 py-0.5 text-[11px] border border-warn/40 rounded focus:outline-none focus:ring-1 focus:ring-warn bg-background text-foreground"
              />
            </label>
            {regions.map(r => (
              <div key={r.id} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color || '#94a3b8' }} />
                <span className="text-[10px] text-muted-foreground">{r.region_name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {days.map(day => (
            <DayColumn
              key={day.toISOString()}
              date={day}
              scheduledOrders={getOrdersForDay(day)}
              regionByOrderId={regionByOrderId}
              onDrop={handleDrop}
              onUnschedule={handleUnschedule}
              onClearDay={handleClearDay}
              highValueThreshold={highValueThreshold}
            />
          ))}
        </div>
      </div>
    </div>
  );
}