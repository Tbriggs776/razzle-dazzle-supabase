import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure, invokeNotSent } from '@/lib/invokeResult';
import { toast } from 'sonner';
import DateRangePicker from '@/components/dashboard/DateRangePicker';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const WORKING_DAYS_MONTH = 22;
const WORKING_DAYS_YEAR = 260;

const fmt = (n, decimals = 1) => Number(n).toFixed(decimals);
const fmtDollar = (n) => '$' + Math.round(n).toLocaleString();
const fmtPct = (n) => (n * 100).toFixed(1) + '%';

function LeverSlider({ label, value, min, max, step, format, onChange, onDetail }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-black text-foreground whitespace-nowrap">{format(value)}</span>
          {onDetail && (
            <button
              onClick={onDetail}
              className="px-2 py-0.5 text-xs font-semibold bg-brand-pink text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Detail
            </button>
          )}
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full cursor-pointer accent-[hsl(var(--brand-pink))]"
      />
    </div>
  );
}

function PillarCard({ pillarNum, pillarName, mainValue, mainLabel, rows, onDetail }) {
  return (
    <div className="border border-border rounded-xl p-5 bg-card">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Pillar {pillarNum}</p>
      <p className="text-sm font-bold uppercase text-foreground mb-3">{pillarName}</p>
      <div className="flex items-baseline gap-3">
        <p className="text-4xl font-black text-foreground">{mainValue}</p>
        {onDetail && (
          <button
            onClick={onDetail}
            className="px-2.5 py-0.5 text-xs font-semibold bg-brand-pink text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Detail
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-4">{mainLabel}</p>
      <div className="border-t border-dashed border-border pt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-semibold text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowBox({ value, label, highlight }) {
  return (
    <div className={`flex-1 min-w-[80px] rounded-xl p-4 text-center ${highlight ? 'bg-brand-pink text-white' : 'bg-brand-navy text-white'}`}>
      <p className="text-3xl font-black">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wider mt-1 opacity-80">{label}</p>
    </div>
  );
}

function SectionHeader({ title }) {
  return (
    <h2 className="text-lg font-black uppercase tracking-wide text-foreground border-l-4 border-brand-pink pl-3 mb-4">{title}</h2>
  );
}

function getPhoenixToday() {
  return new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }));
}

