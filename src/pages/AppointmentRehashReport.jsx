import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, Download, Search, Phone, Mail } from 'lucide-react';
import { format, subDays, startOfMonth } from 'date-fns';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const PRODUCT_TYPES = {
  1: 'Carpet', 2: 'Vinyl', 4: 'Wood',
  5: 'Tile', 6: 'Laminate', 7: 'LVT/LVP',
  8: 'Carpet Tile', 9: 'VCT', 10: 'Natural Stone',
  11: 'Rubber Tile', 12: 'SD/ESD Tile',
  15: 'Metal', 19: 'Install Materials', 20: 'Area Rugs', 21: 'Remnants'
};

const CHART_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16'];

const STATUS_COLORS = {
  'Sold': 'bg-good/12 text-good border-good/25',
  'Lost': 'bg-crit/12 text-crit border-crit/25',
  'Pitch and Miss': 'bg-warn/12 text-warn border-warn/25',
  'One-Leg': 'bg-warn/12 text-warn border-warn/25',
  'Credit Decline': 'bg-crit/12 text-crit border-crit/25',
  'Follow-Up': 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/25',
  'Scheduled': 'bg-info/12 text-info border-info/25',
  'Rescheduled': 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/25',
  'Cancelled': 'bg-secondary text-secondary-foreground border-border',
  'Completed': 'bg-info/12 text-info border-info/25',
  'In Route': 'bg-info/12 text-info border-info/25',
  'On Site': 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/25',
  'Awaiting Assignment': 'bg-secondary text-secondary-foreground border-border',
};

const REHASH_STATUSES = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up', 'Cancelled', 'Rescheduled'];

