import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingUp, DollarSign, Download, ExternalLink, Loader2, Check } from 'lucide-react';
import { format, parseISO, subDays, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';

const DEFAULT_GP_THRESHOLD = 48;

function calcGP(sale) {
  if (!sale.rfms_order_data?.result?.lines) return null;
  const lines = sale.rfms_order_data.result.lines;
  const totalCost = lines.reduce((s, item) => s + (item.unitCost * item.quantity), 0);
  const orderTotal = lines.reduce((s, item) => s + (item.total || 0), 0);
  if (orderTotal <= 0) return null;
  return {
    gpPct: ((orderTotal - totalCost) / orderTotal) * 100,
    gpDollars: orderTotal - totalCost,
    orderTotal,
    totalCost,
  };
}

export default function GrossProfitReport() {
  const [dateRange, setDateRange] = useState('allTime');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [sortCol, setSortCol] = useState('gpPct');
  const [sortDir, setSortDir] = useState('asc');
  const [filterBelow, setFilterBelow] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [trendGroup, setTrendGroup] = useState('auto');

  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list(),
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list(),
  });

  const { data: checklists = [] } = useQuery({
    queryKey: ['checklists'],
    queryFn: () => base44.entities.AppointmentSettingChecklist.list(),
  });

  const { data: smsSettings } = useQuery({
    queryKey: ['smsSettings'],
    queryFn: async () => {
      const settings = await base44.entities.SMSSettings.list();
      return settings[0];
    },
  });

  const GP_THRESHOLD = smsSettings?.gp_alert_threshold ?? DEFAULT_GP_THRESHOLD;

  const getDateRange = () => {
    const now = new Date();
    const today = new Date(now.setHours(0, 0, 0, 0));
    switch (dateRange) {
      case 'allTime': return { start: new Date('2000-01-01'), end: new Date() };
      case '30days': return { start: subDays(today, 30), end: new Date() };
      case 'thisMonth': return { start: startOfMonth(new Date()), end: new Date() };
      case 'lastMonth': {
        const lm = subMonths(new Date(), 1);
        return { start: startOfMonth(lm), end: new Date(lm.getFullYear(), lm.getMonth() + 1, 0, 23, 59, 59) };
      }
      case '7days': return { start: subDays(today, 7), end: new Date() };
      case 'thisWeek': return { start: startOfWeek(new Date()), end: new Date() };
      case 'custom':
        if (customStartDate && customEndDate) {
          return { start: new Date(customStartDate + 'T00:00:00'), end: new Date(customEndDate + 'T23:59:59') };
        }
        return { start: new Date('2000-01-01'), end: new Date() };
      default: return { start: new Date('2000-01-01'), end: new Date() };
    }
  };

  const { start, end } = getDateRange();

  const rows = useMemo(() => {
    return sales
      .filter(sale => {
        if (sale.is_cancelled) return false;
        if (!sale.sale_date) return false;
        const d = parseISO(sale.sale_date);
        return d >= start && d <= end;
      })
      .map(sale => {
        const gp = calcGP(sale);
        const consultant = teamMembers.find(tm => tm.id === sale.assigned_dc);
        const checklist = checklists.find(c => c.appointment === sale.appointment);
        const customerName = checklist
          ? `${checklist.customer_first_name || ''} ${checklist.customer_last_name || ''}`.trim()
          : (sale.location_address || 'Unknown');
        return {
          sale,
          gp,
          gpPct: gp?.gpPct ?? null,
          gpDollars: gp?.gpDollars ?? null,
          orderTotal: gp?.orderTotal ?? null,
          totalCost: gp?.totalCost ?? null,
          consultantName: consultant ? `${consultant.first_name} ${consultant.last_name}` : 'Unassigned',
          customerName,
          saleDate: sale.sale_date ? format(parseISO(sale.sale_date), 'MM/dd/yyyy') : '',
          saleDateRaw: sale.sale_date || '',
          saleAmount: sale.sale_amount || 0,
          invoiceNumber: sale.invoice_number || '',
          belowThreshold: gp !== null && gp.gpPct < GP_THRESHOLD,
        };
      });
  }, [sales, teamMembers, checklists, start, end]);

  const withGP = rows.filter(r => r.gp !== null);
  const belowCount = withGP.filter(r => r.belowThreshold).length;
  const aboveCount = withGP.filter(r => !r.belowThreshold).length;
  const avgGP = withGP.length > 0 ? withGP.reduce((s, r) => s + r.gpPct, 0) / withGP.length : 0;
  const totalGPDollars = withGP.reduce((s, r) => s + (r.gpDollars || 0), 0);

  const filtered = rows
    .filter(r => {
      if (filterBelow && !r.belowThreshold) return false;
      if (search) {
        const q = search.toLowerCase();
        return r.customerName.toLowerCase().includes(q) ||
          r.consultantName.toLowerCase().includes(q) ||
          r.invoiceNumber.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (av === null) av = sortDir === 'asc' ? Infinity : -Infinity;
      if (bv === null) bv = sortDir === 'asc' ? Infinity : -Infinity;
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });

  const handleSort = (col) => {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col; }
      setSortDir('asc');
      return col;
    });
  };

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span className="ml-1 text-muted-foreground">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  // Chart data: GP% by consultant
  const consultantGPChart = useMemo(() => {
    const map = {};
    withGP.forEach(r => {
      if (!map[r.consultantName]) map[r.consultantName] = { total: 0, count: 0 };
      map[r.consultantName].total += r.gpPct;
      map[r.consultantName].count += 1;
    });
    return Object.entries(map)
      .map(([name, { total, count }]) => ({ name: name.split(' ')[0], fullName: name, avgGP: total / count }))
      .sort((a, b) => b.avgGP - a.avgGP);
  }, [withGP]);

  // GP% trend over time — group sales into day/week/month buckets
  const trendData = useMemo(() => {
    if (withGP.length === 0) return [];
    // auto-select granularity based on range span
    const days = Math.max(1, Math.round((end - start) / 86400000));
    let group = trendGroup;
    if (group === 'auto') {
      group = days <= 14 ? 'day' : days <= 90 ? 'week' : 'month';
    }
    const fmtStr = group === 'day' ? 'MMM d' : group === 'week' ? "MMM d 'wk'" : 'MMM yy';
    const buckets = {};
    withGP.forEach(r => {
      const d = parseISO(r.saleDateRaw);
      let key;
      if (group === 'day') {
        key = format(d, 'yyyy-MM-dd');
      } else if (group === 'week') {
        const wkStart = startOfWeek(d);
        key = format(wkStart, 'yyyy-MM-dd');
      } else {
        key = format(d, 'yyyy-MM');
      }
      if (!buckets[key]) buckets[key] = { total: 0, count: 0, gpDollars: 0, label: format(d, fmtStr) };
      buckets[key].total += r.gpPct;
      buckets[key].count += 1;
      buckets[key].gpDollars += (r.gpDollars || 0);
    });
    return Object.entries(buckets)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({
        label: v.label,
        avgGP: v.total / v.count,
        gpDollars: v.gpDollars,
        jobCount: v.count,
      }));
  }, [withGP, start, end, trendGroup]);

  const exportCSV = () => {
    const headers = ['Sale Date', 'Customer', 'Invoice #', 'Consultant', 'Sale Amount', 'Order Total (RFMS)', 'Cost (RFMS)', 'GP $', 'GP %', 'Below Threshold'];
    const csvRows = filtered.map(r => [
      r.saleDate, r.customerName, r.invoiceNumber, r.consultantName,
      r.saleAmount ? `$${r.saleAmount.toLocaleString()}` : '',
      r.orderTotal !== null ? `$${r.orderTotal.toFixed(2)}` : 'N/A',
      r.totalCost !== null ? `$${r.totalCost.toFixed(2)}` : 'N/A',
      r.gpDollars !== null ? `$${r.gpDollars.toFixed(2)}` : 'N/A',
      r.gpPct !== null ? `${r.gpPct.toFixed(1)}%` : 'N/A',
      r.belowThreshold ? 'YES' : 'No',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gp-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Gross Profit Report</h1>
              <p className="text-muted-foreground mt-1">Job-level GP% from RFMS data • Threshold: <span className="font-semibold text-red-600 dark:text-red-400">{GP_THRESHOLD}%</span></p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allTime">All Time</SelectItem>
                  <SelectItem value="7days">Last 7 Days</SelectItem>
                  <SelectItem value="30days">Last 30 Days</SelectItem>
                  <SelectItem value="thisWeek">This Week</SelectItem>
                  <SelectItem value="thisMonth">This Month</SelectItem>
                  <SelectItem value="lastMonth">Last Month</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
              {dateRange === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="h-10 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                  <span className="text-muted-foreground">to</span>
                  <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="h-10 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {salesLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-blue-500 dark:text-blue-400" /> Avg GP%
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className={`text-3xl font-bold ${avgGP < GP_THRESHOLD ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>{avgGP.toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground mt-1">{withGP.length} jobs with RFMS data</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-emerald-500 dark:text-emerald-400" /> Total GP $
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">${totalGPDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                  <p className="text-xs text-muted-foreground mt-1">from RFMS-synced jobs</p>
                </CardContent>
              </Card>

              <Card className="border-red-200 bg-red-50 dark:border-red-500/25 dark:bg-red-500/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-red-500 dark:text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" /> Below {GP_THRESHOLD}%
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-red-600 dark:text-red-400">{belowCount}</p>
                  <p className="text-xs text-red-400 dark:text-red-300 mt-1">
                    {withGP.length > 0 ? ((belowCount / withGP.length) * 100).toFixed(0) : 0}% of jobs with RFMS data
                  </p>
                </CardContent>
              </Card>

              <Card className="border-green-200 bg-green-50 dark:border-green-500/25 dark:bg-green-500/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">
                    Above Threshold
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-green-600 dark:text-green-400">{aboveCount}</p>
                  <p className="text-xs text-green-500 dark:text-green-400 mt-1">
                    {withGP.length > 0 ? ((aboveCount / withGP.length) * 100).toFixed(0) : 0}% of jobs with RFMS data
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* GP% Trend Over Time */}
            {trendData.length > 1 && (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <CardTitle>GP% Trend Over Time</CardTitle>
                      <CardDescription>Average gross profit % across the selected date range</CardDescription>
                    </div>
                    <Select value={trendGroup} onValueChange={setTrendGroup}>
                      <SelectTrigger className="w-36 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="day">Daily</SelectItem>
                        <SelectItem value="week">Weekly</SelectItem>
                        <SelectItem value="month">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={trendData.length > 15 ? Math.floor(trendData.length / 12) : 0} />
                      <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} domain={[0, 'auto']} />
                      <Tooltip
                        formatter={(value, name) => {
                          if (name === 'avgGP') return [`${value.toFixed(1)}%`, 'Avg GP%'];
                          if (name === 'gpDollars') return [`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 'GP $'];
                          if (name === 'jobCount') return [value, 'Jobs'];
                          return [value, name];
                        }}
                      />
                      <ReferenceLine y={GP_THRESHOLD} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={2} label={{ value: `${GP_THRESHOLD}% threshold`, position: 'insideTopRight', fill: '#ef4444', fontSize: 11, fontWeight: 600 }} />
                      <Line type="monotone" dataKey="avgGP" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* GP% by Consultant Bar Chart */}
            {consultantGPChart.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Avg GP% by Consultant</CardTitle>
                  <CardDescription>Dashed line = {GP_THRESHOLD}% threshold</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={consultantGPChart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} domain={[0, 'auto']} />
                      <Tooltip
                        formatter={(value, _, props) => [`${value.toFixed(1)}%`, props.payload.fullName]}
                        labelFormatter={() => ''}
                      />
                      <ReferenceLine y={GP_THRESHOLD} stroke="#ef4444" strokeDasharray="6 3" strokeWidth={2} label={{ value: `${GP_THRESHOLD}% threshold`, position: 'insideTopRight', fill: '#ef4444', fontSize: 11, fontWeight: 600 }} />
                      <Bar dataKey="avgGP" radius={[4, 4, 0, 0]}>
                        {consultantGPChart.map((entry, i) => (
                          <Cell key={i} fill={entry.avgGP < GP_THRESHOLD ? '#ef4444' : '#3b82f6'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Table */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle>All Jobs — GP Detail</CardTitle>
                    <CardDescription>{filtered.length} jobs shown • Jobs without RFMS data show "N/A"</CardDescription>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant={filterBelow ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFilterBelow(v => !v)}
                      className={filterBelow ? 'bg-red-600 hover:bg-red-700 border-red-600' : 'border-red-300 dark:border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                      {filterBelow ? 'Showing Flagged' : `Show Flagged (${belowCount})`}
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportCSV}>
                      <Download className="w-4 h-4 mr-1" /> Export CSV
                    </Button>
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Search customer, consultant, invoice..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="mt-2 w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted text-xs text-muted-foreground uppercase tracking-wider">
                        {[
                          ['saleDateRaw', 'Sale Date'],
                          ['customerName', 'Customer'],
                          ['invoiceNumber', 'Invoice #'],
                          ['consultantName', 'Consultant'],
                          ['saleAmount', 'Sale Amount'],
                          ['orderTotal', 'RFMS Total'],
                          ['totalCost', 'RFMS Cost'],
                          ['gpDollars', 'GP $'],
                          ['gpPct', 'GP %'],
                        ].map(([col, label]) => (
                          <th
                            key={col}
                            onClick={() => handleSort(col)}
                            className="px-4 py-3 font-medium text-left cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                          >
                            {label}<SortIcon col={col} />
                          </th>
                        ))}
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filtered.length === 0 && (
                        <tr><td colSpan={10} className="text-center text-muted-foreground py-10">No jobs found</td></tr>
                      )}
                      {filtered.map(({ sale, gp, gpPct, gpDollars, orderTotal, totalCost, consultantName, customerName, saleDate, saleAmount, invoiceNumber, belowThreshold }) => (
                        <tr
                          key={sale.id}
                          className={`transition-colors ${belowThreshold ? 'bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/20' : 'hover:bg-muted'}`}
                        >
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{saleDate}</td>
                          <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {belowThreshold && (
                                <AlertTriangle className="w-3.5 h-3.5 text-red-500 dark:text-red-400 flex-shrink-0" />
                              )}
                              {customerName}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{invoiceNumber || '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{consultantName}</td>
                          <td className="px-4 py-3 text-foreground whitespace-nowrap font-medium">
                            {saleAmount ? `$${saleAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                            {orderTotal !== null ? `$${orderTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : <span className="text-muted-foreground">N/A</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                            {totalCost !== null ? `$${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : <span className="text-muted-foreground">N/A</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-semibold">
                            {gpDollars !== null ? (
                              <span className={gpDollars < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                                ${gpDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                            ) : <span className="text-muted-foreground">N/A</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {gpPct !== null ? (
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                                gpPct < GP_THRESHOLD
                                  ? 'bg-red-100 text-red-700 border border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25'
                                  : 'bg-green-100 text-green-700 border border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25'
                              }`}>
                                {belowThreshold && <AlertTriangle className="w-3 h-3" />}
                                {gpPct.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground px-2.5 py-1 rounded-full bg-secondary">No data</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Link to={createPageUrl('SaleDetail') + '?id=' + sale.id} className="text-muted-foreground hover:text-primary">
                              <ExternalLink className="w-4 h-4" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}