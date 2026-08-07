import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Plus, ClipboardCheck, Loader2, Calendar, Clock, MoreVertical, XCircle, AlertTriangle, RotateCcw } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import TagSelector from '@/components/tags/TagSelector';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function AppointmentSettingChecklists() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedLead, setSelectedLead] = useState('');
  const [createNewLead, setCreateNewLead] = useState(false);
  const [newLeadData, setNewLeadData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: ''
  });
  const [selectedTags, setSelectedTags] = useState([]);
  const [statusDialog, setStatusDialog] = useState(null); // { checklist, newStatus }
  const [statusReason, setStatusReason] = useState('');
  const queryClient = useQueryClient();

  const { data: checklists = [], isLoading: loadingV1 } = useQuery({
    queryKey: ['checklists'],
    queryFn: () => base44.entities.AppointmentSettingChecklist.list('-created_date')
  });

  const { data: checklistsV2 = [], isLoading: loadingV2 } = useQuery({
    queryKey: ['checklistsV2'],
    queryFn: () => base44.entities.ChecklistV2.list('-created_date')
  });

  const isLoading = loadingV1 || loadingV2;

  const { data: appointments = [] } = useQuery({
    queryKey: ['appointments'],
    queryFn: () => base44.entities.Appointment.list()
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: () => base44.entities.Lead.list('first_name')
  });

  const { data: appointmentLogs = [] } = useQuery({
    queryKey: ['appointmentLogs'],
    queryFn: () => base44.entities.AppointmentLog.list()
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, checklist_status, checklist_status_reason }) => {
      await base44.entities.ChecklistV2.update(id, { checklist_status, checklist_status_reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklistsV2'] });
      setStatusDialog(null);
      setStatusReason('');
    }
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      let leadData;
      
      if (createNewLead) {
        leadData = newLeadData;
      } else {
        leadData = leads.find(l => l.id === selectedLead);
        if (!leadData) throw new Error('Lead not found');
      }
      
      // Create a V2 checklist pre-populated with lead data
      const checklist = await base44.entities.ChecklistV2.create({
        customer_first_name: leadData.first_name,
        customer_last_name: leadData.last_name,
        customer_email: leadData.email,
        customer_phone: leadData.phone,
        customer_street: leadData.address_line1 || '',
        city: leadData.city || '',
        state: leadData.state || '',
        postal_code: leadData.zip || ''
      });
      
      return { checklist };
    },
    onSuccess: ({ checklist }) => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] });
      setShowCreateDialog(false);
      setSelectedLead('');
      setCreateNewLead(false);
      setNewLeadData({ first_name: '', last_name: '', email: '', phone: '' });
      setSelectedTags([]);
      // Navigate to the V2 checklist detail page
      window.location.href = createPageUrl('ChecklistV2Detail') + `?id=${checklist.id}`;
    }
  });

  // Merge V1 and V2 checklists, tagging each with its version
  const allChecklists = [
    ...checklists.map(c => ({ ...c, _version: 'v1' })),
    ...checklistsV2.map(c => ({ ...c, _version: 'v2' }))
  ].sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  // Get appointment for each checklist
  const checklistsWithAppointments = allChecklists.map(checklist => {
    const appointment = appointments.find(a => a.id === checklist.appointment);
    return { ...checklist, appointmentData: appointment };
  });

  // Filter checklists
  const filteredChecklists = checklistsWithAppointments.filter(checklist => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      checklist.customer_first_name?.toLowerCase().includes(query) ||
      checklist.customer_last_name?.toLowerCase().includes(query) ||
      checklist.customer_email?.toLowerCase().includes(query) ||
      checklist.customer_phone?.includes(query)
    );
  });

  const getTimeToSchedule = (checklist) => {
    if (!checklist.appointmentData || checklist.appointmentData.status === 'Lead') {
      return null;
    }

    const startTime = new Date(checklist.created_date + (checklist.created_date.includes('Z') ? '' : 'Z'));
    const endTime = new Date(checklist.appointmentData.created_date + (checklist.appointmentData.created_date.includes('Z') ? '' : 'Z'));
    const diffMs = endTime - startTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d ${diffHours % 24}h`;
    } else if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m`;
    } else {
      return `${diffMins}m`;
    }
  };

  const getCompletionStatus = (checklist) => {
    if (checklist._version === 'v2') {
      // Mirror the exact same sections array used in ChecklistV2Detail
      const sections = [
        { key: 'greeting', complete: checklist.greeting_completed && !!checklist.caller_type },
        { key: 'frame', complete: !!(checklist.frame_greeted_properly && checklist.frame_experience_delivered) },
        { key: 'contact', complete: !!(checklist.customer_first_name && checklist.customer_last_name && checklist.customer_phone && checklist.customer_email && checklist.customer_street && checklist.city && checklist.state && checklist.postal_code && checklist.lives_at_address && checklist.home_built_era) },
        { key: 'discovery', complete: !!(checklist.discovery_q1 && checklist.discovery_q2 && checklist.discovery_q3 && checklist.discovery_q4 && checklist.discovery_q5) },
        { key: 'scope', complete: !!(checklist.scope_gap_fill_notes) },
        { key: 'super_sale', complete: !!checklist.super_sale_delivered },
        { key: 'value_stack', complete: !!checklist.value_stack_delivered },
        { key: 'all_parties', complete: !!(checklist.prequal_dm_track && !checklist.prequal_below_minimum) },
        { key: 'work_from_home', complete: !!checklist.work_from_home },
        { key: 'financing', complete: !!(checklist.financing_notes || checklist.credit_score_range) },
        { key: 'timeframe', complete: !!checklist.project_timeframe },
        { key: 'other_estimates', complete: !!checklist.collected_other_estimates },
        { key: 'scheduling', complete: !!(checklist.preferred_appointment_date && checklist.preferred_appointment_block && checklist.two_hour_window_confirmation) },
        { key: 'recap', complete: !!(checklist.recap_completed && checklist.heard_about_us) },
        { key: 'outro', complete: !!checklist.outro_completed },
        { key: 'ai_summary', complete: !!checklist.ai_summary }
      ];
      const completedCount = sections.filter(s => s.complete).length;
      const percentage = Math.round((completedCount / sections.length) * 100);
      return { completed: completedCount, total: sections.length, percentage };
    }

    // V1 logic
    const sections = [
      { name: 'Intro & Process', required: [] },
      { name: 'Customer Contact Info', required: ['customer_first_name', 'customer_last_name', 'customer_phone', 'customer_email', 'customer_street', 'city', 'state', 'postal_code'] },
      { name: 'Property / Project Details', required: ['other_project_notes', 'lives_at_address'] },
      { name: 'Reason & Scope', required: [] },
      { name: 'Additional Options / Value Adds', required: [] },
      { name: 'Preferences & Household', required: [] },
      { name: 'Incentives, Financing, Budget', required: [] },
      { name: 'Budget & Project Minimums', required: [] },
      { name: 'Scheduling', required: [] },
      { name: 'Marketing Source', required: [] },
      { name: 'Verification Step', required: ['verified_accuracy'] },
      { name: 'Outro', required: [] }
    ];
    
    const completedSections = sections.filter(section => {
      if (section.required.length === 0) return true;
      return section.required.every(field => checklist[field]);
    }).length;
    
    const totalSections = sections.length;
    const percentage = Math.round((completedSections / totalSections) * 100);
    
    return { completed: completedSections, total: totalSections, percentage };
  };

  const isFormValid = createNewLead 
    ? newLeadData.first_name && newLeadData.last_name && newLeadData.email && newLeadData.phone
    : selectedLead;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Appointment Setting Checklists</h1>
              <p className="text-slate-500 mt-1">Collect customer information and set appointments</p>
            </div>
            <Button
              onClick={() => setShowCreateDialog(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white h-12 px-6 rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-200 transition-all"
            >
              <Plus className="w-5 h-5 mr-2" />
              New Checklist
            </Button>
          </div>

          {/* Search */}
          <div className="mt-8">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input
                placeholder="Search by customer name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-14 bg-slate-50 border-slate-200 rounded-xl text-base focus:bg-white focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          </div>
        ) : filteredChecklists.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center mb-6">
              <ClipboardCheck className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-2">
              {searchQuery ? 'No checklists found' : 'No checklists yet'}
            </h3>
            <p className="text-slate-500 mb-6">
              {searchQuery
                ? 'Try adjusting your search'
                : 'Start by creating a new checklist to collect customer information'}
            </p>
            {!searchQuery && (
              <Button
                onClick={() => setShowCreateDialog(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Checklist
              </Button>
            )}
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredChecklists.map((checklist, index) => {
                const status = getCompletionStatus(checklist);
                const timeToSchedule = getTimeToSchedule(checklist);
                const customerName = checklist.customer_first_name && checklist.customer_last_name
                  ? `${checklist.customer_first_name} ${checklist.customer_last_name}`
                  : 'Unnamed Customer';
                const csr = checklist.appointmentData?.assigned_csr ? teamMembers.find(tm => tm.id === checklist.appointmentData.assigned_csr) : null;
                
                return (
                  <motion.div
                    key={checklist.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                  >
                    <div className={cn(
                      "group bg-white rounded-2xl border p-6 transition-all duration-300",
                      checklist.checklist_status === 'not_finished' && 'border-amber-200 bg-amber-50/30',
                      checklist.checklist_status === 'not_qualified' && 'border-red-200 bg-red-50/30',
                      (!checklist.checklist_status || checklist.checklist_status === 'active') && 'border-slate-100 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-50'
                    )}>
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <Link
                          to={createPageUrl(checklist._version === 'v2' ? 'ChecklistV2Detail' : 'ChecklistDetail') + `?id=${checklist.id}`}
                          className="flex-1 min-w-0"
                        >
                          <h3 className="text-lg font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">
                            {customerName}
                          </h3>
                          {checklist.customer_phone && (
                            <p className="text-sm text-slate-500 mt-1">{checklist.customer_phone}</p>
                          )}
                          {csr && (
                            <p className="text-xs text-indigo-600 mt-1">Booked by: {csr.first_name} {csr.last_name}</p>
                          )}
                          {checklist.checklist_status === 'not_finished' && (
                            <Badge className="mt-2 bg-amber-100 text-amber-800 border-amber-200 border">
                              <AlertTriangle className="w-3 h-3 mr-1" /> Not Finished
                            </Badge>
                          )}
                          {checklist.checklist_status === 'not_qualified' && (
                            <Badge className="mt-2 bg-red-100 text-red-800 border-red-200 border">
                              <XCircle className="w-3 h-3 mr-1" /> Not Qualified
                            </Badge>
                          )}
                          {checklist.checklist_status_reason && (checklist.checklist_status === 'not_finished' || checklist.checklist_status === 'not_qualified') && (
                            <p className="text-xs text-slate-500 mt-1 italic">"{checklist.checklist_status_reason}"</p>
                          )}
                        </Link>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {checklist._version === 'v2' && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  onClick={(e) => e.preventDefault()}
                                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
                                >
                                  <MoreVertical className="w-4 h-4 text-slate-500" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {checklist.checklist_status !== 'not_finished' && (
                                  <DropdownMenuItem onClick={() => { setStatusDialog({ checklist, newStatus: 'not_finished' }); setStatusReason(''); }}>
                                    <AlertTriangle className="w-4 h-4 mr-2 text-amber-500" />
                                    Mark as Not Finished
                                  </DropdownMenuItem>
                                )}
                                {checklist.checklist_status !== 'not_qualified' && (
                                  <DropdownMenuItem onClick={() => { setStatusDialog({ checklist, newStatus: 'not_qualified' }); setStatusReason(''); }}>
                                    <XCircle className="w-4 h-4 mr-2 text-red-500" />
                                    Mark as Not Qualified
                                  </DropdownMenuItem>
                                )}
                                {(checklist.checklist_status === 'not_finished' || checklist.checklist_status === 'not_qualified') && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ id: checklist.id, checklist_status: 'active', checklist_status_reason: '' })}>
                                      <RotateCcw className="w-4 h-4 mr-2 text-slate-500" />
                                      Mark as Active
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                            <ClipboardCheck className="w-5 h-5 text-indigo-600" />
                          </div>
                        </div>
                      </div>

                      {/* Progress */}
                      <Link to={createPageUrl(checklist._version === 'v2' ? 'ChecklistV2Detail' : 'ChecklistDetail') + `?id=${checklist.id}`}>
                        <div className="space-y-2 mb-4">
                          <div className="flex items-center justify-between text-xs text-slate-600">
                            <span>Progress</span>
                            <span className="font-medium">{status.percentage}%</span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full transition-all duration-500",
                                status.percentage === 100 ? "bg-green-500" : "bg-indigo-600"
                              )}
                              style={{ width: `${status.percentage}%` }}
                            />
                          </div>
                          <p className="text-xs text-slate-500">
                            {status.completed} of {status.total} sections
                          </p>
                        </div>

                        {/* Status Badge */}
                        {checklist.appointmentData?.status && (
                          <Badge 
                            variant="secondary" 
                            className={cn(
                              'border',
                              checklist.appointmentData.status === 'Lead' && 'bg-slate-100 text-slate-700 border-slate-200',
                              checklist.appointmentData.status === 'Scheduled' && 'bg-blue-100 text-blue-800 border-blue-200'
                            )}
                          >
                            {checklist.appointmentData.status}
                          </Badge>
                        )}

                        {/* Show appointment date if scheduled */}
                        {checklist.appointmentData?.appointment_date && (
                          <div className="flex items-center gap-2 text-sm text-slate-600 mt-3">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            <span>{new Date(checklist.appointmentData.appointment_date).toLocaleDateString()}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-4 mt-3">
                          {/* Created date */}
                          {checklist.created_date && (
                            <div className="flex items-center gap-2 text-xs text-slate-400">
                              <Clock className="w-3.5 h-3.5" />
                              <span>
                                {new Date(checklist.created_date + (checklist.created_date.includes('Z') ? '' : 'Z')).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true
                                })}
                              </span>
                            </div>
                          )}
                          
                          {/* Time to schedule */}
                          {timeToSchedule && (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              ⚡ {timeToSchedule}
                            </Badge>
                          )}
                        </div>
                      </Link>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Results count */}
        {!isLoading && filteredChecklists.length > 0 && (
          <p className="text-center text-sm text-slate-400 mt-8">
            Showing {filteredChecklists.length} of {checklists.length} checklists
          </p>
        )}
      </div>

      {/* Status Reason Dialog */}
      <Dialog open={!!statusDialog} onOpenChange={(open) => { if (!open) { setStatusDialog(null); setStatusReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {statusDialog?.newStatus === 'not_finished' ? '⚠️ Mark as Not Finished' : '❌ Mark as Not Qualified'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-slate-600">
              {statusDialog?.newStatus === 'not_finished'
                ? 'The call ended before the checklist was completed.'
                : 'This lead does not meet the criteria for an appointment.'}
            </p>
            <div>
              <Label className="text-slate-700 mb-2 block">Reason <span className="text-slate-400 font-normal">(optional)</span></Label>
              <Textarea
                placeholder="e.g. Customer hung up, below minimum budget, etc."
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                className="resize-none"
                rows={3}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => { setStatusDialog(null); setStatusReason(''); }}>Cancel</Button>
              <Button
                onClick={() => updateStatusMutation.mutate({ id: statusDialog.checklist.id, checklist_status: statusDialog.newStatus, checklist_status_reason: statusReason })}
                disabled={updateStatusMutation.isPending}
                className={statusDialog?.newStatus === 'not_qualified' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}
              >
                {updateStatusMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => {
        setShowCreateDialog(open);
        if (!open) {
          setSelectedLead('');
          setCreateNewLead(false);
          setNewLeadData({ first_name: '', last_name: '', email: '', phone: '' });
          setSelectedTags([]);
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-800">Create New Checklist</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Tabs value={createNewLead ? "new" : "existing"} onValueChange={(v) => setCreateNewLead(v === "new")} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="existing">Select Existing Lead</TabsTrigger>
                <TabsTrigger value="new">Create New Lead</TabsTrigger>
              </TabsList>
              
              <TabsContent value="existing" className="space-y-4">
                <div>
                  <Label htmlFor="lead" className="text-slate-700 mb-2 block">Select Lead *</Label>
                  <Select value={selectedLead} onValueChange={setSelectedLead}>
                    <SelectTrigger className="h-12 border-slate-200">
                      <SelectValue placeholder="Choose a lead" />
                    </SelectTrigger>
                    <SelectContent>
                      {leads.map((lead) => (
                        <SelectItem key={lead.id} value={lead.id}>
                          {lead.first_name} {lead.last_name} - {lead.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>
              
              <TabsContent value="new" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="first_name" className="text-slate-700 mb-2 block">First Name *</Label>
                    <Input
                      id="first_name"
                      value={newLeadData.first_name}
                      onChange={(e) => setNewLeadData({ ...newLeadData, first_name: e.target.value })}
                      className="h-12 border-slate-200"
                      placeholder="John"
                    />
                  </div>
                  <div>
                    <Label htmlFor="last_name" className="text-slate-700 mb-2 block">Last Name *</Label>
                    <Input
                      id="last_name"
                      value={newLeadData.last_name}
                      onChange={(e) => setNewLeadData({ ...newLeadData, last_name: e.target.value })}
                      className="h-12 border-slate-200"
                      placeholder="Doe"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="email" className="text-slate-700 mb-2 block">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newLeadData.email}
                    onChange={(e) => setNewLeadData({ ...newLeadData, email: e.target.value })}
                    className="h-12 border-slate-200"
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <Label htmlFor="phone" className="text-slate-700 mb-2 block">Phone *</Label>
                  <PhoneInput
                    id="phone"
                    value={newLeadData.phone}
                    onChange={(e) => setNewLeadData({ ...newLeadData, phone: e.target.value })}
                    className="h-12 border-slate-200"
                  />
                </div>
              </TabsContent>
            </Tabs>
            
            <div className="mt-6 pt-4 border-t border-slate-100">
              <Label className="text-slate-700 mb-2 block">Tags <span className="text-slate-400 font-normal">(optional)</span></Label>
              <TagSelector
                selectedTagIds={selectedTags}
                onChange={setSelectedTags}
              />
            </div>

            <div className="flex gap-3 justify-end mt-6 pt-6 border-t border-slate-100">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateDialog(false);
                  setSelectedLead('');
                  setCreateNewLead(false);
                  setNewLeadData({ first_name: '', last_name: '', email: '', phone: '' });
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !isFormValid}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Checklist
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}