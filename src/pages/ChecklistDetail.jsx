import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Calendar, Trash2, Loader2, Save, Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import ChecklistPanel from '@/components/appointments/ChecklistPanel';
import { toast } from 'sonner';

// Convert checklist time block format to appointment format
const convertTimeBlock = (checklistBlock) => {
  if (!checklistBlock) return undefined;
  // Convert en-dash to "to"
  return checklistBlock.replace(/–/g, ' to ');
};

export default function ChecklistDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [selectedDC, setSelectedDC] = useState('');
  const [selectedCSR, setSelectedCSR] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'

  const { data: checklist, isLoading } = useQuery({
    queryKey: ['checklist', id],
    queryFn: async () => {
      // Try to find checklist by ID first
      let checklists = await base44.entities.AppointmentSettingChecklist.filter({ id: id });
      
      // If not found, try to find by appointment ID
      if (checklists.length === 0) {
        checklists = await base44.entities.AppointmentSettingChecklist.filter({ appointment: id });
      }
      
      return checklists[0];
    },
    enabled: !!id
  });

  const { data: appointment } = useQuery({
    queryKey: ['appointment', checklist?.appointment],
    queryFn: async () => {
      const appointments = await base44.entities.Appointment.filter({ id: checklist.appointment });
      return appointments[0] || null;
    },
    enabled: !!checklist?.appointment
  });

  const { data: designConsultants = [] } = useQuery({
    queryKey: ['designConsultants'],
    queryFn: async () => {
      const allMembers = await base44.entities.TeamMember.list();
      return allMembers.filter(m => m.is_active && (m.role === 'Design Consultant' || m.role === 'Sales Manager'));
    }
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: csrMembers = [] } = useQuery({
    queryKey: ['csrMembers'],
    queryFn: async () => {
      const allMembers = await base44.entities.TeamMember.list();
      return allMembers.filter(m => m.is_active && (m.role === 'Customer Service Rep' || m.role === 'Sales Manager' || m.role === 'Admin'));
    }
  });

  const { data: appointmentLogs = [] } = useQuery({
    queryKey: ['appointmentLogs'],
    queryFn: () => base44.entities.AppointmentLog.list()
  });

  const { data: assignedCSR } = useQuery({
    queryKey: ['assignedCSR', appointment?.assigned_csr],
    queryFn: async () => {
      if (!appointment?.assigned_csr) return null;
      const members = await base44.entities.TeamMember.filter({ id: appointment.assigned_csr });
      return members[0] || null;
    },
    enabled: !!appointment?.assigned_csr
  });

  // Auto-populate selectedCSR when dialog opens AND csrMembers have loaded
  React.useEffect(() => {
    if (showScheduleDialog && currentUser && csrMembers.length > 0 && !selectedCSR) {
      const userCSR = csrMembers.find(m => m.email === currentUser.email);
      if (userCSR) {
        setSelectedCSR(userCSR.id);
      }
    }
  }, [showScheduleDialog, currentUser, csrMembers, selectedCSR]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Delete the checklist only
      await base44.entities.AppointmentSettingChecklist.delete(id);
    },
    onSuccess: () => {
      navigate(createPageUrl('AppointmentSettingChecklists'));
    }
  });

  const convertToAppointmentMutation = useMutation({
    mutationFn: async () => {
      console.time('🕐 TOTAL Appointment Conversion');
      let appointmentId;
      let shouldCreateNew = false;

      // Get current user for CSR auto-assignment
      console.time('⏱️ Get current user');
      const currentUser = await base44.auth.me();
      console.timeEnd('⏱️ Get current user');
      let csrId = null;

      if (currentUser?.email) {
        try {
          console.time('⏱️ Find CSR/Sales Manager by email');
          // Check if current user is a CSR or Sales Manager
          const teamMembers = await base44.entities.TeamMember.filter({ 
            email: currentUser.email
          });
          console.timeEnd('⏱️ Find CSR/Sales Manager by email');
          if (teamMembers.length > 0) {
            const member = teamMembers[0];
            if (member.role === 'Customer Service Rep' || member.role === 'Sales Manager') {
              csrId = member.id;
            }
          }
        } catch (error) {
          console.error('Failed to find team member:', error);
        }
      }

      // Check if appointment exists
      console.time('⏱️ Check existing appointment');
      if (checklist.appointment) {
        try {
          const existingAppts = await base44.entities.Appointment.filter({ id: checklist.appointment });
          if (existingAppts.length === 0) {
            shouldCreateNew = true;
          }
        } catch (error) {
          shouldCreateNew = true;
        }
      } else {
        shouldCreateNew = true;
      }
      console.timeEnd('⏱️ Check existing appointment');

      if (shouldCreateNew) {
       // Check if a lead already exists with this email
       console.time('⏱️ Check/Create Lead');
       let leadId;
       // Only check for existing leads if email is provided
       const existingLeads = checklist.customer_email 
         ? await base44.entities.Lead.filter({ email: checklist.customer_email })
         : [];

       if (existingLeads.length > 0) {
         // Use existing lead
         leadId = existingLeads[0].id;
       } else {
         // Create a new lead from checklist data
         const newLead = await base44.entities.Lead.create({
           first_name: checklist.customer_first_name || 'Unknown',
           last_name: checklist.customer_last_name || 'Customer',
           email: checklist.customer_email || '',
           phone: checklist.customer_phone || '',
           address_line1: checklist.customer_street || '',
           city: checklist.city || '',
           state: checklist.state || '',
           zip: checklist.postal_code || ''
         });
         leadId = newLead.id;
       }
       console.timeEnd('⏱️ Check/Create Lead');

       // Create new appointment with the lead
       console.time('⏱️ Create Appointment');
       const notes = [];
       if (checklist.other_project_notes) {
         notes.push({
           content: checklist.other_project_notes,
           user_name: currentUser.full_name,
           user_email: currentUser.email,
           timestamp: new Date().toISOString(),
           context: 'Checklist Creation'
         });
       }
       
       const newAppointment = await base44.entities.Appointment.create({
         status: 'Scheduled',
         customer: leadId,
         location_address: `${checklist.customer_street || ''}, ${checklist.city || ''}, ${checklist.state || ''} ${checklist.postal_code || ''}`.trim(),
         appointment_date: checklist.preferred_appointment_date,
         appointment_block: convertTimeBlock(checklist.preferred_appointment_block),
         notes: notes,
         assigned_dc: (selectedDC && selectedDC !== 'unassigned') ? selectedDC : undefined,
         assigned_csr: selectedCSR || csrId || undefined,
         appointment_created_date: new Date().toISOString()
       });
        appointmentId = newAppointment.id;
        console.timeEnd('⏱️ Create Appointment');



        // Link checklist to the new appointment
        console.time('⏱️ Link Checklist');
        await base44.entities.AppointmentSettingChecklist.update(id, {
          appointment: appointmentId
        });
        console.timeEnd('⏱️ Link Checklist');
      } else {
       // Update existing appointment
       console.time('⏱️ Update Existing Appointment');
       const existingApptData = await base44.entities.Appointment.filter({ id: checklist.appointment });
       const existingNotes = existingApptData[0]?.notes || [];
       
       const notes = [...existingNotes];
       if (checklist.other_project_notes) {
         // Check if there's already a checklist creation note
         const hasChecklistNote = notes.some(n => n.context === 'Checklist Creation');
         if (!hasChecklistNote) {
           notes.push({
             content: checklist.other_project_notes,
             user_name: currentUser.full_name,
             user_email: currentUser.email,
             timestamp: new Date().toISOString(),
             context: 'Checklist Creation'
           });
         }
       }
       
       await base44.entities.Appointment.update(checklist.appointment, {
         status: 'Scheduled',
         location_address: `${checklist.customer_street || ''}, ${checklist.city || ''}, ${checklist.state || ''} ${checklist.postal_code || ''}`.trim(),
         appointment_date: checklist.preferred_appointment_date,
         appointment_block: convertTimeBlock(checklist.preferred_appointment_block),
         notes: notes,
         assigned_dc: (selectedDC && selectedDC !== 'unassigned') ? selectedDC : undefined,
         assigned_csr: selectedCSR || csrId || undefined
       });
        appointmentId = checklist.appointment;
        console.timeEnd('⏱️ Update Existing Appointment');


      }

      // Sync to Google Calendar with selected CSR - MUST succeed
            console.time('⏱️ Sync Google Calendar');
            const csrTeamMember = csrMembers.find(m => m.id === selectedCSR);
            const syncResponse = await base44.functions.invoke('syncCalendarEvent', {
              appointmentId,
              action: 'create',
              appUrl: window.location.origin,
              csrEmail: csrTeamMember?.email
            });

            if (!syncResponse.data.success) {
              // If calendar sync failed, delete the appointment and throw error
              try {
                await base44.entities.Appointment.delete(appointmentId);
              } catch (deleteError) {
                console.error('Failed to delete appointment after calendar sync error:', deleteError);
              }
              throw new Error(syncResponse.data.error || 'Calendar sync failed. Please try again.');
            }
            console.timeEnd('⏱️ Sync Google Calendar');

      // Clear any previous RFMS sync status
      console.time('⏱️ Clear Sync Status');
      await base44.entities.Appointment.update(appointmentId, {
        rfms_sync_status: null
      });
      console.timeEnd('⏱️ Clear Sync Status');

      // Handle all post-conversion tasks in background
      base44.functions.invoke('handlePostConversion', {
        appointmentId,
        selectedDC,
        selectedCSR
      }).catch(error => {
        console.error('Post-conversion tasks failed (non-blocking):', error);
      });

      console.timeEnd('🕐 TOTAL Appointment Conversion');
      return appointmentId;
    },
    onSuccess: (appointmentId) => {
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      queryClient.invalidateQueries({ queryKey: ['checklist', id] });
      setShowScheduleDialog(false);
      setSelectedDC('');
      // Navigate to the appointment
      navigate(createPageUrl('AppointmentDetail') + `?id=${appointmentId}`);
    },
    onError: (error) => {
      // Show error dialog
      toast.error(`Failed to convert to appointment: ${error.message}`);
    }
  });

  const handleSave = () => {
    setSaveStatus('saving');
    // Trigger save from ChecklistPanel
    const saveEvent = new CustomEvent('triggerChecklistSave');
    window.dispatchEvent(saveEvent);
    
    // Show "Saved" for 2 seconds
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  const getTimeToSchedule = () => {
    if (!checklist || !appointment || appointment.status === 'Lead') {
      return null;
    }

    const startTime = new Date(checklist.created_date + (checklist.created_date.includes('Z') ? '' : 'Z'));
    const endTime = new Date(appointment.created_date + (appointment.created_date.includes('Z') ? '' : 'Z'));
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

  const isChecklistComplete = () => {
    if (!checklist) return false;
    const requiredFields = [
      'customer_first_name',
      'customer_last_name',
      'customer_phone',
      'customer_email',
      'customer_street',
      'city',
      'state',
      'postal_code',
      'other_project_notes',
      'lives_at_address',
      'verified_accuracy',
      'home_size',
      'budget_range'
    ];
    const fieldsOk = requiredFields.every(field => checklist[field]);
    const materialOk = checklist.material_type?.length > 0;
    return fieldsOk && materialOk;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!checklist) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">Checklist not found</h2>
          <Link to={createPageUrl('AppointmentSettingChecklists')}>
            <Button variant="outline">Back to Checklists</Button>
          </Link>
        </div>
      </div>
    );
  }

  const customerName = checklist.customer_first_name && checklist.customer_last_name
    ? `${checklist.customer_first_name} ${checklist.customer_last_name}`
    : 'Unnamed Customer';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl('AppointmentSettingChecklists')}>
              <Button variant="ghost" size="icon" className="rounded-xl">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground">{customerName}</h1>
              <div className="flex items-center gap-4 mt-1 flex-wrap">
                <p className="text-sm text-muted-foreground">Appointment Setting Checklist</p>
                {assignedCSR && (
                  <p className="text-sm text-primary font-medium">Booked by: {assignedCSR.first_name} {assignedCSR.last_name}</p>
                )}
                {checklist.created_date && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      Created {new Date(checklist.created_date + (checklist.created_date.includes('Z') ? '' : 'Z')).toLocaleString('en-US', {
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
                {getTimeToSchedule() && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 border border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25 rounded-lg text-xs font-medium">
                    ⚡ Converted in {getTimeToSchedule()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Action Bar */}
      <div className="sticky top-0 z-30 bg-card border-b border-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{customerName}</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {appointment && !['Lead', 'Cancelled'].includes(appointment?.status) && (
              <Link to={createPageUrl('AppointmentDetail') + `?id=${appointment.id}`}>
                <Button variant="outline" className="h-10 px-5 border-primary/30 text-primary hover:bg-primary/10">
                  <Calendar className="w-4 h-4 mr-2" />
                  View Appointment
                </Button>
              </Link>
            )}
            {(!appointment || ['Lead', 'Cancelled'].includes(appointment?.status)) && (
                    <Button
                      onClick={() => setShowScheduleDialog(true)}
                      disabled={!isChecklistComplete()}
                      className={isChecklistComplete() 
                        ? "h-10 px-5 bg-primary text-primary-foreground hover:opacity-90"
                        : "h-10 px-5 bg-secondary text-muted-foreground cursor-not-allowed"
                      }
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      Convert to Appointment
                    </Button>
                  )}
            <Button
              onClick={handleSave}
              disabled={saveStatus !== 'idle'}
              variant="outline"
              className={saveStatus === 'saved'
                ? "h-10 px-5 border-green-600 bg-green-50 text-green-600 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300"
                : "h-10 px-5 border-border hover:bg-secondary"
              }
            >
              {saveStatus === 'saving' ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : saveStatus === 'saved' ? (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Saved
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowDeleteDialog(true)}
              className="h-10 w-10 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ChecklistPanel 
          checklistId={id}
          onChecklistUpdate={() => {
            queryClient.invalidateQueries({ queryKey: ['checklist', id] });
            queryClient.invalidateQueries({ queryKey: ['appointment', checklist?.appointment] });
          }}
        />
      </div>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Checklist</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this checklist? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Convert to Appointment Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={(open) => {
        setShowScheduleDialog(open);
        if (!open) {
          setSelectedDC('');
          setSelectedCSR('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Appointment</DialogTitle>
            <DialogDescription>
              Assign team members to this appointment.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="csr" className="text-foreground">Customer Service Rep <span className="text-destructive">*</span></Label>
              <Select value={selectedCSR} onValueChange={setSelectedCSR}>
                <SelectTrigger className="h-12 border-border">
                  <SelectValue placeholder="Select CSR" />
                </SelectTrigger>
                <SelectContent>
                  {csrMembers.map((csr) => (
                    <SelectItem key={csr.id} value={csr.id}>
                      {csr.first_name} {csr.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dc" className="text-foreground">Design Consultant (Optional)</Label>
              <Select value={selectedDC} onValueChange={setSelectedDC}>
                <SelectTrigger className="h-12 border-border">
                  <SelectValue placeholder="Select Design Consultant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Leave Unassigned</SelectItem>
                  {designConsultants.map((dc) => (
                    <SelectItem key={dc.id} value={dc.id}>
                      {dc.first_name} {dc.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!selectedDC && (
                <p className="text-xs text-muted-foreground">
                  If left unassigned, the appointment status will be "Awaiting Assignment"
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => {
              setShowScheduleDialog(false);
              setSelectedDC('');
              setSelectedCSR('');
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => convertToAppointmentMutation.mutate()}
              disabled={convertToAppointmentMutation.isPending || !selectedCSR}
              className={!selectedCSR ? "bg-secondary text-muted-foreground cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}
            >
              {convertToAppointmentMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Converting...
                </>
              ) : (
                <>
                  <Calendar className="w-4 h-4 mr-2" />
                  Convert to Appointment
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}