import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Loader2, Calendar, ChevronDown, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, startOfWeek, parseISO, isValid } from 'date-fns';
import ContactCustomerDialog from './ContactCustomerDialog';

const STATUS_COLORS = {
  'Sold': 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25',
  'Completed': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
  'Cancelled': 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25',
  'Lost': 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25',
  'Pitch and Miss': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25',
  'One-Leg': 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25',
  'Credit Decline': 'bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-500/15 dark:text-pink-300 dark:border-pink-500/25',
  'Follow-Up': 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/25',
  'Scheduled': 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/25',
  'Rescheduled': 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/25',
  'In Route': 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/25',
  'On Site': 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/25',
  'Lead': 'bg-secondary text-secondary-foreground border-border',
  'Awaiting Assignment': 'bg-secondary text-secondary-foreground border-border',
};

const GROUP_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom' },
];

function getGroupKey(date, groupBy) {
  const d = parseISO(date);
  if (!isValid(d)) return null;
  switch (groupBy) {
    case 'day': return format(d, 'yyyy-MM-dd');
    case 'week': return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    case 'month': return format(d, 'yyyy-MM');
    case 'year': return format(d, 'yyyy');
    default: return format(d, 'yyyy-MM-dd');
  }
}

function formatGroupLabel(key, groupBy) {
  switch (groupBy) {
    case 'day': return format(parseISO(key), 'EEEE, MMM d, yyyy');
    case 'week': return `Week of ${format(parseISO(key), 'MMM d, yyyy')}`;
    case 'month': return format(parseISO(`${key}-01`), 'MMMM yyyy');
    case 'year': return key;
    default: return format(parseISO(key), 'EEEE, MMM d, yyyy');
  }
}

