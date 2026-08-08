import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  Calendar as CalendarIcon, 
  Clock,
  MapPin,
  Users,
  User,
  Pencil, 
  Trash2, 
  Loader2,
  FileText,
  Mail,
  Link as LinkIcon,
  Check,
  Activity,
  DollarSign,
  AlertCircle,
  Settings,
  Download,
  CheckCircle2,
  Circle
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import AppointmentForm from '@/components/appointments/AppointmentForm';
import { useRecording } from '@/Layout';
import AppointmentProgressTracker from '@/components/appointments/AppointmentProgressTracker';
import AppointmentAudioSection from '@/components/appointments/AppointmentAudioSection';
import SalePhotosSection from '@/components/appointments/SalePhotosSection';
import AppointmentDetailsCard from '@/components/appointments/AppointmentDetailsCard';
import LeadInfoCard from '@/components/appointments/LeadInfoCard';
import NotesCard from '@/components/appointments/NotesCard';
import TagSelector from '@/components/tags/TagSelector';
import ResultStatusDialog from '@/components/appointments/ResultStatusDialog';

const statusColors = {
  'Lead': 'bg-slate-100 text-slate-700 border-slate-200',
  'Awaiting Assignment': 'bg-amber-100 text-amber-800 border-amber-200',
  'Scheduled': 'bg-blue-100 text-blue-800 border-blue-200',
  'Rescheduled': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'In Route': 'bg-cyan-100 text-cyan-800 border-cyan-200',
  'On Site': 'bg-green-100 text-green-800 border-green-200',
  'Cancelled': 'bg-red-100 text-red-800 border-red-200',
  'Completed': 'bg-slate-100 text-slate-700 border-slate-200',
  'Sold': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Lost': 'bg-red-100 text-red-800 border-red-200',
  'Pitch and Miss': 'bg-orange-100 text-orange-800 border-orange-200',
  'One-Leg': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Credit Decline': 'bg-rose-100 text-rose-800 border-rose-200',
  'Follow-Up': 'bg-red-100 text-red-800 border-red-200'
};

const COMPLETED_STATUSES = ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed'];

const CANCEL_REASONS = [
  'Customer rescheduled',
  'Customer changed mind / no longer interested',
  'Customer went with competitor',
  'Customer moved / out of area',
  'Customer unreachable / no response',
  'Scheduling conflict',
  'Duplicate appointment',
  'Financial / budget concerns',
  'Other'
];

