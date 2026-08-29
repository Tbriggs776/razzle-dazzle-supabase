import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, ReferenceLine } from 'recharts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, TrendingUp, DollarSign, Target, ArrowUpRight, ArrowDownRight, ArrowRight, Download, Copy, Check } from 'lucide-react';
import { subDays, startOfMonth, startOfWeek, format, eachDayOfInterval, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function SalesReports() {
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState('thisMonth');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedLeadSource, setSelectedLeadSource] = useState(null);
  const [showLeadSourceModal, setShowLeadSourceModal] = useState(false);
  const [selectedConsultant, setSelectedConsultant] = useState(null);
  const [showConsultantModal, setShowConsultantModal] = useState(false);
  const [selectedLostReason, setSelectedLostReason] = useState(null);
  const [showLostSalesModal, setShowLostSalesModal] = useState(false);
  const [selectedSentiment, setSelectedSentiment] = useState(null);
  const [showSentimentModal, setShowSentimentModal] = useState(false);
  const [analyzingId, setAnalyzingId] = useState(null);
  const [selectedPendingConsultant, setSelectedPendingConsultant] = useState(null);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showFollowUpWinsModal, setShowFollowUpWinsModal] = useState(false);
  const [copiedTable, setCopiedTable] = useState(false);
  const [leadSourceTableSearch, setLeadSourceTableSearch] = useState('');
  const [tableSort, setTableSort] = useState({ col: 'saleDate', dir: 'desc' });
  const [tableFilters, setTableFilters] = useState({});

  const handleAnalyze = async (e, appointmentId) => {
    e.preventDefault();
    e.stopPropagation();
    setAnalyzingId(appointmentId);
    try {
      // invoke() does not throw, so the catch below never fired: a failed
      // analysis just spun the button and left the row unchanged, looking to the
      // user like the AI had nothing to say.
      const res = await base44.functions.invoke('analyzeNotSoldReason', { appointmentId });
      const failed = invokeFailure(res);
      if (failed) { toast.error(`Could not analyse this one — ${failed}`); return; }
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    } catch (error) {
      console.error('Failed to analyze:', error);
      toast.error('Failed to analyze: ' + error.message);
    } finally {
      setAnalyzingId(null);
    }
  };

  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery({
    queryKey: ['appointments'],
    queryFn: () => base44.entities.Appointment.list()
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: () => base44.entities.Lead.list()
  });

  const { data: checklists = [] } = useQuery({
    queryKey: ['checklists'],
    queryFn: () => base44.entities.AppointmentSettingChecklist.list()
  });

  const { data: checklistsV2 = [] } = useQuery({
    queryKey: ['checklistsV2'],
    queryFn: () => base44.entities.ChecklistV2.list()
  });

  // Merged lookup: prefer v1 if exists, fall back to v2
  const allChecklists = React.useMemo(() => [...checklists, ...checklistsV2], [checklists, checklistsV2]);

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list()
  });

  // Effective sale amount: fall back to RFMS order line totals when sale_amount is missing
  const getEffectiveSaleAmount = (sale) => {
    if (!sale) return 0;
    if (sale.sale_amount != null && sale.sale_amount > 0) return sale.sale_amount;
    const lines = sale.rfms_order_data?.result?.lines;
    if (lines && lines.length > 0) {
      return lines.reduce((sum, l) => sum + (l.total || 0), 0);
    }
    return 0;
  };

  // Filter appointments by date range
  const getDateRangeFilter = () => {
    const now = new Date();
    const today = new Date(now.setHours(0, 0, 0, 0));
    
    switch (dateRange) {
      case 'today':
        return { start: today, end: new Date() };
      case 'yesterday':
        const yesterday = subDays(today, 1);
        return { start: yesterday, end: yesterday };
      case '7days':
        return { start: subDays(today, 6), end: today };
      case '30days':
        return { start: subDays(now, 30), end: now };
      case 'thisMonth':
        return { start: startOfMonth(now), end: now };
      case 'lastMonth': {
        // Use UTC-7 offset to get Phoenix local month boundaries
        const phoenixNow = new Date(Date.now() - 7 * 60 * 60 * 1000);
        const lastMonthStart = new Date(Date.UTC(phoenixNow.getUTCFullYear(), phoenixNow.getUTCMonth() - 1, 1) + 7 * 60 * 60 * 1000);
        const lastMonthEnd = new Date(Date.UTC(phoenixNow.getUTCFullYear(), phoenixNow.getUTCMonth(), 0, 23, 59, 59) + 7 * 60 * 60 * 1000);
        return { start: lastMonthStart, end: lastMonthEnd };
      }
      case 'thisWeek':
        return { start: startOfWeek(now), end: now };
      case 'custom':
        if (customStartDate && customEndDate) {
          return { 
            start: new Date(customStartDate + 'T00:00:00'), 
            end: new Date(customEndDate + 'T23:59:59') 
          };
        }
        return { start: subDays(now, 30), end: now };
      default:
        return { start: subDays(now, 30), end: now };
    }
  };

  const dateFilter = getDateRangeFilter();

  // Calculate previous period range (same length as current period)
  const getPreviousPeriodFilter = () => {
    const duration = dateFilter.end - dateFilter.start;
    return {
      start: new Date(dateFilter.start.getTime() - duration),
      end: new Date(dateFilter.start.getTime())
    };
  };
  const prevDateFilter = getPreviousPeriodFilter();
  
  // Filter sales by sale_date (compare local date strings) — exclude cancelled
  const filteredSales = sales.filter(sale => {
    if (!sale.sale_date) return false;
    if (sale.is_cancelled) return false;
    const saleDateStr = format(parseISO(sale.sale_date), 'yyyy-MM-dd');
    return saleDateStr >= format(dateFilter.start, 'yyyy-MM-dd') && saleDateStr <= format(dateFilter.end, 'yyyy-MM-dd');
  });
  
  // Previous period sales — exclude cancelled
  const prevFilteredSales = sales.filter(sale => {
    if (!sale.sale_date) return false;
    if (sale.is_cancelled) return false;
    const saleDateStr = format(parseISO(sale.sale_date), 'yyyy-MM-dd');
    return saleDateStr >= format(prevDateFilter.start, 'yyyy-MM-dd') && saleDateStr <= format(prevDateFilter.end, 'yyyy-MM-dd');
  });

  const prevCompletedAppointmentsInRange = appointments.filter(apt => {
    if (!apt.appointment_date) return false;
    const aptDateStr = apt.appointment_date;
    return aptDateStr >= format(prevDateFilter.start, 'yyyy-MM-dd') && aptDateStr <= format(prevDateFilter.end, 'yyyy-MM-dd') &&
           ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed', 'Credit Decline', 'Follow-Up'].includes(apt.status);
  });

  // Get appointment IDs from filtered sales
  const filteredAppointmentIds = new Set(filteredSales.map(s => s.appointment));
  
  // Get appointments that have sales in the date range
  const filteredAppointments = appointments.filter(apt => filteredAppointmentIds.has(apt.id));

  // Get ALL appointments with a completed status in the date range (for consultant performance)
  const completedAppointmentsInRange = appointments.filter(apt => {
    if (!apt.appointment_date) return false;
    const aptDateStr = apt.appointment_date;
    return aptDateStr >= format(dateFilter.start, 'yyyy-MM-dd') && aptDateStr <= format(dateFilter.end, 'yyyy-MM-dd') && 
           ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed', 'Credit Decline', 'Follow-Up'].includes(apt.status);
  });

  // Calculate Follow-Up Wins
  const { data: allTasks = [] } = useQuery({
    queryKey: ['allTasks'],
    queryFn: () => base44.entities.Task.list()
  });

  const { data: appointmentLogs = [] } = useQuery({
    queryKey: ['appointmentLogs'],
    queryFn: () => base44.entities.AppointmentLog.list()
  });

  // Filter tasks to only those for appointments in the date range (all completed or sold)
  const tasksInRange = React.useMemo(() => {
    const appointmentIds = new Set([...completedAppointmentsInRange, ...filteredAppointments].map(apt => apt.id));
    return allTasks.filter(task => appointmentIds.has(task.appointment));
  }, [allTasks, completedAppointmentsInRange, filteredAppointments]);

  const followUpWins = React.useMemo(() => {
    // Get all sold appointments in the date range
    const soldAppointmentsInRange = filteredAppointments.filter(apt => apt.status === 'Sold');
    
    // Check which ones had follow-up tasks (only from date range)
    const followUpSales = soldAppointmentsInRange.filter(apt => {
      return tasksInRange.some(task => task.appointment === apt.id && task.type === 'follow_up' && task.status === 'completed');
    });
    
    // Calculate total revenue from follow-up sales
    const totalRevenue = followUpSales.reduce((sum, apt) => {
      const sale = filteredSales.find(s => s.appointment === apt.id);
      return sum + getEffectiveSaleAmount(sale);
    }, 0);
    
    return {
      count: followUpSales.length,
      revenue: totalRevenue
    };
  }, [filteredAppointments, tasksInRange, filteredSales]);

  // Top Performing Consultants — all stats driven by filteredSales (sale_date in UTC-7 range)
  const dcIds = new Set(teamMembers.filter(tm => tm.role === 'Design Consultant' || tm.role === 'Sales Manager').map(tm => tm.id));
  const notWonStatuses = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up', 'Completed'];

  const consultantPerformance = [
    ...teamMembers
      .filter(tm => tm.role === 'Design Consultant' || tm.role === 'Sales Manager')
      .map(consultant => {
        const consultantSalesRecords = filteredSales.filter(sale => sale.assigned_dc === consultant.id);
        const notWonCount = completedAppointmentsInRange.filter(apt => apt.assigned_dc === consultant.id && notWonStatuses.includes(apt.status)).length;
        const totalDeals = consultantSalesRecords.length + notWonCount;
        const totalSalesValue = consultantSalesRecords.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);
        const aov = consultantSalesRecords.length > 0 ? totalSalesValue / consultantSalesRecords.length : 0;
        
        // Count follow-up wins: only sales with completed follow-up tasks
        const consultantFollowUpWinIds = new Set();
        let consultantFollowUpClosedValue = 0;
        consultantSalesRecords.forEach(sale => {
          const hasFollowUp = tasksInRange.some(task => task.appointment === sale.appointment && task.type === 'follow_up' && task.status === 'completed');
          if (hasFollowUp && !consultantFollowUpWinIds.has(sale.appointment)) {
            consultantFollowUpWinIds.add(sale.appointment);
            consultantFollowUpClosedValue += getEffectiveSaleAmount(sale);
          }
        });
        const consultantFollowUpClosedCount = consultantFollowUpWinIds.size;
        const avgGP = consultantSalesRecords.length > 0
          ? consultantSalesRecords.reduce((sum, sale) => {
              if (sale.rfms_order_data?.result?.lines) {
                const totalCost = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.unitCost * item.quantity), 0);
                const orderTotal = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.total || 0), 0);
                return sum + (orderTotal > 0 ? ((orderTotal - totalCost) / orderTotal * 100) : 0);
              }
              return sum;
            }, 0) / consultantSalesRecords.length
          : 0;
        const totalGPDollars = consultantSalesRecords.reduce((sum, sale) => {
          if (sale.rfms_order_data?.result?.lines) {
            const totalCost = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.unitCost * item.quantity), 0);
            const orderTotal = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.total || 0), 0);
            return sum + (orderTotal - totalCost);
          }
          return sum;
        }, 0);
        const followUpAppointments = completedAppointmentsInRange.filter(a => a.assigned_dc === consultant.id && a.status === 'Follow-Up');
        const followUpWins = tasksInRange.filter(task => task.assigned_to === consultant.id && task.type === 'follow_up' && task.status === 'completed').length;
        const uniqueFollowUpAppointmentIds = new Set(followUpAppointments.map(a => a.id)).size;
        return {
          name: `${consultant.first_name} ${consultant.last_name}`,
          appointments: totalDeals,
          sales: consultantSalesRecords.length,
          conversionRate: totalDeals > 0 ? ((consultantSalesRecords.length / totalDeals) * 100).toFixed(1) : 0,
          aov: aov,
          totalSalesValue: totalSalesValue,
          avgGP: avgGP,
          totalGPDollars: totalGPDollars,
          followUpCount: tasksInRange.filter(task => task.assigned_to === consultant.id && task.type === 'follow_up').length,
          followUpWins: followUpWins,
          totalFollowUpAppointments: uniqueFollowUpAppointmentIds,
          followUpClosedCount: consultantFollowUpClosedCount,
          followUpClosedValue: consultantFollowUpClosedValue,
        };
      })
      .filter(c => c.sales > 0 || c.appointments > 0),
    // Unassigned: sales with no DC or DC not in Design Consultant role
    (() => {
      const unassignedSales = filteredSales.filter(sale => !sale.assigned_dc || !dcIds.has(sale.assigned_dc));
      const totalSalesValue = unassignedSales.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);
      const aov = unassignedSales.length > 0 ? totalSalesValue / unassignedSales.length : 0;
      const notWonCount = completedAppointmentsInRange.filter(apt =>
        (!apt.assigned_dc || !dcIds.has(apt.assigned_dc)) && notWonStatuses.includes(apt.status)
      ).length;
      const totalDeals = unassignedSales.length + notWonCount;
      return {
        name: 'Unassigned',
        appointments: totalDeals,
        sales: unassignedSales.length,
        conversionRate: totalDeals > 0 ? ((unassignedSales.length / totalDeals) * 100).toFixed(1) : 0,
        aov: aov,
        totalSalesValue: totalSalesValue,
        followUpCount: 0,
        followUpClosedCount: 0,
        isUnassigned: true
      };
    })()
  ].filter(c => c.sales > 0 || c.appointments > 0).sort((a, b) => b.sales - a.sales);

  // Calculate Sales by Lead Source
  const salesByLeadSource = React.useMemo(() => {
    const sourceStats = {};

    filteredAppointments.forEach(apt => {
      if (apt.status === 'Sold') {
        const checklist = allChecklists.find(c => c.appointment === apt.id);
        const source = checklist?.heard_about_us || 'Unknown';
        
        // Find the sale record to get the actual sale amount
        const sale = sales.find(s => s.appointment === apt.id);
        const saleAmount = getEffectiveSaleAmount(sale);
        
        if (!sourceStats[source]) {
          sourceStats[source] = {
            count: 0,
            value: 0
          };
        }
        sourceStats[source].count++;
        sourceStats[source].value += saleAmount;
      }
    });

    return Object.entries(sourceStats)
      .map(([name, stats]) => ({ 
        name, 
        count: stats.count, 
        value: stats.value,
        aov: stats.count > 0 ? stats.value / stats.count : 0
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredAppointments, allChecklists, sales]);

  // Pending Outcome Appointments (past appointment date, not yet resulted)
  const pendingOutcomeData = React.useMemo(() => {
    const nowPhoenix = new Date(new Date().getTime() - 7 * 60 * 60 * 1000);
    const pendingStatuses = ['Scheduled', 'Rescheduled', 'In Route', 'On Site', 'Awaiting Assignment'];

    const pendingApts = appointments.filter(apt => {
      if (!apt.appointment_date) return false;
      if (!pendingStatuses.includes(apt.status)) return false;
      const aptDate = new Date(apt.appointment_date + 'T23:59:59');
      return aptDate < nowPhoenix;
    });

    const byConsultant = {};
    pendingApts.forEach(apt => {
      const consultant = teamMembers.find(tm => tm.id === apt.assigned_dc);
      const name = consultant ? `${consultant.first_name} ${consultant.last_name}` : 'Unassigned';
      if (!byConsultant[name]) byConsultant[name] = [];
      byConsultant[name].push(apt);
    });

    return Object.entries(byConsultant)
      .map(([name, apts]) => ({ name, count: apts.length, appointments: apts }))
      .sort((a, b) => b.count - a.count);
  }, [appointments, teamMembers]);

  // Calculate Lost Sales Analysis
  const lostSalesData = React.useMemo(() => {
    const lostReasons = {
      'Lost': 0,
      'Pitch and Miss': 0,
      'One-Leg': 0,
      'Credit Decline': 0
    };

    completedAppointmentsInRange.forEach(apt => {
      if (lostReasons.hasOwnProperty(apt.status)) {
        lostReasons[apt.status]++;
      }
    });

    return Object.entries(lostReasons)
      .map(([name, count]) => ({ name, count }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [completedAppointmentsInRange]);

  // Calculate Lost Sales by Sentiment/Reason
  const lostSalesBySentiment = React.useMemo(() => {
    const sentimentCounts = {};

    completedAppointmentsInRange.forEach(apt => {
      const lostStatuses = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline'];
      if (lostStatuses.includes(apt.status) && apt.analyzed_not_sold_reason) {
        const reason = apt.analyzed_not_sold_reason;
        sentimentCounts[reason] = (sentimentCounts[reason] || 0) + 1;
      }
    });

    return Object.entries(sentimentCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [completedAppointmentsInRange]);

  // Calculate daily metrics based on actual sale dates
  const dailyMetrics = React.useMemo(() => {
    const days = eachDayOfInterval({ start: dateFilter.start, end: dateFilter.end });
    
    return days.map(day => {
      const dayStart = new Date(day.setHours(0, 0, 0, 0));
      const dayEnd = new Date(day.setHours(23, 59, 59, 999));
      
      // Get sales for this day based on sale_date
      const daySales = filteredSales.filter(sale => {
        const saleDateStr = format(parseISO(sale.sale_date), 'yyyy-MM-dd');
        const dayStr = format(day, 'yyyy-MM-dd');
        return saleDateStr === dayStr;
      });
      
      // For closing percentage, we need to look at appointments that were completed on this day
      const dayCompletedAppointments = appointments.filter(apt => {
        if (!apt.appointment_date) return false;
        const aptDate = new Date(apt.appointment_date + 'T00:00:00');
        return aptDate >= dayStart && aptDate <= dayEnd && 
               ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed', 'Credit Decline', 'Follow-Up'].includes(apt.status);
      });
      
      const daySoldAppointments = dayCompletedAppointments.filter(apt => apt.status === 'Sold');
      
      // Calculate closing percentage
      const closingPercentage = dayCompletedAppointments.length > 0 ? 
        (daySoldAppointments.length / dayCompletedAppointments.length) * 100 : 0;
      
      // Calculate total sales and AOV from actual sales
      const totalSales = daySales.reduce((sum, sale) => sum + getEffectiveSaleAmount(sale), 0);
      const aov = daySales.length > 0 ? totalSales / daySales.length : 0;
      
      return {
        date: format(day, 'MMM dd'),
        closingPercentage: parseFloat(closingPercentage.toFixed(1)),
        aov: parseFloat(aov.toFixed(2)),
        totalSales: parseFloat(totalSales.toFixed(2)),
        soldCount: daySales.length,
        completedCount: dayCompletedAppointments.length
      };
    });
  }, [filteredSales, appointments, dateFilter]);

  // Previous period metrics
  // Current period summary values
  const currentTotalSales = dailyMetrics.reduce((sum, day) => sum + day.totalSales, 0);
  const daysWithSales = dailyMetrics.filter(d => d.soldCount > 0);
  const currentAOV = daysWithSales.length > 0
    ? daysWithSales.reduce((sum, d) => sum + d.aov, 0) / daysWithSales.length
    : 0;

  // Use filteredSales directly for totals (includes all sales regardless of DC assignment)
  const totalClosedSales = filteredSales.length;
  const totalNotWon = completedAppointmentsInRange.filter(apt => notWonStatuses.includes(apt.status)).length;
  const totalAppointments = totalClosedSales + totalNotWon;
  const currentClosingPct = totalAppointments > 0 ? (totalClosedSales / totalAppointments) * 100 : 0;

  // Previous period metrics
  const prevNotWonStatuses = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up', 'Completed'];
  const prevTotalSales = prevFilteredSales.reduce((sum, s) => sum + getEffectiveSaleAmount(s), 0);
  const prevSoldCount = prevFilteredSales.length;
  const prevSoldAppointments = prevCompletedAppointmentsInRange.filter(a => a.status === 'Sold').length;
  const prevNotWon = prevCompletedAppointmentsInRange.filter(apt => prevNotWonStatuses.includes(apt.status)).length;
  const prevTotalAppointments = prevSoldCount + prevNotWon;
  const prevClosingPct = prevTotalAppointments > 0
    ? (prevSoldAppointments / prevTotalAppointments) * 100
    : 0;
  const prevAOV = prevSoldCount > 0 ? prevTotalSales / prevSoldCount : 0;

  const calcChange = (current, previous) => {
    if (previous === 0) return null;
    return ((current - previous) / previous) * 100;
  };

  const PeriodBadge = ({ current, previous, isCurrency = false, isPct = false }) => {
    const change = calcChange(current, previous);
    if (change === null) return <p className="text-xs text-muted-foreground mt-1">No prior data</p>;
    const isUp = change >= 0;
    const Icon = Math.abs(change) < 0.5 ? ArrowRight : isUp ? ArrowUpRight : ArrowDownRight;
    const color = isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';
    const prevFormatted = isCurrency
      ? `$${previous.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : isPct
      ? `${previous.toFixed(1)}%`
      : previous.toLocaleString();
    return (
      <div className={`flex items-center gap-1 mt-1 ${color}`}>
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs font-semibold">{Math.abs(change).toFixed(1)}% <span className="font-normal text-muted-foreground">({prevFormatted})</span></span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Sales Reports</h1>
              <p className="text-muted-foreground mt-1">Analytics and insights for sales performance</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="7days">Last 7 Days</SelectItem>
                  <SelectItem value="30days">Last 30 Days</SelectItem>
                  <SelectItem value="thisWeek">This Week</SelectItem>
                  <SelectItem value="thisMonth">This Month</SelectItem>
                  <SelectItem value="lastMonth">Last Month</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
              
              {dateRange === 'custom' && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="h-10 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="h-10 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {appointmentsLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    Avg Closing %
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">
                    {currentClosingPct.toFixed(1)}%
                  </div>
                  <PeriodBadge current={currentClosingPct} previous={prevClosingPct} isPct={true} />
                  <p className="text-xs text-muted-foreground mt-2">{totalClosedSales} sales / {totalAppointments} appointments</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-600 dark:text-green-400" />
                    Avg Order Value
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">
                    ${currentAOV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <PeriodBadge current={currentAOV} previous={prevAOV} isCurrency={true} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Total Sales
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">
                    ${currentTotalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <PeriodBadge current={currentTotalSales} previous={prevTotalSales} isCurrency={true} />
                  <p className="text-xs text-muted-foreground mt-2">{filteredSales.length} sales</p>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:border-purple-300 dark:hover:border-purple-500/40 transition-colors" onClick={() => setShowFollowUpWinsModal(true)}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    Follow-Up Wins
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-foreground">
                    {followUpWins.count}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    ${followUpWins.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from follow-ups
                  </p>
                  <p className="text-xs text-purple-500 dark:text-purple-400 mt-1 underline">Click to view details</p>
                </CardContent>
              </Card>
            </div>

            {/* Closing Percentage by Day */}
            <Card>
              <CardHeader>
                <CardTitle>Closing Percentage by Day</CardTitle>
                <CardDescription>Daily conversion rate from completed appointments to sales</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dailyMetrics}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} />
                    <Tooltip 
                      formatter={(value, name) => {
                        if (name === 'closingPercentage') return [`${value}%`, 'Closing %'];
                        return [value, name];
                      }}
                      labelFormatter={(label, payload) => {
                        if (payload && payload[0]) {
                          return `${label} (${payload[0].payload.soldCount}/${payload[0].payload.completedCount})`;
                        }
                        return label;
                      }}
                    />
                    <Line type="monotone" dataKey="closingPercentage" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
                {dailyMetrics.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No data available for this date range</p>
                )}
              </CardContent>
            </Card>

            {/* AOV by Day */}
            <Card>
              <CardHeader>
                <CardTitle>Average Order Value by Day</CardTitle>
                <CardDescription>Daily average sale amount</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dailyMetrics}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => `$${value.toLocaleString()}`} tick={{ fontSize: 11 }} />
                    <Tooltip 
                      formatter={(value, name) => {
                        if (name === 'aov') return [`$${value.toLocaleString()}`, 'AOV'];
                        return [value, name];
                      }}
                      labelFormatter={(label, payload) => {
                        if (payload && payload[0]) {
                          return `${label} (${payload[0].payload.soldCount} sales)`;
                        }
                        return label;
                      }}
                    />
                    <Line type="monotone" dataKey="aov" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
                {dailyMetrics.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No data available for this date range</p>
                )}
              </CardContent>
            </Card>

            {/* Total Sales by Day */}
            <Card>
              <CardHeader>
                <CardTitle>Total Sales by Day</CardTitle>
                <CardDescription>Daily revenue generated</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dailyMetrics}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => `$${value.toLocaleString()}`} tick={{ fontSize: 11 }} />
                    <Tooltip 
                      formatter={(value, name) => {
                        if (name === 'totalSales') return [`$${value.toLocaleString()}`, 'Total Sales'];
                        return [value, name];
                      }}
                      labelFormatter={(label, payload) => {
                        if (payload && payload[0]) {
                          return `${label} (${payload[0].payload.soldCount} sales)`;
                        }
                        return label;
                      }}
                    />
                    <Bar dataKey="totalSales" fill="#059669" />
                    <ReferenceLine 
                      y={dailyMetrics.length > 0 ? dailyMetrics.reduce((sum, day) => sum + day.totalSales, 0) / dailyMetrics.length : 0} 
                      stroke="#f59e0b" 
                      strokeDasharray="5 5" 
                      strokeWidth={2}
                      label={{ value: 'Average', position: 'insideTopRight', fill: '#f59e0b', fontSize: 12, fontWeight: 600 }}
                    />
                  </BarChart>
                </ResponsiveContainer>
                {dailyMetrics.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No data available for this date range</p>
                )}
              </CardContent>
            </Card>

            {/* Sales by Lead Source */}
            <Card>
              <CardHeader>
                <CardTitle>Sales by Lead Source</CardTitle>
                <CardDescription>Revenue breakdown by marketing channel</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart 
                    data={salesByLeadSource}
                    onClick={(data) => {
                      if (data && data.activePayload) {
                        setSelectedLeadSource(data.activePayload[0].payload.name);
                        setShowLeadSourceModal(true);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} tick={{ fontSize: 11 }} />
                    <YAxis 
                      tickFormatter={(value) => `$${value.toLocaleString()}`}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip 
                      formatter={(value) => [`$${value.toLocaleString()}`, 'Revenue']}
                      cursor={{ fill: 'rgba(16, 185, 129, 0.1)' }}
                    />
                    <Bar dataKey="value" fill="#10b981" style={{ cursor: 'pointer' }} />
                  </BarChart>
                </ResponsiveContainer>
                {salesByLeadSource.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No sales data available for this date range</p>
                )}
              </CardContent>
            </Card>

            {/* AOV by Lead Source */}
            <Card>
              <CardHeader>
                <CardTitle>Average Order Value by Lead Source</CardTitle>
                <CardDescription>Average sale amount per marketing channel</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={salesByLeadSource}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => `$${value.toLocaleString()}`} tick={{ fontSize: 11 }} />
                    <Tooltip 
                      formatter={(value) => [`$${value.toLocaleString()}`, 'AOV']}
                      labelFormatter={(label, payload) => {
                        if (payload && payload[0]) {
                          return `${label} (${payload[0].payload.count} sales)`;
                        }
                        return label;
                      }}
                    />
                    <Bar dataKey="aov" fill="#6366f1" />
                  </BarChart>
                </ResponsiveContainer>
                {salesByLeadSource.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No sales data available for this date range</p>
                )}
              </CardContent>
            </Card>

            {/* Sales Attribution Detail Table */}
            {(() => {
              const allTableRows = filteredAppointments
                .filter(apt => apt.status === 'Sold')
                .map(apt => {
                  const checklist = allChecklists.find(c => c.appointment === apt.id);
                  const sale = sales.find(s => s.appointment === apt.id);
                  const consultant = teamMembers.find(tm => tm.id === sale?.assigned_dc);
                  const lead = leads.find(l => l.id === apt.customer);
                  return {
                    apt, sale, checklist, consultant, lead,
                    customerName: checklist ? `${checklist.customer_first_name || ''} ${checklist.customer_last_name || ''}`.trim() : (lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown'),
                    leadSource: checklist?.heard_about_us || 'Unknown',
                    saleDate: sale?.sale_date ? format(parseISO(sale.sale_date), 'MM/dd/yyyy') : '',
                    saleDateRaw: sale?.sale_date || '',
                    saleAmount: getEffectiveSaleAmount(sale),
                    consultantName: consultant ? `${consultant.first_name} ${consultant.last_name}` : 'Unassigned',
                    phone: checklist?.customer_phone || lead?.phone || '',
                    address: checklist?.customer_street ? `${checklist.customer_street}${checklist.city ? ', ' + checklist.city : ''}${checklist.state ? ', ' + checklist.state : ''}` : (sale?.location_address || ''),
                    invoiceNumber: sale?.invoice_number || '',
                  };
                });

              // Unique values for filter dropdowns
              const uniqueLeadSources = [...new Set(allTableRows.map(r => r.leadSource))].sort();
              const uniqueConsultants = [...new Set(allTableRows.map(r => r.consultantName))].sort();

              const tableRows = allTableRows
                .filter(row => {
                  if (leadSourceTableSearch) {
                    const q = leadSourceTableSearch.toLowerCase();
                    if (!row.customerName.toLowerCase().includes(q) && !row.leadSource.toLowerCase().includes(q) && !row.consultantName.toLowerCase().includes(q) && !row.invoiceNumber.toLowerCase().includes(q)) return false;
                  }
                  if (tableFilters.leadSource && row.leadSource !== tableFilters.leadSource) return false;
                  if (tableFilters.consultantName && row.consultantName !== tableFilters.consultantName) return false;
                  return true;
                })
                .sort((a, b) => {
                  const { col, dir } = tableSort;
                  let av = a[col], bv = b[col];
                  if (col === 'saleAmount') return dir === 'asc' ? av - bv : bv - av;
                  if (col === 'saleDate') { av = a.saleDateRaw; bv = b.saleDateRaw; }
                  return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
                });

              const SortIcon = ({ col }) => {
                if (tableSort.col !== col) return <span className="ml-1 text-muted-foreground">↕</span>;
                return <span className="ml-1">{tableSort.dir === 'asc' ? '↑' : '↓'}</span>;
              };

              const handleSort = (col) => {
                setTableSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
              };

              const FilterDropdown = ({ filterKey, options }) => (
                <select
                  value={tableFilters[filterKey] || ''}
                  onChange={e => setTableFilters(prev => ({ ...prev, [filterKey]: e.target.value || undefined }))}
                  onClick={e => e.stopPropagation()}
                  className="mt-1 block w-full text-xs border border-border rounded px-1.5 py-1 bg-card text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">All</option>
                  {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              );

              const exportCSV = () => {
                const headers = ['Sale Date', 'Customer Name', 'Lead Source', 'Sale Amount', 'Consultant', 'Phone', 'Address', 'Invoice #'];
                const csvRows = tableRows.map(r => [
                  r.saleDate, r.customerName, r.leadSource,
                  r.saleAmount ? `$${r.saleAmount.toLocaleString()}` : '$0',
                  r.consultantName, r.phone, r.address, r.invoiceNumber
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
                const csv = [headers.join(','), ...csvRows].join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `sales-by-lead-source-${format(new Date(), 'yyyy-MM-dd')}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              };

              const copyTable = () => {
                const headers = ['Sale Date', 'Customer Name', 'Lead Source', 'Sale Amount', 'Consultant', 'Phone', 'Address', 'Invoice #'];
                const rows = tableRows.map(r => [r.saleDate, r.customerName, r.leadSource, r.saleAmount ? `$${r.saleAmount.toLocaleString()}` : '$0', r.consultantName, r.phone, r.address, r.invoiceNumber].join('\t'));
                navigator.clipboard.writeText([headers.join('\t'), ...rows].join('\n'));
                setCopiedTable(true);
                setTimeout(() => setCopiedTable(false), 2000);
              };

              return (
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle>Sales Detail — Lead Source Attribution</CardTitle>
                        <CardDescription>{tableRows.length} sales in selected period</CardDescription>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button variant="outline" size="sm" onClick={copyTable} className="gap-1.5">
                          {copiedTable ? <Check className="w-4 h-4 text-green-600 dark:text-green-400" /> : <Copy className="w-4 h-4" />}
                          {copiedTable ? 'Copied!' : 'Copy'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
                          <Download className="w-4 h-4" /> Export CSV
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="text"
                        placeholder="Search by customer, lead source, consultant, invoice..."
                        value={leadSourceTableSearch}
                        onChange={e => setLeadSourceTableSearch(e.target.value)}
                        className="flex-1 h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      {Object.keys(tableFilters).length > 0 && (
                        <button onClick={() => setTableFilters({})} className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 whitespace-nowrap px-2 py-1 border border-red-200 dark:border-red-500/25 rounded">Clear Filters</button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted text-xs text-muted-foreground uppercase tracking-wider">
                            {[['saleDate','Sale Date',false],['customerName','Customer',false],['leadSource','Lead Source',false],['saleAmount','Sale Amount',true],['consultantName','Consultant',false],['phone','Phone',false],['address','Address',false],['invoiceNumber','Invoice #',false]].map(([col, label, right]) => (
                              <th key={col} className={`px-4 py-3 font-medium ${right ? 'text-right' : 'text-left'} cursor-pointer select-none`}>
                                <div onClick={() => handleSort(col)} className="flex items-center gap-0.5 hover:text-foreground">
                                  {label}<SortIcon col={col} />
                                </div>
                                {col === 'leadSource' && <FilterDropdown filterKey="leadSource" options={uniqueLeadSources} />}
                                {col === 'consultantName' && <FilterDropdown filterKey="consultantName" options={uniqueConsultants} />}
                              </th>
                            ))}
                            <th className="px-4 py-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {tableRows.length === 0 && (
                            <tr><td colSpan={9} className="text-center text-muted-foreground py-8">No sales found</td></tr>
                          )}
                          {tableRows.map(({ apt, sale, customerName, leadSource, saleDate, saleAmount, consultantName, phone, address, invoiceNumber }) => (
                            <tr key={apt.id} className="hover:bg-muted transition-colors">
                              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{saleDate}</td>
                              <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{customerName}</td>
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25">
                                  {leadSource}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">
                                ${saleAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{consultantName}</td>
                              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{phone}</td>
                              <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{address}</td>
                              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{invoiceNumber}</td>
                              <td className="px-4 py-3">
                                <Link to={createPageUrl('SaleDetail') + '?id=' + sale?.id} className="text-muted-foreground hover:text-primary">
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
              );
            })()}

            {/* Pending Outcome Appointments */}
            <Card>
              <CardHeader>
                <CardTitle>Pending Outcome — Past Appointments</CardTitle>
                <CardDescription>Appointments that have already passed but haven't been marked as Sold, Lost, etc. • Click a bar to view details</CardDescription>
              </CardHeader>
              <CardContent>
                {pendingOutcomeData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={pendingOutcomeData}
                      onClick={(data) => {
                        if (data && data.activePayload) {
                          setSelectedPendingConsultant(data.activePayload[0].payload);
                          setShowPendingModal(true);
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip formatter={(value) => [value, 'Pending']} />
                      <Bar dataKey="count" fill="#f59e0b" style={{ cursor: 'pointer' }} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No pending appointments — all past appointments have been resulted. 🎉</p>
                )}
              </CardContent>
            </Card>

            {/* Lost Sales Analysis */}
            <Card>
              <CardHeader>
                <CardTitle>Lost Sales Analysis</CardTitle>
                <CardDescription>Breakdown of appointments that didn't close by status • Click a bar to view details</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart 
                    data={lostSalesData}
                    onClick={(data) => {
                      if (data && data.activePayload) {
                        setSelectedLostReason(data.activePayload[0].payload.name);
                        setShowLostSalesModal(true);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [value, 'Count']} />
                    <Bar dataKey="count" fill="#ef4444" style={{ cursor: 'pointer' }} />
                  </BarChart>
                </ResponsiveContainer>
                {lostSalesData.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No lost sales in this date range</p>
                )}
              </CardContent>
            </Card>

            {/* Lost Sales by Reason */}
            <Card>
              <CardHeader>
                <CardTitle>Lost Sales by Reason</CardTitle>
                <CardDescription>AI-analyzed reasons for lost sales • Click a bar to view details</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart 
                    data={lostSalesBySentiment}
                    onClick={(data) => {
                      if (data && data.activePayload) {
                        setSelectedSentiment(data.activePayload[0].payload.name);
                        setShowSentimentModal(true);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={120} tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [value, 'Count']} />
                    <Bar dataKey="count" fill="#f97316" style={{ cursor: 'pointer' }} />
                  </BarChart>
                </ResponsiveContainer>
                {lostSalesBySentiment.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No analyzed lost sales in this date range. Use the "Analyze" button to categorize reasons.</p>
                )}
              </CardContent>
            </Card>

            {/* Consultant Performance */}
            <Card>
              <CardHeader>
                <CardTitle>Consultant Performance</CardTitle>
                <CardDescription>Sales and conversion rates by design consultant</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Summary Row */}
                {consultantPerformance.length > 0 && (() => {
                  const totalAppts = consultantPerformance.reduce((s, c) => s + c.appointments, 0);
                  const totalSalesCount = consultantPerformance.reduce((s, c) => s + c.sales, 0);
                  const totalRev = consultantPerformance.reduce((s, c) => s + c.totalSalesValue, 0);
                  const avgAOV = totalSalesCount > 0 ? totalRev / totalSalesCount : 0;
                  const avgConv = totalAppts > 0 ? (totalSalesCount / totalAppts * 100).toFixed(1) : 0;
                  const totalGP = consultantPerformance.reduce((s, c) => s + (c.totalGPDollars || 0), 0);
                  const avgGPPct = consultantPerformance.filter(c => c.sales > 0).length > 0
                    ? consultantPerformance.filter(c => c.sales > 0).reduce((s, c) => s + (c.avgGP || 0), 0) / consultantPerformance.filter(c => c.sales > 0).length
                    : 0;
                  const totalFUWins = consultantPerformance.reduce((s, c) => s + (c.followUpClosedCount || 0), 0);
                  const totalFUValue = consultantPerformance.reduce((s, c) => s + (c.followUpClosedValue || 0), 0);
                  return (
                    <div className="mb-4 p-4 bg-primary/10 border border-primary/20 rounded-xl">
                      <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">All Consultants — {format(dateFilter.start, 'MMM d')} to {format(dateFilter.end, 'MMM d, yyyy')}</p>
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-4 text-center">
                        <div>
                          <p className="text-lg font-bold text-green-700 dark:text-green-400">${totalRev.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                          <p className="text-xs text-muted-foreground">total revenue</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">${avgAOV.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                          <p className="text-xs text-muted-foreground">avg order value</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-primary">{avgConv}%</p>
                          <p className="text-xs text-muted-foreground">{totalSalesCount}/{totalAppts} conversion</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{avgGPPct.toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">avg gp%</p>
                          <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">${totalGP.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-purple-700 dark:text-purple-400">{totalFUWins}</p>
                          <p className="text-xs text-muted-foreground">follow-up wins</p>
                          <p className="text-xs text-purple-500 dark:text-purple-400">${totalFUValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-foreground">{totalSalesCount}</p>
                          <p className="text-xs text-muted-foreground">total sales</p>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <div className="overflow-x-auto">
                <div className="space-y-4 min-w-[680px]">
                  {consultantPerformance.map((consultant, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setSelectedConsultant(consultant);
                        setShowConsultantModal(true);
                      }}
                      className="w-full flex items-center justify-between p-4 bg-secondary hover:bg-muted rounded-lg border border-border transition-colors group cursor-pointer"
                    >
                      <div className="flex-1 text-left">
                        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{consultant.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {consultant.appointments} appointments • {consultant.sales} sales
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-lg font-bold text-green-600 dark:text-green-400">
                            ${consultant.totalSalesValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-muted-foreground">total sales</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                            ${consultant.aov.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-muted-foreground">avg order value</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-primary">{consultant.conversionRate}%</p>
                          <p className="text-xs text-muted-foreground">conversion rate</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{(consultant.avgGP || 0).toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">avg gp%</p>
                          <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">${(consultant.totalGPDollars || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{consultant.followUpClosedCount} <span className="text-xs text-muted-foreground">/ {consultant.totalFollowUpAppointments}</span></p>
                          <p className="text-xs text-muted-foreground">follow-up wins</p>
                          <p className="text-xs text-purple-400 dark:text-purple-300">${(consultant.followUpClosedValue || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                        </div>
                        <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                        </button>
                        ))}
                  {consultantPerformance.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">No data available for this date range</p>
                  )}
                </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Pending Outcome Modal */}
      <Dialog open={showPendingModal} onOpenChange={setShowPendingModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pending Appointments — {selectedPendingConsultant?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {selectedPendingConsultant?.appointments
              .sort((a, b) => new Date(a.appointment_date) - new Date(b.appointment_date))
              .map(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                return (
                  <Link
                    key={apt.id}
                    to={createPageUrl('AppointmentDetail') + '?id=' + apt.id}
                    className="flex items-center justify-between p-4 bg-secondary hover:bg-muted rounded-lg border border-border transition-colors group"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {checklist?.customer_first_name || apt.location_address || 'Unknown'} {checklist?.customer_last_name || ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {apt.appointment_date && format(new Date(apt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')}
                        {apt.appointment_block && ` • ${apt.appointment_block}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                        apt.status === 'In Route' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' :
                        apt.status === 'On Site' ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' :
                        'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300'
                      }`}>{apt.status}</span>
                      <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                    </div>
                  </Link>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Lead Source Modal */}
      <Dialog open={showLeadSourceModal} onOpenChange={setShowLeadSourceModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sales from {selectedLeadSource}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {filteredAppointments
              .filter(apt => {
                if (apt.status !== 'Sold') return false;
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                return (checklist?.heard_about_us || 'Unknown') === selectedLeadSource;
              })
              .sort((a, b) => new Date(b.appointment_date || b.created_date) - new Date(a.appointment_date || a.created_date))
              .map(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                return (
                  <Link
                    key={apt.id}
                    to={createPageUrl('AppointmentDetail') + '?id=' + apt.id}
                    className="flex items-center justify-between p-4 bg-secondary hover:bg-muted rounded-lg border border-border transition-colors group"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {checklist?.customer_first_name} {checklist?.customer_last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {apt.appointment_date && format(new Date(apt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')} • ${getEffectiveSaleAmount(sales.find(s => s.appointment === apt.id)).toLocaleString()}
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                  </Link>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Lost Sales Modal */}
      <Dialog open={showLostSalesModal} onOpenChange={setShowLostSalesModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedLostReason} Appointments</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {completedAppointmentsInRange
              .filter(apt => apt.status === selectedLostReason)
              .sort((a, b) => new Date(b.appointment_date || b.created_date) - new Date(a.appointment_date || a.created_date))
              .map(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                const lastNote = apt.notes && apt.notes.length > 0 ? apt.notes[apt.notes.length - 1] : null;
                const needsAnalysis = !apt.analyzed_not_sold_reason;
                const isAnalyzing = analyzingId === apt.id;

                return (
                  <Link
                    key={apt.id}
                    to={createPageUrl('AppointmentDetail') + '?id=' + apt.id}
                    className="flex flex-col gap-2 p-4 bg-secondary hover:bg-muted rounded-lg border border-border transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {checklist?.customer_first_name} {checklist?.customer_last_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {apt.appointment_date && format(new Date(apt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')} • Status: {apt.status}
                        </p>
                        {apt.analyzed_not_sold_reason && (
                          <p className="text-xs font-medium text-primary mt-1">
                            Reason: {apt.analyzed_not_sold_reason}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {needsAnalysis && lastNote && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => handleAnalyze(e, apt.id)}
                            disabled={isAnalyzing}
                            className="text-xs"
                          >
                            {isAnalyzing ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                Analyzing...
                              </>
                            ) : (
                              'Analyze'
                            )}
                          </Button>
                        )}
                        <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                      </div>
                    </div>
                    {lastNote && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-1">
                          Last Note ({lastNote.user_name} - {format(new Date(lastNote.timestamp), 'MMM d, h:mm a')}):
                        </p>
                        <p className="text-sm text-foreground">{lastNote.content}</p>
                      </div>
                    )}
                  </Link>
                );
                })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Sentiment Modal */}
      <Dialog open={showSentimentModal} onOpenChange={setShowSentimentModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Lost Sales: {selectedSentiment}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {completedAppointmentsInRange
              .filter(apt => {
                const lostStatuses = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline'];
                return lostStatuses.includes(apt.status) && apt.analyzed_not_sold_reason === selectedSentiment;
              })
              .sort((a, b) => new Date(b.appointment_date || b.created_date) - new Date(a.appointment_date || a.created_date))
              .map(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                const lastNote = apt.notes && apt.notes.length > 0 ? apt.notes[apt.notes.length - 1] : null;
                return (
                  <Link
                    key={apt.id}
                    to={createPageUrl('AppointmentDetail') + '?id=' + apt.id}
                    className="flex flex-col gap-2 p-4 bg-secondary hover:bg-muted rounded-lg border border-border transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {checklist?.customer_first_name} {checklist?.customer_last_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {apt.appointment_date && format(new Date(apt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')} • Status: {apt.status}
                        </p>
                      </div>
                      <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                    </div>
                    {lastNote && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-1">
                          Last Note ({lastNote.user_name} - {format(new Date(lastNote.timestamp), 'MMM d, h:mm a')}):
                        </p>
                        <p className="text-sm text-foreground">{lastNote.content}</p>
                      </div>
                    )}
                  </Link>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Follow-Up Wins Modal */}
      <Dialog open={showFollowUpWinsModal} onOpenChange={setShowFollowUpWinsModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Follow-Up Wins — {followUpWins.count} sales</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {filteredAppointments
              .filter(apt => apt.status === 'Sold' && tasksInRange.some(task => task.appointment === apt.id && task.type === 'follow_up' && task.status === 'completed'))
              .sort((a, b) => {
                const saleA = filteredSales.find(s => s.appointment === a.id);
                const saleB = filteredSales.find(s => s.appointment === b.id);
                return new Date(saleB?.sale_date || 0) - new Date(saleA?.sale_date || 0);
              })
              .map(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                const sale = filteredSales.find(s => s.appointment === apt.id);
                const consultant = teamMembers.find(tm => tm.id === sale?.assigned_dc);
                // Find the last status before "Sold" from appointment logs
                const aptLogs = appointmentLogs
                  .filter(log => log.appointment === apt.id)
                  .sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
                // Look for a log entry that recorded a status change to Sold — the one before it has the prior status
                const soldLogIndex = aptLogs.findIndex(log => 
                  log.action?.toLowerCase().includes('sold') || log.details?.toLowerCase().includes('status: sold') || log.details?.toLowerCase().includes('→ sold')
                );
                let priorStatus = null;
                if (soldLogIndex > 0) {
                  // Try to extract prior status from details of surrounding logs
                  const prevLog = aptLogs[soldLogIndex - 1];
                  const detailMatch = prevLog?.details?.match(/status[:\s]+([A-Za-z\s-]+)/i);
                  priorStatus = detailMatch?.[1]?.trim() || prevLog?.action || null;
                }
                // Fallback: search all logs for any status mentions before sold
                if (!priorStatus) {
                  const statusLogs = aptLogs.filter(log => {
                    const d = (log.details || '').toLowerCase();
                    return d.includes('one-leg') || d.includes('follow-up') || d.includes('pitch and miss') || d.includes('lost') || d.includes('credit decline');
                  });
                  if (statusLogs.length > 0) {
                    const last = statusLogs[statusLogs.length - 1];
                    const match = (last.details || '').match(/(One-Leg|Follow-Up|Pitch and Miss|Lost|Credit Decline)/i);
                    priorStatus = match?.[1] || null;
                  }
                }

                const priorStatusColors = {
                  'one-leg': 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/25',
                  'follow-up': 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/25',
                  'pitch and miss': 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25',
                  'lost': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25',
                  'credit decline': 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25',
                };
                const priorKey = priorStatus?.toLowerCase();
                const priorColor = priorStatusColors[priorKey] || 'bg-secondary text-muted-foreground border-border';

                const notes = apt.notes || [];

                return (
                  <div key={apt.id} className="flex flex-col bg-purple-50 dark:bg-purple-500/10 rounded-lg border border-purple-200 dark:border-purple-500/25 overflow-hidden">
                    <Link
                      to={createPageUrl('SaleDetail') + '?id=' + sale?.id}
                      className="flex items-center justify-between p-4 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors group"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {checklist?.customer_first_name} {checklist?.customer_last_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {sale?.sale_date && format(parseISO(sale.sale_date), 'MMM d, yyyy')}
                          {consultant && ` • ${consultant.first_name} ${consultant.last_name}`}
                        </p>
                        {priorStatus && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <Badge variant="outline" className={`text-xs ${priorColor}`}>{priorStatus}</Badge>
                            <span className="text-muted-foreground text-xs">→</span>
                            <Badge variant="outline" className="text-xs bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25">Sold</Badge>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">${getEffectiveSaleAmount(sale).toLocaleString()}</p>
                        <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                      </div>
                    </Link>
                    {notes.length > 0 && (
                      <div className="border-t border-purple-200 dark:border-purple-500/25 px-4 py-2">
                        <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-2">Notes ({notes.length})</p>
                        <div className="max-h-36 overflow-y-auto space-y-2 pr-1">
                          {[...notes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((note, i) => (
                            <div key={i} className="bg-card rounded p-2 border border-purple-100 dark:border-purple-500/25">
                              <p className="text-xs text-foreground">{note.content}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {note.user_name}{note.timestamp && ` — ${format(new Date(note.timestamp), 'MMM d, h:mm a')}`}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            {followUpWins.count === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No follow-up wins in this period</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Consultant Performance Modal */}
      <Dialog open={showConsultantModal} onOpenChange={setShowConsultantModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Performance — {selectedConsultant?.name}</DialogTitle>
          </DialogHeader>
          {selectedConsultant && (() => {
            const consultant = teamMembers.find(tm => `${tm.first_name} ${tm.last_name}` === selectedConsultant.name);
            const isUnassigned = selectedConsultant.isUnassigned;
            const notWonAppointments = completedAppointmentsInRange.filter(apt =>
              isUnassigned
                ? (!apt.assigned_dc || !dcIds.has(apt.assigned_dc)) && notWonStatuses.includes(apt.status)
                : apt.assigned_dc === consultant?.id && notWonStatuses.includes(apt.status)
            );
            const closedSales = filteredSales.filter(sale =>
              isUnassigned
                ? (!sale.assigned_dc || !dcIds.has(sale.assigned_dc))
                : sale.assigned_dc === consultant?.id
            );
            const totalDeals = closedSales.length + notWonAppointments.length;
            const conversionRate = totalDeals > 0 ? ((closedSales.length / totalDeals) * 100).toFixed(1) : 0;

            return (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pb-4 border-b">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary">{totalDeals}</p>
                    <p className="text-xs text-muted-foreground">Total Appointments</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{closedSales.length}</p>
                    <p className="text-xs text-muted-foreground">Total Sales</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      ${selectedConsultant.totalSalesValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Revenue</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      ${selectedConsultant.aov.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground">Avg Order Value</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{conversionRate}%</p>
                    <p className="text-xs text-muted-foreground">{closedSales.length}/{totalDeals} Conversion</p>
                  </div>
                </div>

                <Tabs defaultValue="closed">
                  <TabsList className="w-full">
                    <TabsTrigger value="closed" className="flex-1">
                      Closed Deals <span className="ml-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 text-xs font-bold px-1.5 py-0.5 rounded-full">{closedSales.length}</span>
                    </TabsTrigger>
                    <TabsTrigger value="followup" className="flex-1">
                      Follow-Up Wins <span className="ml-1.5 bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300 text-xs font-bold px-1.5 py-0.5 rounded-full">{(() => {
                        const wins = closedSales.filter(sale => tasksInRange.some(task => task.appointment === sale.appointment && task.type === 'follow_up' && task.status === 'completed')).length;
                        const totalFollowUp = completedAppointmentsInRange.filter(a => (isUnassigned ? (!a.assigned_dc || !dcIds.has(a.assigned_dc)) : a.assigned_dc === consultant?.id) && a.status === 'Follow-Up').length;
                        return `${wins}/${totalFollowUp}`;
                      })()}</span>
                    </TabsTrigger>
                    <TabsTrigger value="notwon" className="flex-1">
                      Not Won <span className="ml-1.5 bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300 text-xs font-bold px-1.5 py-0.5 rounded-full">{notWonAppointments.length}</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="closed">
                    <div className="space-y-3 mt-3">
                      {closedSales.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-6">No closed deals in this period</p>
                      )}
                      {closedSales
                        .sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date))
                        .map(sale => {
                          const checklist = allChecklists.find(c => c.appointment === sale.appointment);
                          const leadSource = checklist?.heard_about_us || 'Unknown';
                          const gpPercent = (() => {
                            if (sale.rfms_order_data?.result?.lines) {
                              const totalCost = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.unitCost * item.quantity), 0);
                              const orderTotal = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.total || 0), 0);
                              return orderTotal > 0 ? ((orderTotal - totalCost) / orderTotal * 100) : 0;
                            }
                            return null;
                          })();
                          return (
                            <Link
                              key={sale.id}
                              to={createPageUrl('SaleDetail') + '?id=' + sale.id}
                              className="flex items-center justify-between p-4 bg-secondary hover:bg-muted rounded-lg border border-border transition-colors group"
                            >
                              <div className="flex-1">
                                <p className="text-sm font-medium text-foreground">
                                  {checklist?.customer_first_name} {checklist?.customer_last_name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {sale.sale_date && format(parseISO(sale.sale_date), 'MMM d, yyyy')} • {leadSource}
                                </p>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                    ${getEffectiveSaleAmount(sale).toLocaleString()}
                                  </p>
                                  <p className="text-xs text-muted-foreground">sale</p>
                                </div>
                                {gpPercent !== null && (
                                  <div className="text-right">
                                    <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{gpPercent.toFixed(1)}%</p>
                                    <p className="text-xs text-muted-foreground">${(() => {
                                      if (sale.rfms_order_data?.result?.lines) {
                                        const totalCost = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.unitCost * item.quantity), 0);
                                        const orderTotal = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.total || 0), 0);
                                        return (orderTotal - totalCost).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                                      }
                                      return '0';
                                    })()}</p>
                                  </div>
                                )}
                                <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                              </div>
                              </Link>
                              );
                              })}
                              </div>
                              </TabsContent>

                              <TabsContent value="followup">
                    <div className="space-y-3 mt-3">
                      {(() => {
                        const followUpClosedSales = closedSales.filter(sale =>
                          tasksInRange.some(task => task.appointment === sale.appointment && task.type === 'follow_up' && task.status === 'completed')
                        );
                        return (
                          <>
                            {followUpClosedSales.length === 0 && (
                              <p className="text-sm text-muted-foreground text-center py-6">No follow-up wins in this period</p>
                            )}
                            {followUpClosedSales
                              .sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date))
                              .map(sale => {
                                const checklist = allChecklists.find(c => c.appointment === sale.appointment);
                                const leadSource = checklist?.heard_about_us || 'Unknown';
                                const gpPercent = (() => {
                                  if (sale.rfms_order_data?.result?.lines) {
                                    const totalCost = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.unitCost * item.quantity), 0);
                                    const orderTotal = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.total || 0), 0);
                                    return orderTotal > 0 ? ((orderTotal - totalCost) / orderTotal * 100) : 0;
                                  }
                                  return null;
                                })();
                                return (
                                  <Link
                                    key={sale.id}
                                    to={createPageUrl('SaleDetail') + '?id=' + sale.id}
                                    className="flex items-center justify-between p-4 bg-purple-50 hover:bg-purple-100 dark:bg-purple-500/10 dark:hover:bg-purple-500/20 rounded-lg border border-purple-200 dark:border-purple-500/25 transition-colors group"
                                  >
                                    <div className="flex-1">
                                      <p className="text-sm font-medium text-foreground">
                                        {checklist?.customer_first_name} {checklist?.customer_last_name}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {sale.sale_date && format(parseISO(sale.sale_date), 'MMM d, yyyy')} • {leadSource}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                      <div className="text-right">
                                        <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                          ${getEffectiveSaleAmount(sale).toLocaleString()}
                                        </p>
                                        <p className="text-xs text-muted-foreground">sale</p>
                                      </div>
                                      {gpPercent !== null && (
                                        <div className="text-right">
                                          <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{gpPercent.toFixed(1)}%</p>
                                          <p className="text-xs text-muted-foreground">${(() => {
                                            if (sale.rfms_order_data?.result?.lines) {
                                              const totalCost = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.unitCost * item.quantity), 0);
                                              const orderTotal = sale.rfms_order_data.result.lines.reduce((s, item) => s + (item.total || 0), 0);
                                              return (orderTotal - totalCost).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                                            }
                                            return '0';
                                          })()}</p>
                                        </div>
                                      )}
                                      <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                                    </div>
                                    </Link>
                                    );
                                    })}
                                    </>
                                    );
                                    })()}
                                    </div>
                                    </TabsContent>

                  <TabsContent value="notwon">
                    <div className="space-y-3 mt-3">
                      {notWonAppointments.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-6">No non-won appointments in this period</p>
                      )}
                      {notWonAppointments
                        .sort((a, b) => new Date(b.appointment_date || b.created_date) - new Date(a.appointment_date || a.created_date))
                        .map(apt => {
                          const checklist = allChecklists.find(c => c.appointment === apt.id);
                          const lastNote = apt.notes && apt.notes.length > 0 ? apt.notes[apt.notes.length - 1] : null;
                          const statusColors = {
                            'Lost': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
                            'Pitch and Miss': 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
                            'One-Leg': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300',
                            'Credit Decline': 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
                            'Cancelled': 'bg-secondary text-muted-foreground',
                            'Follow-Up': 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
                            'Completed': 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
                          };
                          return (
                            <Link
                              key={apt.id}
                              to={createPageUrl('AppointmentDetail') + '?id=' + apt.id}
                              className="flex flex-col gap-2 p-4 bg-secondary hover:bg-muted rounded-lg border border-border transition-colors group"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-foreground">
                                    {checklist?.customer_first_name} {checklist?.customer_last_name || apt.location_address || 'Unknown'}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {apt.appointment_date && format(parseISO(apt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')}
                                    {apt.appointment_block && ` • ${apt.appointment_block}`}
                                  </p>
                                  {apt.analyzed_not_sold_reason && (
                                    <p className="text-xs font-medium text-primary mt-0.5">Reason: {apt.analyzed_not_sold_reason}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusColors[apt.status] || 'bg-secondary text-muted-foreground'}`}>
                                    {apt.status}
                                  </span>
                                  <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                                </div>
                              </div>
                              {lastNote && (
                                <div className="pt-2 border-t border-border">
                                  <p className="text-xs text-muted-foreground mb-1">
                                    Last Note ({lastNote.user_name} — {format(new Date(lastNote.timestamp), 'MMM d, h:mm a')}):
                                  </p>
                                  <p className="text-xs text-foreground">{lastNote.content}</p>
                                </div>
                              )}
                            </Link>
                          );
                        })}
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}