export default function AppointmentRehashReport() {
  const [dateRange, setDateRange] = useState('90days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('rehash');
  const [dcFilter, setDcFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState('appointment_date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments'],
    queryFn: () => base44.entities.Appointment.list()
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list()
  });

  const { data: checklists = [] } = useQuery({
    queryKey: ['checklists'],
    queryFn: () => base44.entities.AppointmentSettingChecklist.list()
  });

  const { data: checklistsV2 = [] } = useQuery({
    queryKey: ['checklistsV2'],
    queryFn: () => base44.entities.ChecklistV2.list()
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const getDateRange = () => {
    const now = new Date();
    switch (dateRange) {
      case 'today': return { start: format(now, 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
      case '7days': return { start: format(subDays(now, 6), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
      case '30days': return { start: format(subDays(now, 29), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
      case '90days': return { start: format(subDays(now, 89), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
      case '6months': return { start: format(subDays(now, 179), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
      case '1year': return { start: format(subDays(now, 364), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
      case 'thisMonth': return { start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
      case 'all': return { start: '2000-01-01', end: '2099-12-31' };
      case 'custom':
        if (customStartDate && customEndDate) return { start: customStartDate, end: customEndDate };
        return { start: format(subDays(now, 89), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
      default: return { start: format(subDays(now, 89), 'yyyy-MM-dd'), end: format(now, 'yyyy-MM-dd') };
    }
  };

  const { start, end } = getDateRange();

  const rows = useMemo(() => {
    return appointments
      .filter(apt => {
        const d = apt.appointment_date;
        if (!d) return false;
        if (d < start || d > end) return false;

        if (statusFilter === 'rehash') {
          if (!REHASH_STATUSES.includes(apt.status)) return false;
        } else if (statusFilter !== 'all') {
          if (apt.status !== statusFilter) return false;
        }

        if (dcFilter !== 'all' && apt.assigned_dc !== dcFilter) return false;

        return true;
      })
      .map(apt => {
        const cl = checklists.find(c => c.appointment === apt.id);
        const cl2 = checklistsV2.find(c => c.appointment === apt.id);
        const activeChecklist = cl || cl2;
        const sale = sales.find(s => s.appointment === apt.id);
        const dc = teamMembers.find(tm => tm.id === apt.assigned_dc);
        const csr = teamMembers.find(tm => tm.id === apt.assigned_csr);
        const customerName = activeChecklist
          ? `${activeChecklist.customer_first_name || ''} ${activeChecklist.customer_last_name || ''}`.trim()
          : apt.location_address || 'Unknown';

        return {
          id: apt.id,
          appointment_date: apt.appointment_date,
          appointment_block: apt.appointment_block,
          status: apt.status,
          customerName,
          phone: activeChecklist?.customer_phone || '',
          email: activeChecklist?.customer_email || '',
          address: apt.location_address || (activeChecklist?.customer_street ? `${activeChecklist.customer_street}, ${activeChecklist.city || ''}` : ''),
          saleAmount: sale?.sale_amount ?? apt.not_sold_deal_size ?? null,
          dcName: dc ? `${dc.first_name} ${dc.last_name}` : '—',
          csrName: csr ? `${csr.first_name} ${csr.last_name}` : '—',
          notes: apt.notes || [],
          analyzedReason: apt.analyzed_not_sold_reason || '',
          saleId: sale?.id || null,
        };
      })
      .filter(row => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          row.customerName.toLowerCase().includes(q) ||
          row.phone.includes(q) ||
          row.email.toLowerCase().includes(q) ||
          row.address.toLowerCase().includes(q) ||
          row.dcName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        let av = a[sortCol], bv = b[sortCol];
        if (sortCol === 'saleAmount') {
          av = a.saleAmount ?? -1;
          bv = b.saleAmount ?? -1;
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
  }, [appointments, sales, checklists, checklistsV2, teamMembers, start, end, statusFilter, dcFilter, searchQuery, sortCol, sortDir]);

  // Reset to page 1 whenever filters/sort change
  useEffect(() => { setPage(1); }, [statusFilter, dcFilter, searchQuery, sortCol, sortDir, dateRange, customStartDate, customEndDate]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (col) => {
    setSortDir(prev => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setSortCol(col);
  };

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span className="ml-1 text-muted-foreground text-xs">↕</span>;
    return <span className="ml-1 text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const exportCSV = () => {
    const headers = ['Appt Date', 'Time Block', 'Customer', 'Phone', 'Email', 'Address', 'Status', 'Deal Size', 'DC', 'CSR', 'Analyzed Reason', 'Last Note'];
    const csvRows = rows.map(r => {
      const lastNote = r.notes.length > 0 ? r.notes[r.notes.length - 1]?.content || '' : '';
      return [
        r.appointment_date,
        r.appointment_block || '',
        r.customerName,
        r.phone,
        r.email,
        r.address,
        r.status,
        r.saleAmount != null ? `$${r.saleAmount.toLocaleString()}` : 'No amount',
        r.dcName,
        r.csrName,
        r.analyzedReason,
        lastNote
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appointment-rehash-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const dcOptions = teamMembers.filter(tm => tm.role === 'Design Consultant' || tm.role === 'Sales Manager');

  // DC by Product Type chart data — from RFMS line items on sold appointments in date range
  const dcProductTypeChartData = useMemo(() => {
    // Get sold appointments in the current date range
    const soldApts = appointments.filter(apt => {
      const d = apt.appointment_date;
      return d && d >= start && d <= end && apt.status === 'Sold';
    });

    // Map: dcName -> productType -> total revenue
    const dcMap = {};
    const productTypeSet = new Set();

    soldApts.forEach(apt => {
      const sale = sales.find(s => s.appointment === apt.id);
      if (!sale?.rfms_order_data) return;
      const lines = sale.rfms_order_data?.order?.result?.lines || sale.rfms_order_data?.result?.lines || [];
      const dc = teamMembers.find(tm => tm.id === apt.assigned_dc);
      const dcName = dc ? `${dc.first_name} ${dc.last_name}` : 'Unassigned';

      if (!dcMap[dcName]) dcMap[dcName] = {};

      lines.forEach(line => {
        const ptKey = PRODUCT_TYPES[parseInt(line.productCode, 10)];
        if (!ptKey) return;
        productTypeSet.add(ptKey);
        dcMap[dcName][ptKey] = (dcMap[dcName][ptKey] || 0) + (line.total || 0);
      });
    });

    const productTypes = Array.from(productTypeSet).sort();
    const chartData = Object.entries(dcMap).map(([dcName, ptTotals]) => ({
      dcName,
      ...ptTotals
    }));

    return { chartData, productTypes };
  }, [appointments, sales, teamMembers, start, end]);

  const statusCounts = useMemo(() => {
    const counts = {};
    rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    return counts;
  }, [rows]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Sales Manager Dashboard</h1>
              <p className="text-muted-foreground mt-1">Review past appointments to identify re-hash opportunities</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="7days">Last 7 Days</SelectItem>
                  <SelectItem value="30days">Last 30 Days</SelectItem>
                  <SelectItem value="90days">Last 90 Days</SelectItem>
                  <SelectItem value="6months">Last 6 Months</SelectItem>
                  <SelectItem value="1year">Last Year</SelectItem>
                  <SelectItem value="thisMonth">This Month</SelectItem>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
              {dateRange === 'custom' && (
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-1 gap-4 mb-6">
              <Card>
                <CardContent className="pt-5">
                  <p className="text-2xl font-bold text-foreground">{rows.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total Appointments</p>
                </CardContent>
              </Card>
            </div>

            {/* Status breakdown badges */}
            {Object.keys(statusCounts).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(prev => prev === status ? 'all' : status)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all ${STATUS_COLORS[status] || 'bg-secondary text-secondary-foreground border-border'} ${statusFilter === status ? 'ring-2 ring-offset-1 ring-ring ring-offset-background' : 'hover:opacity-80'}`}
                  >
                    {status} <span className="font-bold">{count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* DC by Product Type Chart */}
            {dcProductTypeChartData.chartData.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Design Consultant by Product Type</CardTitle>
                  <CardDescription>Revenue per product type for sold appointments in selected date range</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dcProductTypeChartData.chartData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="dcName" tick={{ fontSize: 12 }} angle={-30} textAnchor="end" interval={0} />
                        <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(value, name) => [`$${Number(value).toLocaleString()}`, name]} />
                        <Legend wrapperStyle={{ paddingTop: 12, fontSize: 11 }} />
                        {dcProductTypeChartData.productTypes.map((pt, i) => (
                          <Bar key={pt} dataKey={pt} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Filters + Table */}
            <Card>
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <CardTitle>Appointment Detail</CardTitle>
                    <CardDescription>{rows.length} appointments · page {page} of {totalPages}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 self-start">
                    <Download className="w-4 h-4" /> Export CSV
                  </Button>
                </div>

                {/* Filter row */}
                <div className="flex flex-wrap gap-3 mt-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search customer, phone, email, DC..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full h-9 pl-9 pr-3 text-sm bg-background text-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-44 h-9 text-sm">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="rehash">Rehash Candidates</SelectItem>
                      <SelectItem value="Lost">Lost</SelectItem>
                      <SelectItem value="Pitch and Miss">Pitch and Miss</SelectItem>
                      <SelectItem value="One-Leg">One-Leg</SelectItem>
                      <SelectItem value="Credit Decline">Credit Decline</SelectItem>
                      <SelectItem value="Follow-Up">Follow-Up</SelectItem>
                      <SelectItem value="Cancelled">Cancelled</SelectItem>
                      <SelectItem value="Rescheduled">Rescheduled</SelectItem>
                      <SelectItem value="Sold">Sold</SelectItem>
                      <SelectItem value="Scheduled">Scheduled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={dcFilter} onValueChange={setDcFilter}>
                    <SelectTrigger className="w-full sm:w-44 h-9 text-sm">
                      <SelectValue placeholder="Design Consultant" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All DCs</SelectItem>
                      {dcOptions.map(dc => (
                        <SelectItem key={dc.id} value={dc.id}>{dc.first_name} {dc.last_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted text-xs text-muted-foreground uppercase tracking-wider">
                        {[
                          ['appointment_date', 'Appt Date'],
                          ['customerName', 'Customer'],
                          ['status', 'Status'],
                          ['saleAmount', 'Deal Size'],
                          ['dcName', 'DC'],
                        ].map(([col, label]) => (
                          <th
                            key={col}
                            className="px-4 py-3 text-left font-medium cursor-pointer select-none hover:text-foreground"
                            onClick={() => handleSort(col)}
                          >
                            {label}<SortIcon col={col} />
                          </th>
                        ))}
                        <th className="px-4 py-3 text-left font-medium">Contact</th>
                        <th className="px-4 py-3 text-left font-medium">Last Note</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={8} className="text-center text-muted-foreground py-12">No appointments found for current filters</td>
                        </tr>
                      )}
                      {pagedRows.map(row => {
                        const lastNote = row.notes.length > 0 ? row.notes[row.notes.length - 1] : null;
                        return (
                          <tr key={row.id} className="hover:bg-muted transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                              <div>{row.appointment_date ? format(new Date(row.appointment_date + 'T00:00:00'), 'MMM d, yyyy') : '—'}</div>
                              {row.appointment_block && <div className="text-xs text-muted-foreground">{row.appointment_block}</div>}
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{row.customerName}</p>
                              {row.address && <p className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate">{row.address}</p>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <Badge variant="outline" className={`text-xs border ${STATUS_COLORS[row.status] || 'bg-secondary text-secondary-foreground border-border'}`}>
                                {row.status}
                              </Badge>
                              {row.analyzedReason && (
                                <p className="text-xs text-primary mt-1">{row.analyzedReason}</p>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {row.saleAmount != null ? (
                                <span className="font-semibold text-good">${row.saleAmount.toLocaleString()}</span>
                              ) : (
                                <span className="text-xs text-warn font-medium bg-warn/12 px-2 py-0.5 rounded-full border border-warn/25">No amount</span>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">{row.dcName}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1">
                                {row.phone && (
                                  <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                                    <Phone className="w-3 h-3" />{row.phone}
                                  </a>
                                )}
                                {row.email && (
                                  <a href={`mailto:${row.email}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary truncate max-w-[160px]">
                                    <Mail className="w-3 h-3" />{row.email}
                                  </a>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 max-w-[200px]">
                              {lastNote ? (
                                <div>
                                  <p className="text-xs text-muted-foreground line-clamp-2">{lastNote.content}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">{lastNote.user_name}</p>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Link
                                to={createPageUrl('AppointmentDetail') + '?id=' + row.id}
                                className="text-muted-foreground hover:text-primary transition-colors"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={page === 1}>«</Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹ Prev</Button>
                  <span className="text-sm text-muted-foreground px-2">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next ›</Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}