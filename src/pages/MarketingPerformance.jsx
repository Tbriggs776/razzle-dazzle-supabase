import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import DateRangePicker from '@/components/dashboard/DateRangePicker';
import { Loader2, RefreshCw, Settings, TrendingDown, TrendingUp, DollarSign, Users, Target, CalendarDays, ShoppingBag } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line, ComposedChart, ReferenceLine } from 'recharts';
import { toast } from 'sonner';
import { invokeFailure, invokeNotSent } from '@/lib/invokeResult';

const COLORS = ['#4F46E5', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

function getPhoenixToday() {
  return new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }));
}

function parseSpreadsheetId(input) {
  const s = input.trim();
  // Full URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
  const urlMatch = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  // Assume raw ID
  return s;
}

export default function MarketingPerformance() {
  const today = getPhoenixToday();
  const past30 = new Date(today.getTime() - 29 * 86400000);
  const [dateRange, setDateRange] = useState({ start: past30, end: today });

  const [spreadsheetInput, setSpreadsheetInput] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [appSettingsId, setAppSettingsId] = useState(null);

  const [adSpendLoading, setAdSpendLoading] = useState(false);
  const [adSpendError, setAdSpendError] = useState(null);
  const [adSpendEntries, setAdSpendEntries] = useState(null);
  const [adSpendHeaders, setAdSpendHeaders] = useState([]);

  const [ghlLoading, setGhlLoading] = useState(false);
  const [allDateAdded, setAllDateAdded] = useState(null);
  const [ghlSyncedAt, setGhlSyncedAt] = useState(null);

  const [apptLoading, setApptLoading] = useState(false);
  const [allApptDates, setAllApptDates] = useState(null);
  const [allCancelledApptDates, setAllCancelledApptDates] = useState(null);

  const [salesLoading, setSalesLoading] = useState(false);
  const [allSales, setAllSales] = useState(null);

  // Monthly marketing budget (TV, Grass Roots, Print Media actuals) — read from the "OtherChannels" tab of the same ad-spend spreadsheet
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [marketingBudget, setMarketingBudget] = useState(null);

  // Load GHL lead count from cache
  const loadGHLLeads = async () => {
    setGhlLoading(true);
    try {
      const r = await base44.functions.invoke('getGHLLeadCount', {});
      // A failure here used to land as an empty list, which reads on screen as "0 leads" —
      // real-looking data. Say it failed instead.
      const failed = invokeFailure(r);
      if (failed) {
        toast.error(`Could not load the lead counts — ${failed}`);
        setAllDateAdded([]);
        return;
      }
      const notLoaded = invokeNotSent(r);
      if (notLoaded) toast.warning(`Lead counts are unavailable — ${notLoaded}`);
      setAllDateAdded(r.data?.dateAddedList ?? []);
      setGhlSyncedAt(r.data?.synced_at ? new Date(r.data.synced_at) : null);
    } catch (e) {
      setAllDateAdded([]);
    } finally {
      setGhlLoading(false);
    }
  };

  // Sync GHL contacts (full refresh)
  const refreshGHL = async () => {
    setGhlLoading(true);
    try {
      const res = await base44.functions.invoke('syncGHLContacts', {});
      const failed = invokeFailure(res);
      if (failed) {
        toast.error(`Could not sync the leads — ${failed}`);
        setGhlLoading(false);
        return;
      }
      const notSynced = invokeNotSent(res);
      if (notSynced) toast.warning(`Nothing was synced — ${notSynced}`);
      await loadGHLLeads();
    } catch (e) {
      setGhlLoading(false);
    }
  };

  // Load appointments (fetch created dates for grouping by Arizona day)
  const loadAppointments = async () => {
    setApptLoading(true);
    try {
      const appts = await base44.entities.Appointment.list('-appointment_created_date', 5000);
      setAllApptDates(appts.filter(a => a.status !== 'Cancelled').map(a => a.appointment_created_date).filter(Boolean));
      setAllCancelledApptDates(appts.filter(a => a.status === 'Cancelled').map(a => a.appointment_created_date).filter(Boolean));
    } catch (e) {
      setAllApptDates([]);
      setAllCancelledApptDates([]);
    } finally {
      setApptLoading(false);
    }
  };

  // Load sales (fetch sale dates and amounts for grouping by Arizona day)
  const loadSales = async () => {
    setSalesLoading(true);
    try {
      const sales = await base44.entities.Sale.list('-sale_date', 5000);
      setAllSales(sales.filter(s => s.sale_date && !s.is_cancelled).map(s => ({ date: s.sale_date, amount: s.sale_amount || 0 })));
    } catch (e) {
      setAllSales([]);
    } finally {
      setSalesLoading(false);
    }
  };

  // Load monthly marketing budget (TV, Grass Roots, Print Media) from the "OtherChannels" tab of the same ad-spend spreadsheet
  const loadMarketingBudget = async () => {
    if (!spreadsheetId) return;
    setBudgetLoading(true);
    try {
      const r = await base44.functions.invoke('getMarketingBudget', { spreadsheet_id: spreadsheetId, sheet_name: 'OtherChannels' });
      const failed = invokeFailure(r);
      if (failed) {
        toast.error(`Could not load the marketing budget — ${failed}`);
        setMarketingBudget([]);
        return;
      }
      const notLoaded = invokeNotSent(r);
      if (notLoaded) toast.warning(`The marketing budget is unavailable — ${notLoaded}`);
      setMarketingBudget(r.data?.entries ?? []);
    } catch (e) {
      setMarketingBudget([]);
    } finally {
      setBudgetLoading(false);
    }
  };

  // Load ad spend from Google Sheets
  const loadAdSpend = async () => {
    if (!spreadsheetId) return;
    setAdSpendLoading(true);
    setAdSpendError(null);
    try {
      const r = await base44.functions.invoke('getAdSpend', { spreadsheet_id: spreadsheetId });
      // Route a failure into the error panel that already exists below (with its Retry button)
      // rather than showing an empty spend table that looks like a real zero.
      const failed = invokeFailure(r);
      if (failed) {
        setAdSpendError(failed);
        setAdSpendEntries([]);
        return;
      }
      const notLoaded = invokeNotSent(r);
      if (notLoaded) toast.warning(`No ad spend was loaded — ${notLoaded}`);
      setAdSpendEntries(r.data?.entries ?? []);
      setAdSpendHeaders(r.data?.headers ?? []);
    } catch (e) {
      setAdSpendError(e.response?.data?.error || e.message || 'Failed to load ad spend data');
      setAdSpendEntries([]);
    } finally {
      setAdSpendLoading(false);
    }
  };

  // Load spreadsheet ID from AppSettings (shared across all users)
  useEffect(() => {
    (async () => {
      try {
        const settings = await base44.entities.AppSettings.list();
        const s = settings[0];
        if (s) {
          setAppSettingsId(s.id);
          if (s.ad_spend_spreadsheet_id) {
            setSpreadsheetId(s.ad_spend_spreadsheet_id);
            setSpreadsheetInput(s.ad_spend_spreadsheet_id);
          }
        }
      } catch (e) { /* ignore */ }
    })();
    loadGHLLeads();
    loadAppointments();
    loadSales();
  }, []);

  // Auto-load ad spend + marketing budget when spreadsheet ID becomes available
  useEffect(() => {
    if (spreadsheetId) {
      loadAdSpend();
      loadMarketingBudget();
    }
  }, [spreadsheetId]);

  const handleSaveSpreadsheetId = async () => {
    const id = parseSpreadsheetId(spreadsheetInput);
    if (appSettingsId) {
      await base44.entities.AppSettings.update(appSettingsId, { ad_spend_spreadsheet_id: id });
    } else {
      const created = await base44.entities.AppSettings.create({ ad_spend_spreadsheet_id: id });
      setAppSettingsId(created.id);
    }
    setSpreadsheetId(id);
    setShowSettings(false);
    loadAdSpend();
  };

  // Build merged daily data: ad spend + GHL leads + cost per lead
  const dailyData = useMemo(() => {
    if (!adSpendEntries && !allDateAdded && !allApptDates && !allCancelledApptDates && !allSales) return [];

    const { start, end } = dateRange;
    const dayCount = Math.round((end - start) / 86400000) + 1;
    const result = [];

    // Build a map of ad spend by date
    const adSpendMap = {};
    (adSpendEntries || []).forEach(e => {
      adSpendMap[e.date] = e;
    });

    // Build a map of monthly budget (OtherChannels: TV, Grass Roots, Print Media) by month key
    const BUDGET_CHANNELS = ['TV', 'Grass Roots', 'Print Media'];
    const budgetByMonth = {};
    (marketingBudget || []).forEach(b => {
      if (!b.month) return;
      budgetByMonth[b.month] = b.platforms || {};
    });

    for (let i = 0; i < dayCount; i++) {
      const day = new Date(start.getTime() + i * 86400000);
      const dayStr = day.toLocaleDateString('en-CA');

      // GHL leads for this day (Phoenix time: UTC-7)
      const startUTC = new Date(dayStr + 'T07:00:00.000Z');
      const endUTC = new Date(new Date(day.getTime() + 86400000).toLocaleDateString('en-CA') + 'T07:00:00.000Z');
      let leads = 0;
      if (allDateAdded) {
        leads = allDateAdded.filter(d => {
          const t = new Date(d).getTime();
          return t >= startUTC.getTime() && t < endUTC.getTime();
        }).length;
      }

      let appointments = 0;
      if (allApptDates) {
        appointments = allApptDates.filter(d => {
          const t = new Date(d).getTime();
          return t >= startUTC.getTime() && t < endUTC.getTime();
        }).length;
      }

      let cancelledAppts = 0;
      if (allCancelledApptDates) {
        cancelledAppts = allCancelledApptDates.filter(d => {
          const t = new Date(d).getTime();
          return t >= startUTC.getTime() && t < endUTC.getTime();
        }).length;
      }

      let sales = 0;
      let salesRevenue = 0;
      if (allSales) {
        const daySales = allSales.filter(s => {
          const t = new Date(s.date).getTime();
          return t >= startUTC.getTime() && t < endUTC.getTime();
        });
        sales = daySales.length;
        salesRevenue = daySales.reduce((sum, s) => sum + (s.amount || 0), 0);
      }

      const adEntry = adSpendMap[dayStr];
      const monthKey = dayStr.slice(0, 7);
      const dayDate = new Date(dayStr + 'T00:00:00');
      const isFirstOfMonth = dayDate.getDate() === 1;
      const budgetCharges = isFirstOfMonth ? (budgetByMonth[monthKey] || {}) : {};
      const platforms = { ...(adEntry?.platforms || {}) };
      let spend = adEntry?.total || 0;
      BUDGET_CHANNELS.forEach(p => {
        const amt = budgetCharges[p];
        if (amt != null && amt !== 0) {
          platforms[p] = (platforms[p] || 0) + amt;
          spend += amt;
        }
      });
      const cpl = leads > 0 ? spend / leads : 0;
      const cpa = appointments > 0 ? spend / appointments : 0;
      const cps = sales > 0 ? spend / sales : 0;

      result.push({
        date: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dateStr: dayStr,
        spend: parseFloat(spend.toFixed(2)),
        leads,
        appointments,
        cancelledAppts,
        sales,
        salesRevenue: parseFloat(salesRevenue.toFixed(2)),
        cpl: parseFloat(cpl.toFixed(2)),
        cpa: parseFloat(cpa.toFixed(2)),
        cps: parseFloat(cps.toFixed(2)),
        platforms,
      });
    }

    return result;
  }, [adSpendEntries, allDateAdded, allApptDates, allCancelledApptDates, allSales, marketingBudget, dateRange]);

  // Summary metrics
  const summary = useMemo(() => {
    const totalSpend = dailyData.reduce((s, d) => s + d.spend, 0);
    const totalLeads = dailyData.reduce((s, d) => s + d.leads, 0);
    const totalAppointments = dailyData.reduce((s, d) => s + d.appointments, 0);
    const totalCancelledAppts = dailyData.reduce((s, d) => s + d.cancelledAppts, 0);
    const totalSales = dailyData.reduce((s, d) => s + d.sales, 0);
    const totalSalesRevenue = dailyData.reduce((s, d) => s + d.salesRevenue, 0);
    const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const avgCPA = totalAppointments > 0 ? totalSpend / totalAppointments : 0;
    const avgCPS = totalSales > 0 ? totalSpend / totalSales : 0;
    const daysWithData = dailyData.filter(d => d.spend > 0 || d.leads > 0 || d.appointments > 0 || d.cancelledAppts > 0 || d.sales > 0).length;

    // Per-platform totals
    const platformTotals = {};
    dailyData.forEach(d => {
      Object.entries(d.platforms || {}).forEach(([platform, amount]) => {
        if (platform.toLowerCase() !== 'total') {
          platformTotals[platform] = (platformTotals[platform] || 0) + amount;
        }
      });
    });

    return {
      totalSpend: parseFloat(totalSpend.toFixed(2)),
      totalLeads,
      totalAppointments,
      totalCancelledAppts,
      totalSales,
      totalSalesRevenue: parseFloat(totalSalesRevenue.toFixed(2)),
      avgCPL: parseFloat(avgCPL.toFixed(2)),
      avgCPA: parseFloat(avgCPA.toFixed(2)),
      avgCPS: parseFloat(avgCPS.toFixed(2)),
      daysWithData,
      platformTotals,
    };
  }, [dailyData]);

  // Leads-per-day trend: 7-day moving average + first-half vs second-half comparison
  const leadsTrend = useMemo(() => {
    const daysWithLeads = dailyData.filter(d => d.leads > 0 || d.spend > 0);
    if (daysWithLeads.length === 0) return { chartData: [], avgFirstHalf: 0, avgSecondHalf: 0, movingAvg: 0, trendDir: 'flat', trendPct: 0 };

    const chartData = dailyData.map((d, i) => {
      // 7-day trailing moving average (centered when possible)
      const window = dailyData.slice(Math.max(0, i - 3), i + 4);
      const valid = window.filter(w => w.leads > 0 || w.spend > 0);
      const ma = valid.length > 0 ? valid.reduce((s, w) => s + w.leads, 0) / valid.length : 0;
      return { date: d.date, dateStr: d.dateStr, leads: d.leads, ma7: parseFloat(ma.toFixed(1)) };
    });

    const validDays = dailyData.filter(d => d.leads > 0 || d.spend > 0);
    const mid = Math.floor(validDays.length / 2);
    const firstHalf = validDays.slice(0, mid);
    const secondHalf = validDays.slice(mid);
    const avgFirstHalf = firstHalf.length > 0 ? firstHalf.reduce((s, d) => s + d.leads, 0) / firstHalf.length : 0;
    const avgSecondHalf = secondHalf.length > 0 ? secondHalf.reduce((s, d) => s + d.leads, 0) / secondHalf.length : 0;
    const recentMA = chartData.slice(-7).filter(d => d.ma7 > 0);
    const movingAvg = recentMA.length > 0 ? recentMA.reduce((s, d) => s + d.ma7, 0) / recentMA.length : 0;

    let trendDir = 'flat';
    let trendPct = 0;
    if (avgFirstHalf > 0) {
      trendPct = ((avgSecondHalf - avgFirstHalf) / avgFirstHalf) * 100;
      trendDir = trendPct > 5 ? 'up' : trendPct < -5 ? 'down' : 'flat';
    }

    return { chartData, avgFirstHalf: parseFloat(avgFirstHalf.toFixed(1)), avgSecondHalf: parseFloat(avgSecondHalf.toFixed(1)), movingAvg: parseFloat(movingAvg.toFixed(1)), trendDir, trendPct: parseFloat(trendPct.toFixed(1)) };
  }, [dailyData]);

  const platformEntries = Object.entries(summary.platformTotals).sort((a, b) => b[1] - a[1]);

  // Daily table columns: daily ad platforms + OtherChannels budget columns (TV, Grass Roots, Print Media)
  const dailyBudgetChannels = ['TV', 'Grass Roots', 'Print Media'].filter(p =>
    (marketingBudget || []).some(b => b.platforms?.[p] != null && b.platforms?.[p] !== 0)
  );
  const dailyTablePlatforms = [
    ...platformEntries.map(([p]) => p),
    ...dailyBudgetChannels.filter(p => !platformEntries.some(([pp]) => pp === p)),
  ];

  // Monthly aggregation across all loaded data (independent of selected date range)
  const monthlyData = useMemo(() => {
    const months = {};
    const ensure = (key) => {
      if (!months[key]) months[key] = { platformSpend: {}, totalSpend: 0, leads: 0, appointments: 0, cancelled: 0, sales: 0, salesRevenue: 0 };
      return months[key];
    };
    // Arizona is UTC-7 year-round (no DST)
    const phoenixMonthKey = (isoStr) => {
      const d = new Date(isoStr);
      const phx = new Date(d.getTime() + 7 * 3600000);
      return `${phx.getUTCFullYear()}-${String(phx.getUTCMonth() + 1).padStart(2, '0')}`;
    };

    (adSpendEntries || []).forEach(e => {
      if (!e.date) return;
      const key = e.date.slice(0, 7);
      const m = ensure(key);
      m.totalSpend += e.total || 0;
      Object.entries(e.platforms || {}).forEach(([p, amt]) => {
        if (p.toLowerCase() !== 'total') m.platformSpend[p] = (m.platformSpend[p] || 0) + amt;
      });
    });
    (allDateAdded || []).forEach(d => { ensure(phoenixMonthKey(d)).leads += 1; });
    (allApptDates || []).forEach(d => { ensure(phoenixMonthKey(d)).appointments += 1; });
    (allCancelledApptDates || []).forEach(d => { ensure(phoenixMonthKey(d)).cancelled += 1; });
    (allSales || []).forEach(s => {
      const m = ensure(phoenixMonthKey(s.date));
      m.sales += 1;
      m.salesRevenue += s.amount || 0;
    });

    // Merge monthly marketing budget actuals (TV, Grass Roots, Print Media)
    const BUDGET_CHANNELS = ['TV', 'Grass Roots', 'Print Media'];
    (marketingBudget || []).forEach(b => {
      if (!b.month) return;
      const m = ensure(b.month);
      BUDGET_CHANNELS.forEach(p => {
        const amt = b.platforms?.[p];
        if (amt != null && amt !== 0) {
          m.platformSpend[p] = (m.platformSpend[p] || 0) + amt;
          m.totalSpend += amt;
        }
      });
    });

    return Object.keys(months).sort().map(key => {
      const [y, mo] = key.split('-');
      const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const m = months[key];
      return {
        key,
        label,
        platformSpend: m.platformSpend,
        totalSpend: parseFloat(m.totalSpend.toFixed(2)),
        leads: m.leads,
        appointments: m.appointments,
        cancelled: m.cancelled,
        sales: m.sales,
        salesRevenue: parseFloat(m.salesRevenue.toFixed(2)),
      };
    });
  }, [adSpendEntries, allDateAdded, allApptDates, allCancelledApptDates, allSales, marketingBudget]);

  // Only show months up to the current month (drop future months)
  const currentMonthKey = useMemo(() => {
    const phx = new Date(today.getTime() + 7 * 3600000);
    return `${phx.getUTCFullYear()}-${String(phx.getUTCMonth() + 1).padStart(2, '0')}`;
  }, [today]);

  const visibleMonthlyData = useMemo(() => monthlyData.filter(m => m.key <= currentMonthKey), [monthlyData, currentMonthKey]);

  const monthlyPlatformNames = useMemo(() => {
    const set = new Set();
    visibleMonthlyData.forEach(m => Object.keys(m.platformSpend).forEach(p => set.add(p)));
    // Keep daily platforms first (alphabetical), then budget channels in fixed order
    const order = ['TV', 'Grass Roots', 'Print Media'];
    return Array.from(set).sort((a, b) => {
      const ai = order.indexOf(a), bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return 1;
      if (bi !== -1) return -1;
      return a.localeCompare(b);
    });
  }, [visibleMonthlyData]);

  const fmtMoney = (n) => '$' + Math.round(n).toLocaleString();
  const fmtMoney2 = (n) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Marketing Performance</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Ad spend vs. leads, appointments & sales — cost per lead, appointment, and sale analysis</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <DateRangePicker value={dateRange} onChange={setDateRange} />
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
                title="Spreadsheet settings"
              >
                <Settings className="w-5 h-5" />
              </button>
              <button
                onClick={refreshGHL}
                disabled={ghlLoading}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${ghlLoading ? 'animate-spin' : ''}`} />
                Sync GHL
              </button>
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="mt-4 p-4 bg-muted rounded-xl border border-border">
              <label className="block text-sm font-medium text-foreground mb-2">Ad Spend Spreadsheet URL or ID</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={spreadsheetInput}
                  onChange={e => setSpreadsheetInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/XXXXX/edit or just the ID"
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={handleSaveSpreadsheetId}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 rounded-md transition-opacity"
                >
                  Save & Load
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Expected format: one row per day, first column = date, remaining columns = ad platform spend.
                Monthly TV, Grass Roots & Print Media actuals are read automatically from the <strong>"OtherChannels"</strong> tab in this same spreadsheet.
                {!spreadsheetId && <span className="text-amber-600 font-medium"> No spreadsheet connected yet.</span>}
              </p>
            </div>
          )}

          {/* Sync status */}
          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
            {ghlSyncedAt && <span>GHL leads last synced: {ghlSyncedAt.toLocaleString()}</span>}
            {adSpendEntries && adSpendEntries.length > 0 && <span>Ad spend rows loaded: {adSpendEntries.length}</span>}
            {marketingBudget && marketingBudget.length > 0 && <span>Budget months loaded: {marketingBudget.length}</span>}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {!spreadsheetId ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Settings className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium text-foreground mb-2">No ad spend spreadsheet configured</p>
            <p className="text-sm text-muted-foreground mb-4">An admin needs to connect a Google Sheets URL via the settings gear</p>
            <button
              onClick={() => setShowSettings(true)}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 rounded-lg transition-opacity"
            >
              Open Settings
            </button>
          </div>
        ) : adSpendLoading || ghlLoading || apptLoading || salesLoading || budgetLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : adSpendError ? (
          <div className="p-6 bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/25 rounded-xl">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">Error loading ad spend data:</p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{adSpendError}</p>
            <button onClick={loadAdSpend} className="mt-3 px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 transition-opacity">
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total Ad Spend</span>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-foreground">{fmtMoney(summary.totalSpend)}</p>
                <p className="text-xs text-muted-foreground mt-1">{summary.daysWithData} days with data</p>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total GHL Leads</span>
                  <Users className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-foreground">{summary.totalLeads}</p>
                <p className="text-xs text-muted-foreground mt-1">{dateRange.start.toLocaleDateString()} – {dateRange.end.toLocaleDateString()}</p>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Avg Cost Per Lead</span>
                  <Target className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-primary">{fmtMoney2(summary.avgCPL)}</p>
                <p className="text-xs text-muted-foreground mt-1">across {summary.daysWithData} days</p>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Leads Per Day</span>
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-foreground">
                  {summary.daysWithData > 0 ? (summary.totalLeads / summary.daysWithData).toFixed(1) : '0'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">average daily leads</p>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Appts Booked</span>
                  <CalendarDays className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-foreground">{summary.totalAppointments}</p>
                <p className="text-xs text-muted-foreground mt-1">{dateRange.start.toLocaleDateString()} – {dateRange.end.toLocaleDateString()}</p>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Cancelled Appts</span>
                  <CalendarDays className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-red-500">{summary.totalCancelledAppts}</p>
                <p className="text-xs text-muted-foreground mt-1">{summary.totalAppointments + summary.totalCancelledAppts > 0 ? ((summary.totalCancelledAppts / (summary.totalAppointments + summary.totalCancelledAppts)) * 100).toFixed(1) : 0}% cancel rate</p>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Avg Cost / Appt Booked</span>
                  <Target className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-cyan-600">{fmtMoney2(summary.avgCPA)}</p>
                <p className="text-xs text-muted-foreground mt-1">across {summary.daysWithData} days</p>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Sales Closed</span>
                  <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-foreground">{summary.totalSales}</p>
                <p className="text-xs text-muted-foreground mt-1">{dateRange.start.toLocaleDateString()} – {dateRange.end.toLocaleDateString()}</p>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total Sale Revenue</span>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-emerald-600">{fmtMoney(summary.totalSalesRevenue)}</p>
                <p className="text-xs text-muted-foreground mt-1">{summary.totalSales} sales · {fmtMoney2(summary.avgCPS)} cost/sale</p>
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Avg Cost / Sale</span>
                  <Target className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-3xl font-black text-amber-600">{fmtMoney2(summary.avgCPS)}</p>
                <p className="text-xs text-muted-foreground mt-1">across {summary.daysWithData} days</p>
              </div>
            </div>

            {/* Leads per day with trend */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-foreground">Leads Per Day (GHL)</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Daily lead volume with 7-day moving average trend line</p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">7-day avg:</span>
                    <span className="font-bold text-primary">{leadsTrend.movingAvg}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">1st half avg:</span>
                    <span className="font-medium text-muted-foreground">{leadsTrend.avgFirstHalf}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">2nd half avg:</span>
                    <span className="font-medium text-muted-foreground">{leadsTrend.avgSecondHalf}</span>
                  </div>
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-full font-bold ${
                    leadsTrend.trendDir === 'up' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' :
                    leadsTrend.trendDir === 'down' ? 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' : 'bg-secondary text-muted-foreground'
                  }`}>
                    {leadsTrend.trendDir === 'up' && <TrendingUp className="w-3.5 h-3.5" />}
                    {leadsTrend.trendDir === 'down' && <TrendingDown className="w-3.5 h-3.5" />}
                    {leadsTrend.trendDir === 'flat' && <span className="text-xs">→</span>}
                    {leadsTrend.trendPct > 0 ? '+' : ''}{leadsTrend.trendPct}%
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={leadsTrend.chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={leadsTrend.chartData.length > 15 ? -45 : 0} textAnchor={leadsTrend.chartData.length > 15 ? 'end' : 'middle'} height={leadsTrend.chartData.length > 15 ? 70 : 30} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value, name) => name === '7-day Avg' ? [value, name] : [value, name]}
                    labelFormatter={(label, payload) => {
                      const item = payload?.[0]?.payload;
                      return item?.dateStr ? new Date(item.dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : label;
                    }}
                  />
                  <Legend />
                  <Bar dataKey="leads" name="Daily Leads" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="ma7" name="7-day Avg" stroke="#6366f1" strokeWidth={2.5} dot={false} />
                  {leadsTrend.movingAvg > 0 && <ReferenceLine y={leadsTrend.movingAvg} stroke="#6366f1" strokeDasharray="5 5" strokeOpacity={0.4} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Spend vs Leads chart */}
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-bold text-foreground mb-4">Daily Ad Spend vs. Leads, Appointments & Sales</h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={dailyData.length > 15 ? -45 : 0} textAnchor={dailyData.length > 15 ? 'end' : 'middle'} height={dailyData.length > 15 ? 70 : 30} />
                  <YAxis yAxisId="left" tickFormatter={v => `$${v}`} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'Ad Spend') return [`$${value.toLocaleString()}`, name];
                      return [value, name];
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="spend" name="Ad Spend" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="leads" name="GHL Leads" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="appointments" name="Appts Booked" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="cancelledAppts" name="Cancelled Appts" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="sales" name="Sales" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="salesRevenue" name="Sale Revenue" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Cost Per Lead trend */}
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-bold text-foreground mb-4">Cost Per Lead, Appointment & Sale Trend</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dailyData.filter(d => d.leads > 0 || d.appointments > 0 || d.sales > 0)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${v}`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, name) => [`$${v.toLocaleString()}`, name]} />
                  <Legend />
                  <Line type="monotone" dataKey="cpl" name="Cost/Lead" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="cpa" name="Cost/Appt Booked" stroke="#06B6D4" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="cps" name="Cost/Sale" stroke="#F59E0B" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Platform breakdown */}
            {platformEntries.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-bold text-foreground mb-4">Spend by Platform</h3>
                <div className="space-y-3">
                  {platformEntries.map(([platform, amount], i) => {
                    const pct = summary.totalSpend > 0 ? (amount / summary.totalSpend) * 100 : 0;
                    return (
                      <div key={platform}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-foreground">{platform}</span>
                          <span className="text-sm font-bold text-foreground">{fmtMoney2(amount)} <span className="text-xs text-muted-foreground font-normal">({pct.toFixed(1)}%)</span></span>
                        </div>
                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Monthly summary table */}
            {visibleMonthlyData.length > 0 && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="p-5 border-b border-border">
                  <h3 className="text-sm font-bold text-foreground">Monthly Summary</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Aggregated across all loaded data</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted text-xs text-muted-foreground uppercase tracking-wider">
                        <th className="px-4 py-3 text-left font-medium">Month</th>
                        {monthlyPlatformNames.map(p => (
                          <th key={p} className="px-4 py-3 text-right font-medium">{p}</th>
                        ))}
                        <th className="px-4 py-3 text-right font-medium">Total Spend</th>
                        <th className="px-4 py-3 text-right font-medium">Leads</th>
                        <th className="px-4 py-3 text-right font-medium">Appts Booked</th>
                        <th className="px-4 py-3 text-right font-medium">Cancelled</th>
                        <th className="px-4 py-3 text-right font-medium">Sales</th>
                        <th className="px-4 py-3 text-right font-medium">Revenue</th>
                        <th className="px-4 py-3 text-right font-medium">Cost/Lead</th>
                        <th className="px-4 py-3 text-right font-medium">Cost/Appt</th>
                        <th className="px-4 py-3 text-right font-medium">Cost/Sale</th>
                        <th className="px-4 py-3 text-right font-medium">MER</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[...visibleMonthlyData].reverse().map(m => {
                        const cpl = m.leads > 0 ? m.totalSpend / m.leads : 0;
                        const cpa = m.appointments > 0 ? m.totalSpend / m.appointments : 0;
                        const cps = m.sales > 0 ? m.totalSpend / m.sales : 0;
                        return (
                          <tr key={m.key} className="hover:bg-secondary">
                            <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">{m.label}</td>
                            {monthlyPlatformNames.map(p => (
                              <td key={p} className="px-4 py-3 text-right text-muted-foreground">
                                {m.platformSpend[p] ? `$${m.platformSpend[p].toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—'}
                              </td>
                            ))}
                            <td className="px-4 py-3 text-right font-semibold text-foreground">{m.totalSpend > 0 ? `$${m.totalSpend.toLocaleString()}` : '—'}</td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{m.leads}</td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{m.appointments}</td>
                            <td className="px-4 py-3 text-right text-red-500">{m.cancelled}</td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{m.sales}</td>
                            <td className="px-4 py-3 text-right font-bold" style={{ color: '#16803c' }}>{m.salesRevenue > 0 ? `$${m.salesRevenue.toLocaleString()}` : '—'}</td>
                            <td className="px-4 py-3 text-right font-bold" style={{ color: '#5d3fd3' }}>{m.leads > 0 ? `$${cpl.toFixed(2)}` : '—'}</td>
                            <td className="px-4 py-3 text-right font-bold" style={{ color: '#087e8b' }}>{m.appointments > 0 ? `$${cpa.toFixed(2)}` : '—'}</td>
                            <td className="px-4 py-3 text-right font-bold" style={{ color: '#c87900' }}>{m.sales > 0 ? `$${cps.toFixed(2)}` : '—'}</td>
                            <td className="px-4 py-3 text-right font-bold text-purple-600">{m.totalSpend > 0 ? (m.salesRevenue / m.totalSpend).toFixed(2) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Daily detail table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-5 border-b border-border">
                <h3 className="text-sm font-bold text-foreground">Daily Breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted text-xs text-muted-foreground uppercase tracking-wider">
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      {dailyTablePlatforms.map(platform => (
                        <th key={platform} className="px-4 py-3 text-right font-medium">{platform}</th>
                      ))}
                      <th className="px-4 py-3 text-right font-medium">Total Spend</th>
                      <th className="px-4 py-3 text-right font-medium">Leads</th>
                      <th className="px-4 py-3 text-right font-medium">Appts Booked</th>
                      <th className="px-4 py-3 text-right font-medium">Cancelled</th>
                      <th className="px-4 py-3 text-right font-medium">Sales</th>
                      <th className="px-4 py-3 text-right font-medium">Revenue</th>
                      <th className="px-4 py-3 text-right font-medium">Cost/Lead</th>
                      <th className="px-4 py-3 text-right font-medium">Cost/Appt</th>
                      <th className="px-4 py-3 text-right font-medium">Cost/Sale</th>
                      <th className="px-4 py-3 text-right font-medium">MER</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[...dailyData].reverse().map(d => (
                      <tr key={d.dateStr} className="hover:bg-secondary">
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{d.date} <span className="text-muted-foreground">({new Date(d.dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })})</span></td>
                        {dailyTablePlatforms.map(platform => (
                          <td key={platform} className="px-4 py-3 text-right text-muted-foreground">
                            {d.platforms[platform] ? `$${d.platforms[platform].toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—'}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right font-semibold text-foreground">{d.spend > 0 ? `$${d.spend.toLocaleString()}` : '—'}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{d.leads}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{d.appointments}</td>
                        <td className="px-4 py-3 text-right text-red-500">{d.cancelledAppts}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{d.sales}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-600">{d.salesRevenue > 0 ? `$${d.salesRevenue.toLocaleString()}` : '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-primary">{d.leads > 0 ? `$${d.cpl.toFixed(2)}` : '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-cyan-600">{d.appointments > 0 ? `$${d.cpa.toFixed(2)}` : '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-600">{d.sales > 0 ? `$${d.cps.toFixed(2)}` : '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-purple-600">{d.spend > 0 ? (d.salesRevenue / d.spend).toFixed(2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}