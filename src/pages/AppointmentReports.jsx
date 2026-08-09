import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, LabelList } from 'recharts';
import { Calendar, TrendingUp, Clock, DollarSign, Loader2, ExternalLink } from 'lucide-react';
import { format, subDays, startOfMonth, startOfWeek } from 'date-fns';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const COLORS = ['#4F46E5', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1'];

export default function AppointmentReports() {
  const [dateRange, setDateRange] = useState('30days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedLeadSource, setSelectedLeadSource] = useState(null);
  const [showLeadSourceModal, setShowLeadSourceModal] = useState(false);
  const [selectedDayForAppointments, setSelectedDayForAppointments] = useState(null);
  const [showDayAppointmentsModal, setShowDayAppointmentsModal] = useState(false);
  const [selectedDayForCancellations, setSelectedDayForCancellations] = useState(null);
  const [showCancellationDayModal, setShowCancellationDayModal] = useState(false);
  const [selectedDayForReschedules, setSelectedDayForReschedules] = useState(null);
  const [showRescheduleDayModal, setShowRescheduleDayModal] = useState(false);
  const [bookedByDayLeadSource, setBookedByDayLeadSource] = useState('all');

  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery({
    queryKey: ['appointments'],
    queryFn: () => base44.entities.Appointment.list()
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
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

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list()
  });

  // Map appointment id -> project status (for sold appointments)
  const projectStatusByAppointment = useMemo(() => {
    const map = {};
    sales.forEach(sale => {
      if (!sale.appointment) return;
      const project = projects.find(p => p.sale === sale.id);
      if (project) {
        map[sale.appointment] = project.status;
      }
    });
    return map;
  }, [sales, projects]);

  // Merged lookup: prefer v1 if exists, fall back to v2
  const allChecklists = useMemo(() => [...checklists, ...checklistsV2], [checklists, checklistsV2]);

  const phoenixOffsetMs = 7 * 60 * 60 * 1000; // UTC-7

  // Helper: get current date string in Phoenix time (UTC-7)
  const nowPhoenixStr = () => format(new Date(new Date().getTime() - phoenixOffsetMs), 'yyyy-MM-dd');

  // Returns { startStr, endStr } as Phoenix date strings (yyyy-MM-dd)
  const getDateRangeFilter = () => {
    const nowPhoenix = new Date(new Date().getTime() - phoenixOffsetMs);
    const todayStr = format(nowPhoenix, 'yyyy-MM-dd');

    switch (dateRange) {
      case 'today':
        return { startStr: todayStr, endStr: todayStr };
      case 'yesterday': {
        const d = new Date(nowPhoenix);
        d.setDate(d.getDate() - 1);
        const s = format(d, 'yyyy-MM-dd');
        return { startStr: s, endStr: s };
      }
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
      case 'thisWeek': {
        const d = startOfWeek(nowPhoenix);
        return { startStr: format(d, 'yyyy-MM-dd'), endStr: todayStr };
      }
      case 'thisMonth': {
        const d = startOfMonth(nowPhoenix);
        return { startStr: format(d, 'yyyy-MM-dd'), endStr: todayStr };
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
  };

  const dateFilter = getDateRangeFilter();

  // Convert apt.created_date (UTC) to Phoenix day string and compare
  const filteredAppointments = appointments.filter(apt => {
    if (!apt.created_date) return false;
    const phoenixDate = new Date(new Date(apt.created_date).getTime() - phoenixOffsetMs);
    const dayStr = format(phoenixDate, 'yyyy-MM-dd');
    return dayStr >= dateFilter.startStr && dayStr <= dateFilter.endStr;
  });

  // Appointment Statistics
  const appointmentStats = {
    total: filteredAppointments.length,
    scheduled: filteredAppointments.filter(a => a.status === 'Scheduled').length,
    completed: filteredAppointments.filter(a => ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed'].includes(a.status)).length,
    cancelled: filteredAppointments.filter(a => a.status === 'Cancelled').length,
    sold: filteredAppointments.filter(a => a.status === 'Sold').length,
  };

  // Status Distribution
  const statusDistribution = [
    { name: 'Scheduled', value: appointmentStats.scheduled },
    { name: 'Completed', value: appointmentStats.completed },
    { name: 'Cancelled', value: appointmentStats.cancelled },
    { name: 'Sold', value: appointmentStats.sold },
  ].filter(item => item.value > 0);

  // Conversion Rate
  const conversionRate = appointmentStats.completed > 0 
    ? ((appointmentStats.sold / appointmentStats.completed) * 100).toFixed(1)
    : 0;

  // Appointments by Day of Week
  const appointmentsByDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => {
    const count = filteredAppointments.filter(apt => {
      if (!apt.appointment_date) return false;
      const date = new Date(apt.appointment_date + 'T00:00:00');
      return format(date, 'EEE') === day;
    }).length;
    return { day, count };
  });

  // Appointments by Time Block
  const appointmentsByBlock = [
    '9am to 11am',
    '12pm to 2pm',
    '3pm to 5pm',
    '6pm to 8pm'
  ].map(block => {
    const count = filteredAppointments.filter(apt => apt.appointment_block === block).length;
    return { block: block.replace(' to ', '-'), count };
  });

  // All appointments assigned to each CSR where created_date falls in range (Phoenix time)
  const csrFilteredAppointments = (csrId) => appointments.filter(apt => {
    if (apt.assigned_csr !== csrId) return false;
    if (!apt.created_date) return false;
    const phoenixDate = new Date(new Date(apt.created_date).getTime() - phoenixOffsetMs);
    const dayStr = format(phoenixDate, 'yyyy-MM-dd');
    return dayStr >= dateFilter.startStr && dayStr <= dateFilter.endStr;
  });

  // CSR Performance (appointments booked)
  const csrPerformance = teamMembers
    .filter(tm => tm.role === 'Customer Service Rep' || tm.role === 'Sales Manager' || tm.role === 'Admin')
    .map(csr => {
      const csrAppointments = csrFilteredAppointments(csr.id);
      return {
        name: `${csr.first_name} ${csr.last_name}`,
        booked: csrAppointments.length,
        scheduled: csrAppointments.filter(apt => apt.status === 'Scheduled' || apt.status === 'Rescheduled').length,
        completed: csrAppointments.filter(apt => ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed'].includes(apt.status)).length,
      };
    })
    .filter(c => c.booked > 0)
    .sort((a, b) => b.booked - a.booked);

  // Unassigned appointments (no CSR assigned, within date filter)
  const unassignedCsrAppointments = filteredAppointments.filter(apt => !apt.assigned_csr);
  if (unassignedCsrAppointments.length > 0) {
    csrPerformance.push({
      name: 'Unassigned',
      booked: unassignedCsrAppointments.length,
      scheduled: unassignedCsrAppointments.filter(apt => apt.status === 'Scheduled' || apt.status === 'Rescheduled').length,
      completed: unassignedCsrAppointments.filter(apt => ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed'].includes(apt.status)).length,
    });
  }

  // CSR Sales Performance (appointments that turned into sales)
  const csrSalesPerformance = teamMembers
    .filter(tm => tm.role === 'Customer Service Rep' || tm.role === 'Sales Manager' || tm.role === 'Admin')
    .map(csr => {
      const csrAppointments = csrFilteredAppointments(csr.id);
      const soldAppointments = csrAppointments.filter(apt => apt.status === 'Sold');
      
      // Get sales data for these appointments
      const csrSales = sales.filter(sale => 
        soldAppointments.some(apt => apt.id === sale.appointment)
      );
      
      const totalSalesValue = csrSales.reduce((sum, sale) => sum + (sale.sale_amount || 0), 0);
      
      return {
        name: `${csr.first_name} ${csr.last_name}`,
        soldCount: soldAppointments.length,
        totalValue: totalSalesValue,
        booked: csrAppointments.length
      };
    })
    .filter(c => c.booked > 0)
    .sort((a, b) => b.totalValue - a.totalValue);

  // Average Time on Site
  const completedWithTime = filteredAppointments.filter(apt => 
    apt.consultant_arrived_time && ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed'].includes(apt.status)
  );

  const avgTimeOnSite = completedWithTime.length > 0
    ? completedWithTime.reduce((sum, apt) => {
        const completionTime = new Date(apt.updated_date + (apt.updated_date.includes('Z') ? '' : 'Z'));
        const arrivedTime = new Date(apt.consultant_arrived_time);
        const durationMs = completionTime - arrivedTime;
        const minutes = Math.floor(durationMs / (1000 * 60));
        return sum + minutes;
      }, 0) / completedWithTime.length
    : 0;

  const avgHours = Math.floor(avgTimeOnSite / 60);
  const avgMinutes = Math.floor(avgTimeOnSite % 60);

  // Average Time to Schedule
  const appointmentsWithScheduleDate = filteredAppointments.filter(apt => 
    apt.appointment_date && apt.created_date
  );

  const avgTimeToSchedule = appointmentsWithScheduleDate.length > 0
    ? appointmentsWithScheduleDate.reduce((sum, apt) => {
        const createdDate = new Date(apt.created_date);
        const scheduledDate = new Date(apt.appointment_date + 'T00:00:00');
        const durationMs = scheduledDate - createdDate;
        const hours = durationMs / (1000 * 60 * 60);
        return sum + hours;
      }, 0) / appointmentsWithScheduleDate.length
    : 0;

  const avgScheduleDays = Math.floor(avgTimeToSchedule / 24);
  const avgScheduleHours = Math.floor(avgTimeToSchedule % 24);

  // Calculate Appointments by Lead Source
  const appointmentsByLeadSource = useMemo(() => {
    const sourceStats = {};

    filteredAppointments.forEach(apt => {
      const checklist = allChecklists.find(c => c.appointment === apt.id);
      const source = checklist?.heard_about_us || 'Unknown';
      
      if (!sourceStats[source]) {
        sourceStats[source] = 0;
      }
      sourceStats[source]++;
    });

    return Object.entries(sourceStats)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredAppointments, allChecklists]);

  // Fixed-period cancellation counts (always relative to today, regardless of date filter)
  const cancellationCounts = useMemo(() => {
    const nowPhoenix = new Date(new Date().getTime() - phoenixOffsetMs);
    const todayStr = format(nowPhoenix, 'yyyy-MM-dd');

    const yesterdayDate = new Date(nowPhoenix);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = format(yesterdayDate, 'yyyy-MM-dd');

    const last7Start = new Date(nowPhoenix);
    last7Start.setDate(last7Start.getDate() - 6);
    const last7StartStr = format(last7Start, 'yyyy-MM-dd');

    const last30Start = new Date(nowPhoenix);
    last30Start.setDate(last30Start.getDate() - 29);
    const last30StartStr = format(last30Start, 'yyyy-MM-dd');

    let yesterday = 0, last7 = 0, last30 = 0;

    appointments.filter(apt => apt.status === 'Cancelled' && apt.created_date).forEach(apt => {
      const utcDate = new Date(apt.created_date);
      const phoenixDate = new Date(utcDate.getTime() - phoenixOffsetMs);
      const dayStr = format(phoenixDate, 'yyyy-MM-dd');
      if (dayStr === yesterdayStr) yesterday++;
      if (dayStr >= last7StartStr && dayStr <= todayStr) last7++;
      if (dayStr >= last30StartStr && dayStr <= todayStr) last30++;
    });

    return { yesterday, last7, last30 };
  }, [appointments]);

  // Cancellation Rate
  const cancellationRate = appointmentStats.total > 0
    ? ((appointmentStats.cancelled / appointmentStats.total) * 100).toFixed(1)
    : 0;

  // Cancellations per day (Phoenix time: UTC-7)
  const cancellationsPerDay = useMemo(() => {
    const dayMap = {};

    filteredAppointments
      .filter(apt => apt.status === 'Cancelled')
      .forEach(apt => {
        const utcDate = new Date(apt.created_date);
        const phoenixDate = new Date(utcDate.getTime() - phoenixOffsetMs);
        const dayStr = format(phoenixDate, 'yyyy-MM-dd');
        dayMap[dayStr] = (dayMap[dayStr] || 0) + 1;
      });

    const data = [];
    for (let d = new Date(dateFilter.startStr + 'T00:00:00'); format(d, 'yyyy-MM-dd') <= dateFilter.endStr; d.setDate(d.getDate() + 1)) {
      const dayStr = format(d, 'yyyy-MM-dd');
      data.push({
        date: dayStr,
        cancellations: dayMap[dayStr] || 0,
        display: format(d, 'MMM d')
      });
    }

    return data;
  }, [filteredAppointments, dateFilter]);

  // Fixed-period reschedule counts
  const rescheduleCounts = useMemo(() => {
    const nowPhoenix = new Date(new Date().getTime() - phoenixOffsetMs);
    const todayStr = format(nowPhoenix, 'yyyy-MM-dd');
    const yesterdayDate = new Date(nowPhoenix);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = format(yesterdayDate, 'yyyy-MM-dd');
    const last7Start = new Date(nowPhoenix);
    last7Start.setDate(last7Start.getDate() - 6);
    const last7StartStr = format(last7Start, 'yyyy-MM-dd');
    const last30Start = new Date(nowPhoenix);
    last30Start.setDate(last30Start.getDate() - 29);
    const last30StartStr = format(last30Start, 'yyyy-MM-dd');

    let yesterday = 0, last7 = 0, last30 = 0;
    appointments.filter(apt => apt.status === 'Rescheduled' && apt.created_date).forEach(apt => {
      const phoenixDate = new Date(new Date(apt.created_date).getTime() - phoenixOffsetMs);
      const dayStr = format(phoenixDate, 'yyyy-MM-dd');
      if (dayStr === yesterdayStr) yesterday++;
      if (dayStr >= last7StartStr && dayStr <= todayStr) last7++;
      if (dayStr >= last30StartStr && dayStr <= todayStr) last30++;
    });
    return { yesterday, last7, last30 };
  }, [appointments]);

  // Reschedules per day
  const reschedulesPerDay = useMemo(() => {
    const dayMap = {};
    filteredAppointments
      .filter(apt => apt.status === 'Rescheduled')
      .forEach(apt => {
        const phoenixDate = new Date(new Date(apt.created_date).getTime() - phoenixOffsetMs);
        const dayStr = format(phoenixDate, 'yyyy-MM-dd');
        dayMap[dayStr] = (dayMap[dayStr] || 0) + 1;
      });

    const data = [];
    for (let d = new Date(dateFilter.startStr + 'T00:00:00'); format(d, 'yyyy-MM-dd') <= dateFilter.endStr; d.setDate(d.getDate() + 1)) {
      const dayStr = format(d, 'yyyy-MM-dd');
      data.push({ date: dayStr, reschedules: dayMap[dayStr] || 0, display: format(d, 'MMM d') });
    }
    return data;
  }, [filteredAppointments, dateFilter]);

  // Lead source options for filter
  const leadSourceOptions = useMemo(() => {
    const sources = new Set();
    filteredAppointments.forEach(apt => {
      const checklist = allChecklists.find(c => c.appointment === apt.id);
      sources.add(checklist?.heard_about_us || 'Unknown');
    });
    return Array.from(sources).sort();
  }, [filteredAppointments, allChecklists]);

  // Appointments booked per day (Phoenix time: UTC-7), optionally filtered by lead source
  const appointmentsBookedPerDay = useMemo(() => {
    const dayMap = {};

    const apptsToCount = bookedByDayLeadSource === 'all'
      ? filteredAppointments
      : filteredAppointments.filter(apt => {
          const checklist = allChecklists.find(c => c.appointment === apt.id);
          return (checklist?.heard_about_us || 'Unknown') === bookedByDayLeadSource;
        });

    apptsToCount.forEach(apt => {
      const utcDate = new Date(apt.created_date);
      const phoenixDate = new Date(utcDate.getTime() - phoenixOffsetMs);
      const dayStr = format(phoenixDate, 'yyyy-MM-dd');
      dayMap[dayStr] = (dayMap[dayStr] || 0) + 1;
    });

    const data = [];
    for (let d = new Date(dateFilter.startStr + 'T00:00:00'); format(d, 'yyyy-MM-dd') <= dateFilter.endStr; d.setDate(d.getDate() + 1)) {
      const dayStr = format(d, 'yyyy-MM-dd');
      data.push({
        date: dayStr,
        bookings: dayMap[dayStr] || 0,
        display: format(d, 'MMM d')
      });
    }

    return data;
  }, [filteredAppointments, dateFilter, bookedByDayLeadSource, allChecklists]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Appointment Reports</h1>
              <p className="text-muted-foreground mt-1">Analytics and insights for appointments</p>
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
          <>
            {/* Key Metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 sm:gap-6 mb-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Appointments</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{appointmentStats.total}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{conversionRate}%</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {appointmentStats.sold} sold / {appointmentStats.completed} completed
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Time to Schedule</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {avgScheduleDays > 0 ? `${avgScheduleDays}d ${avgScheduleHours}h` : `${avgScheduleHours}h`}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created to scheduled date
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Time on Site</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {avgHours > 0 ? `${avgHours}h ${avgMinutes}m` : `${avgMinutes}m`}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {completedWithTime.length} completed appointments
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Sales</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{appointmentStats.sold}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Cancellation Rate</CardTitle>
                  <TrendingUp className="h-4 w-4 text-destructive" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{cancellationRate}%</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {appointmentStats.cancelled} cancelled / {appointmentStats.total} total
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Appointments Booked by Day with Lead Source Filter */}
            <Card className="mb-6">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <CardTitle>Appointments Booked by Day</CardTitle>
                    <CardDescription>
                      {bookedByDayLeadSource === 'all'
                        ? 'All lead sources'
                        : `Filtered: ${bookedByDayLeadSource}`}
                      {' · '}Click a bar to see details
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Lead Source:</span>
                    <Select value={bookedByDayLeadSource} onValueChange={setBookedByDayLeadSource}>
                      <SelectTrigger className="w-full sm:w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Sources</SelectItem>
                        {leadSourceOptions.map(source => (
                          <SelectItem key={source} value={source}>{source}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {appointmentsBookedPerDay.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={appointmentsBookedPerDay} onClick={(state) => {
                      if (state && state.activeTooltipIndex !== undefined) {
                        const selectedData = appointmentsBookedPerDay[state.activeTooltipIndex];
                        if (selectedData && selectedData.bookings > 0) {
                          setSelectedDayForAppointments(selectedData.date);
                          setShowDayAppointmentsModal(true);
                        }
                      }
                    }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="display"
                        angle={appointmentsBookedPerDay.length > 15 ? -45 : 0}
                        textAnchor={appointmentsBookedPerDay.length > 15 ? 'end' : 'middle'}
                        height={appointmentsBookedPerDay.length > 15 ? 80 : 30}
                      />
                      <YAxis />
                      <Tooltip formatter={(value) => [value, 'Bookings']} cursor={{ fill: 'rgba(79, 70, 229, 0.1)' }} />
                      <Bar dataKey="bookings" fill="#4f46e5" radius={[8, 8, 0, 0]} style={{ cursor: 'pointer' }}>
                        <LabelList dataKey="bookings" position="top" fill="#6366f1" fontSize={12} fontWeight={600} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No appointments in selected date range</p>
                )}
              </CardContent>
            </Card>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Status Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Status Distribution</CardTitle>
                  <CardDescription>Breakdown of appointment statuses</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {statusDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Appointments by Day */}
              <Card>
                <CardHeader>
                  <CardTitle>Appointments by Day of Week</CardTitle>
                  <CardDescription>Most popular days for scheduling</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={appointmentsByDay}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#4F46E5" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Time Block Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Appointments by Time Block</CardTitle>
                  <CardDescription>Preferred appointment times</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={appointmentsByBlock}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="block" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#06B6D4" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* CSR Performance */}
              <Card>
                <CardHeader>
                  <CardTitle>CSR Performance</CardTitle>
                  <CardDescription>Appointments booked by CSRs</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {csrPerformance.map((csr, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">{csr.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {csr.scheduled} scheduled • {csr.completed} completed
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-primary">{csr.booked}</p>
                          <p className="text-xs text-muted-foreground">booked</p>
                        </div>
                      </div>
                    ))}
                    {csrPerformance.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No data available</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Cancellation Quick Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Cancelled Yesterday</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{cancellationCounts.yesterday}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Cancelled Last 7 Days</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{cancellationCounts.last7}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Cancelled Last 30 Days</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{cancellationCounts.last30}</div>
                </CardContent>
              </Card>
            </div>

            {/* Cancellations Per Day */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Cancellations Per Day</CardTitle>
                <CardDescription>Number of cancelled appointments by day during selected period</CardDescription>
              </CardHeader>
              <CardContent>
                {cancellationsPerDay.some(d => d.cancellations > 0) ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={cancellationsPerDay} onClick={(state) => {
                      if (state && state.activeTooltipIndex !== undefined) {
                        const selectedData = cancellationsPerDay[state.activeTooltipIndex];
                        if (selectedData && selectedData.cancellations > 0) {
                          setSelectedDayForCancellations(selectedData.date);
                          setShowCancellationDayModal(true);
                        }
                      }
                    }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="display"
                        angle={cancellationsPerDay.length > 15 ? -45 : 0}
                        textAnchor={cancellationsPerDay.length > 15 ? 'end' : 'middle'}
                        height={cancellationsPerDay.length > 15 ? 80 : 30}
                      />
                      <YAxis />
                      <Tooltip formatter={(value) => [value, 'Cancellations']} cursor={{ fill: 'rgba(239, 68, 68, 0.1)' }} />
                      <Bar dataKey="cancellations" fill="#ef4444" radius={[8, 8, 0, 0]} style={{ cursor: 'pointer' }} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No cancellations in selected date range</p>
                )}
              </CardContent>
            </Card>

            {/* Reschedule Quick Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Rescheduled Yesterday</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{rescheduleCounts.yesterday}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Rescheduled Last 7 Days</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{rescheduleCounts.last7}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Rescheduled Last 30 Days</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{rescheduleCounts.last30}</div>
                </CardContent>
              </Card>
            </div>

            {/* Reschedules Per Day */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Reschedules Per Day</CardTitle>
                <CardDescription>Number of rescheduled appointments by day during selected period</CardDescription>
              </CardHeader>
              <CardContent>
                {reschedulesPerDay.some(d => d.reschedules > 0) ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={reschedulesPerDay} onClick={(state) => {
                      if (state && state.activeTooltipIndex !== undefined) {
                        const selectedData = reschedulesPerDay[state.activeTooltipIndex];
                        if (selectedData && selectedData.reschedules > 0) {
                          setSelectedDayForReschedules(selectedData.date);
                          setShowRescheduleDayModal(true);
                        }
                      }
                    }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="display"
                        angle={reschedulesPerDay.length > 15 ? -45 : 0}
                        textAnchor={reschedulesPerDay.length > 15 ? 'end' : 'middle'}
                        height={reschedulesPerDay.length > 15 ? 80 : 30}
                      />
                      <YAxis />
                      <Tooltip formatter={(value) => [value, 'Reschedules']} cursor={{ fill: 'rgba(234, 179, 8, 0.1)' }} />
                      <Bar dataKey="reschedules" fill="#eab308" radius={[8, 8, 0, 0]} style={{ cursor: 'pointer' }} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-center py-8">No reschedules in selected date range</p>
                )}
              </CardContent>
            </Card>

            {/* Appointments by Lead Source */}
            <Card>
              <CardHeader>
                <CardTitle>Appointments by Lead Source</CardTitle>
                <CardDescription>Where customers heard about us</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart 
                    data={appointmentsByLeadSource}
                    onClick={(data) => {
                      if (data && data.activePayload) {
                        setSelectedLeadSource(data.activePayload[0].payload.name);
                        setShowLeadSourceModal(true);
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip cursor={{ fill: 'rgba(99, 102, 241, 0.1)' }} />
                    <Bar dataKey="value" fill="#6366f1" style={{ cursor: 'pointer' }} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* CSR Sales Performance */}
            <div className="grid grid-cols-1 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>CSR Sales Performance</CardTitle>
                  <CardDescription>Appointments booked by CSRs that turned into sales</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {csrSalesPerformance.map((csr, index) => {
                      const conversionRate = csr.booked > 0 ? ((csr.soldCount / csr.booked) * 100).toFixed(1) : 0;
                      return (
                        <div key={index} className="flex items-center justify-between p-4 bg-secondary rounded-lg border border-border">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">{csr.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {csr.soldCount} sold out of {csr.booked} booked • {conversionRate}% conversion
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-green-600 dark:text-green-400">
                              ${csr.totalValue.toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">total value</p>
                          </div>
                        </div>
                      );
                    })}
                    {csrSalesPerformance.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">No sales data available for this date range</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      {/* Day Appointments Modal */}
      <Dialog open={showDayAppointmentsModal} onOpenChange={setShowDayAppointmentsModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Appointments for {selectedDayForAppointments && format(new Date(selectedDayForAppointments + 'T00:00:00'), 'MMMM d, yyyy')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {selectedDayForAppointments && filteredAppointments
              .filter(apt => {
                const utcDate = new Date(apt.created_date);
                const phoenixDate = new Date(utcDate.getTime() - phoenixOffsetMs);
                const dayStr = format(phoenixDate, 'yyyy-MM-dd');
                return dayStr === selectedDayForAppointments;
              })
              .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
              .map(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                return (
                  <div
                    key={apt.id}
                    className="p-4 bg-secondary rounded-lg border border-border"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {checklist?.customer_first_name} {checklist?.customer_last_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Created: {format(new Date(new Date(apt.created_date).getTime() - phoenixOffsetMs), 'MMM d, yyyy h:mm a')} GMT-7
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {apt.appointment_date && format(new Date(apt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')} • {apt.appointment_block}
                        </p>
                      </div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25">
                        {apt.status}
                      </span>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                      {checklist?.customer_phone && (
                        <p><span className="font-medium">Phone:</span> {checklist.customer_phone}</p>
                      )}
                      {checklist?.customer_email && (
                        <p><span className="font-medium">Email:</span> <a href={`mailto:${checklist.customer_email}`} className="text-primary hover:underline">{checklist.customer_email}</a></p>
                      )}
                      {checklist?.customer_street && (
                        <p><span className="font-medium">Address:</span> {checklist.customer_street} {checklist.city}, {checklist.state} {checklist.postal_code}</p>
                      )}
                    </div>
                    <Link
                      to={createPageUrl('AppointmentDetail') + '?id=' + apt.id}
                      className="inline-block mt-3 text-xs font-medium text-primary hover:text-primary"
                    >
                      View Full Details →
                    </Link>
                  </div>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancellation Day Modal */}
      <Dialog open={showCancellationDayModal} onOpenChange={setShowCancellationDayModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cancellations for {selectedDayForCancellations && format(new Date(selectedDayForCancellations + 'T00:00:00'), 'MMMM d, yyyy')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {selectedDayForCancellations && filteredAppointments
              .filter(apt => {
                if (apt.status !== 'Cancelled') return false;
                const utcDate = new Date(apt.created_date);
                const phoenixDate = new Date(utcDate.getTime() - phoenixOffsetMs);
                return format(phoenixDate, 'yyyy-MM-dd') === selectedDayForCancellations;
              })
              .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
              .map(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                return (
                  <div key={apt.id} className="p-4 bg-red-50 rounded-lg border border-red-200 dark:bg-red-500/10 dark:border-red-500/25">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {checklist?.customer_first_name} {checklist?.customer_last_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Created: {format(new Date(new Date(apt.created_date).getTime() - phoenixOffsetMs), 'MMM d, yyyy h:mm a')} GMT-7
                        </p>
                        {apt.appointment_date && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Appt: {format(new Date(apt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')} • {apt.appointment_block}
                          </p>
                        )}
                      </div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25">
                        Cancelled
                      </span>
                    </div>
                    <Link
                      to={createPageUrl('AppointmentDetail') + '?id=' + apt.id}
                      className="inline-block mt-2 text-xs font-medium text-primary hover:text-primary"
                    >
                      View Full Details →
                    </Link>
                  </div>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Reschedule Day Modal */}
      <Dialog open={showRescheduleDayModal} onOpenChange={setShowRescheduleDayModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reschedules for {selectedDayForReschedules && format(new Date(selectedDayForReschedules + 'T00:00:00'), 'MMMM d, yyyy')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {selectedDayForReschedules && filteredAppointments
              .filter(apt => {
                if (apt.status !== 'Rescheduled') return false;
                const phoenixDate = new Date(new Date(apt.created_date).getTime() - phoenixOffsetMs);
                return format(phoenixDate, 'yyyy-MM-dd') === selectedDayForReschedules;
              })
              .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
              .map(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                return (
                  <div key={apt.id} className="p-4 bg-yellow-50 rounded-lg border border-yellow-200 dark:bg-yellow-500/10 dark:border-yellow-500/25">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {checklist?.customer_first_name} {checklist?.customer_last_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Created: {format(new Date(new Date(apt.created_date).getTime() - phoenixOffsetMs), 'MMM d, yyyy h:mm a')} GMT-7
                        </p>
                        {apt.appointment_date && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Appt: {format(new Date(apt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')} • {apt.appointment_block}
                          </p>
                        )}
                      </div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/25">
                        Rescheduled
                      </span>
                    </div>
                    <Link
                      to={createPageUrl('AppointmentDetail') + '?id=' + apt.id}
                      className="inline-block mt-2 text-xs font-medium text-primary hover:text-primary"
                    >
                      View Full Details →
                    </Link>
                  </div>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Lead Source Modal */}
      <Dialog open={showLeadSourceModal} onOpenChange={setShowLeadSourceModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Appointments from {selectedLeadSource}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {filteredAppointments
              .filter(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                return (checklist?.heard_about_us || 'Unknown') === selectedLeadSource;
              })
              .sort((a, b) => new Date(b.appointment_date || b.created_date) - new Date(a.appointment_date || a.created_date))
              .map(apt => {
                const checklist = allChecklists.find(c => c.appointment === apt.id);
                const projectStatus = apt.status === 'Sold' ? projectStatusByAppointment[apt.id] : null;
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
                        {apt.appointment_date && format(new Date(apt.appointment_date + 'T00:00:00'), 'MMM d, yyyy')} • {apt.status}
                        {projectStatus && (
                          <span className="ml-1 text-green-700 dark:text-green-400">• Project: {projectStatus}</span>
                        )}
                      </p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                  </Link>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}