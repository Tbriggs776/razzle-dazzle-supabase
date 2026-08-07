import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar, Search, Loader2, Filter } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import AppointmentCard from '@/components/appointments/AppointmentCard';

export default function MyAppointments() {
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

  if (isCheckingAuth || userLoading || appointmentsLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Please log in</h2>
          <p className="text-slate-500">You need to be logged in to view your appointments</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-800">My Appointments</h1>
              <p className="text-slate-500 mt-1">View and manage your scheduled appointments</p>
            </div>
          </div>
        </motion.div>

        {/* Search and Filter */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by name, location or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12 bg-white border-slate-200"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFollowUpOnly(!showFollowUpOnly)}
            className={cn(
              "h-12 px-5 border-slate-200",
              showFollowUpOnly && "bg-purple-50 border-purple-200 text-purple-700"
            )}
          >
            <Filter className="w-4 h-4 mr-2" />
            {showFollowUpOnly ? 'Show All' : 'Follow-Up Only'}
          </Button>
        </div>

        {/* Tabs */}
         <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
           <TabsList className="bg-white border border-slate-200 p-1">
             <TabsTrigger value="upcoming" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
               Upcoming ({upcomingAppointments.length})
             </TabsTrigger>
             <TabsTrigger value="past" onClick={() => setShowHistorical(true)} className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
               Historical {showHistorical ? `(${pastAppointments.length})` : ''}
             </TabsTrigger>
             <TabsTrigger value="sold" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
               Sold ({soldAppointments.length})
             </TabsTrigger>
           </TabsList>

          <TabsContent value="upcoming" className="space-y-4">
            {upcomingAppointments.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
                <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-700 mb-2">
                  {searchQuery ? 'No matching appointments' : 'No upcoming appointments'}
                </h3>
                <p className="text-slate-500">
                  {searchQuery ? 'Try adjusting your search' : 'Your upcoming appointments will appear here'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {upcomingAppointments.map((appointment) => (
                  <AppointmentCard 
                    key={appointment.id} 
                    appointment={appointment}
                    preloadedData={appointmentData}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="past" className="space-y-4">
            {historicalLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              </div>
            ) : pastAppointments.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
                <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-700 mb-2">
                  {searchQuery ? 'No matching appointments' : 'No past appointments'}
                </h3>
                <p className="text-slate-500">
                  {searchQuery ? 'Try adjusting your search' : 'Your completed appointments will appear here'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pastAppointments.map((appointment) => (
                  <AppointmentCard 
                    key={appointment.id} 
                    appointment={appointment}
                    preloadedData={historicalData}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sold" className="space-y-4">
            {soldAppointments.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
                <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-700 mb-2">
                  {searchQuery ? 'No matching appointments' : 'No sold appointments'}
                </h3>
                <p className="text-slate-500">
                  {searchQuery ? 'Try adjusting your search' : 'Your sold appointments will appear here'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {soldAppointments.map((appointment) => (
                  <AppointmentCard 
                    key={appointment.id} 
                    appointment={appointment}
                    preloadedData={appointmentData}
                  />
                ))}
              </div>
            )}
          </TabsContent>
          </Tabs>
      </div>
    </div>
  );
}