export default function Dashboard() {
  const today = getPhoenixToday();
  const [dateRange, setDateRange] = useState({ start: today, end: today });
  const [ghlLoading, setGhlLoading] = useState(false);
  // All GHL dateAdded timestamps — fetched once on mount
  const [allDateAdded, setAllDateAdded] = useState(null);

  const [lastFetched, setLastFetched] = useState(null);

  const loadFromCache = async () => {
    setGhlLoading(true);
    try {
      const r = await base44.functions.invoke('getGHLLeadCount', {});
      setAllDateAdded(r.data?.dateAddedList ?? []);
      setLastFetched(r.data?.synced_at ? new Date(r.data.synced_at) : new Date());
    } catch (e) {
      setAllDateAdded([]);
    } finally {
      setGhlLoading(false);
    }
  };

  const refreshGHL = async () => {
    setGhlLoading(true);
    try {
      // A refresh button that silently does nothing is indistinguishable from a
      // refresh that found no new leads — and GHL has no credentials today, so
      // that is exactly what this returns.
      const res = await base44.functions.invoke('syncGHLContacts', {});
      const failed = invokeFailure(res);
      const notSent = invokeNotSent(res);
      if (failed) { toast.error(`Could not refresh from GoHighLevel — ${failed}`); setGhlLoading(false); return; }
      if (notSent) { toast.warning(`Nothing was refreshed — ${notSent}`, { duration: 8000 }); }
      await loadFromCache();
    } catch (e) {
      setGhlLoading(false);
    }
  };

  // Load from cache on mount
  useEffect(() => { loadFromCache(); }, []);

  // Compute total leads and per-day average from cached data whenever date range changes
  const { ghlLeadsTotal, ghlLeadsPerDay } = useMemo(() => {
    if (!allDateAdded) return { ghlLeadsTotal: null, ghlLeadsPerDay: null };
    const { start, end } = dateRange;
    const startUTC = new Date(start.toLocaleDateString('en-CA') + 'T07:00:00.000Z');
    const endUTC = new Date(new Date(end.getTime() + 86400000).toLocaleDateString('en-CA') + 'T07:00:00.000Z');
    const dayCount = Math.round((end - start) / 86400000) + 1;
    const count = allDateAdded.filter(d => {
      const t = new Date(d).getTime();
      return t >= startUTC.getTime() && t < endUTC.getTime();
    }).length;
    return { ghlLeadsTotal: count, ghlLeadsPerDay: Math.round(count / dayCount) };
  }, [allDateAdded, dateRange]);

  // Auto-push into lever whenever computed value changes
  useEffect(() => {
    if (ghlLeadsPerDay !== null) setLeadsPerDay(ghlLeadsPerDay);
  }, [ghlLeadsPerDay]);

  // Levers state
  const [leadsPerDay, setLeadsPerDay] = useState(50);
  const [marketingSpend, setMarketingSpend] = useState(12100);
  const [bookingRate, setBookingRate] = useState(0.25);
  const [closeRate, setCloseRate] = useState(0.40);
  const [avgTicket, setAvgTicket] = useState(11500);
  const [depositPct, setDepositPct] = useState(0.50);
  const [installCapacity, setInstallCapacity] = useState(5);
  const [grossMargin, setGrossMargin] = useState(0.50);

  // Appointments run — fetched from our system by appointment_date (AZ local date = YYYY-MM-DD)
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [allAppointments, setAllAppointments] = useState(null);

  const loadAppointments = async () => {
    setAppointmentsLoading(true);
    try {
      // Fetch all appointments with a real run status — appointment_date is stored as YYYY-MM-DD AZ local
      const RUN_STATUSES = ['In Route', 'On Site', 'Completed', 'Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up'];
      const appts = await base44.entities.Appointment.filter({ status: { $in: RUN_STATUSES } });
      setAllAppointments(appts);
    } catch (e) {
      setAllAppointments([]);
    } finally {
      setAppointmentsLoading(false);
    }
  };

  useEffect(() => { loadAppointments(); }, []);

  // Sales — fetched from Sale entity
  const [allSales, setAllSales] = useState(null);

  const loadSales = async () => {
    try {
      const sales = await base44.entities.Sale.list();
      setAllSales(sales);
    } catch (e) {
      setAllSales([]);
    }
  };

  useEffect(() => { loadSales(); }, []);

  const { salesTotal, salesPerDay, salesTotalAmount } = useMemo(() => {
    if (!allSales) return { salesTotal: null, salesPerDay: null, salesTotalAmount: null };
    const { start, end } = dateRange;
    const startStr = start.toLocaleDateString('en-CA');
    const endStr = end.toLocaleDateString('en-CA');
    const dayCount = Math.round((end - start) / 86400000) + 1;
    const inRange = allSales.filter(s => {
      if (!s.sale_date) return false;
      const d = new Date(s.sale_date).toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
      return d >= startStr && d <= endStr;
    });
    const totalAmount = inRange.reduce((sum, s) => sum + (s.sale_amount || 0), 0);
    return { salesTotal: inRange.length, salesPerDay: inRange.length / dayCount, salesTotalAmount: totalAmount };
  }, [allSales, dateRange]);

  const salesPerDayData = useMemo(() => {
    if (!allSales) return [];
    const { start, end } = dateRange;
    const dayCount = Math.round((end - start) / 86400000) + 1;
    const result = [];
    for (let i = 0; i < dayCount; i++) {
      const day = new Date(start.getTime() + i * 86400000);
      const dayStr = day.toLocaleDateString('en-CA');
      const count = allSales.filter(s => {
        if (!s.sale_date) return false;
        return new Date(s.sale_date).toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }) === dayStr;
      }).length;
      result.push({ date: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), sales: count });
    }
    return result;
  }, [allSales, dateRange]);

  // Re-load appointments when date range changes (lightweight — already filtered by status)
  const { apptTotal, apptPerDay } = useMemo(() => {
    if (!allAppointments) return { apptTotal: null, apptPerDay: null };
    const { start, end } = dateRange;
    const startStr = start.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const endStr = end.toLocaleDateString('en-CA');
    const dayCount = Math.round((end - start) / 86400000) + 1;
    const count = allAppointments.filter(a => {
      const d = a.appointment_date;
      return d && d >= startStr && d <= endStr;
    }).length;
    return { apptTotal: count, apptPerDay: count / dayCount };
  }, [allAppointments, dateRange]);

  // Appointments per day breakdown for bar chart
  const apptPerDayData = useMemo(() => {
    if (!allAppointments) return [];
    const { start, end } = dateRange;
    const dayCount = Math.round((end - start) / 86400000) + 1;
    const result = [];
    for (let i = 0; i < dayCount; i++) {
      const day = new Date(start.getTime() + i * 86400000);
      const dayStr = day.toLocaleDateString('en-CA');
      const count = allAppointments.filter(a => a.appointment_date === dayStr).length;
      result.push({ date: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), appointments: count });
    }
    return result;
  }, [allAppointments, dateRange]);

  const [showLeadsChart, setShowLeadsChart] = useState(false);
  const [showApptChart, setShowApptChart] = useState(false);
  const [showSalesChart, setShowSalesChart] = useState(false);
  const [cashTab, setCashTab] = useState('day');

  // Computed values — use real data when available
  const appsRun = apptPerDay !== null ? apptPerDay : leadsPerDay * bookingRate;
  const realBookingRate = (apptPerDay !== null && leadsPerDay > 0) ? apptPerDay / leadsPerDay : bookingRate;
  const jobsSold = salesPerDay !== null ? salesPerDay : appsRun * closeRate;
  const realCloseRate = (salesPerDay !== null && appsRun > 0) ? salesPerDay / appsRun : closeRate;
  const costPerLead = leadsPerDay > 0 ? marketingSpend / leadsPerDay : 0;
  const costPerSoldJob = jobsSold > 0 ? marketingSpend / jobsSold : 0;
  const soldValue = salesTotalAmount !== null && salesTotalAmount > 0 ? salesTotalAmount : jobsSold * avgTicket;
  const jobsCompleted = Math.min(jobsSold, installCapacity);
  const completedValue = jobsCompleted * avgTicket;
  const deposits = soldValue * depositPct;
  const finalPayments = completedValue * (1 - depositPct);
  const totalCash = deposits + finalPayments;
  const grossProfit = completedValue * grossMargin;

  const mult = cashTab === 'day' ? 1 : cashTab === 'month' ? WORKING_DAYS_MONTH : WORKING_DAYS_YEAR;

  // Leads per day breakdown for bar chart
  const leadsPerDayData = useMemo(() => {
    if (!allDateAdded) return [];
    const { start, end } = dateRange;
    const dayCount = Math.round((end - start) / 86400000) + 1;
    const result = [];
    for (let i = 0; i < dayCount; i++) {
      const day = new Date(start.getTime() + i * 86400000);
      const dayStr = day.toLocaleDateString('en-CA'); // YYYY-MM-DD in Phoenix
      const startUTC = new Date(dayStr + 'T07:00:00.000Z');
      const endUTC = new Date(new Date(day.getTime() + 86400000).toLocaleDateString('en-CA') + 'T07:00:00.000Z');
      const count = allDateAdded.filter(d => {
        const t = new Date(d).getTime();
        return t >= startUTC.getTime() && t < endUTC.getTime();
      }).length;
      result.push({ date: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), leads: count });
    }
    return result;
  }, [allDateAdded, dateRange]);

  const balanceDiff = jobsSold - installCapacity;
  const inBalance = Math.abs(balanceDiff) < 0.05;
  const backlogged = balanceDiff > 0.05;

  const cashRows = [
    { label: 'Jobs sold', value: fmt(jobsSold * mult), bold: false },
    { label: 'Jobs completed', value: fmt(jobsCompleted * mult), bold: false },
    { label: 'Sold value', value: fmtDollar(soldValue * mult), bold: false },
    { label: 'Completed value', value: fmtDollar(completedValue * mult), bold: false },
    { label: 'Deposits collected at sale', value: fmtDollar(deposits * mult), bold: false },
    { label: 'Final payments at completion', value: fmtDollar(finalPayments * mult), bold: false },
    { label: 'Total cash collected', value: fmtDollar(totalCash * mult), bold: true },
    { label: 'Gross profit on completed work', value: fmtDollar(grossProfit * mult), bold: true },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-10">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wide text-foreground">Operational Levers</h1>
            <p className="text-sm text-muted-foreground mt-1">Adjust the levers — the scoreboard recomputes instantly.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {ghlLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {!ghlLoading && lastFetched && (
              <span className="text-xs text-muted-foreground">
                Updated {lastFetched.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={refreshGHL}
              disabled={ghlLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border rounded-lg hover:bg-secondary disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${ghlLoading ? 'animate-spin' : ''}`} />
              Refresh GHL
            </button>
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        </div>



        {/* 4-PILLAR SCOREBOARD */}
        <section>
          <SectionHeader title="The 4-Pillar Scoreboard (Per Day)" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <PillarCard pillarNum={1} pillarName="Marketing" mainValue={ghlLeadsTotal ?? leadsPerDay} mainLabel={ghlLeadsTotal != null ? `leads in range (${leadsPerDay}/day avg)` : "leads generated"}
              rows={[{ label: 'Spend', value: fmtDollar(marketingSpend) }, { label: 'Cost per lead', value: fmtDollar(costPerLead) }]}
              onDetail={() => setShowLeadsChart(true)} />
            <PillarCard pillarNum={2} pillarName="Front Office" mainValue={apptTotal ?? fmt(appsRun)} mainLabel={apptTotal != null ? `appointments run in range (${fmt(apptPerDay, 1)}/day avg)` : "appointments run"}
              rows={[{ label: 'Booking rate', value: fmtPct(realBookingRate) }, { label: 'Of leads', value: ghlLeadsTotal ?? leadsPerDay }]}
              onDetail={() => setShowApptChart(true)} />
            <PillarCard pillarNum={3} pillarName="Sales" mainValue={salesTotal ?? fmt(jobsSold)} mainLabel={salesTotal != null ? `jobs sold in range (${fmt(salesPerDay, 1)}/day avg)` : "jobs sold"}
              rows={[{ label: 'Close rate', value: fmtPct(realCloseRate) }, { label: 'Sold value', value: fmtDollar(soldValue) }, { label: 'Cost per sold job', value: fmtDollar(costPerSoldJob) }]}
              onDetail={() => setShowSalesChart(true)} />
            <PillarCard pillarNum={4} pillarName="Installs" mainValue={fmt(jobsCompleted)} mainLabel="jobs completed"
              rows={[{ label: 'Capacity', value: `${installCapacity} / day` }, { label: 'Completed value', value: fmtDollar(completedValue) }, { label: 'Cash collected', value: fmtDollar(totalCash) }]} />
          </div>
        </section>

        {/* THE FLOW */}
        <section>
          <SectionHeader title="The Flow" />
          <div className="flex items-center gap-2 flex-wrap">
            <FlowBox value={leadsPerDay} label="Leads" highlight={false} />
            <div className="text-center px-1 shrink-0"><p className="text-sm font-bold text-muted-foreground">{fmtPct(realBookingRate)}</p></div>
            <FlowBox value={fmt(appsRun)} label="Run Appts" highlight={false} />
            <div className="text-center px-1 shrink-0"><p className="text-sm font-bold text-muted-foreground">{fmtPct(realCloseRate)}</p></div>
            <FlowBox value={fmt(jobsSold)} label="Sold" highlight={true} />
            <div className="text-center px-1 shrink-0"><p className="text-sm font-bold text-muted-foreground">100%</p></div>
            <FlowBox value={fmt(jobsCompleted)} label="Installed" highlight={false} />
          </div>
        </section>

        {/* DAILY PRODUCTION & CASH */}
        <section>
          <SectionHeader title="Daily Production & Cash" />
          <div className="flex flex-nowrap gap-2 mb-4 overflow-x-auto pb-1">
            {['day', 'month', 'year'].map(tab => (
              <button key={tab} onClick={() => setCashTab(tab)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold border whitespace-nowrap transition-colors ${cashTab === tab ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-secondary'}`}>
                Per {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="border border-border rounded-xl overflow-hidden bg-card">
            {cashRows.map((row, i) => (
              <div key={i} className={`flex justify-between items-center px-6 py-3 ${row.bold ? 'border-t-2 border-foreground bg-secondary' : i > 0 ? 'border-t border-dashed border-border' : ''}`}>
                <span className={`text-sm ${row.bold ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{row.label}</span>
                <span className={`text-sm ${row.bold ? 'font-bold text-foreground' : 'font-semibold text-foreground'}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* INSTALL BALANCE */}
        <section>
          <SectionHeader title="Install Balance" />
          <div className="border border-border rounded-xl p-5 flex items-start gap-4 bg-card">
            <span className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide ${inBalance ? 'bg-brand-navy text-white' : backlogged ? 'bg-brand-pink text-white' : 'bg-amber-500 text-white'}`}>
              {inBalance ? 'In Balance' : backlogged ? 'Backlogged' : 'Surplus Capacity'}
            </span>
            <p className="text-sm text-foreground mt-0.5">
              {inBalance
                ? `Crews finish exactly what sales writes, ${fmt(jobsCompleted)} jobs a day. The cycle is closed and the day clears clean.`
                : backlogged
                  ? `Sales is writing ${fmt(jobsSold)} jobs/day but install capacity is only ${installCapacity}. Backlog is building — add crew capacity.`
                  : `Install capacity (${installCapacity}/day) exceeds sales volume (${fmt(jobsSold)}/day). Crews have idle capacity — push harder on marketing or close rate.`}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-3">Planning model for operations. Booking and close rates start at Floor Daddy's stated 22.5% and 38.9%. Tune every lever to your real numbers and the whole day reflows.</p>
        </section>

      </div>

      {/* Sales per day chart modal */}
      {showSalesChart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowSalesChart(false)}>
          <div className="bg-card rounded-2xl shadow-2xl p-6 w-full max-w-3xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-black uppercase tracking-wide text-foreground border-l-4 border-brand-pink pl-3">Sales Per Day</h2>
                <p className="text-xs text-muted-foreground mt-1 ml-4">
                  {dateRange.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {dateRange.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
              <button onClick={() => setShowSalesChart(false)} className="p-2 hover:bg-secondary rounded-lg transition-colors">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            {salesPerDayData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No data available for this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={salesPerDayData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                    interval={salesPerDayData.length > 30 ? Math.floor(salesPerDayData.length / 15) : 0} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="sales" fill="hsl(var(--brand-pink))" radius={[4, 4, 0, 0]} name="Sales" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Appointments per day chart modal */}
      {showApptChart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowApptChart(false)}>
          <div className="bg-card rounded-2xl shadow-2xl p-6 w-full max-w-3xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-black uppercase tracking-wide text-foreground border-l-4 border-brand-pink pl-3">Appointments Run Per Day</h2>
                <p className="text-xs text-muted-foreground mt-1 ml-4">
                  {dateRange.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {dateRange.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
              <button onClick={() => setShowApptChart(false)} className="p-2 hover:bg-secondary rounded-lg transition-colors">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            {apptPerDayData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No data available for this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={apptPerDayData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                    interval={apptPerDayData.length > 30 ? Math.floor(apptPerDayData.length / 15) : 0} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="appointments" fill="hsl(var(--brand-pink))" radius={[4, 4, 0, 0]} name="Appointments" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Leads per day chart modal */}
      {showLeadsChart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowLeadsChart(false)}>
          <div className="bg-card rounded-2xl shadow-2xl p-6 w-full max-w-3xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-black uppercase tracking-wide text-foreground border-l-4 border-brand-pink pl-3">Leads Per Day</h2>
                <p className="text-xs text-muted-foreground mt-1 ml-4">
                  {dateRange.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {dateRange.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
              <button onClick={() => setShowLeadsChart(false)} className="p-2 hover:bg-secondary rounded-lg transition-colors">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            {leadsPerDayData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No data available for this range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={leadsPerDayData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                    interval={leadsPerDayData.length > 30 ? Math.floor(leadsPerDayData.length / 15) : 0} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="leads" fill="hsl(var(--brand-pink))" radius={[4, 4, 0, 0]} name="Leads" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}