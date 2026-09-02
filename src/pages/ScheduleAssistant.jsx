import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { fetchByIds } from '@/lib/fetchByIds';
import { deliveryNote } from '@/lib/invokeResult';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, MapPin, Loader2, AlertCircle, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { SignedImage } from '@/lib/fileUrl';
import { format, parseISO, startOfWeek, addDays, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const TIME_BLOCKS = [
  { id: '9am to 11am', label: '9–11am' },
  { id: '12pm to 2pm', label: '12–2pm' },
  { id: '3pm to 5pm', label: '3–5pm' },
  { id: '6pm to 8pm', label: '6–8pm' }
];

// Default colors - will be fetched from settings
const DEFAULT_TIME_BLOCK_COLORS = {
  '9am to 11am': '#DBEAFE',
  '12pm to 2pm': '#F1F5F9',
  '3pm to 5pm': '#FED7AA',
  '6pm to 8pm': '#DCFCE7'
};

const getColorStyles = (hexColor) => {
  return {
    bg: hexColor,
    border: hexColor,
    hover: hexColor,
    header: hexColor
  };
};

const STATUS_COLORS = {
  'Lead': 'bg-secondary text-foreground border-border',
  'Awaiting Assignment': 'bg-warn/12 text-warn border-warn/25',
  'Scheduled': 'bg-info/12 text-info border-info/25',
  'Rescheduled': 'bg-primary/10 text-primary border-primary/20',
  'Completed': 'bg-good/12 text-good border-good/25',
  'Sold': 'bg-good/12 text-good border-good/25',
  'Cancelled': 'bg-crit/12 text-crit border-crit/25'
};

export default function ScheduleAssistant() {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [viewMode, setViewMode] = useState('week');
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [notifyConsultant, setNotifyConsultant] = useState(true);
  const [syncCalendar, setSyncCalendar] = useState(true);

  const { data: consultants = [], isLoading: loadingConsultants } = useQuery({
    queryKey: ['activeConsultants'],
    queryFn: async () => {
      const allMembers = await base44.entities.TeamMember.filter({ 
        is_active: true 
      });
      const members = allMembers.filter(m => 
        m.role === 'Design Consultant' || m.role === 'Sales Manager'
      );
      return members.sort((a, b) => 
        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
      );
    }
  });

  const getWeekDates = () => {
    const start = startOfWeek(parseISO(selectedDate), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'));
  };

  const weekDates = viewMode === 'week' ? getWeekDates() : [selectedDate];

  const { data: appointments = [], isLoading: loadingAppointments } = useQuery({
    queryKey: ['appointments', viewMode, selectedDate],
    queryFn: async () => {
      if (viewMode === 'day') {
        const appts = await base44.entities.Appointment.filter({
          appointment_date: selectedDate
        });
        return appts.filter(a => a.status !== 'Cancelled');
      } else {
        const allAppts = await base44.entities.Appointment.list();
        return allAppts.filter(a => 
          a.status !== 'Cancelled' && 
          weekDates.includes(a.appointment_date)
        );
      }
    },
    enabled: !!selectedDate
  });

  // Only the leads for the appointments in the visible window.
  const leadIds = useMemo(
    () => [...new Set(appointments.map(a => a.customer).filter(Boolean))].sort(),
    [appointments],
  );

  const { data: leads = [] } = useQuery({
    queryKey: ['leadsByIds', leadIds],
    queryFn: () => fetchByIds('Lead', leadIds),
    enabled: leadIds.length > 0,
  });

  const { data: checklists = [] } = useQuery({
    queryKey: ['checklists'],
    queryFn: () => base44.entities.AppointmentSettingChecklist.list()
  });

  const { data: checklistsV2 = [] } = useQuery({
    queryKey: ['checklistsV2'],
    queryFn: () => base44.entities.ChecklistV2.list()
  });

  const { data: timeBlockSettings } = useQuery({
    queryKey: ['timeBlockSettings'],
    queryFn: async () => {
      const allSettings = await base44.entities.TimeBlockSettings.list();
      return allSettings[0] || null;
    }
  });

  // Build TIME_BLOCK_COLORS dynamically from settings
  const TIME_BLOCK_COLORS = React.useMemo(() => {
    const settings = timeBlockSettings || {};
    const colors = {
      '9am to 11am': DEFAULT_TIME_BLOCK_COLORS['9am to 11am'],
      '12pm to 2pm': DEFAULT_TIME_BLOCK_COLORS['12pm to 2pm'],
      '3pm to 5pm': DEFAULT_TIME_BLOCK_COLORS['3pm to 5pm'],
      '6pm to 8pm': DEFAULT_TIME_BLOCK_COLORS['6pm to 8pm']
    };

    if (settings.time_block_9am_11am_color) colors['9am to 11am'] = settings.time_block_9am_11am_color;
    if (settings.time_block_12pm_2pm_color) colors['12pm to 2pm'] = settings.time_block_12pm_2pm_color;
    if (settings.time_block_3pm_5pm_color) colors['3pm to 5pm'] = settings.time_block_3pm_5pm_color;
    if (settings.time_block_6pm_8pm_color) colors['6pm to 8pm'] = settings.time_block_6pm_8pm_color;

    return Object.entries(colors).reduce((acc, [key, hexColor]) => {
      const styles = getColorStyles(hexColor);
      acc[key] = {
        bg: styles.bg,
        border: styles.border,
        hover: styles.hover,
        header: styles.header,
        hex: hexColor
      };
      return acc;
    }, {});
  }, [timeBlockSettings]);

  const updateAppointmentMutation = useMutation({
    mutationFn: async ({ appointmentId, updates, options }) => {
      console.time('🕐 TOTAL Schedule Assistant Assignment');
      
      console.time('⏱️ Update Appointment Entity');
      await base44.entities.Appointment.update(appointmentId, updates);
      console.timeEnd('⏱️ Update Appointment Entity');

      if (options.notifyConsultant && updates.assigned_dc) {
        console.time('⏱️ Send SMS Notifications');
        try {
          // The appointment row is already updated above, so a notification
          // problem must never throw — it only gets said out loud.
          const consultantRes = await base44.functions.invoke('sendAppointmentSMS', {
            appointmentId,
            type: 'consultant'
          });
          const consultantNote = deliveryNote(consultantRes, {
            saved: 'Appointment updated',
            sent: 'the text to the consultant did not go out'
          });
          if (consultantNote) toast.warning(consultantNote);

          // Notify lead about their assigned consultant
          const leadRes = await base44.functions.invoke('sendAppointmentSMS', {
            appointmentId,
            type: 'lead_consultant_assigned'
          });
          const leadNote = deliveryNote(leadRes, {
            saved: 'Appointment updated',
            sent: 'the customer was not told who is coming'
          });
          if (leadNote) toast.warning(leadNote);
        } catch (error) {
          console.error('Failed to send consultant SMS:', error);
        }
        console.timeEnd('⏱️ Send SMS Notifications');
      } else if (options.notifyCustomer) {
        console.time('⏱️ Send Customer SMS');
        try {
          const customerRes = await base44.functions.invoke('sendAppointmentSMS', {
            appointmentId,
            type: 'lead'
          });
          const customerNote = deliveryNote(customerRes, {
            saved: 'Appointment updated',
            sent: 'the text to the customer did not go out'
          });
          if (customerNote) toast.warning(customerNote);
        } catch (error) {
          console.error('Failed to send customer SMS:', error);
        }
        console.timeEnd('⏱️ Send Customer SMS');
      }

      if (options.syncCalendar) {
        console.time('⏱️ Sync Google Calendar');
        try {
          const calRes = await base44.functions.invoke('syncCalendarEvent', {
            appointmentId,
            action: 'update',
            appUrl: window.location.origin
          });
          const calNote = deliveryNote(calRes, {
            saved: 'Appointment updated',
            sent: 'the calendar was not updated'
          });
          if (calNote) toast.warning(calNote);
        } catch (error) {
          console.error('Failed to sync calendar:', error);
        }
        console.timeEnd('⏱️ Sync Google Calendar');
      }

      console.timeEnd('🕐 TOTAL Schedule Assistant Assignment');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments', viewMode, selectedDate] });
      setConfirmDialog(null);
      toast.success('Appointment updated successfully');
    },
    onError: (error) => {
      toast.error('Failed to update appointment');
      console.error(error);
    }
  });

  const getLeadForAppointment = (appointment) => {
    return leads.find(l => l.id === appointment.customer);
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const { source, destination, draggableId } = result;

    if (source.droppableId === destination.droppableId) return;

    const appointment = appointments.find(a => a.id === draggableId);
    if (!appointment) return;

    const destParts = destination.droppableId.split('|');
    const sourceParts = source.droppableId.split('|');
    
    const destConsultantId = destParts[0];
    const destBlock = destParts[1];
    const destDate = destParts[2] || selectedDate;
    
    const sourceConsultantId = sourceParts[0];
    const sourceBlock = sourceParts[1];
    const sourceDate = sourceParts[2] || selectedDate;

    const oldConsultant = sourceConsultantId === 'unassigned' 
      ? 'Unassigned' 
      : consultants.find(c => c.id === sourceConsultantId);
    const newConsultant = destConsultantId === 'unassigned' 
      ? 'Unassigned' 
      : consultants.find(c => c.id === destConsultantId);

    // Check for double-booking
    if (destConsultantId !== 'unassigned') {
      const dateAppointments = appointments.filter(a => a.appointment_date === destDate);
      const conflictingAppt = dateAppointments.find(a => 
        a.assigned_dc === destConsultantId && 
        a.appointment_block === destBlock &&
        a.id !== appointment.id
      );
      
      if (conflictingAppt) {
        const conflictLead = leads.find(l => l.id === conflictingAppt.customer);
        setConfirmDialog({
          appointment,
          from: {
            consultant: oldConsultant,
            block: sourceBlock,
            date: sourceDate
          },
          to: {
            consultant: newConsultant,
            block: destBlock,
            date: destDate
          },
          updates: {
            assigned_dc: destConsultantId === 'unassigned' ? null : destConsultantId,
            appointment_block: destBlock,
            appointment_date: destDate,
            status: destConsultantId === 'unassigned' ? 'Awaiting Assignment' : 'Scheduled'
          },
          doubleBookWarning: {
            conflictingAppt,
            conflictLead
          }
        });
        return;
      }
    }

    setConfirmDialog({
      appointment,
      from: {
        consultant: oldConsultant,
        block: sourceBlock,
        date: sourceDate
      },
      to: {
        consultant: newConsultant,
        block: destBlock,
        date: destDate
      },
      updates: {
        assigned_dc: destConsultantId === 'unassigned' ? null : destConsultantId,
        appointment_block: destBlock,
        appointment_date: destDate,
        status: destConsultantId === 'unassigned' ? 'Awaiting Assignment' : 'Scheduled'
      }
    });
  };

  const handleConfirm = () => {
    if (!confirmDialog) return;

    updateAppointmentMutation.mutate({
      appointmentId: confirmDialog.appointment.id,
      updates: confirmDialog.updates,
      options: {
        notifyCustomer,
        notifyConsultant,
        syncCalendar
      }
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Schedule Assistant</h1>
              <p className="text-muted-foreground mt-1">Drag and drop to assign appointments</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Tabs value={viewMode} onValueChange={setViewMode}>
              <TabsList>
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2 mt-5">
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  const newDate = addDays(parseISO(selectedDate), viewMode === 'week' ? -7 : -1);
                  setSelectedDate(format(newDate, 'yyyy-MM-dd'));
                }}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  const newDate = addDays(parseISO(selectedDate), viewMode === 'week' ? 7 : 1);
                  setSelectedDate(format(newDate, 'yyyy-MM-dd'));
                }}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full sm:w-48"
              />
            </div>
            <Button
              onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}
              variant="outline"
              className="mt-5"
            >
              Today
            </Button>
            <div className="flex-1" />
            <div className="text-sm text-muted-foreground">
              {viewMode === 'day'
                ? format(parseISO(selectedDate), 'EEEE, MMMM d, yyyy')
                : `Week of ${format(startOfWeek(parseISO(selectedDate), { weekStartsOn: 0 }), 'MMMM d, yyyy')}`
              }
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {(loadingConsultants || loadingAppointments) ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : viewMode === 'day' ? (
          <DayView 
             consultants={consultants}
             appointments={appointments}
             leads={leads}
             checklists={checklists}
             checklistsV2={checklistsV2}
             onDragEnd={handleDragEnd}
             timeBlockColors={TIME_BLOCK_COLORS}
             queryClient={queryClient}
             viewMode={viewMode}
             selectedDate={selectedDate}
             setConfirmDialog={setConfirmDialog}
           />
         ) : (
           <WeekView 
             consultants={consultants}
             appointments={appointments}
             weekDates={weekDates}
             leads={leads}
             checklists={checklists}
             checklistsV2={checklistsV2}
             onDragEnd={handleDragEnd}
             timeBlockColors={TIME_BLOCK_COLORS}
             queryClient={queryClient}
             viewMode={viewMode}
             selectedDate={selectedDate}
             setConfirmDialog={setConfirmDialog}
           />
        )}
      </div>

      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
         <DialogContent className="max-w-md">
           <DialogHeader>
             <DialogTitle>
               {confirmDialog?.doubleBookWarning ? (
                 <span className="flex items-center gap-2 text-warn">
                   <AlertCircle className="w-5 h-5" />
                   Double Booking Warning
                 </span>
               ) : (
                 'Confirm Appointment Move'
               )}
             </DialogTitle>
             <DialogDescription>
               {confirmDialog?.doubleBookWarning 
                 ? 'This consultant already has an appointment at this time'
                 : 'Review the changes before updating the appointment'
               }
             </DialogDescription>
           </DialogHeader>

           {confirmDialog && (
             <div className="space-y-4 py-4">
               {confirmDialog.doubleBookWarning && (
                 <div className="p-3 rounded-lg bg-warn/12 border border-warn/25">
                   <p className="text-sm font-semibold text-warn mb-2">Existing Appointment:</p>
                   <p className="text-sm text-warn">
                     {confirmDialog.doubleBookWarning.conflictLead?.first_name} {confirmDialog.doubleBookWarning.conflictLead?.last_name}
                   </p>
                   <p className="text-xs text-warn mt-1">
                     Same time block on {format(parseISO(confirmDialog.appointment.appointment_date), 'MMM d')}
                   </p>
                 </div>
               )}
               {!confirmDialog.doubleBookWarning && (
                 <>
                   <div className="p-3 rounded-lg bg-secondary border border-border">
                     <p className="font-semibold text-foreground mb-1">
                       {getLeadForAppointment(confirmDialog.appointment)?.first_name || 'Unknown'} {getLeadForAppointment(confirmDialog.appointment)?.last_name || 'Customer'}
                     </p>
                     <p className="text-sm text-muted-foreground">
                       {confirmDialog.appointment.location_address}
                     </p>
                   </div>

                   <div className="space-y-2">
                     <div className="flex items-center gap-2 text-sm flex-wrap">
                       <span className="text-muted-foreground">From:</span>
                       <span className="font-medium text-foreground">
                         {typeof confirmDialog.from.consultant === 'string' 
                           ? confirmDialog.from.consultant 
                           : `${confirmDialog.from.consultant.first_name} ${confirmDialog.from.consultant.last_name}`}
                       </span>
                       <span className="text-muted-foreground">•</span>
                       <span className="font-medium text-foreground">{confirmDialog.from.block}</span>
                       {confirmDialog.from.date !== confirmDialog.to.date && (
                         <>
                           <span className="text-muted-foreground">•</span>
                           <span className="font-medium text-foreground">{format(parseISO(confirmDialog.from.date), 'MMM d')}</span>
                         </>
                       )}
                     </div>
                     <div className="flex items-center gap-2 text-sm flex-wrap">
                       <span className="text-muted-foreground">To:</span>
                       <span className="font-medium text-primary">
                         {typeof confirmDialog.to.consultant === 'string' 
                           ? confirmDialog.to.consultant 
                           : `${confirmDialog.to.consultant.first_name} ${confirmDialog.to.consultant.last_name}`}
                       </span>
                       <span className="text-muted-foreground">•</span>
                       <span className="font-medium text-primary">{confirmDialog.to.block}</span>
                       {confirmDialog.from.date !== confirmDialog.to.date && (
                         <>
                           <span className="text-muted-foreground">•</span>
                           <span className="font-medium text-primary">{format(parseISO(confirmDialog.to.date), 'MMM d')}</span>
                         </>
                       )}
                     </div>
                   </div>
                 </>
               )}

               <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify-customer" className="text-sm">Send customer SMS</Label>
                  <Switch
                    id="notify-customer"
                    checked={notifyCustomer}
                    onCheckedChange={setNotifyCustomer}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify-consultant" className="text-sm">Notify consultant</Label>
                  <Switch
                    id="notify-consultant"
                    checked={notifyConsultant}
                    onCheckedChange={setNotifyConsultant}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="sync-calendar" className="text-sm">Sync calendar</Label>
                  <Switch
                    id="sync-calendar"
                    checked={syncCalendar}
                    onCheckedChange={setSyncCalendar}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog(null)}
              disabled={updateAppointmentMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={updateAppointmentMutation.isPending}
              className={confirmDialog?.doubleBookWarning ? "bg-warn hover:bg-warn" : "bg-primary text-primary-foreground hover:opacity-90"}
            >
              {updateAppointmentMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : confirmDialog?.doubleBookWarning ? (
                'Proceed Anyway'
              ) : (
                'Confirm'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DayView({ consultants, appointments, leads, checklists, checklistsV2 = [], onDragEnd, timeBlockColors, queryClient, viewMode, selectedDate, setConfirmDialog }) {
  const organizeAppointments = () => {
    const organized = { unassigned: {} };

    consultants.forEach(consultant => {
      organized[consultant.id] = {};
      TIME_BLOCKS.forEach(block => {
        organized[consultant.id][block.id] = [];
      });
    });

    TIME_BLOCKS.forEach(block => {
      organized.unassigned[block.id] = [];
    });

    appointments.forEach(appointment => {
      if (!appointment.appointment_block) return;

      if (!appointment.assigned_dc) {
        if (!organized.unassigned[appointment.appointment_block]) {
          organized.unassigned[appointment.appointment_block] = [];
        }
        organized.unassigned[appointment.appointment_block].push(appointment);
      } else {
        if (organized[appointment.assigned_dc]) {
          organized[appointment.assigned_dc][appointment.appointment_block].push(appointment);
        }
      }
    });

    return organized;
  };

  const getLeadForAppointment = (appointment) => {
    return leads.find(l => l.id === appointment.customer);
  };

  const getChecklistForAppointment = (appointment) => {
    return checklists.find(c => c.appointment === appointment.id) || null;
  };

  const getChecklistV2ForAppointment = (appointment) => {
    return checklistsV2.find(c => c.appointment === appointment.id) || null;
  };

  const organized = organizeAppointments();

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="bg-white rounded-xl border border-border overflow-x-auto">
        <div className="grid grid-cols-[250px_repeat(4,minmax(200px,1fr))] border-b border-border bg-muted">
          <div className="p-4 font-semibold text-foreground sticky left-0 bg-muted z-20">Consultant</div>
          {TIME_BLOCKS.map(block => {
            const blockAppts = appointments.filter(a => a.appointment_block === block.id);
            return (
            <div 
              key={block.id} 
              className="p-4 text-center font-semibold text-foreground border-l border-border"
              style={{ backgroundColor: timeBlockColors[block.id].header }}
            >
              {block.label}
              <div className="text-xs text-muted-foreground mt-1">{blockAppts.length} appointment{blockAppts.length !== 1 ? 's' : ''}</div>
            </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[250px_repeat(4,minmax(200px,1fr))] border-b-2 border-warn/25 bg-warn/12">
          <div className="p-4 flex items-center gap-3 sticky left-0 bg-warn/12 z-10">
            <div className="w-10 h-10 rounded-full bg-warn/12 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-warn" />
            </div>
            <span className="font-semibold text-foreground">Unassigned</span>
          </div>
          {TIME_BLOCKS.map(block => (
            <Droppable key={`unassigned|${block.id}`} droppableId={`unassigned|${block.id}`}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    "p-2 border-l border-border min-h-[80px]",
                    snapshot.isDraggingOver && "bg-warn/12"
                  )}
                >
                  <div className="space-y-2">
                    {organized.unassigned[block.id]?.map((appointment, index) => {
                      const lead = getLeadForAppointment(appointment);
                      const checklist = getChecklistForAppointment(appointment);
                      return (
                        <Draggable key={appointment.id} draggableId={appointment.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={cn(
                                "bg-white rounded-lg border p-2 cursor-move hover:shadow-md transition-shadow",
                                snapshot.isDragging && "shadow-xl opacity-90"
                              )}
                            >
                              <AppointmentCard appointment={appointment} lead={lead} checklist={checklist} checklistV2={getChecklistV2ForAppointment(appointment)} compact consultants={consultants} queryClient={queryClient} viewMode={viewMode} selectedDate={selectedDate} setConfirmDialog={setConfirmDialog} appointments={appointments} leads={leads} />
                              </div>
                              )}
                              </Draggable>
                              );
                              })}
                              </div>
                              {provided.placeholder}
                              </div>
                              )}
                              </Droppable>
                              ))}
                              </div>

                              {consultants.map(consultant => (
                              <div key={consultant.id} className="grid grid-cols-[250px_repeat(4,minmax(200px,1fr))] border-b border-border hover:bg-muted">
                              <div className="p-4 flex items-center gap-3 sticky left-0 bg-white hover:bg-muted z-10">
                              {consultant.profile_photo ? (
                              <SignedImage
                              src={consultant.profile_photo}
                              alt={consultant.first_name}
                              className="w-10 h-10 rounded-full object-cover"
                              />
                              ) : (
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <User className="w-5 h-5 text-primary" />
                              </div>
                              )}
                              <span className="font-medium text-foreground">
                              {consultant.first_name} {consultant.last_name}
                              </span>
                              </div>
                              {TIME_BLOCKS.map(block => {
                              const appts = organized[consultant.id][block.id];
                              const blockColor = timeBlockColors[block.id];
                              return (
                              <Droppable key={`${consultant.id}|${block.id}`} droppableId={`${consultant.id}|${block.id}`}>
                              {(provided, snapshot) => (
                              <div
                              ref={provided.innerRef}
                              {...provided.droppableProps}
                              className="p-2 border-l min-h-[80px]"
                              style={{
                              backgroundColor: blockColor.bg,
                              borderLeftColor: blockColor.border,
                              borderLeftWidth: '1px'
                              }}>
                              <div className="space-y-2">
                              {appts.map((appointment, index) => (
                              <Draggable key={appointment.id} draggableId={appointment.id} index={index}>
                              {(provided, snapshot) => (
                              <div
                               ref={provided.innerRef}
                               {...provided.draggableProps}
                               {...provided.dragHandleProps}
                               className={cn(
                                 "bg-white rounded-lg border p-2 cursor-move hover:shadow-md transition-shadow",
                                 snapshot.isDragging && "shadow-xl opacity-90",
                                 appts.length > 1 && "border-warn border-l-4"
                               )}
                              >
                               <AppointmentCard 
                                  appointment={appointment} 
                                  lead={getLeadForAppointment(appointment)}
                                  checklist={getChecklistForAppointment(appointment)}
                                  checklistV2={getChecklistV2ForAppointment(appointment)}
                                  dcColor={consultant.calendar_color}
                                  consultants={consultants}
                                  queryClient={queryClient}
                                  viewMode={viewMode}
                                  selectedDate={selectedDate}
                                  setConfirmDialog={setConfirmDialog}
                                  appointments={appointments}
                                  leads={leads}
                                />
                              </div>
                              )}
                              </Draggable>
                              ))}
                              </div>
                              {provided.placeholder}
                              </div>
                              )}
                              </Droppable>
                              );
                              })}
                            </div>
                            ))}
                            </div>
                            </DragDropContext>
                            );
                            }

                            function WeekView({ consultants, appointments, weekDates, leads, checklists, checklistsV2 = [], onDragEnd, timeBlockColors, queryClient, viewMode, selectedDate, setConfirmDialog }) {
  const organizeAppointmentsByDate = (date) => {
    const organized = { unassigned: {} };

    consultants.forEach(consultant => {
      organized[consultant.id] = {};
      TIME_BLOCKS.forEach(block => {
        organized[consultant.id][block.id] = [];
      });
    });

    TIME_BLOCKS.forEach(block => {
      organized.unassigned[block.id] = [];
    });

    const dateAppointments = appointments.filter(a => a.appointment_date === date);

    dateAppointments.forEach(appointment => {
      if (!appointment.appointment_block) return;

      if (!appointment.assigned_dc) {
        if (!organized.unassigned[appointment.appointment_block]) {
          organized.unassigned[appointment.appointment_block] = [];
        }
        organized.unassigned[appointment.appointment_block].push(appointment);
      } else {
        if (organized[appointment.assigned_dc]) {
          organized[appointment.assigned_dc][appointment.appointment_block].push(appointment);
        }
      }
    });

    return organized;
  };

  const getLeadForAppointment = (appointment) => {
    return leads.find(l => l.id === appointment.customer);
  };

  const getChecklistForAppointment = (appointment) => {
    return checklists.find(c => c.appointment === appointment.id) || null;
  };

  const getChecklistV2ForAppointment = (appointment) => {
    return checklistsV2.find(c => c.appointment === appointment.id) || null;
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="bg-white rounded-xl border border-border overflow-x-auto">
        <div className="grid grid-cols-[80px_200px_repeat(7,minmax(150px,1fr))] border-b border-border bg-muted sticky top-0 z-30">
          <div className="p-3 font-semibold text-foreground text-xs sticky left-0 bg-muted z-20">Time</div>
          <div className="p-3 font-semibold text-foreground border-l border-border sticky left-[80px] bg-muted z-20">Consultant</div>
          {weekDates.map(date => {
            const dayAppts = appointments.filter(a => a.appointment_date === date);
            return (
            <div key={date} className="p-3 text-center border-l border-border">
              <div className="font-semibold text-foreground">{format(parseISO(date), 'EEE')}</div>
              <div className={cn(
                "text-sm",
                isSameDay(parseISO(date), new Date()) ? "text-primary font-semibold" : "text-muted-foreground"
              )}>
                {format(parseISO(date), 'MMM d')}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{dayAppts.length} appointment{dayAppts.length !== 1 ? 's' : ''}</div>
            </div>
            );
          })}
        </div>

        {TIME_BLOCKS.map((timeBlock, blockIndex) => {
           const blockColor = timeBlockColors[timeBlock.id];
           return (
           <div key={timeBlock.id}>
             <div 
               className="grid grid-cols-[80px_200px_repeat(7,minmax(150px,1fr))] border-b-2"
               style={{ borderBottomColor: blockColor.border }}
             >
               <div 
                 className="p-3 flex items-center justify-center border-r sticky left-0 z-10"
                 style={{ 
                   backgroundColor: blockColor.bg,
                   borderRightColor: blockColor.border,
                   borderRightWidth: '1px'
                 }}
               >
                 <span className="font-semibold text-xs text-foreground writing-mode-vertical transform -rotate-0">
                   {timeBlock.label}
                 </span>
               </div>
               <div 
                 className="p-3 flex items-center gap-2 border-l sticky left-[80px] z-10"
                 style={{
                   backgroundColor: blockColor.bg,
                   borderLeftColor: blockColor.border,
                   borderLeftWidth: '1px'
                 }}
               >
                 <div 
                   className="w-8 h-8 rounded-full flex items-center justify-center"
                   style={{ backgroundColor: blockColor.header }}
                 >
                   <AlertCircle className="w-4 h-4 text-foreground" />
                </div>
                <span className="font-semibold text-sm text-foreground">Unassigned</span>
              </div>
              {weekDates.map(date => {
               const organized = organizeAppointmentsByDate(date);
               return (
                 <Droppable key={`unassigned|${timeBlock.id}|${date}`} droppableId={`unassigned|${timeBlock.id}|${date}`}>
                   {(provided, snapshot) => (
                     <div
                       ref={provided.innerRef}
                       {...provided.droppableProps}
                       className="p-1 min-h-[60px] border-l border-border"
                       style={{
                         backgroundColor: snapshot.isDraggingOver ? blockColor.hover : blockColor.bg
                       }}
                      >
                        <div className="space-y-1">
                          {organized.unassigned[timeBlock.id]?.map((appointment, index) => {
                            const lead = getLeadForAppointment(appointment);
                            const checklist = getChecklistForAppointment(appointment);
                            return (
                              <Draggable key={appointment.id} draggableId={appointment.id} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    className={cn(
                                      "bg-white rounded border p-1.5 cursor-move",
                                      snapshot.isDragging && "shadow-xl opacity-90"
                                    )}
                                  >
                                    <AppointmentCard appointment={appointment} lead={lead} checklist={checklist} checklistV2={getChecklistV2ForAppointment(appointment)} compact consultants={consultants} queryClient={queryClient} viewMode={viewMode} selectedDate={selectedDate} setConfirmDialog={setConfirmDialog} appointments={appointments} leads={leads} />
                                    </div>
                                    )}
                                    </Draggable>
                                    );
                                    })}
                                    </div>
                                    {provided.placeholder}
                                    </div>
                                    )}
                                    </Droppable>
                                    );
                                    })}
                                    </div>

                                    {consultants.map(consultant => (
                                    <div key={`${consultant.id}-${timeBlock.id}`} className="grid grid-cols-[80px_200px_repeat(7,minmax(150px,1fr))] border-b border-border hover:bg-muted">
                                    <div className="bg-muted sticky left-0 z-10" />
                                    <div className="p-3 flex items-center gap-2 border-l border-border sticky left-[80px] bg-white hover:bg-muted z-10">
                                    {consultant.profile_photo ? (
                                    <SignedImage
                                    src={consultant.profile_photo}
                                    alt={consultant.first_name}
                                    className="w-8 h-8 rounded-full object-cover"
                                    />
                                    ) : (
                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                    <User className="w-4 h-4 text-primary" />
                                    </div>
                                    )}
                                    <span className="font-medium text-sm text-foreground truncate">
                                    {consultant.first_name} {consultant.last_name}
                                    </span>
                                    </div>
                                    {weekDates.map(date => {
                                    const organized = organizeAppointmentsByDate(date);
                                    const appts = organized[consultant.id][timeBlock.id];
                                    return (
                                    <Droppable key={`${consultant.id}|${timeBlock.id}|${date}`} droppableId={`${consultant.id}|${timeBlock.id}|${date}`}>
                                    {(provided, snapshot) => (
                                    <div
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                    className="p-1 min-h-[60px] border-l border-border"
                                    style={{
                                    backgroundColor: snapshot.isDraggingOver ? blockColor.hover : blockColor.bg
                                    }}
                                    >
                                    <div className="space-y-1">
                                    {appts.map((appointment, index) => (
                                    <Draggable key={appointment.id} draggableId={appointment.id} index={index}>
                                    {(provided, snapshot) => (
                                    <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    className={cn(
                                     "bg-white rounded border p-1.5 cursor-move",
                                     snapshot.isDragging && "shadow-xl opacity-90",
                                     appts.length > 1 && "border-warn border-l-2"
                                    )}
                                    >
                                    <AppointmentCard 
                                      appointment={appointment} 
                                      lead={getLeadForAppointment(appointment)}
                                      checklist={getChecklistForAppointment(appointment)}
                                      checklistV2={getChecklistV2ForAppointment(appointment)}
                                      compact
                                      dcColor={consultant.calendar_color}
                                      consultants={consultants}
                                      queryClient={queryClient}
                                      viewMode={viewMode}
                                      selectedDate={selectedDate}
                                      setConfirmDialog={setConfirmDialog}
                                      appointments={appointments}
                                      leads={leads}
                                    />
                                    </div>
                                    )}
                                    </Draggable>
                                    ))}
                                    </div>
                                    {provided.placeholder}
                                    </div>
                                    )}
                                    </Droppable>
                                    );
                                    })}
              </div>
            ))}
            </div>
            );
            })}
      </div>
    </DragDropContext>
  );
}

function AppointmentCard({ appointment, lead, checklist, checklistV2 = null, compact = false, dcColor = null, consultants = [], queryClient = null, viewMode = null, selectedDate = null, setConfirmDialog = null, appointments = [], leads = [] }) {
   const [doubleBookWarning, setDoubleBookWarning] = React.useState(null);
   const [showNotesModal, setShowNotesModal] = React.useState(false);

   if (!lead) return null;

   // Use DC's custom color if available, otherwise use default border style
   const cardStyle = dcColor ? {
     borderLeftWidth: '4px',
     borderLeftColor: dcColor
   } : {};

   // Format date and time block
   const appointmentDate = appointment.appointment_date ? format(parseISO(appointment.appointment_date), 'MMM d') : '';
   const timeBlockLabel = TIME_BLOCKS.find(b => b.id === appointment.appointment_block)?.label || appointment.appointment_block;

   const handleAssign = (consultantId) => {
     if (!setConfirmDialog) return;

     // Check for conflicts if assigning to a consultant
     if (consultantId) {
       const conflictingAppt = appointments.find(a => 
         a.assigned_dc === consultantId && 
         a.appointment_block === appointment.appointment_block &&
         a.appointment_date === appointment.appointment_date &&
         a.id !== appointment.id
       );

       if (conflictingAppt) {
         const conflictLead = leads.find(l => l.id === conflictingAppt.customer);
         setDoubleBookWarning({
           consultantId,
           conflictingAppt,
           conflictLead
         });
         return;
       }
     }

     proceedWithAssignment(consultantId);
   };

  const proceedWithAssignment = (consultantId) => {
    const oldConsultant = appointment.assigned_dc
      ? consultants.find(c => c.id === appointment.assigned_dc)
      : 'Unassigned';
    const newConsultant = consultantId
      ? consultants.find(c => c.id === consultantId)
      : 'Unassigned';

    setConfirmDialog({
      appointment,
      from: {
        consultant: oldConsultant,
        block: appointment.appointment_block,
        date: appointment.appointment_date
      },
      to: {
        consultant: newConsultant,
        block: appointment.appointment_block,
        date: appointment.appointment_date
      },
      updates: {
        assigned_dc: consultantId || null,
        appointment_block: appointment.appointment_block,
        appointment_date: appointment.appointment_date,
        status: consultantId ? 'Scheduled' : 'Awaiting Assignment'
      }
    });
    setDoubleBookWarning(null);
  };

  return (
    <>
      <div className="space-y-1 relative" style={cardStyle}>
        <p className={cn(
          "font-semibold text-foreground truncate",
          compact ? "text-xs" : "text-sm"
        )}>
          {lead.first_name} {lead.last_name}
        </p>
        <div className={cn("text-muted-foreground flex items-center gap-1", compact ? "text-[10px]" : "text-xs")}>
          {appointmentDate && <span>{appointmentDate}</span>}
          {timeBlockLabel && <span>•</span>}
          {timeBlockLabel && <span>{timeBlockLabel}</span>}
        </div>
        {!compact && appointment.location_address && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{appointment.location_address.split(',')[0]}</span>
          </p>
        )}
        {checklist && (
          <div className={cn("space-y-0.5 text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>
            {checklist.city && (
              <p className="truncate">📍 {checklist.city}{checklist.postal_code ? `, ${checklist.postal_code}` : ''}</p>
            )}
            {checklist.number_of_rooms && (
              <p>🏠 {checklist.number_of_rooms} rooms</p>
            )}
            {checklist.project_budget && (
              <p className="truncate">💰 {checklist.project_budget}</p>
            )}
            {checklist.flooring_products && checklist.flooring_products.length > 0 && (
              <p className="truncate">🛠️ {checklist.flooring_products.join(', ')}</p>
            )}
          </div>
        )}
        {!checklist && checklistV2 && (
          <div className={cn("space-y-0.5 text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>
            {checklistV2.city && (
              <p className="truncate">📍 {checklistV2.city}{checklistV2.postal_code ? `, ${checklistV2.postal_code}` : ''}</p>
            )}
            {checklistV2.scope_gap_fill_notes && (
              <p className="truncate">🏠 {checklistV2.scope_gap_fill_notes}</p>
            )}
            {checklistV2.discovery_q3 && (
              <p className="truncate">🎨 {checklistV2.discovery_q3}</p>
            )}
            {checklistV2.scope_flooring_products && checklistV2.scope_flooring_products.length > 0 && (
              <p className="truncate">🛠️ {checklistV2.scope_flooring_products.join(', ')}</p>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={cn("text-xs", STATUS_COLORS[appointment.status])}>
            {appointment.status}
          </Badge>
          {consultants.length > 0 && (
            <Select value={appointment.assigned_dc || ''} onValueChange={handleAssign}>
              <SelectTrigger className={cn("h-6 text-xs w-auto", compact && "text-[10px]")}>
                <SelectValue placeholder="Assign" />
              </SelectTrigger>
              <SelectContent className="w-48">
                <SelectItem value={null}>Unassigned</SelectItem>
                {consultants.map(consultant => (
                  <SelectItem key={consultant.id} value={consultant.id}>
                    {consultant.first_name} {consultant.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {appointment.notes && appointment.notes.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowNotesModal(true); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-[10px] text-primary hover:text-primary underline flex-shrink-0"
            >
              Notes ({appointment.notes.length})
            </button>
          )}
          <Link
            to={createPageUrl('AppointmentDetail') + `?id=${appointment.id}`}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-5 h-5 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition-colors flex-shrink-0 ml-auto"
          >
            <ArrowRight className="w-2.5 h-2.5 text-primary" />
          </Link>
        </div>
      </div>

      <Dialog open={showNotesModal} onOpenChange={setShowNotesModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Notes — {lead.first_name} {lead.last_name}</DialogTitle>
            <DialogDescription>{appointment.appointment_date} · {appointment.appointment_block}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-96 overflow-y-auto py-2">
            {[...(appointment.notes || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((note, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-secondary border border-border">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-medium text-primary">{note.context || 'Note'}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(note.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                  </span>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                <p className="text-xs text-muted-foreground mt-1">{note.user_name}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!doubleBookWarning} onOpenChange={() => setDoubleBookWarning(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-warn">
              <AlertCircle className="w-5 h-5" />
              Double Booking Warning
            </DialogTitle>
            <DialogDescription>
              This consultant already has an appointment at this time
            </DialogDescription>
          </DialogHeader>

          {doubleBookWarning && (
            <div className="space-y-4 py-4">
              <div className="p-3 rounded-lg bg-warn/12 border border-warn/25">
                <p className="text-sm font-semibold text-warn mb-2">Existing Appointment:</p>
                <p className="text-sm text-warn">
                  {doubleBookWarning.conflictLead?.first_name} {doubleBookWarning.conflictLead?.last_name}
                </p>
                <p className="text-xs text-warn mt-1">
                  Same time block on {format(parseISO(appointment.appointment_date), 'MMM d')}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Do you want to proceed with this double booking?
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDoubleBookWarning(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => doubleBookWarning && proceedWithAssignment(doubleBookWarning.consultantId)}
              className="bg-warn hover:bg-warn"
            >
              Proceed Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}