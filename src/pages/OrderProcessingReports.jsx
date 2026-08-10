import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Package, Loader2 } from 'lucide-react';
import { format, startOfMonth, startOfWeek } from 'date-fns';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const AZ_OFFSET_MS = 7 * 60 * 60 * 1000;

const USER_COLORS = [
  '#9333ea', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#ec4899'
];

const toAZDayStr = (dateStr) => {
  const utc = new Date(dateStr);
  const az = new Date(utc.getTime() - AZ_OFFSET_MS);
  return format(az, 'yyyy-MM-dd');
};

export default function OrderProcessingReports() {
  const [dateRange, setDateRange] = useState('30days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);
  const [showDayModal, setShowDayModal] = useState(false);

  const { data: projectLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['materialsOrderedLogs'],
    queryFn: () => base44.entities.ProjectLog.filter({ action: 'Status Changed to Materials Ordered' }, '-created_date', 5000)
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date')
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list()
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list()
  });

  const getDateRange = () => {
    const nowAZ = new Date(Date.now() - AZ_OFFSET_MS);
    const todayStr = format(nowAZ, 'yyyy-MM-dd');
    switch (dateRange) {
      case 'today': return { startStr: todayStr, endStr: todayStr };
      case 'yesterday': {
        const d = new Date(nowAZ); d.setDate(d.getDate() - 1);
        const s = format(d, 'yyyy-MM-dd');
        return { startStr: s, endStr: s };
      }
      case '7days': {
        const d = new Date(nowAZ); d.setDate(d.getDate() - 6);
        return { startStr: format(d, 'yyyy-MM-dd'), endStr: todayStr };
      }
      case '30days': {
        const d = new Date(nowAZ); d.setDate(d.getDate() - 29);
        return { startStr: format(d, 'yyyy-MM-dd'), endStr: todayStr };
      }
      case 'thisWeek': return { startStr: format(startOfWeek(nowAZ), 'yyyy-MM-dd'), endStr: todayStr };
      case 'thisMonth': return { startStr: format(startOfMonth(nowAZ), 'yyyy-MM-dd'), endStr: todayStr };
      case 'alltime':
        return { startStr: '2020-01-01', endStr: todayStr };
      case 'custom':
        if (customStartDate && customEndDate) return { startStr: customStartDate, endStr: customEndDate };
      default: {
        const d = new Date(nowAZ); d.setDate(d.getDate() - 29);
        return { startStr: format(d, 'yyyy-MM-dd'), endStr: todayStr };
      }
    }
  };

  const { startStr, endStr } = getDateRange();

  // For each project, find the most recent "Status Changed to Materials Ordered" log
  const projectLogMap = useMemo(() => {
    const map = new Map();
    projectLogs.forEach(log => {
      const existing = map.get(log.project);
      const logTime = new Date(log.created_date);
      if (!existing || logTime > existing.time) {
        map.set(log.project, { time: logTime, log });
      }
    });
    return map;
  }, [projectLogs]);

  // Filter logs that fall within date range
  const filteredLogs = useMemo(() => {
    return Array.from(projectLogMap.values()).filter(({ time }) => {
      const dayStr = format(new Date(time.getTime() - AZ_OFFSET_MS), 'yyyy-MM-dd');
      return dayStr >= startStr && dayStr <= endStr;
    });
  }, [projectLogMap, startStr, endStr]);

  // All unique users in filtered logs
  const allUsers = useMemo(() => {
    const names = new Set();
    filteredLogs.forEach(({ log }) => names.add(log.user_name || log.user_email || 'Unknown'));
    return Array.from(names);
  }, [filteredLogs]);

  // Build per-day chart data (stacked by user)
  const perDayData = useMemo(() => {
    const dayMap = {};
    filteredLogs.forEach(({ time, log }) => {
      const dayStr = format(new Date(time.getTime() - AZ_OFFSET_MS), 'yyyy-MM-dd');
      const name = log.user_name || log.user_email || 'Unknown';
      if (!dayMap[dayStr]) dayMap[dayStr] = {};
      dayMap[dayStr][name] = (dayMap[dayStr][name] || 0) + 1;
    });

    const data = [];
    for (let d = new Date(startStr + 'T00:00:00'); format(d, 'yyyy-MM-dd') <= endStr; d.setDate(d.getDate() + 1)) {
      const dayStr = format(d, 'yyyy-MM-dd');
      const entry = { date: dayStr, display: format(d, 'MMM d'), count: 0 };
      allUsers.forEach(u => { entry[u] = dayMap[dayStr]?.[u] || 0; });
      entry.count = allUsers.reduce((sum, u) => sum + (entry[u] || 0), 0);
      data.push(entry);
    }
    return data;
  }, [filteredLogs, startStr, endStr, allUsers]);

  const totalOrdered = filteredLogs.length;

  // Per-user breakdown
  const perUserData = useMemo(() => {
    const userMap = {};
    filteredLogs.forEach(({ log }) => {
      const name = log.user_name || log.user_email || 'Unknown';
      userMap[name] = (userMap[name] || 0) + 1;
    });
    return Object.entries(userMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredLogs]);

  // Jobs for selected day modal
  const selectedDayJobs = useMemo(() => {
    if (!selectedDay) return [];
    return Array.from(projectLogMap.values())
      .filter(({ time }) => format(new Date(time.getTime() - AZ_OFFSET_MS), 'yyyy-MM-dd') === selectedDay)
      .map(({ time, log }) => {
        const project = projects.find(p => p.id === log.project);
        const customer = project ? customers.find(c => c.id === project.customer) : null;
        const sale = project ? sales.find(s => s.id === project.sale) : null;
        return { time, log, project, customer, sale };
      })
      .sort((a, b) => b.time - a.time);
  }, [selectedDay, projectLogMap, projects, customers, sales]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Order Processing Reports</h1>
              <p className="text-muted-foreground mt-1">Materials ordered by day</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alltime">All Time</SelectItem>
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {logsLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary Card */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Jobs Ordered</CardTitle>
                  <Package className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-primary">{totalOrdered}</div>
                  <p className="text-xs text-muted-foreground mt-1">Materials ordered in selected period</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Daily Average</CardTitle>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{perDayData.length > 0 ? (totalOrdered / perDayData.length).toFixed(1) : 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">Jobs per day</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Peak Day</CardTitle>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {(() => {
                    const peak = perDayData.reduce((max, d) => d.count > max.count ? d : max, { count: 0, display: '—' });
                    return (
                      <>
                        <div className="text-3xl font-bold">{peak.count}</div>
                        <p className="text-xs text-muted-foreground mt-1">{peak.count > 0 ? peak.display : 'No data'}</p>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>

            {/* Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Jobs Ordered Material Per Day</CardTitle>
                <CardDescription>Stacked by user. Click a bar to see individual jobs. Dates based on Arizona time.</CardDescription>
              </CardHeader>
              <CardContent>
                {perDayData.some(d => d.count > 0) ? (
                  <ResponsiveContainer width="100%" height={380}>
                    <BarChart
                      data={perDayData}
                      onClick={(state) => {
                        if (state && state.activeTooltipIndex !== undefined) {
                          const d = perDayData[state.activeTooltipIndex];
                          if (d && d.count > 0) {
                            setSelectedDay(d.date);
                            setShowDayModal(true);
                          }
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="display"
                        angle={perDayData.length > 15 ? -45 : 0}
                        textAnchor={perDayData.length > 15 ? 'end' : 'middle'}
                        height={perDayData.length > 15 ? 80 : 30}
                      />
                      <YAxis allowDecimals={false} />
                      <Tooltip cursor={{ fill: 'rgba(147, 51, 234, 0.08)' }} />
                      <Legend />
                      {allUsers.map((user, i) => (
                        <Bar
                          key={user}
                          dataKey={user}
                          stackId="a"
                          fill={USER_COLORS[i % USER_COLORS.length]}
                          radius={i === allUsers.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                          style={{ cursor: 'pointer' }}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-center py-16">No materials ordered in selected date range</p>
                )}
              </CardContent>
            </Card>

            {/* Per-user breakdown */}
            {perUserData.length > 0 && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>By Order Processor</CardTitle>
                  <CardDescription>Total jobs marked as "Materials Ordered" per user in the selected period</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {perUserData.map((u, i) => (
                      <div key={u.name} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-foreground">{u.name}</span>
                            <span className="text-sm font-bold text-primary">{u.count} job{u.count !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${(u.count / perUserData[0].count) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Daily breakdown table */}
            {perDayData.some(d => d.count > 0) && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Daily Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {[...perDayData].reverse().filter(d => d.count > 0).map(d => (
                      <button
                        key={d.date}
                        onClick={() => { setSelectedDay(d.date); setShowDayModal(true); }}
                        className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-secondary hover:bg-primary/5 border border-border hover:border-primary/40 transition-colors text-left"
                      >
                        <span className="text-sm font-medium text-foreground">
                          {format(new Date(d.date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                        </span>
                        <span className="text-sm font-bold text-primary bg-primary/10 px-3 py-0.5 rounded-full">
                          {d.count} job{d.count !== 1 ? 's' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Day Detail Modal */}
      <Dialog open={showDayModal} onOpenChange={setShowDayModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Jobs Ordered — {selectedDay && format(new Date(selectedDay + 'T00:00:00'), 'MMMM d, yyyy')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {selectedDayJobs.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">No jobs found.</p>
            ) : selectedDayJobs.map(({ time, log, project, customer, sale }, i) => (
              <div key={i} className="p-4 bg-primary/10 rounded-lg border border-primary/20">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown Customer'}
                    </p>
                    {sale?.invoice_number && (
                      <p className="text-xs text-muted-foreground mt-0.5">CG#: {sale.invoice_number}</p>
                    )}
                    {project?.installation_date && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Install: {format(new Date(project.installation_date + 'T00:00:00'), 'MMM d, yyyy')}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Ordered at: {format(new Date(time.getTime() - AZ_OFFSET_MS), 'h:mm a')} AZ
                      {log.user_name ? ` by ${log.user_name}` : ''}
                    </p>
                  </div>
                  {project && (
                    <Link
                      to={createPageUrl('ProjectDetail') + `?id=${project.id}`}
                      className="text-xs font-medium text-primary hover:opacity-80 whitespace-nowrap"
                    >
                      View Project →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}