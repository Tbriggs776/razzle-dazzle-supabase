import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, CalendarDays, Loader2, ClipboardCheck, LayoutGrid, List, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AppointmentCard from '@/components/appointments/AppointmentCard';
import AppointmentForm from '@/components/appointments/AppointmentForm';
import TagBadge from '@/components/tags/TagBadge';
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, parseISO } from 'date-fns';

export default function Appointments() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assignmentFilter, setAssignmentFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showChecklistDialog, setShowChecklistDialog] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [sortBy, setSortBy] = useState('appointment_date');
  const [soldFilter, setSoldFilter] = useState('all');
  const [dcFilter, setDcFilter] = useState('all');
  const [csrFilter, setCsrFilter] = useState('all');
  const [selectedStatPeriod, setSelectedStatPeriod] = useState(null);
  const [showStatModal, setShowStatModal] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments', sortBy],
    queryFn: () => base44.entities.Appointment.list(`-${sortBy}`)
  });

  // Real-time subscription for appointment updates
  useEffect(() => {
    const unsubscribe = base44.entities.Appointment.subscribe((event) => {
      if (event.type === 'update') {
        queryClient.setQueryData(['appointments'], (old = []) => 
          old.map(apt => apt.id === event.id ? event.data : apt)
        );
      } else if (event.type === 'create') {
        queryClient.setQueryData(['appointments'], (old = []) => [event.data, ...old]);
      } else if (event.type === 'delete') {
        queryClient.setQueryData(['appointments'], (old = []) => 
          old.filter(apt => apt.id !== event.id)
        );
      }
    });

    return unsubscribe;
  }, [queryClient]);

  const { data: checklists = [] } = useQuery({
    queryKey: ['checklists'],
    queryFn: () => base44.entities.AppointmentSettingChecklist.list('-created_date', 500)
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: () => base44.entities.Lead.list()
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ['allTasks'],
    queryFn: () => base44.entities.Task.list()
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => base44.entities.Tag.list(),
    staleTime: 60000
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const appointmentData = {
        ...data,
        appointment_created_date: new Date().toISOString()
      };
      const appointment = await base44.entities.Appointment.create(appointmentData);
      
      // Generate short URLs for lead and consultant tracking
      let shortUrlsUpdated = false;
      try {
        const appUrl = await base44.functions.invoke('getAppUrl');
        const baseUrl = appUrl.data.url;
        const leadViewUrl = `${baseUrl}/LeadAppointmentView?id=${appointment.id}`;
        const consultantViewUrl = `${baseUrl}/ConsultantAppointmentView?id=${appointment.id}`;
        
        const [leadShortUrl, consultantShortUrl] = await Promise.all([
          base44.functions.invoke('shortenUrl', { originalURL: leadViewUrl }),
          base44.functions.invoke('shortenUrl', { originalURL: consultantViewUrl })
        ]);
        
        const updateData = {};
        if (leadShortUrl.data.shortURL) updateData.lead_short_url = leadShortUrl.data.shortURL;
        if (consultantShortUrl.data.shortURL) updateData.consultant_short_url = consultantShortUrl.data.shortURL;
        
        if (Object.keys(updateData).length > 0) {
          await base44.entities.Appointment.update(appointment.id, updateData);
          shortUrlsUpdated = true;
        }
      } catch (error) {
        console.error('Short URL generation failed:', error);
      }
      
      // Sync to Google Calendar with CSR
      if (data.assigned_csr) {
       try {
         const csr = teamMembers.find(m => m.id === data.assigned_csr);
         await base44.functions.invoke('syncCalendarEvent', {
           appointmentId: appointment.id,
           action: 'create',
           appUrl: window.location.origin,
           csrEmail: csr?.email
         });
       } catch (error) {
         console.error('Calendar sync failed:', error);
       }
      }

      // Send SMS notifications (only after short URLs are generated)
      if (shortUrlsUpdated) {
        try {
          // Send SMS to lead
          await base44.functions.invoke('sendAppointmentSMS', {
            appointmentId: appointment.id,
            type: 'lead'
          });

          // Send SMS to consultant if assigned
          if (data.assigned_dc) {
            await base44.functions.invoke('sendAppointmentSMS', {
              appointmentId: appointment.id,
              type: 'consultant'
            });
          }
        } catch (error) {
          console.error('SMS notification failed:', error);
        }
      }

      // Sync to RFMS Measure Mobile
      try {
        await base44.functions.invoke('sendToRFMS', {
          appointmentId: appointment.id
        });
      } catch (error) {
        console.error('RFMS sync failed:', error);
      }

      return appointment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      setShowCreateDialog(false);
    }
  });

  // Filter and group appointments
  const filteredAppointments = appointments.filter(appointment => {
    // Hide appointments with "Lead" status
    if (appointment.status === 'Lead') {
      return false;
    }

    // Date filter
    if (dateFilter !== 'all' && appointment.appointment_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const appointmentDate = new Date(appointment.appointment_date + 'T00:00:00');
      
      if (dateFilter === 'today' && appointmentDate.getTime() !== today.getTime()) {
        return false;
      }
      if (dateFilter === 'tomorrow' && appointmentDate.getTime() !== tomorrow.getTime()) {
        return false;
      }
    }

    // Date range filter
    if ((startDate || endDate) && appointment.appointment_date) {
      const appointmentDate = new Date(appointment.appointment_date + 'T00:00:00');
      
      if (startDate) {
        const start = new Date(startDate + 'T00:00:00');
        if (appointmentDate < start) return false;
      }
      
      if (endDate) {
        const end = new Date(endDate + 'T23:59:59');
        if (appointmentDate > end) return false;
      }
    }

    // Status filter
    if (statusFilter !== 'all' && appointment.status !== statusFilter) {
      return false;
    }

    // Assignment filter
    if (assignmentFilter !== 'all') {
      if (assignmentFilter === 'assigned' && !appointment.assigned_dc) {
        return false;
      }
      if (assignmentFilter === 'unassigned' && appointment.assigned_dc) {
        return false;
      }
    }

    // CSR filter
    if (csrFilter !== 'all') {
      if (csrFilter === 'unassigned' && appointment.assigned_csr) return false;
      if (csrFilter !== 'unassigned' && appointment.assigned_csr !== csrFilter) return false;
    }

    // DC filter
    if (dcFilter !== 'all') {
      if (dcFilter === 'unassigned' && appointment.assigned_dc) return false;
      if (dcFilter !== 'unassigned' && appointment.assigned_dc !== dcFilter) return false;
    }

    // Sold filter
    if (soldFilter !== 'all') {
      const notSoldStatuses = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Cancelled', 'Follow-Up'];
      if (soldFilter === 'sold' && appointment.status !== 'Sold') {
        return false;
      }
      if (soldFilter === 'not_sold' && !notSoldStatuses.includes(appointment.status)) {
        return false;
      }
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const lead = leads.find(l => l.id === appointment.customer);
      return (
        lead?.first_name?.toLowerCase().includes(query) ||
        lead?.last_name?.toLowerCase().includes(query) ||
        lead?.phone?.includes(query) ||
        lead?.email?.toLowerCase().includes(query) ||
        appointment.location_address?.toLowerCase().includes(query) ||
        appointment.internal_notes?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  // Group appointments by date
  const groupedAppointments = filteredAppointments.reduce((groups, appointment) => {
    const dateField = sortBy === 'created_date' ? 'created_date' : 'appointment_date';
    let dateKey;
    
    if (dateField === 'created_date') {
      const createdDate = new Date(appointment.created_date + (appointment.created_date.includes('Z') ? '' : 'Z'));
      dateKey = format(createdDate, 'yyyy-MM-dd');
    } else {
      dateKey = appointment.appointment_date || 'No Date';
    }
    
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(appointment);
    return groups;
  }, {});

  // Sort dates
  const sortedDates = Object.keys(groupedAppointments).sort((a, b) => {
    if (a === 'No Date') return 1;
    if (b === 'No Date') return -1;
    return b.localeCompare(a); // Newest first
  });

  // Calculate appointment stats using UTC-7 (Arizona/Phoenix time)
  const AZ_OFFSET_MS = 7 * 60 * 60 * 1000;

  // Get current date string in AZ time (yyyy-MM-dd)
  const toAZDateStr = (utcMs) => {
    const d = new Date(utcMs - AZ_OFFSET_MS);
    return d.toISOString().slice(0, 10);
  };

  const todayAZStr = toAZDateStr(Date.now());
  const yesterdayAZStr = toAZDateStr(Date.now() - 86400000);
  const twoDaysAgoAZStr = toAZDateStr(Date.now() - 2 * 86400000);
  const threeDaysAgoAZStr = toAZDateStr(Date.now() - 3 * 86400000);

  // For 7-day range: last 7 days NOT including today
  const last7StartAZStr = toAZDateStr(Date.now() - 7 * 86400000);

  const getAZDateStr = (apt) => toAZDateStr(new Date(apt.created_date + (apt.created_date.includes('Z') ? '' : 'Z')).getTime());

  const bookedToday = appointments.filter(apt => getAZDateStr(apt) === todayAZStr).length;
  const bookedYesterday = appointments.filter(apt => getAZDateStr(apt) === yesterdayAZStr).length;
  const booked2DaysAgo = appointments.filter(apt => getAZDateStr(apt) === twoDaysAgoAZStr).length;
  const booked3DaysAgo = appointments.filter(apt => getAZDateStr(apt) === threeDaysAgoAZStr).length;
  const bookedLast7Days = appointments.filter(apt => {
    const d = getAZDateStr(apt);
    return d >= last7StartAZStr && d < todayAZStr;
  }).length;

  // Keep for compatibility (not displayed but referenced)
  const bookedPrevious7Days = 0;
  const bookedThisMonth = 0;

  // For stat modal date references
  const today = new Date(todayAZStr + 'T00:00:00');
  const yesterday = new Date(yesterdayAZStr + 'T00:00:00');
  const twoDaysAgo = new Date(twoDaysAgoAZStr + 'T00:00:00');
  const threeDaysAgo = new Date(threeDaysAgoAZStr + 'T00:00:00');
  const last7DaysStart = new Date(last7StartAZStr + 'T00:00:00');

  // DC appointment counts from filteredAppointments
  const dcCounts = teamMembers
    .filter(tm => tm.role === 'Design Consultant')
    .map(dc => ({
      id: dc.id,
      name: `${dc.first_name} ${dc.last_name}`,
      count: filteredAppointments.filter(apt => apt.assigned_dc === dc.id).length
    }))
    .filter(dc => dc.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Stats Header */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <button
                onClick={() => {
                  setSelectedStatPeriod({ type: 'today', date: today });
                  setShowStatModal(true);
                }}
                className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-3 border border-indigo-200 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="text-xs text-indigo-600 font-medium">Booked Today</div>
                <div className="text-2xl font-bold text-indigo-900">{bookedToday}</div>
              </button>
              <button
                onClick={() => {
                  setSelectedStatPeriod({ type: 'yesterday', date: yesterday });
                  setShowStatModal(true);
                }}
                className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3 border border-purple-200 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="text-xs text-purple-600 font-medium">1 Day Ago</div>
                <div className="text-2xl font-bold text-purple-900">{bookedYesterday}</div>
              </button>
              <button
                onClick={() => {
                  setSelectedStatPeriod({ type: '2daysago', date: twoDaysAgo });
                  setShowStatModal(true);
                }}
                className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg p-3 border border-pink-200 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="text-xs text-pink-600 font-medium">2 Days Ago</div>
                <div className="text-2xl font-bold text-pink-900">{booked2DaysAgo}</div>
              </button>
              <button
                onClick={() => {
                  setSelectedStatPeriod({ type: '3daysago', date: threeDaysAgo });
                  setShowStatModal(true);
                }}
                className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-3 border border-orange-200 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="text-xs text-orange-600 font-medium">3 Days Ago</div>
                <div className="text-2xl font-bold text-orange-900">{booked3DaysAgo}</div>
              </button>
              <button
                onClick={() => {
                  setSelectedStatPeriod({ type: 'last7days', start: last7DaysStart, end: today });
                  setShowStatModal(true);
                }}
                className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-3 border border-blue-200 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="text-xs text-blue-600 font-medium">Last 7 Days</div>
                <div className="text-2xl font-bold text-blue-900">{bookedLast7Days}</div>
              </button>
            </div>

          {/* DC Appointment Counts */}
          {dcCounts.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {dcCounts.map(dc => (
                <div key={dc.id} className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">
                  <span className="text-sm font-medium text-indigo-800">{dc.name}</span>
                  <span className="bg-indigo-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{dc.count}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Appointments</h1>
              <p className="text-slate-500 mt-1">Manage appointments and schedule meetings</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-1 bg-white">
                <Button
                  variant={viewMode === 'cards' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('cards')}
                  className={viewMode === 'cards' ? 'bg-indigo-600 hover:bg-indigo-700' : ''}
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className={viewMode === 'list' ? 'bg-indigo-600 hover:bg-indigo-700' : ''}
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
              <Link to={createPageUrl('ScheduledThisWeek')}>
                <Button variant="outline" className="border-slate-200">
                  This Week
                </Button>
              </Link>
              <Button
                onClick={() => setShowChecklistDialog(true)}
                variant="outline"
                className="border-indigo-200 text-indigo-600 hover:bg-indigo-50"
              >
                <ClipboardCheck className="w-5 h-5 mr-2" />
                From Checklist
              </Button>
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white h-12 px-6 rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-200 transition-all"
              >
                <Plus className="w-5 h-5 mr-2" />
                New Appointment
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-8 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input
                placeholder="Search appointments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-14 bg-slate-50 border-slate-200 rounded-xl text-base focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              />
            </div>

            {/* Date Filter */}
            <div className="flex items-center gap-4 flex-wrap">
              <Tabs value={dateFilter} onValueChange={(val) => {
                setDateFilter(val);
                if (val !== 'all') {
                  setStartDate('');
                  setEndDate('');
                }
              }}>
                <TabsList className="bg-slate-100 p-1">
                  <TabsTrigger value="all" className="rounded-lg">All Dates</TabsTrigger>
                  <TabsTrigger value="today" className="rounded-lg">Today</TabsTrigger>
                  <TabsTrigger value="tomorrow" className="rounded-lg">Tomorrow</TabsTrigger>
                </TabsList>
              </Tabs>
              
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">Date Range:</span>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (e.target.value) setDateFilter('all');
                  }}
                  className="h-10 w-40"
                  placeholder="Start date"
                />
                <span className="text-slate-400">to</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    if (e.target.value) setDateFilter('all');
                  }}
                  className="h-10 w-40"
                  placeholder="End date"
                />
                {(startDate || endDate) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStartDate('');
                      setEndDate('');
                    }}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {/* Sort and Status */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">Sort by:</span>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-10 w-48 border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="appointment_date">Appointment Date</SelectItem>
                    <SelectItem value="created_date">Date Created</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Status tabs */}
            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
              <TabsList className="bg-slate-100 p-1">
                <TabsTrigger value="all" className="rounded-lg">All</TabsTrigger>
                <TabsTrigger value="Scheduled" className="rounded-lg">Scheduled</TabsTrigger>
                <TabsTrigger value="Rescheduled" className="rounded-lg">Rescheduled</TabsTrigger>
                <TabsTrigger value="Follow-Up" className="rounded-lg">Follow-Up</TabsTrigger>
                <TabsTrigger value="Cancelled" className="rounded-lg">Cancelled</TabsTrigger>
                <TabsTrigger value="Completed" className="rounded-lg">Completed</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Assignment filter */}
            <Tabs value={assignmentFilter} onValueChange={setAssignmentFilter}>
              <TabsList className="bg-slate-100 p-1">
                <TabsTrigger value="all" className="rounded-lg">All Assignments</TabsTrigger>
                <TabsTrigger value="assigned" className="rounded-lg">Assigned</TabsTrigger>
                <TabsTrigger value="unassigned" className="rounded-lg">Unassigned</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* CSR filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">CSR:</span>
              <Select value={csrFilter} onValueChange={setCsrFilter}>
                <SelectTrigger className="h-10 w-56 border-slate-200">
                  <SelectValue placeholder="All CSRs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All CSRs</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teamMembers
                    .filter(tm => (tm.role === 'Customer Service Rep' || tm.role === 'Sales Manager') && tm.is_active)
                    .sort((a, b) => a.first_name.localeCompare(b.first_name))
                    .map(csr => (
                      <SelectItem key={csr.id} value={csr.id}>
                        {csr.first_name} {csr.last_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* DC filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">DC:</span>
              <Select value={dcFilter} onValueChange={setDcFilter}>
                <SelectTrigger className="h-10 w-56 border-slate-200">
                  <SelectValue placeholder="All DCs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All DCs</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teamMembers
                    .filter(tm => tm.role === 'Design Consultant' && tm.is_active)
                    .sort((a, b) => a.first_name.localeCompare(b.first_name))
                    .map(dc => (
                      <SelectItem key={dc.id} value={dc.id}>
                        {dc.first_name} {dc.last_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sold filter */}
            <Tabs value={soldFilter} onValueChange={setSoldFilter}>
              <TabsList className="bg-slate-100 p-1">
                <TabsTrigger value="all" className="rounded-lg">All Appointments</TabsTrigger>
                <TabsTrigger value="not_sold" className="rounded-lg">Not Sold</TabsTrigger>
                <TabsTrigger value="sold" className="rounded-lg">Sold Only</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          </div>
        ) : filteredAppointments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-6">
              <CalendarDays className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-2">
              {searchQuery || statusFilter !== 'all' ? 'No appointments found' : 'No appointments yet'}
            </h3>
            <p className="text-slate-500 mb-6">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Get started by creating your first appointment'}
            </p>
            {!searchQuery && statusFilter === 'all' && (
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Appointment
              </Button>
            )}
          </motion.div>
        ) : viewMode === 'cards' ? (
          <div className="space-y-8">
            {sortedDates.map((dateKey) => {
              const dateLabel = dateKey === 'No Date' 
                ? 'No Date Set' 
                : format(parseISO(dateKey), 'EEEE, MMMM d, yyyy');
              
              return (
                <div key={dateKey}>
                  <div className="sticky top-0 z-10 bg-slate-50 pb-3">
                    <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                      <CalendarDays className="w-5 h-5 text-indigo-600" />
                      {dateLabel}
                      <Badge variant="outline" className="ml-2">
                        {groupedAppointments[dateKey].length}
                      </Badge>
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <AnimatePresence>
                      {groupedAppointments[dateKey].map((appointment, index) => (
                        <AppointmentCard key={appointment.id} appointment={appointment} index={index} />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-6">
            {sortedDates.map((dateKey) => {
              const dateLabel = dateKey === 'No Date' 
                ? 'No Date Set' 
                : format(parseISO(dateKey), 'EEEE, MMMM d, yyyy');
              
              return (
                <div key={dateKey}>
                  <div className="sticky top-0 z-10 bg-slate-50 pb-3">
                    <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                      <CalendarDays className="w-5 h-5 text-indigo-600" />
                      {dateLabel}
                      <Badge variant="outline" className="ml-2">
                        {groupedAppointments[dateKey].length}
                      </Badge>
                    </h2>
                  </div>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {groupedAppointments[dateKey].map((appointment, index) => (
                <motion.div
                  key={appointment.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <Link
                    to={createPageUrl('AppointmentDetail') + `?id=${appointment.id}`}
                    className="block bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-md transition-all"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="flex-shrink-0">
                          <CalendarDays className="w-5 h-5 text-slate-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge
                              className={
                                appointment.status === 'Scheduled' || appointment.status === 'Rescheduled'
                                  ? 'bg-green-100 text-green-700 hover:bg-green-100'
                                  : appointment.status === 'Cancelled'
                                  ? 'bg-red-100 text-red-700 hover:bg-red-100'
                                  : appointment.status === 'Completed' || appointment.status === 'Sold'
                                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-100'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-100'
                              }
                            >
                              {appointment.status}
                            </Badge>
                            {appointment.rfms_sync_status === 'synced' && (
                              <Badge className="bg-green-50 text-green-700 hover:bg-green-50 border border-green-200">
                                RFMS
                              </Badge>
                            )}
                            {appointment.rfms_sync_status === 'error' && (
                              <Badge className="bg-red-50 text-red-700 hover:bg-red-50 border border-red-200">
                                RFMS Error
                              </Badge>
                            )}
                            {(() => {
                              const user = currentUser;
                              if (user?.role === 'admin') {
                                return (
                                  <Badge 
                                    className={cn('border font-mono text-xs', 
                                      appointment.google_calendar_event_id 
                                        ? 'bg-blue-50 text-blue-700 border-blue-200' 
                                        : 'bg-slate-100 text-slate-500 border-slate-200'
                                    )}
                                  >
                                    GCal: {appointment.google_calendar_event_id || 'None'}
                                  </Badge>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                              const checklist = checklists.find(c => c.appointment === appointment.id);
                              return checklist?.photos?.length > 0 ? (
                                <Badge className="bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-50">
                                  📷 {checklist.photos.length} photos
                                </Badge>
                              ) : null;
                            })()}
                            {(() => {
                              const lead = leads.find(l => l.id === appointment.customer);
                              const name = lead ? `${lead.first_name} ${lead.last_name}` : null;
                              return name ? (
                                <span className="text-sm text-slate-700 font-medium">{name}</span>
                              ) : null;
                            })()}
                            {(() => {
                              const lead = leads.find(l => l.id === appointment.customer);
                              return lead?.phone ? (
                                <span className="text-sm text-slate-500">• {lead.phone}</span>
                              ) : null;
                            })()}
                            {appointment.tags && appointment.tags.length > 0 && appointment.tags.map(tagId => {
                              const tag = allTags.find(t => t.id === tagId);
                              return tag ? <TagBadge key={tagId} tag={tag} /> : null;
                            })}
                            {(() => {
                              const appointmentTasks = allTasks.filter(t => t.appointment === appointment.id);
                              const completedCount = appointmentTasks.filter(t => t.status === 'completed').length;
                              const totalCount = appointmentTasks.length;
                              
                              if (totalCount === 0) return null;
                              
                              return (
                                <Badge 
                                  variant="outline" 
                                  className={cn(
                                    "text-xs font-medium",
                                    completedCount === totalCount 
                                      ? "bg-green-50 text-green-700 border-green-200"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                                  )}
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  {completedCount}/{totalCount} Tasks
                                </Badge>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-500 flex-wrap">
                            {appointment.appointment_date && (
                              <span className="font-medium">
                                {new Date(appointment.appointment_date + 'T00:00:00').toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })}
                              </span>
                            )}
                            {appointment.appointment_block && (
                              <span>• {appointment.appointment_block}</span>
                            )}
                            {appointment.created_date && (
                              <span className="text-xs text-slate-400">
                                • {new Date(appointment.created_date + (appointment.created_date.includes('Z') ? '' : 'Z')).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })} at {new Date(appointment.created_date + (appointment.created_date.includes('Z') ? '' : 'Z')).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true
                                })}
                              </span>
                            )}
                            {appointment.consultant_arrived_time && ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed'].includes(appointment.status) && (() => {
                              const completionTime = new Date(appointment.updated_date + (appointment.updated_date.includes('Z') ? '' : 'Z'));
                              const arrivedTime = new Date(appointment.consultant_arrived_time);
                              const durationMs = completionTime - arrivedTime;
                              const hours = Math.floor(durationMs / (1000 * 60 * 60));
                              const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
                              return (
                                <span className="text-indigo-600 font-medium">
                                  • {hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`} on site
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="flex flex-col items-end gap-1">
                          {(() => {
                            const csr = appointment.assigned_csr ? teamMembers.find(tm => tm.id === appointment.assigned_csr) : null;
                            return csr ? (
                              <span className="text-xs text-slate-500">Booked by: {csr.first_name} {csr.last_name}</span>
                            ) : null;
                          })()}
                          {appointment.assigned_dc ? (
                            <>
                              <Badge variant="outline" className="border-indigo-200 text-indigo-700">
                                Assigned
                              </Badge>
                              {(() => {
                                const dc = teamMembers.find(tm => tm.id === appointment.assigned_dc);
                                return dc ? (
                                  <span className="text-xs text-slate-600">
                                    {dc.first_name} {dc.last_name}
                                  </span>
                                ) : null;
                              })()}
                            </>
                          ) : (
                            <Badge variant="outline" className="border-slate-200 text-slate-500">
                              Unassigned
                            </Badge>
                          )}
                          {(() => {
                            const appointmentTasks = allTasks.filter(t => t.appointment === appointment.id);
                            const completedCount = appointmentTasks.filter(t => t.status === 'completed').length;
                            const totalCount = appointmentTasks.length;

                            if (totalCount === 0) return null;

                            return (
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "text-xs font-medium",
                                  completedCount === totalCount 
                                    ? "bg-green-50 text-green-700 border-green-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                )}
                              >
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                {completedCount}/{totalCount}
                              </Badge>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Notes Section */}
                    {appointment.notes && appointment.notes.length > 0 && (
                      <div className="border-t border-slate-200 pt-3 mt-3">
                        <p className="text-xs font-semibold text-slate-600 mb-2">Appointment Notes</p>
                        <div className="max-h-32 overflow-y-auto space-y-2 pr-2 overscroll-contain overflow-x-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
                          {[...appointment.notes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((note, idx) => (
                            <div key={idx} className="bg-slate-50 rounded-lg p-2.5 border border-slate-200 break-words">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <p className="text-xs font-semibold text-slate-700">{note.user_name}</p>
                                {note.context && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                                    {note.context}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed">{note.content}</p>
                              {note.timestamp && (
                                <p className="text-[10px] text-slate-400 mt-1">
                                  {format(new Date(note.timestamp), 'MMM d, yyyy h:mm a')}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Link>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Results count */}
        {!isLoading && filteredAppointments.length > 0 && (
          <p className="text-center text-sm text-slate-400 mt-8">
            Showing {filteredAppointments.length} of {appointments.length} appointments
          </p>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent 
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          onInteractOutside={(e) => {
            // Prevent closing when clicking on Google Places autocomplete dropdown
            const target = e.target;
            if (target.closest('.pac-container')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-800">New Appointment</DialogTitle>
          </DialogHeader>
          <AppointmentForm
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowCreateDialog(false)}
            isLoading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Stat Period Modal */}
      <Dialog open={showStatModal} onOpenChange={setShowStatModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedStatPeriod?.type === 'today' && 'Booked Today'}
              {selectedStatPeriod?.type === 'yesterday' && '1 Day Ago'}
              {selectedStatPeriod?.type === '2daysago' && '2 Days Ago'}
              {selectedStatPeriod?.type === '3daysago' && '3 Days Ago'}
              {selectedStatPeriod?.type === 'last7days' && 'Last 7 Days'}
            </DialogTitle>
          </DialogHeader>
          {/* CSR Summary */}
          {selectedStatPeriod && (() => {
            const periodApts = appointments.filter(apt => {
              const azStr = getAZDateStr(apt);
              if (selectedStatPeriod.type === 'today') return azStr === todayAZStr;
              if (selectedStatPeriod.type === 'yesterday') return azStr === yesterdayAZStr;
              if (selectedStatPeriod.type === '2daysago') return azStr === twoDaysAgoAZStr;
              if (selectedStatPeriod.type === '3daysago') return azStr === threeDaysAgoAZStr;
              if (selectedStatPeriod.type === 'last7days') return azStr >= last7StartAZStr && azStr < todayAZStr;
              return false;
            });
            const csrMap = {};
            periodApts.forEach(apt => {
              const key = apt.assigned_csr || '__unassigned__';
              csrMap[key] = (csrMap[key] || 0) + 1;
            });
            const csrEntries = Object.entries(csrMap).sort((a, b) => b[1] - a[1]);
            return csrEntries.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-slate-200">
                {csrEntries.map(([csrId, count]) => {
                  const csr = csrId !== '__unassigned__' ? teamMembers.find(tm => tm.id === csrId) : null;
                  const name = csr ? `${csr.first_name} ${csr.last_name}` : 'Unassigned';
                  return (
                    <div key={csrId} className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">
                      <span className="text-sm font-medium text-indigo-800">{name}</span>
                      <span className="bg-indigo-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{count}</span>
                    </div>
                  );
                })}
              </div>
            ) : null;
          })()}
          <div className="space-y-3">
            {selectedStatPeriod && appointments
              .filter(apt => {
                const azStr = getAZDateStr(apt);
                if (selectedStatPeriod.type === 'today') return azStr === todayAZStr;
                if (selectedStatPeriod.type === 'yesterday') return azStr === yesterdayAZStr;
                if (selectedStatPeriod.type === '2daysago') return azStr === twoDaysAgoAZStr;
                if (selectedStatPeriod.type === '3daysago') return azStr === threeDaysAgoAZStr;
                if (selectedStatPeriod.type === 'last7days') return azStr >= last7StartAZStr && azStr < todayAZStr;
                return false;
              })
              .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
              .map(apt => {
                const lead = leads.find(l => l.id === apt.customer);
                const phoenixOffsetMs = 7 * 60 * 60 * 1000;
                const utcDate = new Date(apt.created_date);
                const phoenixDate = new Date(utcDate.getTime() - phoenixOffsetMs);
                return (
                  <Link
                    key={apt.id}
                    to={createPageUrl('AppointmentDetail') + `?id=${apt.id}`}
                    className="flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {lead?.first_name} {lead?.last_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {lead?.phone}
                      </p>
                      {lead?.email && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          <a href={`mailto:${lead.email}`} className="text-indigo-600 hover:underline">
                            {lead.email}
                          </a>
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5">
                        {format(phoenixDate, 'MMM d, yyyy h:mm a')} GMT-7
                      </p>
                    </div>
                    <div className="ml-2 flex-shrink-0 text-right">
                     <span className="text-xs font-medium text-slate-600 block">{apt.status}</span>
                     {apt.assigned_csr && (() => {
                       const csr = teamMembers.find(tm => tm.id === apt.assigned_csr);
                       return csr ? (
                         <span className="text-xs text-indigo-600 block mt-0.5">
                           {csr.first_name} {csr.last_name}
                         </span>
                       ) : null;
                     })()}
                    </div>
                  </Link>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Select Checklist Dialog */}
      <Dialog open={showChecklistDialog} onOpenChange={setShowChecklistDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-800">Select Checklist</DialogTitle>
            <p className="text-slate-500">Choose a completed checklist to convert to an appointment</p>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            {checklists
              .filter(checklist => {
                // Only show checklists with appointments that are still Leads
                const appointment = appointments.find(a => a.id === checklist.appointment);
                return appointment?.status === 'Lead';
              })
              .map(checklist => {
                const customerName = checklist.customer_first_name && checklist.customer_last_name
                  ? `${checklist.customer_first_name} ${checklist.customer_last_name}`
                  : 'Unnamed Customer';
                
                const appointment = appointments.find(a => a.id === checklist.appointment);
                const csr = appointment?.assigned_csr ? teamMembers.find(tm => tm.id === appointment.assigned_csr) : null;
                
                return (
                  <Link
                    key={checklist.id}
                    to={createPageUrl('ChecklistDetail') + `?id=${checklist.id}`}
                    className="block p-4 border border-slate-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-800">{customerName}</h3>
                        {checklist.customer_phone && (
                          <p className="text-sm text-slate-500 mt-1">{checklist.customer_phone}</p>
                        )}
                        {csr && (
                          <p className="text-xs text-indigo-600 mt-1">Booked by: {csr.first_name} {csr.last_name}</p>
                        )}
                      </div>
                      <ClipboardCheck className="w-5 h-5 text-indigo-600" />
                    </div>
                  </Link>
                );
              })}
            {checklists.filter(checklist => {
              const appointment = appointments.find(a => a.id === checklist.appointment);
              return appointment?.status === 'Lead';
            }).length === 0 && (
              <div className="text-center py-8">
                <ClipboardCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No available checklists</p>
                <Link to={createPageUrl('AppointmentSettingChecklists')}>
                  <Button className="mt-4" variant="outline">
                    Create New Checklist
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}