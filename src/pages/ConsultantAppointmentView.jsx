import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Calendar as CalendarIcon, 
  Clock,
  MapPin,
  User,
  Mail,
  Loader2,
  FileText,
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Upload,
  Navigation,
  List,
  Camera,
  Check,
  Trophy,
  X,
  Send,
  Pen,
  DollarSign
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format, addWeeks, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { CameraCapture } from '@/components/ui/camera-capture';
import AudioRecorder from '@/components/AudioRecorder';
import PreInstallChecklistModal from '@/components/PreInstallChecklistModal';
import ChecklistDisplay from '@/components/appointments/ChecklistDisplay';
import ChecklistV2Display from '@/components/appointments/ChecklistV2Display';
import CreateQuoteDialog from '@/components/appointments/CreateQuoteDialog';
import { toast } from 'sonner';

const statusColors = {
  'Lead': 'bg-secondary text-secondary-foreground border-border',
  'Awaiting Assignment': 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25',
  'Scheduled': 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25',
  'Rescheduled': 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/25',
  'In Route': 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/25',
  'On Site': 'bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25',
  'Cancelled': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25',
  'Completed': 'bg-secondary text-secondary-foreground border-border',
  'Sold': 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25',
  'Lost': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25',
  'Pitch and Miss': 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25',
  'One-Leg': 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/25',
  'Credit Decline': 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/25',
  'Follow-Up': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25'
};

