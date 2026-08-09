import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, DollarSign } from 'lucide-react';
import { format, startOfMonth } from 'date-fns';
import { buildCatalogCostMap, computeCatalogGP } from '@/lib/catalogCost';
import AvailabilityGrid from '@/components/reports/AvailabilityGrid';
import DCRecommendations from '@/components/reports/DCRecommendations';

const formatCurrency = (amount) => {
  if (!amount || isNaN(amount)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
};

// Compute GP% for a sale using catalog cost (same logic as Sales list view)
const getSaleGPPct = (sale, catalogCostMap) => {
  const lines = sale?.rfms_order_data?.result?.lines;
  if (!lines || !Array.isArray(lines) || lines.length === 0) return null;
  const { grossProfitPercent } = computeCatalogGP(lines, catalogCostMap);
  return grossProfitPercent;
};

// Matrix columns: count of each appointment status per design consultant
const MATRIX_COLUMNS = [
  { key: 'total', label: 'Total Appts', color: 'text-foreground' },
  { key: 'Sold', label: 'Sold', color: 'text-green-600' },
  { key: 'One-Leg', label: 'One-Leg', color: 'text-yellow-600' },
  { key: 'Pitch and Miss', label: 'Pitch & Miss', color: 'text-orange-600' },
  { key: 'Lost', label: 'Lost', color: 'text-red-600' },
  { key: 'Credit Decline', label: 'Credit Decline', color: 'text-rose-600' },
  { key: 'Cancelled', label: 'Cancelled', color: 'text-muted-foreground' },
  { key: 'Rescheduled', label: 'Rescheduled', color: 'text-cyan-600' },
];

export default function DCPerformanceMatrix() {
  const [dateRange, setDateRange] = useState('30days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const { data: appointments = [], isLoading: aptLoading } = useQuery({
    queryKey: ['appointments'],
    queryFn: () => base44.entities.Appointment.list()
  });

  const { data: teamMembers = [], isLoading: tmLoading } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list()
  });

  // Catalog per-unit costs (cont_labor excluded) for catalog-based GP
  const { data: catalogCostMap = {} } = useQuery({
    queryKey: ['rfmsCatalogCostMap'],
    queryFn: async () => {
      const [items, rolls] = await Promise.all([
        base44.entities.RFMSItem.list(),
        base44.entities.RFMSRoll.list()
      ]);
      return buildCatalogCostMap(items, rolls);
    },
    staleTime: 5 * 60 * 1000
  });

  // Design consultants only
  const designConsultants = useMemo(
    () => teamMembers.filter(tm => tm.role === 'Design Consultant'),
    [teamMembers]
  );

  const phoenixOffsetMs = 7 * 60 * 60 * 1000; // UTC-7

  const dateFilter = useMemo(() => {
    const nowPhoenix = new Date(new Date().getTime() - phoenixOffsetMs);
    const todayStr = format(nowPhoenix, 'yyyy-MM-dd');

    switch (dateRange) {
      case 'today':
        return { startStr: todayStr, endStr: todayStr };
      case '7days': {
        const d = new Date(nowPhoenix);
        d.setDate(d.getDate() - 6);
        return { startStr: format(d, 'yyyy-MM-dd'), endStr: todayStr };
      }
      case '30days': {
        const d = new Date(nowPhoenix);
        d.setDate(d.getDate() - 29);
        return { startStr: format(d, 'yyyy-MM-dd'), endStr: todayStr };
      }
      case 'thisMonth':
        return { startStr: format(startOfMonth(nowPhoenix), 'yyyy-MM-dd'), endStr: todayStr };
      case 'lastMonth': {
        const lastMonthDate = new Date(nowPhoenix.getFullYear(), nowPhoenix.getMonth() - 1, 1);
        const lastMonthEnd = new Date(nowPhoenix.getFullYear(), nowPhoenix.getMonth(), 0);
        return {
          startStr: format(lastMonthDate, 'yyyy-MM-dd'),
          endStr: format(lastMonthEnd, 'yyyy-MM-dd')
        };
      }
      case 'custom':
        if (customStartDate && customEndDate) {
          return { startStr: customStartDate, endStr: customEndDate };
        }
        // fallthrough
      default: {
        const d = new Date(nowPhoenix);
        d.setDate(d.getDate() - 29);
        return { startStr: format(d, 'yyyy-MM-dd'), endStr: todayStr };
      }
    }
  }, [dateRange, customStartDate, customEndDate]);

  // Filter appointments by appointment_date (Phoenix day) within range
  const filteredAppointments = useMemo(() => {
    return appointments.filter(apt => {
      if (!apt.appointment_date) return false;
      return apt.appointment_date >= dateFilter.startStr && apt.appointment_date <= dateFilter.endStr;
    });
  }, [appointments, dateFilter]);

  // Sales within the selected date range, keyed by assigned_dc
  const salesByDc = useMemo(() => {
    const map = {};
    sales.forEach(sale => {
      if (!sale.assigned_dc) return;
      if (!sale.sale_date) return;
      const phoenixDate = new Date(new Date(sale.sale_date).getTime() - phoenixOffsetMs);
      const dayStr = format(phoenixDate, 'yyyy-MM-dd');
      if (dayStr < dateFilter.startStr || dayStr > dateFilter.endStr) return;
      if (!map[sale.assigned_dc]) map[sale.assigned_dc] = [];
      map[sale.assigned_dc].push(sale);
    });
    return map;
  }, [sales, dateFilter]);

  // Build matrix rows per design consultant
  const matrixRows = useMemo(() => {
    const rows = designConsultants.map(dc => {
      const dcAppts = filteredAppointments.filter(a => a.assigned_dc === dc.id);
      const counts = { total: dcAppts.length };
      MATRIX_COLUMNS.forEach(col => {
        if (col.key === 'total') return;
        counts[col.key] = dcAppts.filter(a => a.status === col.key).length;
      });
      // Conversion rate = sold / (sold + lost outcomes)
      const closedDeals = counts['Sold'] || 0;
      const lostOutcomes = (counts['Lost'] || 0) + (counts['Pitch and Miss'] || 0) + (counts['One-Leg'] || 0) + (counts['Credit Decline'] || 0);
      const closedTotal = closedDeals + lostOutcomes;
      const closeRate = closedTotal > 0 ? ((closedDeals / closedTotal) * 100).toFixed(1) : '0.0';
      const dcSales = (salesByDc[dc.id] || []).filter(s => !s.is_cancelled);
      const salesWithAmount = dcSales.filter(s => s.sale_amount != null);
      const totalRevenue = salesWithAmount.reduce((sum, s) => sum + (s.sale_amount || 0), 0);
      const aov = salesWithAmount.length > 0 ? totalRevenue / salesWithAmount.length : 0;
      const gpPcts = dcSales.map(s => getSaleGPPct(s, catalogCostMap)).filter(v => v != null);
      const avgGP = gpPcts.length > 0 ? gpPcts.reduce((sum, v) => sum + v, 0) / gpPcts.length : 0;
      return {
        dcId: dc.id,
        name: `${dc.first_name} ${dc.last_name}`,
        counts,
        closeRate,
        totalRevenue,
        aov,
        avgGP,
        gpCount: gpPcts.length
      };
    });
    return rows.filter(r => r.counts.total > 0).sort((a, b) => b.counts.total - a.counts.total);
  }, [designConsultants, filteredAppointments, salesByDc, catalogCostMap]);

  // Totals row
  const totals = useMemo(() => {
    const t = { total: 0 };
    MATRIX_COLUMNS.forEach(col => {
      if (col.key === 'total') return;
      t[col.key] = 0;
    });
    let totalRevenue = 0;
    let soldCount = 0;
    let totalGP = 0;
    let gpCount = 0;
    matrixRows.forEach(row => {
      Object.keys(t).forEach(k => {
        t[k] += row.counts[k] || 0;
      });
      totalRevenue += row.totalRevenue || 0;
      soldCount += row.counts['Sold'] || 0;
      totalGP += (row.avgGP || 0) * (row.gpCount || 0);
      gpCount += row.gpCount || 0;
    });
    t.totalRevenue = totalRevenue;
    t.aov = soldCount > 0 ? totalRevenue / soldCount : 0;
    t.avgGP = gpCount > 0 ? totalGP / gpCount : 0;
    return t;
  }, [matrixRows]);

  const loading = aptLoading || tmLoading;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">DC Performance Matrix</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Appointment outcomes by design consultant — grouped by appointment date.
        </p>
      </div>

      {/* Date selector */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date Range</Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="7days">Last 7 Days</SelectItem>
                  <SelectItem value="30days">Last 30 Days</SelectItem>
                  <SelectItem value="thisMonth">This Month</SelectItem>
                  <SelectItem value="lastMonth">Last Month</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {dateRange === 'custom' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Start Date</Label>
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-44"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">End Date</Label>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-44"
                  />
                </div>
              </>
            )}
            <div className="ml-auto text-sm text-muted-foreground">
              {dateFilter.startStr} → {dateFilter.endStr}
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : matrixRows.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center text-muted-foreground">
            No appointments found in this date range.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Design Consultant Outcomes</CardTitle>
            <CardDescription>
              {matrixRows.length} consultant(s) · {totals.total} appointment(s) in range
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="text-left font-semibold text-muted-foreground px-3 py-2 sticky left-0 bg-muted z-10 min-w-[140px]">
                      Design Consultant
                    </th>
                    {MATRIX_COLUMNS.map(col => (
                      <th
                        key={col.key}
                        className={`text-center font-semibold px-3 py-2 whitespace-nowrap ${col.color}`}
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="text-center font-semibold text-emerald-700 dark:text-emerald-400 px-3 py-2 whitespace-nowrap">
                      Total Sales Value
                    </th>
                    <th className="text-center font-semibold text-emerald-700 dark:text-emerald-400 px-3 py-2 whitespace-nowrap">
                      Avg Order Value
                    </th>
                    <th className="text-center font-semibold text-blue-700 dark:text-blue-400 px-3 py-2 whitespace-nowrap">
                      Avg GP%
                    </th>
                    <th className="text-center font-semibold text-foreground px-3 py-2 whitespace-nowrap">
                      Close Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map(row => (
                    <tr key={row.dcId} className="border-b border-border hover:bg-secondary">
                      <td className="font-medium text-foreground px-3 py-2 sticky left-0 bg-card z-10">
                        {row.name}
                      </td>
                      {MATRIX_COLUMNS.map(col => (
                        <td
                          key={col.key}
                          className={`text-center px-3 py-2 ${col.color} ${col.key === 'total' ? 'font-bold' : ''}`}
                        >
                          {row.counts[col.key] || 0}
                        </td>
                      ))}
                      <td className="text-center px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        {formatCurrency(row.totalRevenue)}
                      </td>
                      <td className="text-center px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        {formatCurrency(row.aov)}
                      </td>
                      <td className="text-center px-3 py-2 font-semibold text-blue-700 dark:text-blue-400 whitespace-nowrap">
                        {row.gpCount > 0 ? `${row.avgGP.toFixed(1)}%` : '—'}
                      </td>
                      <td className="text-center px-3 py-2 font-semibold text-foreground">
                        {row.closeRate}%
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="border-t-2 border-border bg-muted font-bold">
                    <td className="text-foreground px-3 py-2 sticky left-0 bg-muted z-10">
                      TOTAL
                    </td>
                    {MATRIX_COLUMNS.map(col => (
                      <td
                        key={col.key}
                        className={`text-center px-3 py-2 ${col.color}`}
                      >
                        {totals[col.key] || 0}
                      </td>
                    ))}
                    <td className="text-center px-3 py-2 text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                      {formatCurrency(totals.totalRevenue)}
                    </td>
                    <td className="text-center px-3 py-2 text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                      {formatCurrency(totals.aov)}
                    </td>
                    <td className="text-center px-3 py-2 text-blue-700 dark:text-blue-400 whitespace-nowrap">
                      {totals.avgGP > 0 ? `${totals.avgGP.toFixed(1)}%` : '—'}
                    </td>
                    <td className="text-center px-3 py-2 text-foreground">
                      {(() => {
                        const closedDeals = totals['Sold'] || 0;
                        const lostOutcomes = (totals['Lost'] || 0) + (totals['Pitch and Miss'] || 0) + (totals['One-Leg'] || 0) + (totals['Credit Decline'] || 0);
                        return closedDeals + lostOutcomes > 0
                          ? ((closedDeals / (closedDeals + lostOutcomes)) * 100).toFixed(1) + '%'
                          : '0.0%';
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Availability & Utilization Grid */}
      {!loading && designConsultants.length > 0 && (
        <div className="mt-6">
          <AvailabilityGrid
            designConsultants={designConsultants}
            appointments={appointments}
          />
        </div>
      )}

      {/* AI Staffing Recommendations */}
      {!loading && matrixRows.length > 0 && designConsultants.length > 0 && (
        <div className="mt-6">
          <DCRecommendations
            matrixRows={matrixRows}
            designConsultants={designConsultants}
            appointments={appointments}
          />
        </div>
      )}
    </div>
  );
}