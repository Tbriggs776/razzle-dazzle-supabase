import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { Calendar, TrendingUp, Users, DollarSign, Clock, CheckCircle, XCircle, Loader2, GitMerge } from 'lucide-react';
import ContractDiscrepancyReport from '@/components/rfms/ContractDiscrepancyReport';
import { format, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, parseISO } from 'date-fns';

const COLORS = ['#4F46E5', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1'];

export default function Reports() {
  const [dateRange, setDateRange] = useState('30days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery({
    queryKey: ['appointments'],
    queryFn: () => base44.entities.Appointment.list()
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: () => base44.entities.Lead.list()
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list()
  });

  // Filter appointments by date range
  const getDateRangeFilter = () => {
    const now = new Date();
    const today = new Date(now.setHours(0, 0, 0, 0));
    
    switch (dateRange) {
      case 'today':
        return { start: today, end: new Date() };
      case 'yesterday':
        const yesterday = subDays(today, 1);
        return { start: yesterday, end: today };
      case '7days':
        return { start: subDays(now, 7), end: now };
      case '30days':
        return { start: subDays(now, 30), end: now };
      case 'thisMonth':
        return { start: startOfMonth(now), end: now };
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
  const filteredAppointments = appointments.filter(apt => {
    if (!apt.created_date) return false;
    const createdDate = new Date(apt.created_date);
    return createdDate >= dateFilter.start && createdDate <= dateFilter.end;
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

  // Top Performing Consultants
  const consultantPerformance = teamMembers
    .filter(tm => tm.role === 'Design Consultant')
    .map(consultant => {
      const consultantAppointments = filteredAppointments.filter(apt => apt.assigned_dc === consultant.id);
      const consultantSales = consultantAppointments.filter(apt => apt.status === 'Sold').length;
      const completed = consultantAppointments.filter(apt => ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed'].includes(apt.status)).length;
      return {
        name: `${consultant.first_name} ${consultant.last_name}`,
        appointments: consultantAppointments.length,
        sales: consultantSales,
        conversionRate: completed > 0 ? ((consultantSales / completed) * 100).toFixed(1) : 0
      };
    })
    .filter(c => c.appointments > 0)
    .sort((a, b) => b.sales - a.sales);

  // CSR Performance (appointments booked)
  const csrPerformance = teamMembers
    .filter(tm => tm.role === 'Customer Service Rep')
    .map(csr => {
      const csrAppointments = filteredAppointments.filter(apt => apt.assigned_csr === csr.id);
      return {
        name: `${csr.first_name} ${csr.last_name}`,
        booked: csrAppointments.length,
        scheduled: csrAppointments.filter(apt => apt.status === 'Scheduled' || apt.status === 'Rescheduled').length,
        completed: csrAppointments.filter(apt => ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed'].includes(apt.status)).length,
      };
    })
    .filter(c => c.booked > 0)
    .sort((a, b) => b.booked - a.booked);

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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Reports</h1>
              <p className="text-muted-foreground mt-1">Analytics and insights for your business</p>
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
        <Tabs defaultValue="appointments" className="space-y-6">
          <div className="overflow-x-auto pb-1">
            <TabsList className="bg-card border border-border p-1">
              <TabsTrigger value="appointments" className="rounded-lg">Appointments</TabsTrigger>
              <TabsTrigger value="discrepancy" className="rounded-lg">
                <GitMerge className="w-4 h-4 mr-2" />Contract vs RFMS
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="appointments" className="space-y-6">
            {appointmentsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : (
              <>
                {/* Key Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
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
                </div>

                {/* Charts Row 1 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

                  {/* Top Consultants */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Consultant Performance</CardTitle>
                      <CardDescription>Sales and conversion rates</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {consultantPerformance.slice(0, 5).map((consultant, index) => (
                          <div key={index} className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-foreground">{consultant.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {consultant.appointments} appointments • {consultant.sales} sales
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-primary">{consultant.conversionRate}%</p>
                              <p className="text-xs text-muted-foreground">conversion</p>
                            </div>
                          </div>
                        ))}
                        {consultantPerformance.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-4">No data available</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>
          <TabsContent value="discrepancy">
            <ContractDiscrepancyReport />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}