export default function AppointmentDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const appointmentId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Determine back URL and label based on URL parameter
  const fromParam = urlParams.get('from');
  const backInfo = fromParam === 'MyAppointments' 
    ? { url: createPageUrl('MyAppointments'), label: 'Back to My Appointments' }
    : { url: createPageUrl('Appointments'), label: 'Back to Appointments' };

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignData, setAssignData] = useState({
    assigned_csr: '',
    assigned_dc: ''
  });
  const [linkCopied, setLinkCopied] = useState(false);
  const [rescheduleData, setRescheduleData] = useState({
    appointment_date: '',
    appointment_block: ''
  });
  const [editingNotes, setEditingNotes] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [doubleBookWarning, setDoubleBookWarning] = useState(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReasonSelect, setCancelReasonSelect] = useState('');
  const [cancelReasonOther, setCancelReasonOther] = useState('');

  const consultantViewUrl = `${window.location.origin}/ConsultantAppointmentView?id=${appointmentId}`;
  const leadViewUrl = `${window.location.origin}/LeadAppointmentView?id=${appointmentId}`;

  const [leadLinkCopied, setLeadLinkCopied] = useState(false);
  const [consultantLinkCopied, setConsultantLinkCopied] = useState(false);
  const [generatingLeadShortUrl, setGeneratingLeadShortUrl] = useState(false);
  const [generatingConsultantShortUrl, setGeneratingConsultantShortUrl] = useState(false);
  const [syncingRFMS, setSyncingRFMS] = useState(false);
  const [showAdminActionsDialog, setShowAdminActionsDialog] = useState(false);
  const [actionResults, setActionResults] = useState([]);
  const [runningAction, setRunningAction] = useState(null);
  const [showResultDialog, setShowResultDialog] = useState(false);

  const copyConsultantLinkToClipboard = async () => {
    let urlToCopy = appointment.consultant_short_url || consultantViewUrl;
    
    // Generate short URL if it doesn't exist
    if (!appointment.consultant_short_url) {
      setGeneratingConsultantShortUrl(true);
      try {
        const { data } = await base44.functions.invoke('shortenUrl', {
          originalURL: consultantViewUrl
        });
        
        if (data.shortURL) {
          urlToCopy = data.shortURL;
          await base44.entities.Appointment.update(appointmentId, {
            consultant_short_url: data.shortURL
          });
          queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
        }
      } catch (error) {
        console.error('Failed to generate short URL:', error);
      } finally {
        setGeneratingConsultantShortUrl(false);
      }
    }
    
    navigator.clipboard.writeText(urlToCopy);
    setConsultantLinkCopied(true);
    setTimeout(() => setConsultantLinkCopied(false), 2000);
  };

  const [rfmsSyncError, setRfmsSyncError] = useState(null);

  const syncToRFMS = async () => {
    setSyncingRFMS(true);
    setRfmsSyncError(null);
    try {
      const { data } = await base44.functions.invoke('sendToRFMS', {
        appointmentId
      });
      
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
      } else if (data.error) {
        setRfmsSyncError(data.error);
      }
    } catch (error) {
      console.error('RFMS sync failed:', error);
      setRfmsSyncError(error.message || 'Sync failed');
      queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
    } finally {
      setSyncingRFMS(false);
    }
  };

  const runAdminAction = async (actionName, actionFn) => {
    setRunningAction(actionName);
    setActionResults([]);
    const startTime = Date.now();
    
    try {
      const result = await actionFn();
      const duration = Date.now() - startTime;
      
      setActionResults([
        { type: 'success', message: `✓ ${actionName} completed in ${duration}ms` },
        { type: 'info', message: 'Result:', data: result }
      ]);
    } catch (error) {
      const duration = Date.now() - startTime;
      setActionResults([
        { type: 'error', message: `✗ ${actionName} failed after ${duration}ms` },
        { type: 'error', message: error.message || 'Unknown error', data: error }
      ]);
    } finally {
      setRunningAction(null);
      queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
    }
  };

  const copyLeadLinkToClipboard = async () => {
    let urlToCopy = appointment.lead_short_url || leadViewUrl;
    
    // Generate short URL if it doesn't exist
    if (!appointment.lead_short_url) {
      setGeneratingLeadShortUrl(true);
      try {
        const { data } = await base44.functions.invoke('shortenUrl', {
          originalURL: leadViewUrl
        });
        
        if (data.shortURL) {
          urlToCopy = data.shortURL;
          await base44.entities.Appointment.update(appointmentId, {
            lead_short_url: data.shortURL
          });
          queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
        }
      } catch (error) {
        console.error('Failed to generate short URL:', error);
      } finally {
        setGeneratingLeadShortUrl(false);
      }
    }
    
    navigator.clipboard.writeText(urlToCopy);
    setLeadLinkCopied(true);
    setTimeout(() => setLeadLinkCopied(false), 2000);
  };

  // Fetch all data in a single query to avoid rate limits
  const { data: appointmentData, isLoading } = useQuery({
    queryKey: ['appointmentDetail', appointmentId],
    queryFn: async () => {
      const user = await base44.auth.me();
      
      // Get appointment based on role
      let appointment;
      if (user?.role === 'admin') {
        const appointments = await base44.entities.Appointment.list();
        appointment = appointments.find(a => a.id === appointmentId);
      } else {
        const tm = await base44.entities.TeamMember.filter({ email: user.email });
        if (!tm.length) return null;
        
        // Role-based appointment access
        if (tm[0].role === 'Sales Manager') {
          // Sales Managers can view all appointments
          const appointments = await base44.entities.Appointment.list();
          appointment = appointments.find(a => a.id === appointmentId);
        } else if (tm[0].role === 'Design Consultant') {
          // Design Consultants only see appointments where they're assigned as DC
          const myAppointments = await base44.entities.Appointment.filter({ assigned_dc: tm[0].id });
          appointment = myAppointments.find(a => a.id === appointmentId);
        } else if (tm[0].role === 'Customer Service Rep') {
          // CSRs can view all appointments
          const appointments = await base44.entities.Appointment.list();
          appointment = appointments.find(a => a.id === appointmentId);
        } else {
          // Other roles can view all appointments
          const appointments = await base44.entities.Appointment.list();
          appointment = appointments.find(a => a.id === appointmentId);
        }
      }
      
      if (!appointment) return null;

      // Fetch all related data in parallel
      const [
        leads,
        teamMembers,
        logs,
        sales,
        checklists,
        tasks,
        checklistsV2
      ] = await Promise.all([
        appointment.customer ? base44.entities.Lead.filter({ id: appointment.customer }) : Promise.resolve([]),
        base44.entities.TeamMember.filter({ is_active: true }),
        base44.entities.AppointmentLog.filter({ appointment: appointmentId }),
        appointment.status === 'Sold' ? base44.entities.Sale.filter({ appointment: appointmentId }) : Promise.resolve([]),
        base44.entities.AppointmentSettingChecklist.filter({ appointment: appointmentId }),
        base44.entities.Task.filter({ appointment: appointmentId }),
        base44.entities.ChecklistV2.filter({ appointment: appointmentId })
      ]);

      return {
        appointment,
        lead: leads[0] || null,
        csr: appointment.assigned_csr ? teamMembers.find(tm => tm.id === appointment.assigned_csr) : null,
        dc: appointment.assigned_dc ? teamMembers.find(tm => tm.id === appointment.assigned_dc) : null,
        allTeamMembers: teamMembers,
        logs: logs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)),
        sale: sales[0] || null,
        checklist: checklists[0] || null,
        checklistV2: checklistsV2[0] || null,
        tasks: tasks.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
      };
    },
    enabled: !!appointmentId,
    staleTime: 30000 // Cache for 30 seconds
  });

  const appointment = appointmentData?.appointment;
  const lead = appointmentData?.lead;
  const csr = appointmentData?.csr;
  const dc = appointmentData?.dc;
  const allTeamMembers = appointmentData?.allTeamMembers || [];
  const logs = appointmentData?.logs;
  const sale = appointmentData?.sale;
  const checklist = appointmentData?.checklist;
  const checklistV2 = appointmentData?.checklistV2;
  const appointmentTasks = appointmentData?.tasks || [];

  const is1978OrBefore = checklist?.home_built_era === 'On or before 1978' || checklistV2?.home_built_era === 'On or before 1978';

  // Real-time subscription for appointment updates
  useEffect(() => {
    if (!appointmentId) return;

    const unsubscribeAppointment = base44.entities.Appointment.subscribe((event) => {
      if (event.type === 'update' && event.id === appointmentId) {
        queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
      }
    });

    const unsubscribeLogs = base44.entities.AppointmentLog.subscribe((event) => {
      if (event.data?.appointment === appointmentId) {
        queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
      }
    });

    return () => {
      unsubscribeAppointment();
      unsubscribeLogs();
    };
  }, [appointmentId, queryClient]);

  const openTasks = appointmentTasks.filter(task => task.status === 'pending');
  const completedTasks = appointmentTasks.filter(task => task.status === 'completed');

  const { data: streetView, isLoading: streetViewLoading } = useQuery({
    queryKey: ['streetView', appointmentId, appointment?.location_address],
    queryFn: async () => {
      if (!appointment?.location_address) return null;
      
      // Return cached URL if it exists
      if (appointment.street_view_url) {
        return { streetViewUrl: appointment.street_view_url };
      }
      
      // Fetch and cache the street view
      const { data } = await base44.functions.invoke('getStreetView', {
        address: appointment.location_address
      });
      
      // Save the URL to the appointment
      if (data?.streetViewUrl) {
        await base44.entities.Appointment.update(appointmentId, {
          street_view_url: data.streetViewUrl
        });
      }
      
      return data;
    },
    enabled: !!appointment?.location_address,
    staleTime: Infinity // Street view URLs don't change
  });



  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: currentTeamMember } = useQuery({
    queryKey: ['currentTeamMember', currentUser?.email],
    queryFn: async () => {
      const members = await base44.entities.TeamMember.filter({ email: currentUser.email });
      return members[0];
    },
    enabled: !!currentUser?.email
  });

  const canViewRecording = currentUser?.role === 'admin' || currentTeamMember?.role === 'Sales Manager';
  const { startRecording, recordingAppointmentId } = useRecording();

  const { data: allAppointments = [] } = useQuery({
    queryKey: ['allAppointmentsForDoubleBook'],
    queryFn: () => base44.entities.Appointment.list(),
    staleTime: 60000 // Cache for 1 minute
  });

  const updateMutation = useMutation({
    mutationFn: async (data) => {
        console.time('🕐 TOTAL Appointment Update');
        const previousDC = appointment.assigned_dc;
        const previousCSR = appointment.assigned_csr;
        const previousStatus = appointment.status;
        const newStatus = data.status;
        
        console.time('⏱️ Update Appointment Entity');
        await base44.entities.Appointment.update(appointmentId, data);
        console.timeEnd('⏱️ Update Appointment Entity');

        // Log the update
        console.time('⏱️ Get Current User');
        const user = await base44.auth.me();
        console.timeEnd('⏱️ Get Current User');
        let logDetails = [];
        
        if (data.status && data.status !== previousStatus) logDetails.push(`Status: ${previousStatus} → ${data.status}`);
        
        if (data.assigned_dc !== undefined && data.assigned_dc !== previousDC) {
          try {
            const oldDC = previousDC ? await base44.entities.TeamMember.filter({ id: previousDC }).then(m => m[0]) : null;
            const newDC = data.assigned_dc ? await base44.entities.TeamMember.filter({ id: data.assigned_dc }).then(m => m[0]) : null;
            const oldName = oldDC ? `${oldDC.first_name} ${oldDC.last_name}` : 'None';
            const newName = newDC ? `${newDC.first_name} ${newDC.last_name}` : 'None';
            logDetails.push(`Design Consultant: ${oldName} → ${newName}`);
          } catch (e) {
            logDetails.push('Design Consultant changed');
          }
        }
        
        if (data.assigned_csr !== undefined && data.assigned_csr !== previousCSR) {
          try {
            const oldCSR = previousCSR ? await base44.entities.TeamMember.filter({ id: previousCSR }).then(m => m[0]) : null;
            const newCSR = data.assigned_csr ? await base44.entities.TeamMember.filter({ id: data.assigned_csr }).then(m => m[0]) : null;
            const oldName = oldCSR ? `${oldCSR.first_name} ${oldCSR.last_name}` : 'None';
            const newName = newCSR ? `${newCSR.first_name} ${newCSR.last_name}` : 'None';
            logDetails.push(`Customer Service Rep: ${oldName} → ${newName}`);
          } catch (e) {
            logDetails.push('Customer Service Rep changed');
          }
        }
        
        if (data.appointment_date || data.appointment_block) {
          try {
            const oldDate = appointment.appointment_date ? format(new Date(appointment.appointment_date + 'T00:00:00'), 'MMM d, yyyy') : 'N/A';
            const oldBlock = appointment.appointment_block || 'N/A';
            const newDate = data.appointment_date ? format(new Date(data.appointment_date + 'T00:00:00'), 'MMM d, yyyy') : oldDate;
            const newBlock = data.appointment_block || oldBlock;
            if (oldDate !== newDate || oldBlock !== newBlock) {
              logDetails.push(`${oldDate} at ${oldBlock} → ${newDate} at ${newBlock}`);
            }
          } catch (e) {
            logDetails.push('Date/time updated');
          }
        }
        
        if (logDetails.length > 0) {
          console.time('⏱️ Create Appointment Log');
          await base44.entities.AppointmentLog.create({
            appointment: appointmentId,
            action: 'Updated',
            details: logDetails.join(', '),
            user_email: user.email,
            user_name: user.full_name
          });
          console.timeEnd('⏱️ Create Appointment Log');
        }



        // Send SMS and email notifications based on status/assignment changes
        const notifications = [];

        // Send SMS if newly assigned
        if (data.assigned_dc && data.assigned_dc !== previousDC) {
          notifications.push(
            base44.functions.invoke('sendAppointmentSMS', {
              appointmentId,
              type: 'consultant'
            }),
            base44.functions.invoke('sendAppointmentSMS', {
              appointmentId,
              type: 'lead_consultant_assigned'
            })
          );
        }

        // Send SMS and email if marked as Lost, Pitch and Miss, One-Leg, or Credit Decline
        const notSoldStatuses = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline'];
        console.log('🔍 Status check:', { newStatus: data.status, previousStatus, isNotSoldStatus: notSoldStatuses.includes(data.status) });
        if (data.status && notSoldStatuses.includes(data.status) && !notSoldStatuses.includes(previousStatus)) {
          console.log('✅ Triggering not_sold notifications');
          notifications.push(
            base44.functions.invoke('sendAppointmentSMS', {
              appointmentId,
              type: 'lead_not_sold'
            }).then(res => {
              console.log('📱 SMS Response:', res.data);
              return res;
            }).catch(err => {
              console.error('❌ SMS Failed:', err);
              throw err;
            }),
            base44.functions.invoke('sendNotificationEmail', {
              type: 'not_sold',
              entityId: appointmentId,
              appUrl: window.location.origin
            }).then(res => {
              console.log('📧 Email Response:', res.data);
              return res;
            }).catch(err => {
              console.error('❌ Email Failed:', err);
              throw err;
            })
          );
        }

        if (notifications.length > 0) {
          console.time('⏱️ Send Notifications');
          try {
            await Promise.all(notifications);
          } catch (error) {
            console.error('Notification failed:', error);
          }
          console.timeEnd('⏱️ Send Notifications');
        }

          // Create follow-up task if status changed to "Follow-Up"
          if (newStatus === 'Follow-Up' && previousStatus !== 'Follow-Up' && appointment.assigned_dc) {
          console.time('⏱️ Create Follow-Up Task');
          try {
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 7); // 7 days from now

            await base44.entities.Task.create({
              appointment: appointmentId,
              assigned_to: appointment.assigned_dc,
              due_date: dueDate.toISOString().split('T')[0],
              status: 'pending',
              type: 'follow_up',
              notes: 'Follow up with customer regarding this appointment'
            });
          } catch (error) {
            console.error('Failed to create follow-up task:', error);
          }
          console.timeEnd('⏱️ Create Follow-Up Task');
          }

          console.timeEnd('🕐 TOTAL Appointment Update');
          },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      setShowEditDialog(false);

      // Sync to Google Calendar after modal closes (non-blocking)
      const checkApptData = async () => {
        const updatedAppts = await base44.entities.Appointment.filter({ id: appointmentId });
        const updatedAppt = updatedAppts[0];
        const hasDC = updatedAppt?.assigned_dc || appointment.assigned_dc;
        const hasCalendarEvent = updatedAppt?.google_calendar_event_id || appointment.google_calendar_event_id;
        const isCancelled = updatedAppt?.status === 'Cancelled';
        // Sync if: has DC, OR has an existing calendar event that needs to be deleted/updated
        if (hasDC || hasCalendarEvent) {
          const action = isCancelled ? 'delete' : 'update';
          base44.functions.invoke('syncCalendarEvent', {
            appointmentId,
            action,
            appUrl: window.location.origin
          }).catch(error => {
            console.error('Calendar sync failed:', error);
          });
        }
      };
      checkApptData();
    }
  });

  const rescheduleMutation = useMutation({
    mutationFn: async (data) => {
      // Capture previous date/time for logging
      let logDetails = 'Rescheduled';
      try {
        const oldDate = appointment.appointment_date ? format(new Date(appointment.appointment_date + 'T00:00:00'), 'MMM d, yyyy') : 'N/A';
        const oldBlock = appointment.appointment_block || 'N/A';
        const newDate = format(new Date(data.appointment_date + 'T00:00:00'), 'MMM d, yyyy');
        const newBlock = data.appointment_block;
        logDetails = `${oldDate} at ${oldBlock} → ${newDate} at ${newBlock}`;
      } catch (e) {
        logDetails = 'Rescheduled';
      }

      await base44.entities.Appointment.update(appointmentId, {
        ...data,
        status: 'Rescheduled'
      });

      // Log the reschedule
      const user = await base44.auth.me();
      await base44.entities.AppointmentLog.create({
        appointment: appointmentId,
        action: 'Rescheduled',
        details: logDetails,
        user_email: user.email,
        user_name: user.full_name
      });

      // Sync to Google Calendar
      if (appointment.assigned_csr) {
        try {
          const syncResult = await base44.functions.invoke('syncCalendarEvent', {
            appointmentId,
            action: 'update',
            appUrl: window.location.origin
          });
          
          // Log success
          await base44.entities.AppointmentLog.create({
            appointment: appointmentId,
            action: 'Calendar Synced',
            details: 'Google Calendar updated for reschedule',
            user_email: user.email,
            user_name: user.full_name
          });
        } catch (error) {
          console.error('Calendar sync failed:', error);
          
          // Log failure
          await base44.entities.AppointmentLog.create({
            appointment: appointmentId,
            action: 'Calendar Sync Failed',
            details: `Error: ${error.message || 'Unknown error'}`,
            user_email: user.email,
            user_name: user.full_name
          });
        }
      }

      // Send SMS notifications for reschedule (in parallel)
      try {
        const smsCalls = [
          base44.functions.invoke('sendAppointmentSMS', {
            appointmentId,
            type: 'lead_rescheduled'
          })
        ];

        if (appointment.assigned_dc) {
          smsCalls.push(
            base44.functions.invoke('sendAppointmentSMS', {
              appointmentId,
              type: 'consultant_rescheduled'
            })
          );
        }

        await Promise.all(smsCalls);
      } catch (error) {
        console.error('SMS notification failed:', error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      setShowRescheduleDialog(false);
      setRescheduleData({ appointment_date: '', appointment_block: '' });
    }
  });

  const deleteMutation = useMutation({
        mutationFn: async () => {
          // Delete from Google Calendar first (non-blocking — don't prevent deletion on calendar errors)
          if (appointment.google_calendar_event_id || appointment.assigned_csr) {
            try {
              await base44.functions.invoke('syncCalendarEvent', {
                appointmentId,
                action: 'delete',
                appUrl: window.location.origin
              });
            } catch (error) {
              console.error('Calendar delete failed (proceeding with appointment deletion):', error);
            }
          }

          // Log appointment deletion
          try {
            await base44.functions.invoke('logAppointmentAction', {
              appointmentId,
              action: 'deleted',
              details: `Lead: ${lead?.first_name} ${lead?.last_name}`
            });
          } catch (logError) {
            console.error('Failed to log appointment deletion:', logError);
          }

          await base44.entities.Appointment.delete(appointmentId);
        },
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['appointments'] });
          navigate(createPageUrl('Appointments'));
        },
        onError: (error) => {
          toast.error(`Failed to delete appointment: ${error.message}`);
        }
      });

  const confirmCancel = async () => {
    const finalReason = cancelReasonSelect === 'Other' ? cancelReasonOther.trim() : cancelReasonSelect;
    await updateMutation.mutateAsync({ status: 'Cancelled', cancelled_reason: finalReason || '' });

    // Log the cancellation to system log
    try {
      await base44.functions.invoke('logAppointmentAction', {
        appointmentId,
        action: 'cancelled',
        details: `Lead: ${lead?.first_name} ${lead?.last_name}${finalReason ? ` — Reason: ${finalReason}` : ''}`
      });
    } catch (logError) {
      console.error('Failed to log appointment cancellation:', logError);
    }

    // Log the cancellation to appointment log
    const user = await base44.auth.me();
    await base44.entities.AppointmentLog.create({
      appointment: appointmentId,
      action: 'Cancelled',
      details: finalReason ? `Appointment cancelled — Reason: ${finalReason}` : 'Appointment cancelled',
      user_email: user.email,
      user_name: user.full_name
    });

    // Send SMS notifications for cancellation (in parallel)
    try {
      const smsCalls = [
        base44.functions.invoke('sendAppointmentSMS', {
          appointmentId,
          type: 'lead_cancelled'
        })
      ];

      if (appointment.assigned_dc) {
        smsCalls.push(
          base44.functions.invoke('sendAppointmentSMS', {
            appointmentId,
            type: 'consultant_cancelled'
          })
        );
      }

      await Promise.all(smsCalls);
    } catch (error) {
      console.error('SMS notification failed:', error);
    }

    // Sync Google Calendar - delete event on cancellation
    if (appointment.google_calendar_event_id || appointment.assigned_csr) {
      base44.functions.invoke('syncCalendarEvent', {
        appointmentId,
        action: 'delete',
        appUrl: window.location.origin
      }).catch(error => {
        console.error('Calendar sync (cancel) failed:', error);
      });
    }

    queryClient.invalidateQueries({ queryKey: ['appointmentDetail', appointmentId] });
    setShowCancelDialog(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Appointment not found</h2>
          <Link to={createPageUrl('Appointments')} className="text-indigo-600 hover:underline">
            Back to appointments
          </Link>
        </div>
      </div>
    );
  }

  const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Loading...';

  return (
    <div className="bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Link
            to={backInfo.url}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            {backInfo.label}
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex flex-col md:flex-row md:items-start gap-6">
              <div className="w-20 h-20 flex-shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-xl shadow-indigo-200">
                <CalendarIcon className="w-10 h-10" />
              </div>

              <div className="flex-1 min-w-0">
                <h1 className="text-3xl font-bold text-slate-800 tracking-tight">{leadName}</h1>
                {/* Tags */}
                <div className="mt-2 mb-1">
                  <TagSelector
                    selectedTagIds={appointment.tags || []}
                    onChange={(tags) => updateMutation.mutate({ tags })}
                    className="w-64"
                  />
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <Badge variant="secondary" className={cn('border', statusColors[appointment.status])}>
                    {appointment.status}
                  </Badge>
                  {(appointment.status === 'Scheduled' || appointment.status === 'Awaiting Assignment') && (
                    <Badge variant="secondary" className={cn('border', appointment.assigned_dc ? 'bg-green-100 text-green-800 border-green-200' : 'bg-amber-100 text-amber-800 border-amber-200')}>
                      {appointment.assigned_dc ? 'Assigned' : 'Unassigned'}
                    </Badge>
                  )}
                  {appointment.status === 'Sold' && sale && (
                    <Link to={createPageUrl('SaleDetail') + `?id=${sale.id}`}>
                      <Badge variant="secondary" className="border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 cursor-pointer">
                        View Sale Record →
                      </Badge>
                    </Link>
                  )}
                  {currentUser?.role === 'admin' && (
                    <Badge 
                      variant="secondary" 
                      className={cn('border font-mono text-xs', 
                        appointment.google_calendar_event_id 
                          ? 'bg-blue-50 text-blue-700 border-blue-200' 
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      )}
                    >
                      GCal: {appointment.google_calendar_event_id || 'None'}
                    </Badge>
                  )}
                  {appointment.confirmation_email_sent_at && (
                    <Badge variant="secondary" className="border bg-teal-50 text-teal-700 border-teal-200 text-xs">
                      ✉ Confirmation Sent
                    </Badge>
                  )}
                  {appointment.reminder_email_sent_at && (
                    <Badge variant="secondary" className="border bg-sky-50 text-sky-700 border-sky-200 text-xs">
                      ✉ Reminder Sent
                    </Badge>
                  )}
                  {appointment.day1_followup_email_sent_at && (
                    <Badge variant="secondary" className="border bg-violet-50 text-violet-700 border-violet-200 text-xs">
                      ✉ Day 1 Sent
                    </Badge>
                  )}
                  {appointment.day2_followup_email_sent_at && (
                    <Badge variant="secondary" className="border bg-purple-50 text-purple-700 border-purple-200 text-xs">
                      ✉ Day 2 Sent
                    </Badge>
                  )}
                  {appointment.day3_followup_email_sent_at && (
                    <Badge variant="secondary" className="border bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 text-xs">
                      ✉ Day 3 Sent
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6 flex-wrap">
              {appointment.rfms_sync_status === 'syncing' || syncingRFMS ? (
                <Button
                  variant="outline"
                  disabled
                  className="h-11 px-5 border-blue-200 text-blue-600 bg-blue-50"
                >
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Syncing with RFMS Measure Mobile...
                </Button>
              ) : appointment.rfms_sync_status === 'synced' && !rfmsSyncError ? (
                <Button
                  variant="outline"
                  disabled
                  className="h-11 px-5 border-green-200 text-green-600 bg-green-50"
                >
                  <Check className="w-4 h-4 mr-2" />
                  Synced with RFMS Measure Mobile
                </Button>
              ) : rfmsSyncError || appointment.rfms_sync_status === 'error' ? (
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    onClick={syncToRFMS}
                    disabled={syncingRFMS}
                    className="h-11 px-5 border-red-200 text-red-600 hover:bg-red-50"
                  >
                    {syncingRFMS ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 mr-2" />
                        Retry RFMS Sync
                      </>
                    )}
                  </Button>
                  {(rfmsSyncError || appointment.rfms_sync_error) && (
                    <p className="text-xs text-red-600 max-w-xs">
                      {rfmsSyncError || appointment.rfms_sync_error}
                    </p>
                  )}
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={syncToRFMS}
                  disabled={syncingRFMS}
                  className="h-11 px-5 border-blue-200 text-blue-600 hover:bg-blue-50"
                >
                  {syncingRFMS ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <LinkIcon className="w-4 h-4 mr-2" />
                      Sync with RFMS Measure Mobile
                    </>
                  )}
                </Button>
              )}
              <a href={appointment.consultant_short_url || `${window.location.origin}/ConsultantAppointmentView?id=${appointmentId}`} target="_blank" rel="noopener noreferrer">
                <Button
                  variant="outline"
                  className="h-11 px-5 border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                >
                  <User className="w-4 h-4 mr-2" />
                  Consultant View
                </Button>
              </a>
              {currentUser?.role === 'admin' && (
                <Link to={createPageUrl('ConsultantAppointmentView') + `?id=${appointmentId}`}>
                  <Button
                    variant="outline"
                    className="h-11 px-5 border-purple-200 text-purple-600 hover:bg-purple-50"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Preview Consultant View
                  </Button>
                </Link>
              )}
              <Link to={createPageUrl('LeadAppointmentView') + `?id=${appointmentId}`} target="_blank">
                <Button
                  variant="outline"
                  className="h-11 px-5 border-green-200 text-green-600 hover:bg-green-50"
                >
                  <LinkIcon className="w-4 h-4 mr-2" />
                  View as Lead
                </Button>
              </Link>
              {(appointment.status === 'Scheduled' || appointment.status === 'Rescheduled') && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setRescheduleData({
                        appointment_date: appointment.appointment_date || '',
                        appointment_block: appointment.appointment_block || ''
                      });
                      setShowRescheduleDialog(true);
                    }}
                    className="h-11 px-5 border-yellow-200 text-yellow-700 hover:bg-yellow-50"
                  >
                    Reschedule
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCancelReasonSelect('');
                      setCancelReasonOther('');
                      setShowCancelDialog(true);
                    }}
                    className="h-11 px-5 border-red-200 text-red-600 hover:bg-red-50"
                  >
                    Cancel
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(true)}
                className="h-11 px-5 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowResultDialog(true)}
                className="h-11 px-5 border-indigo-200 text-indigo-600 hover:bg-indigo-50"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Mark Result
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAdminActionsDialog(true)}
                className="h-11 px-5 border-purple-200 text-purple-600 hover:bg-purple-50"
              >
                <Settings className="w-4 h-4 mr-2" />
                Admin Actions
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Sticky Action Bar */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className={cn('border', statusColors[appointment.status])}>
              {appointment.status}
            </Badge>
            <span className="text-sm text-slate-600">{leadName}</span>
          </div>
          <div className="flex items-center gap-3">
            {appointment.status === 'Lead' && (
              <Link to={createPageUrl('ChecklistDetail') + `?id=${appointmentId}`}>
                <Button className="h-10 px-5 bg-indigo-600 hover:bg-indigo-700">
                  Convert to Appointment
                </Button>
              </Link>
            )}
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(true)}
              className="h-10 px-5 border-slate-200 hover:bg-slate-50"
            >
              <Pencil className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>
      </div>

      {/* 1978 Warning Banner */}
      {is1978OrBefore && (
        <div className="bg-red-600 text-white px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center gap-4">
            <span className="text-3xl">🛑</span>
            <div>
              <p className="font-bold text-lg">STOP — Home Built On or Before 1978</p>
              <p className="text-red-100 text-sm">Asbestos risk — notify the DC and follow proper protocol before proceeding.</p>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <AppointmentProgressTracker appointment={appointment} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SalePhotosSection sale={sale} lead={lead} />
          <AppointmentDetailsCard appointment={appointment} updateMutation={updateMutation} />
          <LeadInfoCard lead={lead} leadName={leadName} />

          {/* Project Budget & Marketing Source */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Project Budget & Source
            </h2>
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Amount</p>
                  <p className="text-slate-800 font-medium">{checklist?.project_budget || 'Unknown'}</p>
                </div>
              </div>
              {checklist?.heard_about_us && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Marketing Source</p>
                    <p className="text-slate-800 font-medium">{checklist.heard_about_us === 'Other' && checklist.heard_about_us_other ? checklist.heard_about_us_other : checklist.heard_about_us}</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Team Members */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
                Assigned Team
              </h2>
              <div className="flex gap-2">
                <Button
                     variant="outline"
                     size="sm"
                     onClick={() => {
                       setAssignData({
                         assigned_csr: appointment.assigned_csr || '',
                         assigned_dc: appointment.assigned_dc || ''
                       });
                       setShowAssignDialog(true);
                       setDoubleBookWarning(null);
                     }}
                     className="text-xs bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100"
                   >
                     <Users className="w-3 h-3 mr-1" />
                     Assign Team
                   </Button>
                {checklistV2 ? (
                  <Link to={createPageUrl('ChecklistV2Detail') + `?id=${checklistV2.id}`}>
                    <Button variant="outline" size="sm" className="text-xs">
                      View Checklist
                    </Button>
                  </Link>
                ) : (
                  <Link to={createPageUrl('ChecklistDetail') + `?id=${checklist?.id || appointmentId}`}>
                    <Button variant="outline" size="sm" className="text-xs">
                      View Checklist
                    </Button>
                  </Link>
                )}
              </div>
            </div>
            <div className="space-y-4">
              {csr && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-green-50">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <Users className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-green-600 mb-0.5">Customer Service Rep</p>
                    <p className="text-slate-800">{csr.first_name} {csr.last_name}</p>
                  </div>
                </div>
              )}
              {dc && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-blue-50">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 mb-0.5">Design Consultant</p>
                    <p className="text-slate-800">{dc.first_name} {dc.last_name}</p>
                  </div>
                </div>
              )}
              {!csr && !dc && (
                <p className="text-slate-400 text-center py-4 text-sm">No team members assigned</p>
              )}
            </div>
          </motion.div>

          {/* Location with Street View */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Location
            </h2>
            {appointment.location_address ? (
              <div className="space-y-4">
                <div className="flex items-start gap-4 p-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-slate-800">{appointment.location_address}</p>
                  </div>
                </div>
                {streetViewLoading ? (
                  <div className="flex items-center justify-center h-64 bg-slate-50 rounded-xl">
                    <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
                  </div>
                ) : streetView?.streetViewUrl ? (
                  <div className="rounded-xl overflow-hidden border border-slate-200">
                    <img
                      src={streetView.streetViewUrl}
                      alt="Property Street View"
                      className="w-full h-64 object-cover"
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-slate-400 text-center py-6">No location specified</p>
            )}
          </motion.div>

          {/* Share Links */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2 space-y-6"
          >
            {/* Lead View Link */}
            <div>
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Lead View Link
              </h2>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="flex-1 p-3 bg-slate-50 rounded-lg border border-slate-200 min-w-0">
                  <p className="text-sm text-slate-600 break-all">
                    {appointment.lead_short_url || leadViewUrl}
                  </p>
                </div>
                <Button
                  onClick={copyLeadLinkToClipboard}
                  variant="outline"
                  disabled={generatingLeadShortUrl}
                  className="h-12 px-5 border-green-200 hover:bg-green-50 flex-shrink-0"
                >
                  {generatingLeadShortUrl ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Shortening...
                    </>
                  ) : leadLinkCopied ? (
                    <>
                      <Check className="w-4 h-4 mr-2 text-green-600" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <LinkIcon className="w-4 h-4 mr-2" />
                      Copy Link
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                {appointment.lead_short_url ? (
                  <>Shortened link ready to share with customer</>
                ) : (
                  <>Click to generate a shortened link for easier sharing</>
                )}
              </p>
            </div>

            {/* Consultant View Link */}
            <div>
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Consultant View Link
              </h2>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="flex-1 p-3 bg-slate-50 rounded-lg border border-slate-200 min-w-0">
                  <p className="text-sm text-slate-600 break-all">
                    {appointment.consultant_short_url || consultantViewUrl}
                  </p>
                </div>
                <Button
                  onClick={copyConsultantLinkToClipboard}
                  variant="outline"
                  disabled={generatingConsultantShortUrl}
                  className="h-12 px-5 border-indigo-200 hover:bg-indigo-50 flex-shrink-0"
                >
                  {generatingConsultantShortUrl ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Shortening...
                    </>
                  ) : consultantLinkCopied ? (
                    <>
                      <Check className="w-4 h-4 mr-2 text-green-600" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <LinkIcon className="w-4 h-4 mr-2" />
                      Copy Link
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                {appointment.consultant_short_url ? (
                  <>Shortened link ready to share with consultant</>
                ) : (
                  <>Click to generate a shortened link for easier sharing</>
                )}
              </p>
            </div>
          </motion.div>

          {/* Tasks */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Tasks
            </h2>
            
            {openTasks.length === 0 && completedTasks.length === 0 ? (
              <p className="text-slate-400 text-center py-6">No tasks for this appointment</p>
            ) : (
              <>
                {/* Open Tasks */}
                {openTasks.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
                      Open ({openTasks.length})
                    </h3>
                    <div className="space-y-2">
                      {openTasks.map((task) => (
                        <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                          <Circle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-slate-800">{task.type === 'follow_up' ? 'Follow-Up' : task.type}</p>
                                {task.notes && <p className="text-xs text-slate-600 mt-1">{task.notes}</p>}
                              </div>
                              <span className="text-xs text-slate-500 whitespace-nowrap">
                                Due: {format(parseISO(task.due_date), 'MMM d')}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Completed Tasks */}
                {completedTasks.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
                      Completed ({completedTasks.length})
                    </h3>
                    <div className="space-y-2">
                      {completedTasks.map((task) => (
                        <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                          <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium text-slate-800 line-through">{task.type === 'follow_up' ? 'Follow-Up' : task.type}</p>
                                {task.notes && <p className="text-xs text-slate-600 mt-1">{task.notes}</p>}
                              </div>
                              <span className="text-xs text-slate-500 whitespace-nowrap">
                                {format(parseISO(task.due_date), 'MMM d')}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </motion.div>

          <NotesCard appointment={appointment} updateMutation={updateMutation} />

          {/* Metadata */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Record Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                <CalendarIcon className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Created</p>
                  <p className="text-sm text-slate-700">
                    {appointment.created_date && new Date(appointment.created_date + (appointment.created_date.includes('Z') ? '' : 'Z')).toLocaleString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric', 
                      hour: 'numeric', 
                      minute: '2-digit', 
                      hour12: true 
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                <CalendarIcon className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Last Updated</p>
                  <p className="text-sm text-slate-700">
                    {appointment.updated_date && new Date(appointment.updated_date + (appointment.updated_date.includes('Z') ? '' : 'Z')).toLocaleString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric', 
                      hour: 'numeric', 
                      minute: '2-digit', 
                      hour12: true 
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                <Mail className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Created By</p>
                  <p className="text-sm text-slate-700 truncate">{appointment.created_by}</p>
                </div>
              </div>
            </div>
          </motion.div>



          {/* Duration on Site */}
          {appointment.consultant_arrived_time && COMPLETED_STATUSES.includes(appointment.status) && (() => {
            const completionLog = logs?.find(log => 
              log.action === 'Status Changed' && 
              COMPLETED_STATUSES.some(status => log.details?.includes(status))
            );
            const completionTime = completionLog && completionLog.created_date
              ? new Date(completionLog.created_date + (completionLog.created_date.includes('Z') ? '' : 'Z'))
              : appointment.updated_date 
                ? new Date(appointment.updated_date + (appointment.updated_date.includes('Z') ? '' : 'Z'))
                : new Date();
            const arrivedTime = new Date(appointment.consultant_arrived_time);
            const durationMs = completionTime - arrivedTime;
            const hours = Math.floor(durationMs / (1000 * 60 * 60));
            const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

            return (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85 }}
                className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
              >
                <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                  Duration on Site
                </h2>
                <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100">
                  <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                    <Clock className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-slate-800">
                      {hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`}
                    </p>
                    <p className="text-sm text-slate-500">Time spent with customer</p>
                  </div>
                </div>
              </motion.div>
            );
          })()}

          {/* Activity Log */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
          >
            <div className="flex items-center gap-3 mb-4">
              <Activity className="w-5 h-5 text-indigo-600" />
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
                Activity Log
              </h2>
            </div>
            {logs && logs.length > 0 ? (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-4 p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium text-slate-800">{log.action}</p>
                          {log.details && (
                            <p className="text-sm text-slate-600 mt-1">{log.details}</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-slate-500">
                            {log.created_date && new Date(log.created_date + (log.created_date.includes('Z') ? '' : 'Z')).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">{log.user_name || log.user_email}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-center py-6">No activity recorded yet</p>
            )}
          </motion.div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
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
            <DialogTitle className="text-2xl font-bold text-slate-800">Edit Appointment</DialogTitle>
          </DialogHeader>
          <AppointmentForm
            appointment={appointment}
            onSubmit={(data) => updateMutation.mutate(data)}
            onCancel={() => setShowEditDialog(false)}
            isLoading={updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Reschedule Dialog */}
      <Dialog open={showRescheduleDialog} onOpenChange={setShowRescheduleDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-800">Reschedule Appointment</DialogTitle>
            <DialogDescription className="text-slate-500 mt-2">
              Select a new date and time for this appointment
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reschedule_date" className="text-slate-700">New Date *</Label>
              <Input
                id="reschedule_date"
                type="date"
                value={rescheduleData.appointment_date}
                onChange={(e) => setRescheduleData({ ...rescheduleData, appointment_date: e.target.value })}
                className="h-12 border-slate-200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reschedule_block" className="text-slate-700">Time Block *</Label>
              <Select 
                value={rescheduleData.appointment_block} 
                onValueChange={(value) => setRescheduleData({ ...rescheduleData, appointment_block: value })}
              >
                <SelectTrigger className="h-12 border-slate-200">
                  <SelectValue placeholder="Select time block" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9am to 11am">9am to 11am</SelectItem>
                  <SelectItem value="12pm to 2pm">12pm to 2pm</SelectItem>
                  <SelectItem value="3pm to 5pm">3pm to 5pm</SelectItem>
                  <SelectItem value="6pm to 8pm">6pm to 8pm</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRescheduleDialog(false)}
              className="border-slate-200"
            >
              Cancel
            </Button>
            <Button
              onClick={() => rescheduleMutation.mutate(rescheduleData)}
              disabled={rescheduleMutation.isPending || !rescheduleData.appointment_date || !rescheduleData.appointment_block}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              {rescheduleMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Rescheduling...
                </>
              ) : (
                'Reschedule'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Team Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className={cn(
              "text-xl font-bold",
              doubleBookWarning ? "flex items-center gap-2 text-amber-600" : "text-slate-800"
            )}>
              {doubleBookWarning ? (
                <>
                  <AlertCircle className="w-5 h-5" />
                  Double Booking Warning
                </>
              ) : (
                'Assign Team Members'
              )}
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-2">
              {doubleBookWarning 
                ? 'This consultant already has an appointment at this time' 
                : 'Select team members to assign to this appointment'
              }
            </DialogDescription>
          </DialogHeader>
          {doubleBookWarning ? (
            <div className="space-y-4 py-4">
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-sm font-semibold text-amber-900 mb-2">Existing Appointment:</p>
                <p className="text-sm text-amber-800">
                  {doubleBookWarning.conflictLead?.first_name} {doubleBookWarning.conflictLead?.last_name}
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  Same time block on {format(parseISO(appointment.appointment_date), 'MMM d')}
                </p>
              </div>
              <p className="text-sm text-slate-600">
                Do you want to proceed with this double booking?
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="assign_csr" className="text-slate-700">Customer Service Rep</Label>
                <Select 
                  value={assignData.assigned_csr} 
                  onValueChange={(value) => setAssignData({ ...assignData, assigned_csr: value === 'none' ? '' : value })}
                >
                  <SelectTrigger className="h-12 border-slate-200">
                    <SelectValue placeholder="Select CSR" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {allTeamMembers.filter(m => m.role === 'Customer Service Rep' || m.role === 'Sales Manager' || m.role === 'Admin').map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.first_name} {member.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="assign_dc" className="text-slate-700">Design Consultant</Label>
                <Select 
                  value={assignData.assigned_dc} 
                  onValueChange={(value) => {
                    const newDCId = value === 'none' ? '' : value;

                    // Check for double booking on DC assignment
                    if (newDCId && newDCId !== appointment.assigned_dc) {
                      const conflictingAppt = allAppointments.find(a => 
                        a.assigned_dc === newDCId && 
                        a.appointment_block === appointment.appointment_block &&
                        a.appointment_date === appointment.appointment_date &&
                        a.id !== appointment.id
                      );

                      if (conflictingAppt) {
                        const conflictLead = lead && lead.id === conflictingAppt.customer ? lead : null;
                        setDoubleBookWarning({
                          dcId: newDCId,
                          conflictingAppt,
                          conflictLead
                        });
                        return;
                      }
                    }

                    setAssignData({ ...assignData, assigned_dc: newDCId });
                    setDoubleBookWarning(null);
                  }}
                >
                  <SelectTrigger className="h-12 border-slate-200">
                    <SelectValue placeholder="Select DC" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {allTeamMembers.filter(m => m.role === 'Design Consultant' || m.role === 'Sales Manager').map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.first_name} {member.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAssignDialog(false);
                setDoubleBookWarning(null);
              }}
              className="border-slate-200"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (doubleBookWarning) {
                  // Proceed with double booking
                  setAssignData({ ...assignData, assigned_dc: doubleBookWarning.dcId });
                  setDoubleBookWarning(null);

                  await updateMutation.mutateAsync({
                    assigned_csr: assignData.assigned_csr || null,
                    assigned_dc: doubleBookWarning.dcId || null
                  });
                  setShowAssignDialog(false);
                } else {
                  // Normal assignment
                  await updateMutation.mutateAsync({
                    assigned_csr: assignData.assigned_csr || null,
                    assigned_dc: assignData.assigned_dc || null
                  });
                  setShowAssignDialog(false);
                }
              }}
              disabled={updateMutation.isPending}
              className={doubleBookWarning ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700"}
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Assigning...
                </>
              ) : doubleBookWarning ? (
                'Proceed Anyway'
              ) : (
                'Assign Team'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-800">Delete Appointment</DialogTitle>
            <DialogDescription className="text-slate-500 mt-2">
              Are you sure you want to delete this appointment with <span className="font-semibold">{leadName}</span>? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              className="border-slate-200"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Appointment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Appointment Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-800">Cancel Appointment</DialogTitle>
            <DialogDescription className="text-slate-500 mt-2">
              Are you sure you want to cancel this appointment with <span className="font-semibold">{leadName}</span>?
              Please provide a reason for the cancellation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cancel_reason" className="text-slate-700">Cancellation Reason *</Label>
              <Select value={cancelReasonSelect} onValueChange={(value) => setCancelReasonSelect(value)}>
                <SelectTrigger className="h-12 border-slate-200">
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  {CANCEL_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {cancelReasonSelect === 'Other' && (
              <div className="space-y-2">
                <Label htmlFor="cancel_reason_other" className="text-slate-700">Please specify</Label>
                <Textarea
                  id="cancel_reason_other"
                  value={cancelReasonOther}
                  onChange={(e) => setCancelReasonOther(e.target.value)}
                  placeholder="Enter the reason for cancelling this appointment..."
                  className="min-h-24 border-slate-200 focus:border-red-500 focus:ring-red-500"
                />
              </div>
            )}
          </div>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(false)}
              className="border-slate-200"
            >
              Keep Appointment
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancel}
              disabled={updateMutation.isPending || !cancelReasonSelect || (cancelReasonSelect === 'Other' && !cancelReasonOther.trim())}
              className="bg-red-600 hover:bg-red-700"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cancelling...
                </>
              ) : (
                'Confirm Cancellation'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin Actions Dialog */}
      <Dialog open={showAdminActionsDialog} onOpenChange={setShowAdminActionsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Settings className="w-5 h-5 text-purple-600" />
              Admin Actions
            </DialogTitle>
            <DialogDescription className="text-slate-500 mt-2">
              Manually trigger sync and notification actions for this appointment
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => runAdminAction('Google Calendar Sync', async () => {
                  const response = await base44.functions.invoke('syncCalendarEvent', {
                    appointmentId,
                    action: appointment.google_calendar_event_id ? 'update' : 'create',
                    appUrl: window.location.origin
                  });
                  return response.data;
                })}
                disabled={!!runningAction}
                className="h-20 flex-col border-blue-200 hover:bg-blue-50"
              >
                {runningAction === 'Google Calendar Sync' ? (
                  <Loader2 className="w-5 h-5 mb-2 animate-spin" />
                ) : (
                  <CalendarIcon className="w-5 h-5 mb-2 text-blue-600" />
                )}
                <span className="text-sm">Sync Google Calendar</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => runAdminAction('Send Customer SMS', async () => {
                  const response = await base44.functions.invoke('sendAppointmentSMS', {
                    appointmentId,
                    type: 'lead'
                  });
                  return response.data;
                })}
                disabled={!!runningAction}
                className="h-20 flex-col border-green-200 hover:bg-green-50"
              >
                {runningAction === 'Send Customer SMS' ? (
                  <Loader2 className="w-5 h-5 mb-2 animate-spin" />
                ) : (
                  <Mail className="w-5 h-5 mb-2 text-green-600" />
                )}
                <span className="text-sm">Send Customer SMS</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => runAdminAction('Send Consultant SMS', async () => {
                  const response = await base44.functions.invoke('sendAppointmentSMS', {
                    appointmentId,
                    type: 'consultant'
                  });
                  return response.data;
                })}
                disabled={!!runningAction || !appointment.assigned_dc}
                className="h-20 flex-col border-indigo-200 hover:bg-indigo-50"
              >
                {runningAction === 'Send Consultant SMS' ? (
                  <Loader2 className="w-5 h-5 mb-2 animate-spin" />
                ) : (
                  <Users className="w-5 h-5 mb-2 text-indigo-600" />
                )}
                <span className="text-sm">Send Consultant SMS</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => runAdminAction('Sync to RFMS', async () => {
                  const response = await base44.functions.invoke('sendToRFMS', {
                    appointmentId
                  });
                  return response.data;
                })}
                disabled={!!runningAction}
                className="h-20 flex-col border-purple-200 hover:bg-purple-50"
              >
                {runningAction === 'Sync to RFMS' ? (
                  <Loader2 className="w-5 h-5 mb-2 animate-spin" />
                ) : (
                  <LinkIcon className="w-5 h-5 mb-2 text-purple-600" />
                )}
                <span className="text-sm">Sync to RFMS</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => runAdminAction('Send Confirmation Email', async () => {
                  const response = await base44.functions.invoke('sendNotificationEmail', {
                    type: 'appointment_created',
                    entityId: appointmentId,
                    appUrl: window.location.origin
                  });
                  return response.data;
                })}
                disabled={!!runningAction}
                className="h-20 flex-col border-orange-200 hover:bg-orange-50"
              >
                {runningAction === 'Send Confirmation Email' ? (
                  <Loader2 className="w-5 h-5 mb-2 animate-spin" />
                ) : (
                  <Mail className="w-5 h-5 mb-2 text-orange-600" />
                )}
                <span className="text-sm">Send Confirmation Email</span>
              </Button>
            </div>

            {/* Results Console */}
            {actionResults.length > 0 && (
              <div className="mt-6 bg-slate-900 rounded-lg p-4 text-white font-mono text-xs overflow-auto max-h-96">
                {actionResults.map((result, i) => (
                  <div key={i} className={cn('mb-2', result.type === 'error' && 'text-red-400', result.type === 'success' && 'text-green-400')}>
                    <div>{result.message}</div>
                    {result.data && (
                      <pre className="mt-1 text-slate-300 overflow-auto">
                        {JSON.stringify(result.data, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAdminActionsDialog(false);
                setActionResults([]);
                setRunningAction(null);
              }}
              className="border-slate-200"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Result Status Dialog */}
      <ResultStatusDialog
        open={showResultDialog}
        onOpenChange={setShowResultDialog}
        appointment={appointment}
        currentUser={currentUser}
        onConfirm={(data) => updateMutation.mutate(data)}
        isLoading={updateMutation.isPending}
      />
    </div>
  );
}