const COLUMNS = [
  { key: 'appointment_date', label: 'Date', sortable: true },
  { key: 'customer_name', label: 'Customer', sortable: true },
  { key: 'location_address', label: 'Address', sortable: true },
  { key: 'appointment_block', label: 'Block', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'contact', label: 'Contact', sortable: false },
];

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export default function MyAppointmentResultsTable({ currentUser }) {
  const queryClient = useQueryClient();
  const [groupBy, setGroupBy] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('Pitch and Miss');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [contactApt, setContactApt] = useState(null);
  const [sortKey, setSortKey] = useState('appointment_date');
  const [sortDir, setSortDir] = useState('desc');

  const { data: aptData, isLoading } = useQuery({
    queryKey: ['myAppointmentResults', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return { appointments: [], leads: [] };
      const teamMembers = await base44.entities.TeamMember.filter({ email: currentUser.email });
      if (!teamMembers.length) return { appointments: [], leads: [] };
      const teamMemberId = teamMembers[0].id;
      const appointments = await base44.entities.Appointment.filter({ assigned_dc: teamMemberId });
      const leadIds = [...new Set(appointments.map(a => a.customer).filter(Boolean))];
      const leads = leadIds.length
        ? await base44.entities.Lead.filter({ id: { $in: leadIds } }, '-created_date', leadIds.length).catch(() => [])
        : [];
      return { appointments, leads };
    },
    enabled: !!currentUser?.email,
    staleTime: 30000,
  });

  const appointments = aptData?.appointments || [];
  const leads = aptData?.leads || [];

  // Recent inbound messages (last 7 days) for the unread indicators.
  const { data: inboundComms = [] } = useQuery({
    queryKey: ['inboundComms', currentUser?.email],
    queryFn: async () => {
      const all = await base44.entities.Communication.list('-created_date', 500);
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return all.filter(m => m.direction === 'inbound' && new Date(m.created_date).getTime() >= since);
    },
    enabled: !!currentUser?.email,
    staleTime: 30000,
  });

  // Realtime: refresh when new communications arrive.
  useEffect(() => {
    const unsubscribe = base44.entities.Communication.subscribe((event) => {
      if (event?.type === 'create') {
        queryClient.invalidateQueries({ queryKey: ['inboundComms'] });
        queryClient.invalidateQueries({ queryKey: ['leadThread'] });
      }
    });
    return unsubscribe;
  }, [queryClient]);

  // Track last-seen timestamp per lead so unread inbound messages show a red badge.
  const [lastSeenMap, setLastSeenMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rd_convo_seen') || '{}'); } catch { return {}; }
  });

  const markLeadSeen = (lead) => {
    if (!lead) return;
    const key = lead.id ? `lead:${lead.id}` : (lead.phone ? `phone:${normalizePhone(lead.phone)}` : null);
    if (!key) return;
    const now = Date.now();
    setLastSeenMap(prev => {
      const next = { ...prev, [key]: now };
      // Also stamp the phone key so both matching paths are cleared.
      if (lead.phone) next[`phone:${normalizePhone(lead.phone)}`] = now;
      try { localStorage.setItem('rd_convo_seen', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // Count unread inbound messages per lead key (created after the last-seen timestamp).
  const unreadByLeadKey = useMemo(() => {
    const counts = {};
    inboundComms.forEach(m => {
      if (m.direction !== 'inbound') return;
      const keys = [];
      if (m.lead_id) keys.push(`lead:${m.lead_id}`);
      if (m.contact_phone) keys.push(`phone:${normalizePhone(m.contact_phone)}`);
      const ts = new Date(m.created_date).getTime();
      keys.forEach(k => {
        const seen = lastSeenMap[k] || 0;
        if (ts > seen) counts[k] = (counts[k] || 0) + 1;
      });
    });
    return counts;
  }, [inboundComms, lastSeenMap]);

  const getLead = (id) => leads.find(l => l.id === id);
  const getCustomerName = (apt) => {
    const lead = getLead(apt.customer);
    return lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : '—';
  };

  const getUnreadCount = (apt) => {
    const lead = getLead(apt.customer);
    if (!lead) return 0;
    if (lead.id && unreadByLeadKey[`lead:${lead.id}`]) return unreadByLeadKey[`lead:${lead.id}`];
    if (lead.phone) {
      const c = unreadByLeadKey[`phone:${normalizePhone(lead.phone)}`];
      if (c) return c;
    }
    return 0;
  };

  const enriched = useMemo(() => appointments.map(a => ({
    ...a,
    customer_name: getCustomerName(a),
  })), [appointments, leads]);

  const filtered = useMemo(() => {
    let list = enriched.filter(a => a.appointment_date);
    if (groupBy === 'custom' && customStart && customEnd) {
      const s = parseISO(customStart);
      const e = parseISO(customEnd);
      list = list.filter(a => {
        const d = parseISO(a.appointment_date);
        return isValid(d) && d >= s && d <= e;
      });
    }
    if (statusFilter) {
      list = list.filter(a => a.status === statusFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(a =>
        a.customer_name?.toLowerCase().includes(q) ||
        a.location_address?.toLowerCase().includes(q) ||
        a.status?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [enriched, groupBy, customStart, customEnd, searchQuery, statusFilter]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(a => {
      const key = getGroupKey(a.appointment_date, groupBy);
      if (!key) return;
      (map[key] = map[key] || []).push(a);
    });
    return Object.entries(map).sort((a, b) => sortDir === 'desc' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]));
  }, [filtered, groupBy, sortDir]);

  const sortAppointments = (list) => {
    return [...list].sort((a, b) => {
      const av = String(a[sortKey] || '');
      const bv = String(b[sortKey] || '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === 'desc' ? -cmp : cmp;
    });
  };

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const toggleGroup = (key) => setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const groupStats = (list) => {
    const total = list.length;
    const sold = list.filter(a => a.status === 'Sold').length;
    const cancelled = list.filter(a => a.status === 'Cancelled').length;
    const closeRate = total > 0 ? Math.round((sold / total) * 100) : 0;
    return { total, sold, cancelled, closeRate };
  };

  const overallStats = useMemo(() => groupStats(filtered), [filtered]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total</p>
          <p className="text-2xl font-bold text-foreground">{overallStats.total}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Sold</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{overallStats.sold}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Cancelled</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{overallStats.cancelled}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Close Rate</p>
          <p className="text-2xl font-bold text-primary">{overallStats.closeRate}%</p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground mr-1">Status:</span>
          <button
            onClick={() => setStatusFilter(null)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
              !statusFilter ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted'
            )}
          >
            All
          </button>
          {Object.keys(STATUS_COLORS).map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? null : status)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                statusFilter === status ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted'
              )}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground mr-1">Group by:</span>
          {GROUP_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setGroupBy(opt.value)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                groupBy === opt.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {groupBy === 'custom' && (
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground"
            />
          </div>
        )}

        <div className="relative max-w-md">
          <Input
            placeholder="Search customer, address, status..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Grouped collapsible tables */}
      {grouped.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-2xl border border-border">
          <Calendar className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No appointments found</h3>
          <p className="text-muted-foreground">Adjust your filters or date range</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([groupKey, list]) => {
            const stats = groupStats(list);
            const collapsed = collapsedGroups[groupKey];
            const sortedList = sortAppointments(list);
            return (
              <div key={groupKey} className="bg-card rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-full flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {collapsed ? <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />}
                    <h3 className="font-semibold text-foreground truncate">{formatGroupLabel(groupKey, groupBy)}</h3>
                    <span className="text-xs text-muted-foreground shrink-0">({list.length})</span>
                  </div>
                  <div className="hidden sm:flex items-center gap-4 text-xs shrink-0">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">{stats.sold} sold</span>
                    <span className="text-red-600 dark:text-red-400 font-medium">{stats.cancelled} cancelled</span>
                    <span className="text-primary font-medium">{stats.closeRate}% close</span>
                  </div>
                </button>

                {!collapsed && (
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          {COLUMNS.map(col => (
                            <th
                              key={col.key}
                              onClick={() => col.sortable && toggleSort(col.key)}
                              className={cn('px-4 py-3 text-left font-medium select-none', col.sortable && 'cursor-pointer hover:text-foreground')}
                            >
                              <div className="flex items-center gap-1">
                                {col.label}
                                {col.sortable && (sortKey === col.key ? (
                                  sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 opacity-40" />
                                ))}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {sortedList.map(apt => {
                          const unread = getUnreadCount(apt);
                          const lead = getLead(apt.customer);
                          return (
                            <tr key={apt.id} className="hover:bg-muted/50">
                              <td className="px-4 py-3 text-foreground whitespace-nowrap">
                                {apt.appointment_date ? format(parseISO(apt.appointment_date), 'MMM d, yyyy') : '—'}
                              </td>
                              <td className="px-4 py-3 text-foreground font-medium">{apt.customer_name}</td>
                              <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{apt.location_address || '—'}</td>
                              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{apt.appointment_block || '—'}</td>
                              <td className="px-4 py-3">
                                <span className={cn(
                                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
                                  STATUS_COLORS[apt.status] || 'bg-secondary text-secondary-foreground border-border'
                                )}>
                                  {apt.status || '—'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => { markLeadSeen(lead); setContactApt(apt); }}
                                  disabled={!lead?.phone && !lead?.email}
                                  className={cn(
                                    'relative p-1.5 rounded-lg border transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                                    unread > 0
                                      ? 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300'
                                      : 'border-border text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30'
                                  )}
                                  title={unread > 0 ? `${unread} unread message${unread > 1 ? 's' : ''} — click to view & reply` : 'Text / Email customer'}
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                  {unread > 0 && (
                                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                                      {unread > 9 ? '9+' : unread}
                                    </span>
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {contactApt && (
        <ContactCustomerDialog
          open={!!contactApt}
          onClose={() => setContactApt(null)}
          lead={getLead(contactApt.customer)}
          appointmentId={contactApt.id}
        />
      )}
    </div>
  );
}
