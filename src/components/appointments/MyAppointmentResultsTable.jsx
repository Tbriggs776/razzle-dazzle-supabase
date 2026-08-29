import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { Loader2, Calendar, ArrowUpDown, MessageSquare, Phone, Mail, MessageCircle, Clock, Circle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO, isValid } from 'date-fns';
import ContactCustomerDialog from './ContactCustomerDialog';
import FollowUpDialog from './FollowUpDialog';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import StatusPill from '@/components/common/StatusPill';

// Status list drives the filter chips (order preserved).
const STATUSES = [
  'Sold', 'Completed', 'Cancelled', 'Lost', 'Pitch and Miss', 'One-Leg',
  'Credit Decline', 'Follow-Up', 'Scheduled', 'Rescheduled', 'In Route',
  'On Site', 'Lead', 'Awaiting Assignment',
];

// Appointment status -> semantic StatusPill tone.
const STATUS_TONE = {
  'Sold': 'good', 'Completed': 'good',
  'Cancelled': 'crit', 'Lost': 'crit', 'Credit Decline': 'crit',
  'Pitch and Miss': 'warn', 'One-Leg': 'warn', 'Follow-Up': 'warn',
  'Scheduled': 'info', 'Rescheduled': 'info', 'In Route': 'info', 'On Site': 'info',
  'Lead': 'info', 'Awaiting Assignment': 'info',
};
const toneFor = (s) => STATUS_TONE[s] || 'neutral';