export default function ConsultantAppointmentView() {
  const urlParams = new URLSearchParams(window.location.search);
  const appointmentId = urlParams.get('id');
  const action = urlParams.get('action');
  const queryClient = useQueryClient();
  const [showChecklist, setShowChecklist] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [contractFileUrl, setContractFileUrl] = useState('');
  const [saleNotes, setSaleNotes] = useState('');
  const [saleAmount, setSaleAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [uploadingContract, setUploadingContract] = useState(false);
  const [extractingAmount, setExtractingAmount] = useState(false);
  const [sendingOnMyWay, setSendingOnMyWay] = useState(false);
  const [folderPhotoUrl, setFolderPhotoUrl] = useState('');
  const [yardSignPhotoUrl, setYardSignPhotoUrl] = useState('');
  const [yardSignOptedOut, setYardSignOptedOut] = useState(false);
  const [uploadingFolderPhoto, setUploadingFolderPhoto] = useState(false);
  const [uploadingYardSignPhoto, setUploadingYardSignPhoto] = useState(false);
  const [driverLicensePhotoUrl, setDriverLicensePhotoUrl] = useState('');
  const [uploadingDriverLicensePhoto, setUploadingDriverLicensePhoto] = useState(false);
  const [productPhotos, setProductPhotos] = useState([]);
  const [uploadingProductPhoto, setUploadingProductPhoto] = useState(false);
  const [depositPaymentMethod, setDepositPaymentMethod] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [checkDate, setCheckDate] = useState('');
  const [checkDepositCompleted, setCheckDepositCompleted] = useState(false);
  const [showPreInstallChecklist, setShowPreInstallChecklist] = useState(false);
  const [preInstallData, setPreInstallData] = useState(null);
  const [sendingStandaloneChecklist, setSendingStandaloneChecklist] = useState(false);
  const [standaloneSent, setStandaloneSent] = useState(false);
  const [standaloneEmail, setStandaloneEmail] = useState('');
  const [standaloneProductInfo, setStandaloneProductInfo] = useState('');
  const fileInputRef = useRef(null);
  const folderPhotoInputRef = useRef(null);
  const yardSignPhotoInputRef = useRef(null);

  const [currentUser, setCurrentUser] = React.useState(null);
  const [showRecorder, setShowRecorder] = React.useState(false);
  const [testingSMS, setTestingSMS] = React.useState(false);
  const [followUpChecked, setFollowUpChecked] = React.useState(false);
  const [showSkipToResult, setShowSkipToResult] = React.useState(false);
  const [showQuoteDialog, setShowQuoteDialog] = React.useState(false);
  const [currentTeamMember, setCurrentTeamMember] = React.useState(null);
  const [quotesEnabled, setQuotesEnabled] = React.useState(false);

  React.useEffect(() => {
    const loadUser = async () => {
      try {
        const user = await base44.auth.me();
        setCurrentUser(user);
        if (user?.email) {
          const teamMembers = await base44.entities.TeamMember.filter({ email: user.email });
          const teamMember = teamMembers[0];
          setCurrentTeamMember(teamMember);
          setShowRecorder(teamMember?.role === 'Design Consultant' || teamMember?.role === 'Sales Manager');
        }
        // Check if quotes are enabled
        const settings = await base44.entities.AppSettings.list();
        const appSettings = settings[0];
        if (appSettings?.quotes_enabled) {
          if (appSettings?.quotes_admin_only && user?.role !== 'admin') {
            setQuotesEnabled(false);
          } else {
            setQuotesEnabled(true);
          }
        }
      } catch (error) {
        setShowRecorder(false);
      }
    };
    loadUser();
  }, []);

  const { data: appointment, isLoading } = useQuery({
    queryKey: ['appointment', appointmentId],
    queryFn: async () => {
      try {
        const appointments = await base44.entities.Appointment.filter({ id: appointmentId });
        return appointments[0];
      } catch (error) {
        console.error('Error fetching appointment:', error);
        return null;
      }
    },
    enabled: !!appointmentId,
    retry: false
  });

  // Real-time subscription for appointment updates
  React.useEffect(() => {
    if (!appointmentId) return;

    const unsubscribe = base44.entities.Appointment.subscribe((event) => {
      if (event.type === 'update' && event.id === appointmentId) {
        queryClient.setQueryData(['appointment', appointmentId], event.data);
      }
    });

    return unsubscribe;
  }, [appointmentId, queryClient]);

  // Restore preInstallData from appointment if already signed
  React.useEffect(() => {
    if (appointment?.pre_install_checklist_signature_url && appointment?.pre_install_product_info && !preInstallData) {
      setPreInstallData({
        signatureUrl: appointment.pre_install_checklist_signature_url,
        productInfo: appointment.pre_install_product_info
      });
    }
  }, [appointment]);

  // Auto-open sold dialog if action=sold in URL (only once)
  const hasAutoOpened = React.useRef(false);
  React.useEffect(() => {
    if (action === 'sold' && appointment && !hasAutoOpened.current) {
      setSelectedStatus('Sold');
      setShowStatusDialog(true);
      hasAutoOpened.current = true;
    }
  }, [action, appointment]);

  const { data: lead } = useQuery({
    queryKey: ['lead', appointment?.customer],
    queryFn: async () => {
      if (!appointment?.customer) return null;
      try {
        const leads = await base44.entities.Lead.filter({ id: appointment.customer });
        return leads[0];
      } catch (error) {
        console.error('Error fetching lead:', error);
        return null;
      }
    },
    enabled: !!appointment?.customer,
    retry: false
  });

  const { data: checklist } = useQuery({
    queryKey: ['checklist', appointmentId],
    queryFn: async () => {
      try {
        const checklists = await base44.entities.AppointmentSettingChecklist.filter({ appointment: appointmentId });
        return checklists[0] || null;
      } catch (error) {
        console.error('Error fetching checklist:', error);
        return null;
      }
    },
    enabled: !!appointmentId,
    retry: false
  });

  const { data: checklistV2 } = useQuery({
    queryKey: ['checklistv2byAppt', appointmentId],
    queryFn: async () => {
      const results = await base44.entities.ChecklistV2.filter({ appointment: appointmentId });
      return results[0] || null;
    },
    enabled: !!appointmentId,
    retry: false
  });

  const { data: streetView, isLoading: streetViewLoading } = useQuery({
    queryKey: ['streetView', appointmentId, appointment?.location_address],
    queryFn: async () => {
      if (!appointment?.location_address) return null;
      
      if (appointment.street_view_url) {
        return { streetViewUrl: appointment.street_view_url };
      }
      
      const { data } = await base44.functions.invoke('getStreetView', {
        address: appointment.location_address
      });
      
      if (data?.streetViewUrl) {
        await base44.entities.Appointment.update(appointmentId, {
          street_view_url: data.streetViewUrl
        });
      }
      
      return data;
    },
    enabled: !!appointment?.location_address
  });

  const { data: photoSettings } = useQuery({
    queryKey: ['photoSettings'],
    queryFn: async () => {
      const settings = await base44.entities.SMSSettings.list();
      return settings[0] || { require_folder_photo: true, require_yard_sign_photo: true };
    }
  });

  const { data: sale } = useQuery({
    queryKey: ['appointmentSale', appointmentId],
    queryFn: async () => {
      const sales = await base44.entities.Sale.filter({ appointment: appointmentId });
      return sales[0] || null;
    },
    enabled: !!appointmentId && appointment?.status === 'Sold'
  });

  const markStatusMutation = useMutation({
    mutationFn: async ({ status, contractFileUrl, notes, amount, depositAmount, folderPhotoUrl, yardSignPhotoUrl, yardSignOptedOut, driverLicensePhotoUrl, depositPaymentMethod, checkNumber, checkDate, scheduleFollowUp }) => {
      let userEmail = 'consultant';
      let userName = 'Design Consultant';
      try {
        const user = await base44.auth.me();
        userEmail = user?.email || userEmail;
        userName = user?.full_name || userName;
      } catch (authError) {
        // User not authenticated (public view), use defaults
      }
      
      // Save previous status BEFORE updating
      const previousStatus = appointment?.status;
      
      // Update appointment with status and notes (if provided)
      const notSoldStatusList = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up'];
      const updateData = { status };
      if (amount && notSoldStatusList.includes(status)) {
        updateData.not_sold_deal_size = parseFloat(amount);
      }
      if (notes) {
        const existingNotes = appointment.notes || [];
        updateData.notes = [
          ...existingNotes,
          {
            content: notes,
            user_name: userName,
            user_email: userEmail,
            timestamp: new Date().toISOString(),
            context: status === 'Sold' ? 'Sale Result' : `${status} Result`
          }
        ];
      }
      await base44.entities.Appointment.update(appointmentId, updateData);

      // Send SMS and email if marked as Lost, Pitch and Miss, One-Leg, Credit Decline, or Follow-Up
      const notSoldStatuses = ['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up'];
      if (status && notSoldStatuses.includes(status) && !notSoldStatuses.includes(previousStatus)) {
        console.log('✅ Triggering not_sold notifications from consultant view');
        try {
          await Promise.all([
            base44.functions.invoke('sendAppointmentSMS', {
              appointmentId,
              type: 'lead_not_sold'
            }).then(res => {
              console.log('📱 SMS Response:', res.data);
            }).catch(err => {
              console.error('❌ SMS Failed:', err);
            }),
            base44.functions.invoke('sendNotificationEmail', {
              type: 'not_sold',
              entityId: appointmentId,
              appUrl: window.location.origin
            }).then(res => {
              console.log('📧 Email Response:', res.data);
            }).catch(err => {
              console.error('❌ Email Failed:', err);
            })
          ]);
        } catch (error) {
          console.error('Notification sending failed (non-blocking):', error);
        }
      }

      // Create follow-up task if status is "Follow-Up" OR if follow-up checkbox was checked
      if ((status === 'Follow-Up' || scheduleFollowUp) && appointment.assigned_dc) {
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
      }

      if (status === 'Sold') {
        // Guard: lead must be loaded
        if (!lead) {
          throw new Error('Customer/Lead data could not be loaded for this appointment. Please refresh and try again.');
        }
        // Convert Lead to Customer
        const customer = await base44.entities.Customer.create({
          first_name: lead.first_name,
          last_name: lead.last_name,
          email: lead.email,
          phone: lead.phone,
          address_line1: lead.address_line1,
          address_line2: lead.address_line2,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
          notes: lead.notes,
          converted_from_lead: appointment.customer
        });

        const sale = await base44.entities.Sale.create({
          appointment: appointmentId,
          customer: customer.id,
          lead: appointment.customer,
          assigned_dc: appointment.assigned_dc,
          sale_date: new Date().toISOString(),
          contract_file_url: contractFileUrl,
          appointment_date: appointment.appointment_date,
          appointment_block: appointment.appointment_block,
          location_address: appointment.location_address,
          sale_amount: amount ? parseFloat(amount) : undefined,
          deposit_amount: depositAmount ? parseFloat(depositAmount) : undefined,
          notes: notes || undefined,
          folder_photo_url: folderPhotoUrl,
          yard_sign_photo_url: yardSignPhotoUrl || undefined,
          yard_sign_opted_out: yardSignOptedOut,
          pre_install_checklist_signature_url: preInstallData?.signatureUrl || undefined,
          pre_install_product_info: preInstallData?.productInfo || undefined,
          driver_license_photo_url: driverLicensePhotoUrl || undefined,
          product_photos: productPhotos.length > 0 ? productPhotos : undefined,
          deposit_payment_method: depositPaymentMethod || undefined,
          check_number: (depositPaymentMethod === 'Check' || depositPaymentMethod === 'Post-Dated Check') ? checkNumber : undefined,
          check_date: depositPaymentMethod === 'Post-Dated Check' ? checkDate : undefined
        });

        // Create project for this sale
        const projectStatus = appointment.installation_date ? 'Scheduled' : 'Accepted';
        const newProject = await base44.entities.Project.create({
          sale: sale.id,
          customer: customer.id,
          status: projectStatus,
          installation_date: appointment.installation_date,
          pre_install_checklist_signature_url: preInstallData?.signatureUrl || undefined,
          pre_install_product_info: preInstallData?.productInfo || undefined
        });

        // Generate and save project tracker URL
        try {
          const appUrl = await base44.functions.invoke('getAppUrl');
          const baseUrl = appUrl.data.url;
          const fullUrl = `${baseUrl}/CustomerProjectView?id=${newProject.id}`;
          let trackerUrl = fullUrl;
          
          try {
            const { data } = await base44.functions.invoke('shortenUrl', { originalURL: fullUrl });
            if (data?.shortURL) {
              trackerUrl = data.shortURL;
            }
          } catch (error) {
            console.error('Failed to shorten URL, using full URL:', error);
          }
          
          await base44.entities.Project.update(newProject.id, { project_tracker_url: trackerUrl });
        } catch (error) {
          console.error('Failed to generate tracker URL:', error);
        }

        // Send SMS to customer confirming the sale
        try {
          await base44.functions.invoke('sendAppointmentSMS', {
            appointmentId,
            customerId: customer.id,
            type: 'customer_sale_confirmation'
          });
        } catch (error) {
          console.error('Failed to send customer SMS:', error);
        }

        // Send sale confirmation email to team (CC list)
        try {
          await base44.functions.invoke('sendNotificationEmail', {
            type: 'sale_confirmed',
            entityId: sale.id,
            appUrl: window.location.origin
          });
        } catch (error) {
          console.error('Failed to send sale confirmation email:', error);
        }

        // Send SMS and email for project creation
        try {
          await base44.functions.invoke('sendAppointmentSMS', {
            appointmentId,
            type: 'customer_project_created',
            customerId: customer.id
          });
        } catch (error) {
          console.error('Failed to send project SMS:', error);
        }

        try {
          await base44.functions.invoke('sendNotificationEmail', {
            type: 'project_created',
            entityId: newProject.id,
            appUrl: window.location.origin
          });
        } catch (error) {
          console.error('Failed to send project email:', error);
        }
        }

      try {
        const user = await base44.auth.me();
        await base44.entities.AppointmentLog.create({
          appointment: appointmentId,
          action: 'Status Changed',
          details: `Status changed to: ${status}`,
          user_email: user?.email || 'consultant',
          user_name: user?.full_name || 'Design Consultant'
        });
      } catch (error) {
        await base44.entities.AppointmentLog.create({
          appointment: appointmentId,
          action: 'Status Changed',
          details: `Status changed to: ${status}`,
          user_email: 'consultant',
          user_name: 'Design Consultant'
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      setShowStatusDialog(false);
      setSelectedStatus('');
      setContractFileUrl('');
      setSaleNotes('');
      setSaleAmount('');
      setDepositAmount('');
      setFolderPhotoUrl('');
      setYardSignPhotoUrl('');
      setYardSignOptedOut(false);
      setDepositPaymentMethod('');
      setCheckNumber('');
      setCheckDate('');
      setCheckDepositCompleted(false);
      setFollowUpChecked(false);
      setPreInstallData(null);
      setStandaloneSent(false);
      setStandaloneEmail('');
      setStandaloneProductInfo('');
    },
    onError: (error) => {
      console.error('Failed to update status:', error);
      toast.error('Failed to update appointment status: ' + (error?.message || 'Unknown error. Please try again.'));
    }
  });

  const handleStatusSelect = (status) => {
    setSelectedStatus(status);
    setFollowUpChecked(false);
    setShowStatusDialog(true);
    
    // Set default installation date to 2 weeks from appointment date
    if (status === 'Sold' && appointment.appointment_date) {
      const defaultInstallDate = addWeeks(parseISO(appointment.appointment_date + 'T00:00:00'), 2);
      base44.entities.Appointment.update(appointmentId, {
        installation_date: format(defaultInstallDate, 'yyyy-MM-dd')
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      });
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingContract(true);
    try {

      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      setContractFileUrl(fileUrl);
      
      // Auto-extract invoice total from PDF
      setExtractingAmount(true);
      try {
        const { data } = await base44.functions.invoke('extractInvoiceTotal', {
          pdfUrl: fileUrl
        });
        
        if (data?.success && data?.total) {
          setSaleAmount(data.total.toString());
        }
      } catch (extractError) {
        // Silently fail - user can still enter amount manually
      } finally {
        setExtractingAmount(false);
      }
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload contract');
    } finally {
      setUploadingContract(false);
    }
  };

  const handleFolderPhotoCapture = async (dataUrl) => {
    setUploadingFolderPhoto(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'folder-photo.jpg', { type: 'image/jpeg' });
      

      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      setFolderPhotoUrl(fileUrl);
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload photo');
    } finally {
      setUploadingFolderPhoto(false);
    }
  };

  const handleYardSignPhotoCapture = async (dataUrl) => {
    setUploadingYardSignPhoto(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'yard-sign-photo.jpg', { type: 'image/jpeg' });
      

      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      setYardSignPhotoUrl(fileUrl);
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload photo');
    } finally {
      setUploadingYardSignPhoto(false);
    }
  };

  const handleProductPhotoCapture = async (dataUrl) => {
    setUploadingProductPhoto(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `product-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      setProductPhotos(prev => [...prev, fileUrl]);
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload photo');
    } finally {
      setUploadingProductPhoto(false);
    }
  };

  const handleDriverLicensePhotoCapture = async (dataUrl) => {
    setUploadingDriverLicensePhoto(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'driver-license-photo.jpg', { type: 'image/jpeg' });
      

      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      setDriverLicensePhotoUrl(fileUrl);
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload photo');
    } finally {
      setUploadingDriverLicensePhoto(false);
    }
  };

  const handleSendStandaloneChecklist = async () => {
    const emailToUse = standaloneEmail || lead?.email;
    if (!emailToUse || !standaloneProductInfo) return;
    setSendingStandaloneChecklist(true);
    try {
      const record = await base44.entities.StandalonePreInstallChecklist.create({
        customer_first_name: lead?.first_name || '',
        customer_last_name: lead?.last_name || '',
        customer_email: emailToUse,
        product_info: standaloneProductInfo,
        status: 'draft'
      });
      await base44.functions.invoke('sendPreInstallEmail', { checklistId: record.id });
      setStandaloneSent(true);
    } catch (err) {
      console.error('Failed to send checklist:', err);
      toast.error('Failed to send checklist email');
    } finally {
      setSendingStandaloneChecklist(false);
    }
  };

  const handlePreInstallComplete = async (data) => {
    setPreInstallData(data);
    setShowPreInstallChecklist(false);
    // Persist to appointment so it survives a page refresh
    try {
      await base44.entities.Appointment.update(appointmentId, {
        pre_install_checklist_signature_url: data.signatureUrl,
        pre_install_product_info: data.productInfo
      });
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
    } catch (err) {
      console.error('Failed to save checklist to appointment:', err);
    }
    setShowStatusDialog(true);
  };

  const handleSubmitStatus = async () => {
    try {
      if (selectedStatus === 'Sold') {
        const requireFolder = photoSettings?.require_folder_photo !== false;
        const requireYardSign = photoSettings?.require_yard_sign_photo !== false;
        
        if (!contractFileUrl) return;
        if (requireFolder && !folderPhotoUrl) return;
        if (requireYardSign && !yardSignPhotoUrl && !yardSignOptedOut) return;
        
        await markStatusMutation.mutateAsync({
          status: selectedStatus,
          contractFileUrl: contractFileUrl,
          notes: saleNotes,
          amount: saleAmount,
          depositAmount: depositAmount,
          folderPhotoUrl: folderPhotoUrl,
          yardSignPhotoUrl: yardSignPhotoUrl,
          yardSignOptedOut: yardSignOptedOut,
          driverLicensePhotoUrl: driverLicensePhotoUrl,
          depositPaymentMethod: depositPaymentMethod,
          checkNumber: checkNumber,
          checkDate: checkDate
        });
      } else {
        // Keep the original status; follow-up checkbox just creates a task (handled inside mutation)
        await markStatusMutation.mutateAsync({ 
          status: selectedStatus,
          notes: saleNotes,
          amount: saleAmount,
          scheduleFollowUp: followUpChecked
        });
      }
    } catch (error) {
      // Error is already handled by mutation onError
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Appointment not found</h2>
        </div>
      </div>
    );
  }

  const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Loading...';

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Unique Product Color Banner */}
      {(checklist?.unique_product_color) && (
        <div className="flex items-center gap-4 px-4 sm:px-6 py-4 bg-orange-50 border-b-2 border-orange-400 dark:bg-orange-500/10 dark:border-orange-500/40">
          <span className="text-3xl flex-shrink-0">⚠️</span>
          <div>
            <p className="text-orange-700 dark:text-orange-300 font-bold text-lg leading-tight">Unique Product Color — Reference Notes</p>
            <p className="text-orange-600 dark:text-orange-400 text-sm font-medium">Customer has a specific/unique color in mind. Review the checklist notes before presenting options.</p>
          </div>
        </div>
      )}
      {/* 1978 Asbestos Banner - top of page */}
      {(checklist?.home_built_era === 'On or before 1978' || checklistV2?.home_built_era === 'On or before 1978') && (
        <div className="flex items-center gap-4 px-4 sm:px-6 py-4 bg-red-50 border-b-2 border-red-400 dark:bg-red-500/10 dark:border-red-500/40">
          <span className="text-3xl flex-shrink-0">🛑</span>
          <div>
            <p className="text-red-700 dark:text-red-300 font-bold text-lg leading-tight">STOP — Home Built On or Before 1978</p>
            <p className="text-red-600 dark:text-red-400 text-sm font-medium">Lead paint & asbestos risk — follow proper protocol and EPA RRP procedures before any demo or installation.</p>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
          >
            <div className="flex flex-col md:flex-row md:items-start gap-6">
              <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg">
                <CalendarIcon className="w-10 h-10" />
              </div>

              <div className="flex-1">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-3xl font-bold text-foreground tracking-tight">{leadName}</h1>
                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant="secondary" className={cn('border text-lg px-4 py-1', statusColors[appointment.status])}>
                        {appointment.status}
                      </Badge>
                    </div>
                  </div>
                  <a href="/MyAppointments">
                    <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
                      <List className="w-4 h-4 mr-2" />
                      View All
                    </Button>
                  </a>
                </div>
              </div>
            </div>

            {/* On My Way Button */}
             {(appointment.status === 'Scheduled' || appointment.status === 'Rescheduled') && (
               <div className="space-y-3">
               <Button
                 onClick={async () => {
                   setSendingOnMyWay(true);
                   try {
                     let userEmail = 'consultant';
                     let userName = 'Design Consultant';
                     try {
                       const user = await base44.auth.me();
                       userEmail = user?.email || userEmail;
                       userName = user?.full_name || userName;
                     } catch (authError) {
                       // User not authenticated (public view), use defaults
                     }

                     // Update appointment status to In Route
                     await base44.entities.Appointment.update(appointmentId, {
                       status: 'In Route',
                       consultant_en_route_time: new Date().toISOString()
                     });

                     // Log the action
                     await base44.entities.AppointmentLog.create({
                       appointment: appointmentId,
                       action: 'En Route',
                       details: `Started en route at ${format(new Date(), 'h:mm a')}`,
                       user_email: userEmail,
                       user_name: userName
                     });

                     // Send SMS notification
                     await base44.functions.invoke('sendAppointmentSMS', {
                       appointmentId,
                       type: 'consultant_on_my_way'
                     });

                     // Refresh appointment data
                     queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
                   } catch (error) {
                     console.error('Failed to send SMS:', error);
                   } finally {
                     setSendingOnMyWay(false);
                   }
                 }}
                 disabled={sendingOnMyWay || !appointment.assigned_dc}
                 className="w-full bg-primary text-primary-foreground hover:opacity-90 h-12"
               >
                 {sendingOnMyWay ? (
                   <>
                     <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                     Sending...
                   </>
                 ) : (
                   <>
                     <Navigation className="w-4 h-4 mr-2" />
                     On My Way
                   </>
                 )}
               </Button>

               {/* Skip to Result */}
               <div className="border border-border rounded-xl overflow-hidden">
                 <button
                   onClick={() => setShowSkipToResult(prev => !prev)}
                   className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:bg-secondary transition-colors"
                 >
                   <span>Skip to Result (no customer notification)</span>
                   {showSkipToResult ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                 </button>
                 {showSkipToResult && (
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-secondary border-t border-border">
                     <Button onClick={() => handleStatusSelect('Sold')} disabled={!appointment.assigned_dc} className="bg-emerald-600 hover:bg-emerald-700 h-11">
                       <Trophy className="w-4 h-4 mr-2" />Sold
                     </Button>
                     <Button onClick={() => handleStatusSelect('Lost')} disabled={!appointment.assigned_dc} variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10 h-11">
                       <X className="w-4 h-4 mr-2" />Lost
                     </Button>
                     <Button onClick={() => handleStatusSelect('Pitch and Miss')} disabled={!appointment.assigned_dc} variant="outline" className="border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-500/30 dark:text-orange-400 dark:hover:bg-orange-500/10 h-11">
                       Pitch and Miss
                     </Button>
                     <Button onClick={() => handleStatusSelect('One-Leg')} disabled={!appointment.assigned_dc} variant="outline" className="border-yellow-200 text-yellow-600 hover:bg-yellow-50 dark:border-yellow-500/30 dark:text-yellow-400 dark:hover:bg-yellow-500/10 h-11">
                       One-Leg
                     </Button>
                     <Button onClick={() => handleStatusSelect('Credit Decline')} disabled={!appointment.assigned_dc} variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10 h-11 col-span-2">
                       Credit Decline
                     </Button>
                   </div>
                 )}
               </div>
               </div>
             )}
            {(appointment.status === 'In Route' || appointment.status === 'On Site') && (
              <div className="w-full space-y-3">
                <div className={cn(
                  "w-full border rounded-xl p-4 text-center transition-all duration-300",
                  appointment.status === 'On Site' 
                    ? "bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/25"
                    : "bg-cyan-50 border-cyan-200 dark:bg-cyan-500/10 dark:border-cyan-500/25"
                )}>
                  <p className={cn(
                    "font-medium",
                    appointment.status === 'On Site' ? "text-green-800 dark:text-green-300" : "text-cyan-800 dark:text-cyan-300"
                  )}>
                    {appointment.status === 'On Site' ? 'On Site with Customer' : 'En Route to Customer'}
                  </p>
                  <p className={cn(
                    "text-sm mt-1",
                    appointment.status === 'On Site' ? "text-green-600 dark:text-green-400" : "text-cyan-600 dark:text-cyan-400"
                  )}>
                    {appointment.status === 'On Site' 
                      ? `Arrived at ${new Date(appointment.consultant_arrived_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
                      : `Started at ${new Date(appointment.consultant_en_route_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
                    }
                  </p>
                </div>
                {appointment.status === 'In Route' && (
                  <Button
                    onClick={async () => {
                      setSendingOnMyWay(true);
                      try {
                        let userEmail = 'consultant';
                        let userName = 'Design Consultant';
                        try {
                          const user = await base44.auth.me();
                          userEmail = user?.email || userEmail;
                          userName = user?.full_name || userName;
                        } catch (authError) {
                          // User not authenticated (public view), use defaults
                        }
                        await base44.entities.Appointment.update(appointmentId, {
                          status: 'On Site',
                          consultant_arrived_time: new Date().toISOString()
                        });
                        await base44.entities.AppointmentLog.create({
                          appointment: appointmentId,
                          action: 'Arrived On Site',
                          details: `Arrived at ${format(new Date(), 'h:mm a')}`,
                          user_email: userEmail,
                          user_name: userName
                        });

                        // Send SMS notification to customer
                        try {
                          await base44.functions.invoke('sendAppointmentSMS', {
                            appointmentId,
                            type: 'consultant_arrived'
                          });
                        } catch (error) {
                          console.error('Failed to send arrival SMS:', error);
                        }

                        queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
                      } catch (error) {
                        console.error('Failed to mark arrived:', error);
                      } finally {
                        setSendingOnMyWay(false);
                      }
                    }}
                    disabled={sendingOnMyWay}
                    className="w-full bg-green-600 hover:bg-green-700 h-12"
                  >
                    {sendingOnMyWay ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Marking Arrived...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        I've Arrived
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Admin Test SMS Button */}
             {currentUser?.role === 'admin' && (
               <Button
                 onClick={async () => {
                   setTestingSMS(true);
                   try {
                     console.log('🧪 TEST SMS: Sending lead_not_sold SMS');
                     console.log('🧪 SMS Type:', 'lead_not_sold');
                     console.log('🧪 Appointment ID:', appointmentId);
                     const response = await base44.functions.invoke('sendAppointmentSMS', {
                       appointmentId,
                       type: 'lead_not_sold'
                     });
                     console.log('🧪 SMS Response:', response.data);
                   } catch (error) {
                     console.error('🧪 SMS Test Failed:', error);
                   } finally {
                     setTestingSMS(false);
                   }
                 }}
                 disabled={testingSMS}
                 variant="outline"
                 className="border-primary/30 text-primary hover:bg-primary/10"
               >
                 {testingSMS ? (
                   <>
                     <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                     Testing SMS...
                   </>
                 ) : (
                   '🧪 Test Not Sold SMS'
                 )}
               </Button>
             )}

            {/* Pitch and Miss Status Actions */}
             {appointment.status === 'Pitch and Miss' && (
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  onClick={() => handleStatusSelect('Sold')}
                  disabled={!appointment.assigned_dc}
                  className="bg-emerald-600 hover:bg-emerald-700 h-12"
                >
                  <Trophy className="w-4 h-4 mr-2" />
                  Mark as Won
                </Button>
                <Button
                  onClick={() => handleStatusSelect('Lost')}
                  disabled={!appointment.assigned_dc}
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10 h-12"
                >
                  <X className="w-4 h-4 mr-2" />
                  Mark as Lost
                </Button>
              </div>
            )}

            {/* One-Leg Status Actions */}
             {appointment.status === 'One-Leg' && (
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  onClick={() => handleStatusSelect('Sold')}
                  disabled={!appointment.assigned_dc}
                  className="bg-emerald-600 hover:bg-emerald-700 h-12"
                >
                  <Trophy className="w-4 h-4 mr-2" />
                  Mark as Won
                </Button>
                <Button
                  onClick={() => handleStatusSelect('Lost')}
                  disabled={!appointment.assigned_dc}
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10 h-12"
                >
                  <X className="w-4 h-4 mr-2" />
                  Mark as Lost
                </Button>
                <Button
                  onClick={() => handleStatusSelect('Pitch and Miss')}
                  disabled={!appointment.assigned_dc}
                  variant="outline"
                  className="border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-500/30 dark:text-orange-400 dark:hover:bg-orange-500/10 h-12 col-span-2"
                >
                  Pitch and Miss
                </Button>
              </div>
            )}

            {/* Follow-Up Status Actions */}
             {appointment.status === 'Follow-Up' && (
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  onClick={() => handleStatusSelect('Sold')}
                  disabled={!appointment.assigned_dc}
                  className="bg-emerald-600 hover:bg-emerald-700 h-12"
                >
                  <Trophy className="w-4 h-4 mr-2" />
                  Mark as Won
                </Button>
                <Button
                  onClick={() => handleStatusSelect('Lost')}
                  disabled={!appointment.assigned_dc}
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10 h-12"
                >
                  <X className="w-4 h-4 mr-2" />
                  Mark as Lost
                </Button>
              </div>
            )}

            {/* Status Action Buttons */}
             {!['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed', 'Cancelled', 'Credit Decline', 'Follow-Up'].includes(appointment.status) && (appointment.status === 'On Site' || appointment.status === 'In Progress') && (
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
               <Button
                 onClick={() => handleStatusSelect('Sold')}
                 disabled={!appointment.assigned_dc}
                 className="bg-emerald-600 hover:bg-emerald-700 h-12"
               >
                 <CheckCircle2 className="w-4 h-4 mr-2" />
                 Mark as Sold
               </Button>
               <Button
                 onClick={() => handleStatusSelect('Lost')}
                 disabled={!appointment.assigned_dc}
                 variant="outline"
                 className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10 h-12"
               >
                 Mark as Lost
               </Button>
               {quotesEnabled && (
                 <Button
                   onClick={() => setShowQuoteDialog(true)}
                   disabled={!appointment.assigned_dc}
                   variant="outline"
                   className="border-primary/30 text-primary hover:bg-primary/10 h-12 col-span-2"
                 >
                   <FileText className="w-4 h-4 mr-2" />
                   Create Quote
                 </Button>
               )}
               <Button
                 onClick={() => handleStatusSelect('Pitch and Miss')}
                 disabled={!appointment.assigned_dc}
                 variant="outline"
                 className="border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-500/30 dark:text-orange-400 dark:hover:bg-orange-500/10 h-12"
               >
                 Pitch and Miss
               </Button>
               <Button
                 onClick={() => handleStatusSelect('One-Leg')}
                 disabled={!appointment.assigned_dc}
                 variant="outline"
                 className="border-yellow-200 text-yellow-600 hover:bg-yellow-50 dark:border-yellow-500/30 dark:text-yellow-400 dark:hover:bg-yellow-500/10 h-12"
               >
                 One-Leg
               </Button>
               <Button
                 onClick={() => handleStatusSelect('Credit Decline')}
                 disabled={!appointment.assigned_dc}
                 variant="outline"
                 className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10 h-12"
               >
                 Credit Decline
               </Button>
               <Button
                 onClick={() => handleStatusSelect('Rescheduled')}
                 disabled={!appointment.assigned_dc}
                 variant="outline"
                 className="border-yellow-200 text-yellow-600 hover:bg-yellow-50 dark:border-yellow-500/30 dark:text-yellow-400 dark:hover:bg-yellow-500/10 h-12 col-span-2"
                 >
                 Needs Rescheduled
               </Button>
               </div>
               )}
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Appointment Details */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Appointment Details
            </h2>
            <div className="space-y-4">
              {appointment.appointment_date && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-brand-blue/12 flex items-center justify-center">
                    <CalendarIcon className="w-5 h-5 text-brand-blue" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Date</p>
                    <p className="text-foreground">
                      {format(new Date(appointment.appointment_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
              )}

              {appointment.appointment_block && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-brand-pink/12 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-brand-pink" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Time Block</p>
                    <p className="text-foreground">{appointment.appointment_block}</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Lead Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Customer Information
            </h2>
            {lead ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                    <p className="text-foreground">{leadName}</p>
                  </div>
                </div>
                <a
                  href={`mailto:${lead.email}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-brand-gold/15 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-brand-gold" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                    <p className="text-foreground group-hover:text-brand-gold transition-colors">
                      {lead.email}
                    </p>
                  </div>
                </a>
                {lead.phone && (
                  <a
                    href={`tel:${lead.phone}`}
                    className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-brand-blue/12 flex items-center justify-center">
                      <Mail className="w-5 h-5 text-brand-blue" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                      <p className="text-foreground group-hover:text-brand-blue transition-colors">
                        {lead.phone}
                      </p>
                    </div>
                  </a>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-4">Loading customer information...</p>
            )}
          </motion.div>

          {/* Location with Street View */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-card rounded-2xl border border-border p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Location
            </h2>
            {appointment.location_address ? (
              <div className="space-y-4">
                <div className="flex items-start gap-4 p-3">
                  <div className="w-10 h-10 rounded-lg bg-brand-gold/15 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-brand-gold" />
                  </div>
                  <div>
                    <p className="text-foreground">{appointment.location_address}</p>
                  </div>
                </div>
                {streetViewLoading ? (
                  <div className="flex items-center justify-center h-64 bg-secondary rounded-xl">
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  </div>
                ) : streetView?.streetViewUrl ? (
                  <div className="rounded-xl overflow-hidden border border-border">
                    <img
                      src={streetView.streetViewUrl}
                      alt="Property Street View"
                      className="w-full h-64 object-cover"
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-6">No location specified</p>
            )}
          </motion.div>

          {/* Notes */}
          {appointment.notes && appointment.notes.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-card rounded-2xl border border-border p-6 md:col-span-2"
            >
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                Notes
              </h2>
              <div className="space-y-3">
                {appointment.notes.map((note, index) => (
                  <div key={index} className="p-4 rounded-lg bg-secondary border border-border">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-primary">{note.context || 'Note'}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{note.user_name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(note.timestamp).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true
                        })}
                      </span>
                    </div>
                    <p className="text-foreground whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Sale Photos */}
          {sale && (sale.folder_photo_url || sale.yard_sign_photo_url) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="bg-card rounded-2xl border border-border p-6 md:col-span-2"
            >
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                Sale Documentation Photos
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sale.folder_photo_url && (
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2">RAZZLE DAZZLE Folder</p>
                    <img 
                      src={sale.folder_photo_url} 
                      alt="RAZZLE DAZZLE Folder" 
                      className="w-full h-64 object-cover rounded-lg border border-border"
                    />
                  </div>
                )}
                {sale.yard_sign_photo_url && (
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2">Yard Sign</p>
                    <img 
                      src={sale.yard_sign_photo_url} 
                      alt="Yard Sign" 
                      className="w-full h-64 object-cover rounded-lg border border-border"
                    />
                  </div>
                )}
                {sale.yard_sign_opted_out && !sale.yard_sign_photo_url && (
                  <div className="flex items-center justify-center h-64 rounded-lg border border-border bg-secondary">
                    <p className="text-sm text-muted-foreground">Customer opted out of yard sign</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* 1978 Banner - always visible when checklist has this value */}
          {(checklist?.home_built_era === 'On or before 1978' || checklistV2?.home_built_era === 'On or before 1978') && (
            <div className="flex items-center gap-4 p-5 bg-red-50 border-2 border-red-500 rounded-xl md:col-span-2 dark:bg-red-500/10 dark:border-red-500/40">
              <span className="text-4xl flex-shrink-0">🛑</span>
              <div>
                <p className="text-red-700 dark:text-red-300 font-bold text-xl">STOP — Home Built On or Before 1978</p>
                <p className="text-red-600 dark:text-red-400 font-medium">Lead paint & asbestos risk — follow proper protocol and EPA RRP procedures before any demo or installation.</p>
              </div>
            </div>
          )}



          {/* Checklist V1 Toggle */}
          {checklist && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-card rounded-2xl border border-border p-6 md:col-span-2"
            >
              <Button
                onClick={() => setShowChecklist(!showChecklist)}
                variant="outline"
                className="w-full h-14 text-left justify-between border-primary/30 hover:bg-primary/10"
              >
                <div className="flex items-center gap-3">
                  <ClipboardCheck className="w-5 h-5 text-primary" />
                  <span className="font-semibold text-foreground">Appointment Setting Checklist</span>
                </div>
                {showChecklist ? (
                  <ChevronUp className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                )}
              </Button>

              {showChecklist && <ChecklistDisplay checklist={checklist} />}
            </motion.div>
          )}

          {/* Checklist V2 Toggle */}
          {checklistV2 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="bg-card rounded-2xl border border-border p-6 md:col-span-2"
            >
              <Button
                onClick={() => setShowChecklist(!showChecklist)}
                variant="outline"
                className="w-full h-14 text-left justify-between border-primary/30 hover:bg-primary/10"
              >
                <div className="flex items-center gap-3">
                  <ClipboardCheck className="w-5 h-5 text-primary" />
                  <span className="font-semibold text-foreground">Appointment Setting Checklist</span>
                </div>
                {showChecklist ? (
                  <ChevronUp className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                )}
              </Button>

              {showChecklist && <ChecklistV2Display checklist={checklistV2} />}
            </motion.div>
          )}
        </div>
      </div>

      {/* Status Dialog */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {followUpChecked ? `Mark as ${selectedStatus} + Follow-Up` : `Mark as ${selectedStatus}`}
            </DialogTitle>
            <DialogDescription>
              {selectedStatus === 'Sold' 
                ? 'Upload the signed contract PDF to proceed with marking this appointment as sold.'
                : followUpChecked
                  ? `This appointment will be marked as Follow-Up and a task will be assigned to the DC.`
                  : `Confirm that you want to mark this appointment as ${selectedStatus}.`
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Pre-Install Checklist Section */}
            {selectedStatus === 'Sold' && !preInstallData && (
              <div className="space-y-3 p-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Pre-Installation Checklist</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">Have the customer sign in person, or send to their email.</p>
                <Button
                  type="button"
                  onClick={() => { setShowStatusDialog(false); setShowPreInstallChecklist(true); }}
                  variant="outline"
                  className="w-full border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/15"
                >
                  <Pen className="w-4 h-4 mr-2" />Sign In Person
                </Button>
                <div className="space-y-2">
                  <Input
                    placeholder="Customer email"
                    type="email"
                    value={standaloneEmail || lead?.email || ''}
                    onChange={(e) => setStandaloneEmail(e.target.value)}
                    className="bg-card"
                  />
                  <Textarea
                    placeholder="Product name / style / color"
                    value={standaloneProductInfo}
                    onChange={(e) => setStandaloneProductInfo(e.target.value)}
                    rows={2}
                    className="bg-card"
                  />
                  {standaloneSent ? (
                    <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Checklist email sent!</p>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleSendStandaloneChecklist}
                      disabled={sendingStandaloneChecklist || !standaloneProductInfo || !(standaloneEmail || lead?.email) || standaloneSent}
                      variant="outline"
                      className="w-full border-primary/30 text-primary hover:bg-primary/10"
                    >
                      {sendingStandaloneChecklist ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : <><Send className="w-4 h-4 mr-2" />Send by Email</>}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Pre-install checklist completed indicator */}
            {selectedStatus === 'Sold' && preInstallData && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200 dark:bg-green-500/10 dark:border-green-500/25">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-800 dark:text-green-300">Pre-Installation Checklist Signed ✓</p>
                  <p className="text-xs text-green-600 dark:text-green-400">Product: {preInstallData.productInfo}</p>
                </div>
              </div>
            )}

            {selectedStatus === 'Sold' && (
              <>
                <div className="space-y-2">
                  <Label>Contract PDF *</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                    className="w-full h-20 border-dashed"
                    disabled={uploadingContract}
                  >
                    {uploadingContract ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5 mr-2" />
                        {contractFileUrl ? 'Contract Uploaded ✓' : 'Click to Upload Contract'}
                      </>
                    )}
                  </Button>
                  {contractFileUrl && (
                    <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Contract uploaded successfully
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount">Sale Amount (optional)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="amount"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={saleAmount}
                      onChange={(e) => setSaleAmount(e.target.value)}
                      disabled={extractingAmount}
                      className="pl-7"
                    />
                    {extractingAmount && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      </div>
                    )}
                  </div>
                  {extractingAmount && (
                    <p className="text-xs text-primary">Extracting amount from PDF...</p>
                  )}
                  {saleAmount && !extractingAmount && (
                    <p className="text-sm text-muted-foreground">
                      Amount: ${parseFloat(saleAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notes {selectedStatus === 'Sold' ? '(optional)' : ''}</Label>
              <Textarea
                id="notes"
                placeholder={`Add notes about this ${selectedStatus.toLowerCase()} outcome...`}
                value={saleNotes}
                onChange={(e) => setSaleNotes(e.target.value)}
                rows={3}
              />
            </div>

            {/* Deal Size for non-sold outcomes */}
            {['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up'].includes(selectedStatus) && (
              <div className="space-y-2">
                <Label htmlFor="not-sold-amount">Deal Size *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="not-sold-amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={saleAmount}
                    onChange={(e) => setSaleAmount(e.target.value)}
                    className="pl-7"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Enter the estimated deal size for this appointment</p>
              </div>
            )}

            {/* Follow-Up checkbox for non-sold outcomes */}
            {['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline'].includes(selectedStatus) && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <Checkbox
                  id="follow-up-checkbox"
                  checked={followUpChecked}
                  onCheckedChange={(checked) => setFollowUpChecked(!!checked)}
                  className="mt-0.5"
                />
                <div>
                  <label htmlFor="follow-up-checkbox" className="text-sm font-medium text-foreground cursor-pointer">
                    Schedule a Follow-Up
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Creates a follow-up task for the DC due in 7 days
                  </p>
                </div>
              </div>
            )}

            {selectedStatus === 'Sold' && (
              <>
              {photoSettings?.require_folder_photo !== false && (
                <div className="space-y-2">
                  <Label>RAZZLE DAZZLE Folder Photo *</Label>
                {uploadingFolderPhoto ? (
                  <div className="flex items-center justify-center h-20 border border-dashed rounded-lg">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    <span className="ml-2 text-sm text-muted-foreground">Uploading...</span>
                  </div>
                ) : folderPhotoUrl ? (
                  <div>
                    <img src={folderPhotoUrl} alt="Folder" className="w-full h-48 object-cover rounded-lg border border-border" />
                    <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2 mt-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Folder photo uploaded
                    </p>
                    <Button
                      type="button"
                      onClick={() => setFolderPhotoUrl('')}
                      variant="outline"
                      size="sm"
                      className="mt-2"
                    >
                      Retake Photo
                    </Button>
                  </div>
                ) : (
                  <CameraCapture 
                    onCapture={handleFolderPhotoCapture}
                    label="Take Photo of Folder"
                  />
                )}
                </div>
              )}

              {photoSettings?.require_yard_sign_photo !== false && (
                <div className="space-y-2">
                  <Label>Yard Sign Photo (visible in yard) *</Label>
                {!yardSignOptedOut && (
                  <>
                    {uploadingYardSignPhoto ? (
                      <div className="flex items-center justify-center h-20 border border-dashed rounded-lg">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <span className="ml-2 text-sm text-muted-foreground">Uploading...</span>
                      </div>
                    ) : yardSignPhotoUrl ? (
                      <div>
                        <img src={yardSignPhotoUrl} alt="Yard Sign" className="w-full h-48 object-cover rounded-lg border border-border" />
                        <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2 mt-2">
                          <CheckCircle2 className="w-4 h-4" />
                          Yard sign photo uploaded
                        </p>
                        <Button
                          type="button"
                          onClick={() => setYardSignPhotoUrl('')}
                          variant="outline"
                          size="sm"
                          className="mt-2"
                        >
                          Retake Photo
                        </Button>
                      </div>
                    ) : (
                      <CameraCapture 
                        onCapture={handleYardSignPhotoCapture}
                        label="Take Photo of Yard Sign"
                      />
                    )}
                  </>
                )}
                <div className="flex items-center space-x-2 pt-2">
                  <Checkbox 
                    id="yard-sign-opt-out" 
                    checked={yardSignOptedOut}
                    onCheckedChange={(checked) => {
                      setYardSignOptedOut(checked);
                      if (checked) setYardSignPhotoUrl('');
                    }}
                  />
                  <label
                    htmlFor="yard-sign-opt-out"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    Customer opted out of yard sign
                  </label>
                </div>
                </div>
              )}

              {/* Final Product Selected Photos */}
              <div className="space-y-2">
                <Label>Final Product Selected Photos (optional)</Label>
                <p className="text-xs text-muted-foreground">Take photos of each product the customer selected. Add as many as needed.</p>
                {productPhotos.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {productPhotos.map((url, idx) => (
                      <div key={idx} className="relative">
                        <img src={url} alt={`Product ${idx + 1}`} className="w-full h-32 object-cover rounded-lg border border-border" />
                        <button
                          type="button"
                          onClick={() => setProductPhotos(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs hover:opacity-90"
                        >
                          ×
                        </button>
                        <p className="text-xs text-center text-muted-foreground mt-1">Product {idx + 1}</p>
                      </div>
                    ))}
                  </div>
                )}
                {uploadingProductPhoto ? (
                  <div className="flex items-center justify-center h-20 border border-dashed rounded-lg">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    <span className="ml-2 text-sm text-muted-foreground">Uploading...</span>
                  </div>
                ) : (
                  <CameraCapture
                    onCapture={handleProductPhotoCapture}
                    label={productPhotos.length === 0 ? "Take Photo of Selected Product" : "Add Another Product Photo"}
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Driver's License Photo *</Label>
                {uploadingDriverLicensePhoto ? (
                  <div className="flex items-center justify-center h-20 border border-dashed rounded-lg">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    <span className="ml-2 text-sm text-muted-foreground">Uploading...</span>
                  </div>
                ) : driverLicensePhotoUrl ? (
                  <div>
                    <img src={driverLicensePhotoUrl} alt="Driver's License" className="w-full h-48 object-cover rounded-lg border border-border" />
                    <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2 mt-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Driver's license photo uploaded
                    </p>
                    <Button
                      type="button"
                      onClick={() => setDriverLicensePhotoUrl('')}
                      variant="outline"
                      size="sm"
                      className="mt-2"
                    >
                      Retake Photo
                    </Button>
                  </div>
                ) : (
                  <CameraCapture 
                    onCapture={handleDriverLicensePhotoCapture}
                    label="Take Photo of Driver's License"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="deposit-payment-method">50% Deposit Payment Method *</Label>
                <Select value={depositPaymentMethod} onValueChange={(value) => {
                  setDepositPaymentMethod(value);
                  setCheckDepositCompleted(false);
                  setCheckDate('');
                  setCheckNumber('');
                }}>
                  <SelectTrigger id="deposit-payment-method">
                    <SelectValue placeholder="Select payment method..." />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4} className="z-[200]">
                    <SelectItem value="Check">Check</SelectItem>
                    <SelectItem value="Post-Dated Check">Post-Dated Check</SelectItem>
                    <SelectItem value="Credit Card">Credit Card</SelectItem>
                    <SelectItem value="Financing - Synchrony">Financing - Synchrony</SelectItem>
                    <SelectItem value="Financing - MOMNT">Financing - MOMNT</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Wire">Wire</SelectItem>
                    <SelectItem value="Zelle">Zelle</SelectItem>
                    <SelectItem value="Customer Payment Drop Off">Customer Payment Drop Off</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(depositPaymentMethod === 'Check' || depositPaymentMethod === 'Post-Dated Check') && (
                <div className="space-y-2">
                  <Label htmlFor="check-number">Check Number *</Label>
                  <Input
                    id="check-number"
                    type="text"
                    placeholder="Enter check number"
                    value={checkNumber}
                    onChange={(e) => setCheckNumber(e.target.value)}
                  />
                </div>
              )}

              {depositPaymentMethod === 'Post-Dated Check' && (
                <div className="space-y-2">
                  <Label htmlFor="check-date">Check Date *</Label>
                  <Input
                    id="check-date"
                    type="date"
                    value={checkDate}
                    onChange={(e) => setCheckDate(e.target.value)}
                  />
                </div>
              )}

              {depositPaymentMethod === 'Check' && !checkDepositCompleted && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3 dark:bg-blue-500/10 dark:border-blue-500/25">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                    Please deposit the check using the Chase Mobile App:
                  </p>
                  <ol className="text-sm text-blue-800 dark:text-blue-300 space-y-1 list-decimal list-inside">
                    <li>Open the Chase Mobile app</li>
                    <li>Select "Deposit" and "Remote Deposit"</li>
                    <li>Follow the prompts to photograph and deposit the check</li>
                  </ol>
                  <Button
                    type="button"
                    onClick={() => setCheckDepositCompleted(true)}
                    className="w-full bg-primary text-primary-foreground hover:opacity-90"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    I've Completed the Deposit
                  </Button>
                </div>
              )}

              {depositPaymentMethod === 'Check' && checkDepositCompleted && (
                <div className="p-4 bg-green-50 border border-green-200 dark:bg-green-500/10 dark:border-green-500/25 rounded-lg">
                  <p className="text-sm text-green-800 dark:text-green-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Check deposit completed
                  </p>
                </div>
              )}

              {depositPaymentMethod && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="deposit-amount">Deposit Amount *</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        id="deposit-amount"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        className="pl-7"
                      />
                    </div>
                    {depositAmount && (
                      <p className="text-sm text-muted-foreground">
                        Deposit: ${parseFloat(depositAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="installation-date">Installation Date *</Label>
                    <Input
                      id="installation-date"
                      type="date"
                      value={appointment?.installation_date || ''}
                      onChange={async (e) => {
                        await base44.entities.Appointment.update(appointmentId, {
                          installation_date: e.target.value
                        });
                        queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
                      }}
                    />
                  </div>
                </>
              )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowStatusDialog(false);
                setContractFileUrl('');
                setSaleNotes('');
                setSaleAmount('');
                setDepositAmount('');
                setFolderPhotoUrl('');
                setYardSignPhotoUrl('');
                setYardSignOptedOut(false);
                setDriverLicensePhotoUrl('');
                setProductPhotos([]);
                setDepositPaymentMethod('');
                setCheckNumber('');
                setCheckDate('');
                setCheckDepositCompleted(false);
                setFollowUpChecked(false);
                setStandaloneSent(false);
                setStandaloneEmail('');
                setStandaloneProductInfo('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitStatus}
              disabled={
                (['Lost', 'Pitch and Miss', 'One-Leg', 'Credit Decline', 'Follow-Up'].includes(selectedStatus) && !saleAmount) ||
                (selectedStatus === 'Sold' && (
                  !contractFileUrl || 
                  !appointment?.installation_date ||
                  (photoSettings?.require_folder_photo !== false && !folderPhotoUrl) ||
                  (photoSettings?.require_yard_sign_photo !== false && !yardSignPhotoUrl && !yardSignOptedOut) ||
                  !driverLicensePhotoUrl ||
                  // productPhotos.length === 0 || // product photos are optional
                  !depositPaymentMethod ||
                  !depositAmount ||
                  (depositPaymentMethod === 'Check' && (!checkNumber || !checkDepositCompleted)) ||
                  (depositPaymentMethod === 'Post-Dated Check' && (!checkNumber || !checkDate))
                )) || 
                markStatusMutation.isPending
              }
              className={cn(
                selectedStatus === 'Sold' && 'bg-emerald-600 hover:bg-emerald-700'
              )}
            >
              {markStatusMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                `Confirm ${selectedStatus}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PreInstallChecklistModal
        open={showPreInstallChecklist}
        onClose={() => setShowPreInstallChecklist(false)}
        onComplete={handlePreInstallComplete}
        lead={lead}
      />

      <CreateQuoteDialog
        open={showQuoteDialog}
        onClose={() => setShowQuoteDialog(false)}
        lead={lead}
        appointment={appointment}
        appointmentId={appointmentId}
      />

    </div>
  );
}