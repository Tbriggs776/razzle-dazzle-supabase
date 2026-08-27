import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar, Search, Loader2, Filter, History, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import SyncBadge from '@/components/common/SyncBadge';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';

// Appointment outcome/stage → StatusPill tone.
const STATUS_TONE = {
  'Lead': 'info',
  'Awaiting Assignment': 'warn',
  'Scheduled': 'info',
  'Rescheduled': 'warn',
  'In Route': 'info',
  'On Site': 'info',
  'Cancelled': 'crit',
  'Completed': 'good',
  'Sold': 'good',
  'Lost': 'crit',
  'Pitch and Miss': 'crit',
  'One-Leg': 'warn',
  'Credit Decline': 'crit',
  'Follow-Up': 'warn',
};

export default function MyAppointments() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('upcoming');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [showFollowUpOnly, setShowFollowUpOnly] = useState(false);
  const [showHistorical, setShowHistorical] = useState(false);

  // Check authentication
  React.useEffect(() => {
    const checkAuth = async () => {
      const isAuthenticated = await base44.auth.isAuthenticated();
      if (!isAuthenticated) {
        base44.auth.redirectToLogin(window.location.href);
      } else {
        setIsCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  // Get current user
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false,
    enabled: !isCheckingAuth
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  // Helper to fetch leads + checklists for a set of appointments
  const enrichAppointments = async (appointments, allTeamMembers) => {
    if (!appointments.length) return { appointments, leads: [], teamMembers: allTeamMembers, checklists: [] };
    const CHUNK = 25;
    const leadIds = [...new Set(appointments.map(a => a.customer).filter(Boolean))];
    const leadChunks = [];
    for (let i = 0; i < leadIds.length; i += CHUNK) leadChunks.push(leadIds.slice(i, i + CHUNK));
    const leadResults = await Promise.all(
      leadChunks.map(chunk => base44.entities.Lead.filter({ id: { $in: chunk } }, '-created_date', chunk.length).catch(() => []))
    );
    const aptIds = appointments.map(a => a.id);
    const aptChunks = [];
    for (let i = 0; i < aptIds.length; i += CHUNK) aptChunks.push(aptIds.slice(i, i + CHUNK));
    const checklistResults = await Promise.all(
      aptChunks.map(chunk => base44.entities.AppointmentSettingChecklist.filter({ appointment: { $in: chunk } }, '-created_date', chunk.length).catch(() => []))
    );
    return { appointments, leads: leadResults.flat(), teamMembers: allTeamMembers, checklists: checklistResults.flat() };
  };

  // Fetch upcoming + sold appointments (no past dates)
  const { data: appointmentData, isLoading: appointmentsLoading } = useQuery({
    queryKey: ['myAppointmentsUpcoming', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return { appointments: [], leads: [], teamMembers: [], checklists: [] };
      const teamMembers = await base44.entities.TeamMember.filter({ email: currentUser.email });
      if (!teamMembers.length) return { appointments: [], leads: [], teamMembers: [], checklists: [] };
      const teamMemberId = teamMembers[0].id;
      const [appointments, allTeamMembers] = await Promise.all([
        base44.entities.Appointment.filter({ assigned_dc: teamMemberId, appointment_date: { $gte: todayStr } }),
        base44.entities.TeamMember.list()
      ]);
      // Also fetch sold appointments (may have any date)
      const soldAppointments = await base44.entities.Appointment.filter({ assigned_dc: teamMemberId, status: 'Sold' });
      const merged = [...appointments, ...soldAppointments.filter(s => !appointments.find(a => a.id === s.id))];
      return enrichAppointments(merged, allTeamMembers);
    },
    enabled: !!currentUser?.email,
    staleTime: 30000
  });

  // Only fetch historical (past) appointments when user opens that tab
  const { data: historicalData, isLoading: historicalLoading } = useQuery({
    queryKey: ['myAppointmentsHistorical', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return { appointments: [], leads: [], teamMembers: [], checklists: [] };
      const teamMembers = await base44.entities.TeamMember.filter({ email: currentUser.email });
      if (!teamMembers.length) return { appointments: [], leads: [], teamMembers: [], checklists: [] };
      const teamMemberId = teamMembers[0].id;
      const [appointments, allTeamMembers] = await Promise.all([
        base44.entities.Appointment.filter({ assigned_dc: teamMemberId, appointment_date: { $lt: todayStr } }),
        base44.entities.TeamMember.list()
      ]);
      return enrichAppointments(appointments, allTeamMembers);
    },
    enabled: !!currentUser?.email && showHistorical,
    staleTime: 30000
  });

  const appointments = appointmentData?.appointments || [];
  const leads = appointmentData?.leads || [];
  const historicalAppointments = historicalData?.appointments || [];
  const historicalLeads = historicalData?.leads || [];

  const makeMatchesSearch = (leadsList) => (apt) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const lead = leadsList.find(l => l.id === apt.customer);
    return (
      apt.location_address?.toLowerCase().includes(query) ||
      apt.internal_notes?.toLowerCase().includes(query) ||
      lead?.first_name?.toLowerCase().includes(query) ||
      lead?.last_name?.toLowerCase().includes(query) ||
      `${lead?.first_name} ${lead?.last_name}`.toLowerCase().includes(query)
    );
  };

  const matchesSearch = makeMatchesSearch(leads);
  const matchesSearchHistorical = makeMatchesSearch(historicalLeads);

  const upcomingAppointments = appointments
    .filter(apt => {
      if (!apt.appointment_date) return false;
      const aptDate = new Date(apt.appointment_date + 'T00:00:00');
      return aptDate >= today;
    })
    .filter(apt => {
      if (showFollowUpOnly && apt.status !== 'Follow-Up') return false;
      return true;
    })
    .filter(matchesSearch)
    .sort((a, b) => new Date(a.appointment_date + 'T00:00:00') - new Date(b.appointment_date + 'T00:00:00'));

  const pastAppointments = historicalAppointments
    .filter(apt => {
      if (showFollowUpOnly && apt.status !== 'Follow-Up') return false;
      return true;
    })
    .filter(matchesSearchHistorical)
    .sort((a, b) => new Date(b.appointment_date + 'T00:00:00') - new Date(a.appointment_date + 'T00:00:00'));

  const soldAppointments = appointments
    .filter(apt => apt.status === 'Sold')
    .filter(matchesSearch)
    .sort((a, b) => new Date(b.appointment_date + 'T00:00:00') - new Date(a.appointment_date + 'T00:00:00'));

  // Presentational KPI: appointments flagged for follow-up (stable across the toggle).
  const followUpCount = appointments.filter(apt => apt.status === 'Follow-Up').length;

  const renderRows = (list, data) =>
    list.map((apt) => {
      const lead = data?.leads?.find((l) => l.id === apt.customer);
      const dc = data?.teamMembers?.find((tm) => tm.id === apt.assigned_dc);
      const csr = data?.teamMembers?.find((tm) => tm.id === apt.assigned_csr);
      const checklist = data?.checklists?.find((c) => c.appointment === apt.id);
      const name = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Customer';
      const tone = STATUS_TONE[apt.status] || 'neutral';
      const meta = [
        apt.appointment_block,
        apt.location_address,
        dc && `DC: ${dc.first_name} ${dc.last_name}`,
        csr && `Booked by ${csr.first_name} ${csr.last_name}`,
        checklist?.project_budget && `Budget ${checklist.project_budget}`,
        checklist?.photos?.length ? `${checklist.photos.length} photos` : null,
      ]
        .filter(Boolean)
        .join('  ·  ');
      return (
        <WorkRow
          key={apt.id}
          lead={apt.appointment_date ? format(new Date(apt.appointment_date + 'T00:00:00'), 'MMM d') : '—'}
          primary={name}
          meta={meta}
          onClick={() => navigate(createPageUrl('AppointmentDetail') + `?id=${apt.id}&from=MyAppointments`)}
          trailing={
            <div className="flex items-center gap-2">
              {apt.rfms_sync_status === 'synced' && <SyncBadge status="synced" label="RFMS" />}
              {apt.rfms_sync_status === 'error' && <SyncBadge status="error" label="RFMS" />}
              <StatusPill tone={tone}>{apt.status}</StatusPill>
            </div>
          }
        />
      );
    });

  const emptyBody = (title, sub, Icon = Calendar) => (
    <div className="px-4 py-14 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );

  if (isCheckingAuth || userLoading || appointmentsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Please log in</h2>
          <p className="text-muted-foreground">You need to be logged in to view your appointments</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Consultant"
          title="My Appointments"
          subtitle="View and manage your scheduled appointments."
          actions={
            <>
              <div className="relative w-52">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search name, address, notes…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 border-border bg-card pl-9"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => setShowFollowUpOnly(!showFollowUpOnly)}
                className={cn(
                  'h-9 border-border',
                  showFollowUpOnly && 'border-primary/30 bg-primary/10 text-primary'
                )}
              >
                <Filter className="mr-2 h-4 w-4" />
                {showFollowUpOnly ? 'Show All' : 'Follow-Up Only'}
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label="Upcoming"
            value={upcomingAppointments.length}
            foot="Scheduled ahead"
            onClick={() => setActiveTab('upcoming')}
          />
          <KpiTile
            label="Follow-Ups"
            value={followUpCount}
            foot="Flagged for follow-up"
          />
          <KpiTile
            label="Sold"
            value={soldAppointments.length}
            hero
            foot="Closed from your appointments"
            onClick={() => setActiveTab('sold')}
          />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="overflow-x-auto pb-1">
            <TabsList className="flex-nowrap border border-border bg-card p-1">
              <TabsTrigger value="upcoming" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                Upcoming ({upcomingAppointments.length})
              </TabsTrigger>
              <TabsTrigger value="past" onClick={() => setShowHistorical(true)} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                Historical {showHistorical ? `(${pastAppointments.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="sold" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                Sold ({soldAppointments.length})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="upcoming">
            <ModuleCard
              title="Upcoming Appointments"
              subtitle={`${upcomingAppointments.length} ${upcomingAppointments.length === 1 ? 'appointment' : 'appointments'}${showFollowUpOnly ? ' · follow-up only' : ''}`}
              icon={Calendar}
            >
              {upcomingAppointments.length === 0
                ? emptyBody(
                    searchQuery ? 'No matching appointments' : 'No upcoming appointments',
                    searchQuery ? 'Try adjusting your search.' : 'Your upcoming appointments will appear here.'
                  )
                : renderRows(upcomingAppointments, appointmentData)}
            </ModuleCard>
          </TabsContent>

          <TabsContent value="past">
            <ModuleCard
              title="Historical Appointments"
              subtitle={showHistorical ? `${pastAppointments.length} past` : 'Open to load history'}
              icon={History}
            >
              {historicalLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : pastAppointments.length === 0 ? (
                emptyBody(
                  searchQuery ? 'No matching appointments' : 'No past appointments',
                  searchQuery ? 'Try adjusting your search.' : 'Your completed appointments will appear here.',
                  History
                )
              ) : (
                renderRows(pastAppointments, historicalData)
              )}
            </ModuleCard>
          </TabsContent>

          <TabsContent value="sold">
            <ModuleCard
              title="Sold Appointments"
              subtitle={`${soldAppointments.length} ${soldAppointments.length === 1 ? 'closed job' : 'closed jobs'}`}
              icon={CheckCircle2}
            >
              {soldAppointments.length === 0
                ? emptyBody(
                    searchQuery ? 'No matching appointments' : 'No sold appointments',
                    searchQuery ? 'Try adjusting your search.' : 'Your sold appointments will appear here.',
                    CheckCircle2
                  )
                : renderRows(soldAppointments, appointmentData)}
            </ModuleCard>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