// Delta vs prior period, with SEMANTIC good/bad decoupled from direction.
function deltaFor(cur, prev, { invert = false, unit = '' } = {}) {
  const d = Math.round((cur - prev) * 10) / 10;
  const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  const good = invert ? d < 0 : d > 0;
  const deltaTone = d === 0 ? 'flat' : good ? 'good' : 'bad';
  return { delta: `${d >= 0 ? '+' : ''}${d}${unit} vs prior`, dir, deltaTone };
}

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export default function MyAppointmentResultsTable({ currentUser }) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('Pitch and Miss');
  const [contactApt, setContactApt] = useState(null);
  const [followUpApt, setFollowUpApt] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  const { data: aptData, isLoading } = useQuery({
    queryKey: ['myAppointmentResults', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return { appointments: [], leads: [] };
      const teamMembers = await base44.entities.TeamMember.filter({ email: currentUser.email });
      if (!teamMembers.length) return { appointments: [], leads: [] };
      const teamMemberId = teamMembers[0].id;
      const appointments = await base44.entities.Appointment.filter({ assigned_dc: teamMemberId });
      const sales = await base44.entities.Sale.filter({ assigned_dc: teamMemberId });
      const leadIds = [...new Set(appointments.map(a => a.customer).filter(Boolean))];
      const leads = leadIds.length
        ? await base44.entities.Lead.filter({ id: { $in: leadIds } }, '-created_date', leadIds.length).catch(() => [])
        : [];
      return { appointments, leads, sales, teamMemberId };
    },
    enabled: !!currentUser?.email,
    staleTime: 30000
  });

  const appointments = aptData?.appointments || [];
  const leads = aptData?.leads || [];
  const sales = aptData?.sales || [];
  const teamMemberId = aptData?.teamMemberId;

  // Fetch pending tasks for this user, mapped by appointment ID
  const { data: pendingTasks = [] } = useQuery({
    queryKey: ['myResultsTasks', teamMemberId],
    queryFn: async () => {
      if (!teamMemberId) return [];
      return base44.entities.Task.filter({ assigned_to: teamMemberId, status: 'pending' });
    },
    enabled: !!teamMemberId,
    staleTime: 30000
  });

  const tasksByAppointment = useMemo(() => {
    const map = {};
    pendingTasks.forEach(t => {
      if (t.appointment) map[t.appointment] = t;
    });
    return map;
  }, [pendingTasks]);

  // Recent inbound messages (last 7 days) for unread indicators
  const { data: inboundComms = [] } = useQuery({
    queryKey: ['inboundComms', currentUser?.email],
    queryFn: async () => {
      const all = await base44.entities.Communication.list('-created_date', 500);
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return all.filter(m => m.direction === 'inbound' && new Date(m.created_date).getTime() >= since);
    },
    enabled: !!currentUser?.email,
    staleTime: 30000
  });

  // Realtime: refresh when new communications arrive
  useEffect(() => {
    const unsubscribe = base44.entities.Communication.subscribe((event) => {
      if (event?.type === 'create') {
        queryClient.invalidateQueries({ queryKey: ['inboundComms'] });
        queryClient.invalidateQueries({ queryKey: ['leadThread'] });
      }
    });
    return unsubscribe;
  }, [queryClient]);

  // Track last-seen timestamp per lead so unread inbound messages show a badge
  const [lastSeenMap, setLastSeenMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rd_convo_seen') || '{}'); } catch { return {}; }
  });

  const markLeadSeen = (lead) => {
    if (!lead) return;
    const now = Date.now();
    const keys = [];
    if (lead.id) keys.push(`lead:${lead.id}`);
    if (lead.phone) keys.push(`phone:${normalizePhone(lead.phone)}`);
    if (!keys.length) return;
    setLastSeenMap(prev => {
      const next = { ...prev };
      keys.forEach(k => { next[k] = now; });
      try { localStorage.setItem('rd_convo_seen', JSON.stringify(next)); } catch {}
      return next;
    });
  };

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

  const isTaskOverdue = (dueDate) => {
    const d = parseISO(dueDate);
    if (!isValid(d)) return false;
    return d < new Date() && d.toDateString() !== new Date().toDateString();
  };

  const enriched = useMemo(() => appointments.map(a => ({
    ...a,
    customer_name: getCustomerName(a)
  })), [appointments, leads]);

  // All appointments with a date (no status/search filter) — used for the summary stats.
  const dateFiltered = useMemo(() => enriched.filter(a => a.appointment_date), [enriched]);

  // Display set: status filter + search
  const filtered = useMemo(() => {
    let list = dateFiltered;
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
  }, [dateFiltered, searchQuery, statusFilter]);

  // Matches Sales Reports → Consultant Performance:
  //   sold   = Sale records (sale_date in range, not cancelled)
  //   total  = sold + not-won appointments (Lost, Pitch and Miss, One-Leg,
  //            Credit Decline, Follow-Up, Completed) — excludes Cancelled & pending
  //   close  = sold / total
  const NOT_WON_STATUSES = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up', 'Completed'];

  const saleInRange = (sale, range) => {
    if (!sale.sale_date || sale.is_cancelled) return false;
    const d = format(parseISO(sale.sale_date), 'yyyy-MM-dd');
    return d >= range.start && d <= range.end;
  };

  const inRange = (a, { start, end }) => a.appointment_date && a.appointment_date >= start && a.appointment_date <= end;

  const computeStats = (range) => {
    const rangeAppts = enriched.filter(a => inRange(a, range));
    const sold = sales.filter(s => saleInRange(s, range)).length;
    const notWon = rangeAppts.filter(a => NOT_WON_STATUSES.includes(a.status)).length;
    const cancelled = rangeAppts.filter(a => a.status === 'Cancelled').length;
    const total = sold + notWon;
    const closeRate = total > 0 ? Math.round((sold / total) * 100) : 0;
    return { total, sold, cancelled, closeRate };
  };

  // Month-to-date range (current month day 1 → today) and the equivalent prior-period
  // range (same day-of-month window in the previous month) for vs-previous comparison.
  const { mtdRange, prevRange } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed
    const mm = String(m + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const prevMonthLastDay = new Date(y, m, 0).getDate();
    const prevDay = Math.min(now.getDate(), prevMonthLastDay);
    const prevDate = new Date(y, m - 1, prevDay);
    const py = prevDate.getFullYear();
    const pm = String(prevDate.getMonth() + 1).padStart(2, '0');
    const pd = String(prevDate.getDate()).padStart(2, '0');
    return {
      mtdRange: { start: `${y}-${mm}-01`, end: `${y}-${mm}-${dd}` },
      prevRange: { start: `${py}-${pm}-01`, end: `${py}-${pm}-${pd}` }
    };
  }, []);

  const overallStats = useMemo(() => computeStats(mtdRange), [enriched, sales, mtdRange]);
  const prevStats = useMemo(() => computeStats(prevRange), [enriched, sales, prevRange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const sortedRows = [...filtered].sort((a, b) => {
    const cmp = String(a.appointment_date || '').localeCompare(String(b.appointment_date || ''));
    return sortDir === 'desc' ? -cmp : cmp;
  });

  return (
    <div className="space-y-6">
      {/* MTD performance KPIs */}
      <div>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-foreground">Month to Date Performance</h2>
            <p className="text-xs text-muted-foreground">
              {format(parseISO(mtdRange.start), 'MMM d')} – {format(parseISO(mtdRange.end), 'MMM d, yyyy')} · vs {format(parseISO(prevRange.start), 'MMM d')} – {format(parseISO(prevRange.end), 'MMM d')}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground/70">Total = sold + not-won outcomes</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile label="Total" value={overallStats.total} foot="Sold + not-won" {...deltaFor(overallStats.total, prevStats.total)} />
          <KpiTile label="Sold" value={overallStats.sold} foot="Closed this period" {...deltaFor(overallStats.sold, prevStats.sold)} />
          <KpiTile label="Cancelled" value={overallStats.cancelled} foot="Fewer is better" {...deltaFor(overallStats.cancelled, prevStats.cancelled, { invert: true })} />
          <KpiTile label="Close Rate" value={`${overallStats.closeRate}%`} hero foot={`${overallStats.sold} sold / ${overallStats.total} total`} {...deltaFor(overallStats.closeRate, prevStats.closeRate, { unit: 'pts' })} />
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm font-medium text-muted-foreground">Status:</span>
          <button
            onClick={() => setStatusFilter(null)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              !statusFilter
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            )}
          >
            All
          </button>
          {STATUSES.map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? null : status)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                statusFilter === status
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted'
              )}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortDir === 'desc' ? 'Newest' : 'Oldest'}
          </button>
        </div>

        <div className="relative max-w-md">
          <Input
            placeholder="Search customer, address, status..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Results list */}
      <ModuleCard
        title={statusFilter || 'All Appointments'}
        subtitle={`${filtered.length} ${filtered.length === 1 ? 'appointment' : 'appointments'}`}
        icon={Calendar}
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <h3 className="text-sm font-semibold text-foreground">No appointments found</h3>
            <p className="mt-1 text-xs text-muted-foreground">Adjust your filters or search.</p>
          </div>
        ) : (
          sortedRows.map(apt => {
            const lead = getLead(apt.customer);
            const unread = getUnreadCount(apt);
            const task = tasksByAppointment[apt.id];
            const taskOverdue = task ? isTaskOverdue(task.due_date) : false;

            return (
              <div key={apt.id} className="px-4 py-4 transition-colors hover:bg-muted/50">
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={createPageUrl('AppointmentDetail') + `?id=${apt.id}`}
                      className="font-semibold text-foreground transition-colors hover:text-brand-blue"
                    >
                      {apt.customer_name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Follow up with customer regarding this appointment
                    </p>
                  </div>

                  {task && (
                    <div className={cn(
                      'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold',
                      taskOverdue ? 'bg-crit/15 text-crit' : 'bg-warn/15 text-warn'
                    )}>
                      {taskOverdue ? <AlertCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                      <Clock className="h-3 w-3" />
                      {task.due_date ? format(parseISO(task.due_date), 'MMM d, yyyy') : 'No date'}
                      {taskOverdue && ' · Overdue'}
                    </div>
                  )}
                </div>

                {/* Badges row */}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <StatusPill tone={toneFor(apt.status)}>{apt.status || '—'}</StatusPill>
                  {apt.appointment_date && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {format(parseISO(apt.appointment_date), 'MMM d')}
                    </span>
                  )}
                  {apt.not_sold_deal_size > 0 && (
                    <span className="rounded-full bg-good/15 px-2 py-0.5 text-[11px] font-semibold text-good">
                      Deal Size: ${Number(apt.not_sold_deal_size).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </div>

                {/* Contact info + actions */}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {lead?.phone && (
                    <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-brand-blue">
                      <Phone className="h-3.5 w-3.5" />
                      {lead.phone}
                    </a>
                  )}
                  {lead?.email && (
                    <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-brand-blue">
                      <Mail className="h-3.5 w-3.5" />
                      {lead.email}
                    </a>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setFollowUpApt(apt)} className="h-7 text-xs">
                    <MessageCircle className="mr-1 h-3 w-3" />
                    Log Follow-Up
                  </Button>
                  <button
                    onClick={() => { markLeadSeen(lead); setContactApt(apt); }}
                    disabled={!lead?.phone && !lead?.email}
                    className={cn(
                      'relative rounded-lg border p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                      unread > 0
                        ? 'border-crit/30 bg-crit/15 text-crit hover:bg-crit/20'
                        : 'border-border text-muted-foreground hover:border-brand-blue/30 hover:bg-brand-blue/10 hover:text-brand-blue'
                    )}
                    title={unread > 0 ? `${unread} unread message${unread > 1 ? 's' : ''}` : 'Text / Email customer'}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    {unread > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-crit px-1 text-[10px] font-bold leading-none text-background">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </button>
                </div>

                {/* Appointment Notes */}
                {apt.notes && apt.notes.length > 0 && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">Appointment Notes</p>
                    <div className="max-h-32 space-y-2 overflow-y-auto pr-2">
                      {[...apt.notes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((note, idx) => (
                        <div key={idx} className="break-words rounded-lg border border-border bg-muted p-2.5">
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-foreground">{note.user_name}</p>
                            {note.context && (
                              <span className="rounded bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">{note.context}</span>
                            )}
                          </div>
                          <p className="text-xs leading-relaxed text-muted-foreground">{note.content}</p>
                          {note.timestamp && (
                            <p className="mt-1 text-[10px] text-muted-foreground/70">
                              {format(new Date(note.timestamp), 'MMM d, yyyy h:mm a')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </ModuleCard>

      {contactApt && (
        <ContactCustomerDialog
          open={!!contactApt}
          onClose={() => setContactApt(null)}
          lead={getLead(contactApt.customer)}
          appointmentId={contactApt.id}
        />
      )}

      {followUpApt && (
        <FollowUpDialog
          open={!!followUpApt}
          onClose={() => setFollowUpApt(null)}
          appointment={followUpApt}
          lead={getLead(followUpApt.customer)}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}
