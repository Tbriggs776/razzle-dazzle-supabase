import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ArrowLeft, 
  Calendar as CalendarIcon, 
  Clock,
  User,
  Mail,
  Phone,
  Loader2,
  FileText,
  DollarSign,
  Edit,
  CheckCircle2,
  Circle,
  MapPin,
  UserPlus,
  Copy,
  Link as LinkIcon,
  ExternalLink,
  Trash2,
  Download,
  MessageSquare,
  Activity,
  Image,
  Upload,
  X,
  Paperclip
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import * as Bytescale from "@bytescale/sdk";
import TeamNotesSection from '@/components/projects/TeamNotesSection';
import { generatePreInstallPDF } from '@/utils/generatePreInstallPDF';
import ImageDescriptionInput from '@/components/projects/ImageDescriptionInput';
import ProjectDialogs from '@/components/projects/ProjectDialogs';
import InspectionReportsSection from '@/components/projects/InspectionReportsSection';
import DesignModsSection from '@/components/projects/DesignModsSection';
import ProjectClaimsSection from '@/components/projects/ProjectClaimsSection';
import InstallationCheckpointsSection from '@/components/projects/InstallationCheckpointsSection';
import RFMSOrderNotes from '@/components/projects/RFMSOrderNotes';
import ProjectProgressTracker from '@/components/projects/ProjectProgressTracker';
import TagSelector from '@/components/tags/TagSelector';
import PhotoLightbox from '@/components/PhotoLightbox';

const statusColors = {
'Cancelled': 'bg-red-100 text-red-800 border-red-200',
'Accepted': 'bg-blue-100 text-blue-800 border-blue-200',
  'Materials Ordered': 'bg-purple-100 text-purple-800 border-purple-200',
  'Scheduled': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'In Progress': 'bg-orange-100 text-orange-800 border-orange-200',
  'Quality Checks': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  'Completed': 'bg-green-100 text-green-800 border-green-200'
};

const statusSteps = [
  'Accepted',
  'Scheduled',
  'Materials Ordered',
  'In Progress',
  'Quality Checks',
  'Completed'
];

export default function ProjectDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false);
  const [sendingSMS, setSendingSMS] = useState(false);
  const [smsPreview, setSmsPreview] = useState('');
  const [editData, setEditData] = useState({});
  const [assignData, setAssignData] = useState({
    project_manager: '',
    installation_manager: ''
  });
  const [showSetInstallationDialog, setShowSetInstallationDialog] = useState(false);
  const [installationDateData, setInstallationDateData] = useState('');
  const [installationDateStatusData, setInstallationDateStatusData] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [newNote, setNewNote] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [downloadingChecklistPDF, setDownloadingChecklistPDF] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const projects = await base44.entities.Project.filter({ id: projectId });
      const proj = projects[0];
      
      if (!proj) return null;
      
      // Auto-generate tracker URL if not exists
      if (!proj.project_tracker_url) {
        const fullUrl = `${window.location.origin}/CustomerProjectView?id=${projectId}`;
        try {
          const { data } = await base44.functions.invoke('shortenUrl', { originalURL: fullUrl });
          await base44.entities.Project.update(projectId, { project_tracker_url: data.shortURL });
          proj.project_tracker_url = data.shortURL;
        } catch (error) {
          console.error('Failed to generate tracker URL:', error);
        }
      }
      
      return proj;
    },
    enabled: !!projectId
  });

  const { data: customer } = useQuery({
    queryKey: ['customer', project?.customer],
    queryFn: async () => {
      const customers = await base44.entities.Customer.filter({ id: project.customer });
      return customers[0];
    },
    enabled: !!project?.customer
  });

  const { data: sale } = useQuery({
    queryKey: ['sale', project?.sale],
    queryFn: async () => {
      const sales = await base44.entities.Sale.filter({ id: project.sale });
      return sales[0];
    },
    enabled: !!project?.sale
  });

  const { data: projectManager } = useQuery({
    queryKey: ['projectManager', project?.project_manager],
    queryFn: async () => {
      if (!project?.project_manager) return null;
      const members = await base44.entities.TeamMember.filter({ id: project.project_manager });
      return members[0];
    },
    enabled: !!project?.project_manager
  });

  const { data: installationManager } = useQuery({
    queryKey: ['installationManager', project?.installation_manager],
    queryFn: async () => {
      if (!project?.installation_manager) return null;
      const members = await base44.entities.TeamMember.filter({ id: project.installation_manager });
      return members[0];
    },
    enabled: !!project?.installation_manager
  });

  const { data: allTeamMembers = [] } = useQuery({
    queryKey: ['allTeamMembers'],
    queryFn: () => base44.entities.TeamMember.list()
  });

  const { data: appointment } = useQuery({
    queryKey: ['appointment', sale?.appointment],
    queryFn: async () => {
      const appointments = await base44.entities.Appointment.filter({ id: sale.appointment });
      return appointments[0];
    },
    enabled: !!sale?.appointment
  });

  const { data: checklist } = useQuery({
    queryKey: ['checklist', sale?.appointment],
    queryFn: async () => {
      const checklists = await base44.entities.AppointmentSettingChecklist.filter({ appointment: sale.appointment });
      return checklists[0] || null;
    },
    enabled: !!sale?.appointment
  });

  const { data: checklistV2 } = useQuery({
    queryKey: ['checklistV2ByAppt', sale?.appointment],
    queryFn: async () => {
      const results = await base44.entities.ChecklistV2.filter({ appointment: sale.appointment });
      return results[0] || null;
    },
    enabled: !!sale?.appointment
  });

  const isPreConstruction1978 = checklist?.home_built_era === 'On or before 1978' || checklistV2?.home_built_era === 'On or before 1978';

  const { data: smsSettings } = useQuery({
    queryKey: ['smsSettings'],
    queryFn: async () => {
      const settings = await base44.entities.SMSSettings.list();
      return settings[0];
    }
  });

  const { data: projectLogs = [] } = useQuery({
    queryKey: ['projectLogs', projectId],
    queryFn: () => base44.entities.ProjectLog.filter({ project: projectId }),
    enabled: !!projectId
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: currentTeamMember } = useQuery({
    queryKey: ['currentTeamMember', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return null;
      const members = await base44.entities.TeamMember.filter({ email: currentUser.email });
      return members[0];
    },
    enabled: !!currentUser?.email
  });

  // Generate SMS preview
  React.useEffect(() => {
    if (smsSettings?.customer_project_created_template && customer && project?.project_tracker_url) {
      const preview = smsSettings.customer_project_created_template
        .replace('{customer_first_name}', customer.first_name || '')
        .replace('{project_tracker_url}', project.project_tracker_url);
      setSmsPreview(preview);
    }
  }, [smsSettings, customer, project]);

  const updateProjectMutation = useMutation({
    mutationFn: async (updates) => {
      await base44.entities.Project.update(projectId, updates);
      if (updates.status && updates.status !== project?.status) {
        await base44.entities.ProjectLog.create({
          project: projectId,
          action: `Status Changed to ${updates.status}`,
          details: `Project moved to ${updates.status}`,
          user_email: currentUser?.email,
          user_name: currentUser?.full_name
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projectLogs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projectManager'] });
      queryClient.invalidateQueries({ queryKey: ['installationManager'] });
      setShowEditDialog(false);
      setShowAssignDialog(false);
      setUpdatingStatus(null);
    }
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Project.delete(projectId);
    },
    onSuccess: () => {
      navigate(createPageUrl('Projects'));
    }
  });



  const handleEditClick = () => {
    setEditData({
      status: project.status || '',
      installation_date: project.installation_date || '',
      scheduled_start_date: project.scheduled_start_date || '',
      scheduled_end_date: project.scheduled_end_date || '',
      actual_start_date: project.actual_start_date || '',
      actual_completion_date: project.actual_completion_date || '',
      project_notes: project.project_notes || '',
      materials_notes: project.materials_notes || '',
      quality_check_notes: project.quality_check_notes || ''
    });
    setShowEditDialog(true);
  };

  const handleEditSubmit = () => {
    const updates = { ...editData };
    // Auto-set status to "Scheduled" if installation_date is set and status is still "Accepted"
    if (editData.installation_date && editData.status === 'Accepted') {
      updates.status = 'Scheduled';
    }
    updateProjectMutation.mutate(updates);
  };

  const handleAssignClick = () => {
    setAssignData({
      project_manager: project.project_manager || '',
      installation_manager: project.installation_manager || ''
    });
    setShowAssignDialog(true);
  };

  const handleAssignSubmit = () => {
    updateProjectMutation.mutate(assignData);
  };

  const handleRescheduleClick = () => {
    setEditData({ installation_date: project.installation_date || '' });
    setInstallationDateStatusData(project.installation_date_status || '');
    setShowRescheduleDialog(true);
  };

  const handleRescheduleSubmit = () => {
    const wasOnHold = project.installation_date_status && ['pending payment','pending contract','on hold','pending cancellation'].includes(project.installation_date_status);
    const isNowCleared = !installationDateStatusData || !['pending payment','pending contract','on hold','pending cancellation'].includes(installationDateStatusData);
    updateProjectMutation.mutate({ installation_date: editData.installation_date, installation_date_status: installationDateStatusData, status: 'Scheduled', ...(wasOnHold && isNowCleared ? { hold_cleared_date: new Date().toISOString() } : {}) });
    setShowRescheduleDialog(false);
  };

  const handleSetInstallationClick = () => {
    setInstallationDateData(project.installation_date || '');
    setInstallationDateStatusData(project.installation_date_status || '');
    setShowSetInstallationDialog(true);
  };

  const handleSetInstallationSubmit = () => {
    updateProjectMutation.mutate({ 
      installation_date: installationDateData,
      installation_date_status: installationDateStatusData,
      status: 'Scheduled'
    });
    setShowSetInstallationDialog(false);
  };

  const handleCopyTrackerUrl = () => {
    if (project.project_tracker_url) {
      navigator.clipboard.writeText(project.project_tracker_url);
    }
  };

  const handleSendTrackerSMS = async () => {
    if (!customer?.phone || !project.project_tracker_url) return;
    
    setSendingSMS(true);
    try {
      const settings = await base44.entities.SMSSettings.list();
      const smsSettings = settings[0];
      
      if (smsSettings?.customer_project_created_template) {
        const message = smsSettings.customer_project_created_template
          .replace('{customer_first_name}', customer.first_name || '')
          .replace('{project_tracker_url}', project.project_tracker_url);

        await base44.functions.invoke('sendSMS', {
          to: customer.phone,
          message
        });

        // Log the activity
        await base44.entities.ProjectLog.create({
          project: projectId,
          action: 'SMS Sent',
          details: `Project tracker SMS sent to ${customer.first_name} ${customer.last_name} (${customer.phone})`,
          user_email: currentUser?.email,
          user_name: currentUser?.full_name
        });

        queryClient.invalidateQueries({ queryKey: ['projectLogs', projectId] });
        
        alert('SMS sent successfully!');
      }
    } catch (error) {
      console.error('Failed to send SMS:', error);
      alert('Failed to send SMS');
    } finally {
      setSendingSMS(false);
    }
  };

  const handleCustomerExperienceAction = async (actionType) => {
    const fieldName = `${actionType}_date`;
    const actionLabels = {
      'welcome_call_attempted': 'Welcome Call Attempted',
      'welcome_call_completed': 'Welcome Call Completed',
      'check_in_attempted': 'Check-In Attempted',
      'check_in_completed': 'Check-In Completed',
      'pre_install_call_attempted': 'Pre-Install Call Attempted',
      'pre_install_call_completed': 'Pre-Install Call Completed',
      'qa_in_progress': 'QA In Progress',
      'qa_completed': 'QA Completed'
    };

    try {
      // Update project with timestamp
      await base44.entities.Project.update(projectId, {
        [fieldName]: new Date().toISOString(),
        ...(actionType === 'qa_in_progress' ? { status: 'Quality Checks' } : {})
      });

      // Log the activity
      await base44.entities.ProjectLog.create({
        project: projectId,
        action: actionLabels[actionType],
        details: `Customer experience milestone logged`,
        user_email: currentUser?.email,
        user_name: currentUser?.full_name
      });

      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projectLogs', projectId] });
    } catch (error) {
      console.error('Failed to log action:', error);
      alert('Failed to log action');
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    const updatedNotes = [
      ...(project.notes || []),
      { content: newNote, user_name: currentUser?.full_name || currentUser?.email, user_email: currentUser?.email, timestamp: new Date().toISOString(), reactions: [] }
    ];
    try {
      await base44.entities.Project.update(projectId, { notes: updatedNotes });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setNewNote('');
      // Also append as a private note to RFMS if the sale has an invoice number
      if (sale?.invoice_number) {
        try {
          await base44.functions.invoke('appendRFMSOrderNotes', {
            documentNumber: sale.invoice_number,
            noteType: 'privateNotes',
            noteText: newNote.trim()
          });
          queryClient.invalidateQueries({ queryKey: ['rfmsOrderNotes', sale.invoice_number] });
        } catch (rfmsError) {
          console.error('Failed to append note to RFMS:', rfmsError);
        }
      }
    } catch (error) {
      console.error('Failed to add note:', error);
      alert('Failed to add note');
    }
  };

  const handleAddReaction = async (noteIndex, emoji) => {
    const updatedNotes = [...project.notes];
    const note = updatedNotes[noteIndex];
    if (!note.reactions) note.reactions = [];
    const reactionIndex = note.reactions.findIndex(r => r.emoji === emoji);
    if (reactionIndex > -1) {
      const userIndex = note.reactions[reactionIndex].users.indexOf(currentUser?.email);
      if (userIndex > -1) {
        note.reactions[reactionIndex].users.splice(userIndex, 1);
        if (note.reactions[reactionIndex].users.length === 0) note.reactions.splice(reactionIndex, 1);
      } else {
        note.reactions[reactionIndex].users.push(currentUser?.email);
      }
    } else {
      note.reactions.push({ emoji, users: [currentUser?.email] });
    }
    try {
      await base44.entities.Project.update(projectId, { notes: updatedNotes });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (error) {
      console.error('Failed to update reaction:', error);
    }
  };

  const handleImageUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setUploadingImage(true);
    try {
      const uploadManager = new Bytescale.UploadManager({
        apiKey: "public_223k2X95KYxtnQTr5pfZZakKp58x"
      });

      const newImages = await Promise.all(files.map(async (file) => {
        const { fileUrl } = await uploadManager.upload({ data: file });
        return {
          url: fileUrl,
          user_name: currentUser?.full_name || currentUser?.email,
          user_email: currentUser?.email,
          timestamp: new Date().toISOString(),
          description: ''
        };
      }));

      const updatedImages = [...(project.images || []), ...newImages];
      await base44.entities.Project.update(projectId, { images: updatedImages });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (error) {
      console.error('Failed to upload image:', error);
      alert('Failed to upload image');
    } finally {
      setUploadingImage(false);
      event.target.value = '';
    }
  };

  const handleUpdateImageDescription = async (imageIndex, description) => {
    const updatedImages = project.images.map((img, i) => 
      i === imageIndex ? { ...(typeof img === 'string' ? { url: img } : img), description } : img
    );
    await base44.entities.Project.update(projectId, { images: updatedImages });
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };

  const handleDeleteImage = async (indexToDelete) => {
    const updatedImages = project.images.filter((_, index) => index !== indexToDelete);
    try {
      await base44.entities.Project.update(projectId, { images: updatedImages });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (error) {
      console.error('Failed to delete image:', error);
      alert('Failed to delete image');
    }
  };

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploadingFile(true);
    try {
      const uploadManager = new Bytescale.UploadManager({ apiKey: "public_223k2X95KYxtnQTr5pfZZakKp58x" });
      const newFiles = await Promise.all(files.map(async (file) => {
        const { fileUrl } = await uploadManager.upload({ data: file });
        return {
          url: fileUrl,
          name: file.name,
          user_name: currentUser?.full_name || currentUser?.email,
          user_email: currentUser?.email,
          timestamp: new Date().toISOString()
        };
      }));
      const updatedFiles = [...(project.files || []), ...newFiles];
      await base44.entities.Project.update(projectId, { files: updatedFiles });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (error) {
      console.error('Failed to upload file:', error);
      alert('Failed to upload file');
    } finally {
      setUploadingFile(false);
      event.target.value = '';
    }
  };

  const handleDeleteFile = async (indexToDelete) => {
    const updatedFiles = project.files.filter((_, index) => index !== indexToDelete);
    try {
      await base44.entities.Project.update(projectId, { files: updatedFiles });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (error) {
      console.error('Failed to delete file:', error);
      alert('Failed to delete file');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Project not found</h2>
          <Link to={createPageUrl('Projects')} className="text-indigo-600 hover:underline">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const projectImageUrls = project?.images ? project.images.map(img => typeof img === 'string' ? img : img.url) : [];
  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Loading...';
  
  // Map backend status to display status
  let displayStatus = project.status;
  if (project.status === 'Accepted' && project.installation_date) {
    displayStatus = 'Scheduled';
  }
  
  const currentStepIndex = statusSteps.indexOf(displayStatus);

  // Get latest customer experience action
  const getLatestCustomerExperience = () => {
    const actions = [
      { date: project.welcome_call_attempted_date, label: 'Welcome Call Attempted', color: 'bg-blue-100 text-blue-800 border-blue-200' },
      { date: project.welcome_call_completed_date, label: 'Welcome Call Completed', color: 'bg-green-100 text-green-800 border-green-200' },
      { date: project.check_in_attempted_date, label: 'Check-In Attempted', color: 'bg-blue-100 text-blue-800 border-blue-200' },
      { date: project.check_in_completed_date, label: 'Check-In Completed', color: 'bg-green-100 text-green-800 border-green-200' },
      { date: project.pre_install_call_attempted_date, label: 'Pre-Install Call Attempted', color: 'bg-blue-100 text-blue-800 border-blue-200' },
      { date: project.pre_install_call_completed_date, label: 'Pre-Install Call Completed', color: 'bg-green-100 text-green-800 border-green-200' },
      { date: project.qa_in_progress_date, label: 'QA In Progress', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
      { date: project.qa_completed_date, label: 'QA Completed', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
    ].filter(a => a.date);
    
    if (actions.length === 0) return null;
    
    return actions.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  };

  const latestCustomerExperience = getLatestCustomerExperience();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Link
            to={createPageUrl('Projects')}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
          >
            <div className="flex flex-col md:flex-row md:items-start gap-6">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-xl shadow-indigo-200">
              <FileText className="w-10 h-10" />
            </div>

            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">{customerName}</h1>
              <div className="mt-2 mb-1">
                <TagSelector
                  selectedTagIds={project.tags || []}
                  onChange={(tags) => updateProjectMutation.mutate({ tags })}
                  className="w-64"
                />
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <Badge variant="secondary" className={cn('border text-lg px-4 py-1', statusColors[project.status])}>
                  {project.status}
                </Badge>
                {project.installation_date_status && (
                  <Badge className="border text-lg px-4 py-1 bg-red-100 text-red-800 border-red-200">
                    {project.installation_date_status}
                  </Badge>
                )}
                {latestCustomerExperience && (
                  <Badge variant="secondary" className={cn('border px-3 py-1', latestCustomerExperience.color)}>
                    {latestCustomerExperience.label}
                  </Badge>
                )}
              </div>
              {sale && (() => {
                const lines = sale.rfms_order_data?.result?.lines || sale.rfms_order_data?.order?.result?.lines;
                const isGlueDown = lines?.some(l => [l.styleName, l.supplierName, l.colorName, l.description].some(v => v?.toLowerCase().includes('glue')));
                return isGlueDown ? (
                  <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-amber-100 border border-amber-300 rounded-lg text-amber-800 font-semibold text-sm">
                    🔧 Glue Down Project
                  </div>
                ) : null;
              })()}
              {project.created_by && (
                <p className="text-xs text-slate-400 mt-2">
                  Created by <span className="font-medium text-slate-500">{project.created_by}</span>
                  {project.created_date && (
                    <> on {format(new Date(project.created_date), 'MMM d, yyyy')} at {format(new Date(project.created_date), 'h:mm a')}</>
                  )}
                </p>
              )}
            </div>

              <div className="flex gap-3">
                {project.project_tracker_url && (
                  <Button
                    onClick={() => window.open(project.project_tracker_url, '_blank')}
                    variant="outline"
                    className="border-purple-200 text-purple-600 hover:bg-purple-50"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Customer View
                  </Button>
                )}
                <Button
                  onClick={handleEditClick}
                  variant="outline"
                  className="border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Project
                </Button>
                {project.status !== 'Cancelled' ? (
                  <Button
                    onClick={() => setShowCancelDialog(true)}
                    variant="outline"
                    className="border-red-200 text-red-600 hover:bg-red-50"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Cancel Project
                  </Button>
                ) : (
                  <Button
                    onClick={async () => {
                      const restoreStatus = project.pre_cancelled_status || 'Accepted';
                      await updateProjectMutation.mutateAsync({
                        status: restoreStatus,
                        installation_date_status: null,
                        cancelled_date: null,
                        cancelled_by: null,
                        cancelled_reason: null,
                        pre_cancelled_status: null
                      });
                      if (sale?.id) {
                        await base44.entities.Sale.update(sale.id, {
                          is_cancelled: false,
                          cancelled_date: null,
                          cancelled_reason: null
                        });
                        queryClient.invalidateQueries({ queryKey: ['sale', sale.id] });
                      }
                      await base44.entities.ProjectLog.create({
                        project: projectId,
                        action: 'Cancellation Removed',
                        details: `Project restored to ${restoreStatus}`,
                        user_email: currentUser?.email,
                        user_name: currentUser?.full_name
                      });
                      queryClient.invalidateQueries({ queryKey: ['projectLogs', projectId] });
                    }}
                    variant="outline"
                    className="border-green-200 text-green-600 hover:bg-green-50"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Restore Project
                  </Button>
                )}
                <Button
                  onClick={() => setShowDeleteDialog(true)}
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>

            {project.status === 'Cancelled' && (
              <div className="bg-red-50 border border-red-300 rounded-xl px-5 py-4 flex items-center gap-3">
                <span className="text-2xl">🚫</span>
                <div className="flex-1">
                  <p className="font-bold text-red-800 text-sm uppercase tracking-wide">Project Cancelled</p>
                  {project.cancelled_date && (
                    <p className="text-red-700 text-sm mt-0.5">
                      {project.cancelled_by && <span>By {project.cancelled_by} · </span>}
                      {format(new Date(project.cancelled_date), 'MMM d, yyyy h:mm a')}
                    </p>
                  )}
                  {project.cancelled_reason && (
                    <p className="text-red-600 text-sm mt-0.5">Reason: {project.cancelled_reason}</p>
                  )}
                </div>
              </div>
            )}

            {isPreConstruction1978 && (
              <div className="bg-red-50 border border-red-300 rounded-xl px-5 py-4 flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <p className="font-bold text-red-800 text-sm uppercase tracking-wide">Pre-1978 Home — Lead Paint & Asbestos Notice Required</p>
                  <p className="text-red-700 text-sm mt-0.5">This home was built on or before 1978. Ensure all required lead paint disclosures, asbestos precautions, and EPA RRP protocols are followed.</p>
                </div>
              </div>
            )}

            <ProjectProgressTracker project={project} projectLogs={projectLogs} />
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Sale Documentation Photos */}
          {sale && (sale.folder_photo_url || sale.yard_sign_photo_url || sale.driver_license_photo_url) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Sale Documentation Photos
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sale.folder_photo_url && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700">RAZZLE DAZZLE Folder</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = sale.folder_photo_url;
                          link.download = 'folder-photo.jpg';
                          link.click();
                        }}
                        className="h-7 px-2 text-xs"
                      >
                        <Download className="w-3 h-3" />
                      </Button>
                    </div>
                    <img 
                      src={sale.folder_photo_url} 
                      alt="RAZZLE DAZZLE Folder" 
                      className="w-full h-64 object-cover rounded-lg border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => window.open(sale.folder_photo_url, '_blank')}
                    />
                  </div>
                )}
                {sale.yard_sign_photo_url && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700">Yard Sign</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = sale.yard_sign_photo_url;
                          link.download = 'yard-sign-photo.jpg';
                          link.click();
                        }}
                        className="h-7 px-2 text-xs"
                      >
                        <Download className="w-3 h-3" />
                      </Button>
                    </div>
                    <img 
                      src={sale.yard_sign_photo_url} 
                      alt="Yard Sign" 
                      className="w-full h-64 object-cover rounded-lg border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => window.open(sale.yard_sign_photo_url, '_blank')}
                    />
                  </div>
                )}
                {sale.driver_license_photo_url && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700">Driver's License</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const response = await fetch(sale.driver_license_photo_url, {
                              mode: 'cors'
                            });
                            const blob = await response.blob();
                            const url = window.URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.style.display = 'none';
                            link.href = url;
                            link.setAttribute('download', `${customer?.last_name || 'customer'}-drivers-license.jpg`);
                            document.body.appendChild(link);
                            link.click();
                            setTimeout(() => {
                              document.body.removeChild(link);
                              window.URL.revokeObjectURL(url);
                            }, 100);
                          } catch (error) {
                            console.error('Download failed:', error);
                            window.open(sale.driver_license_photo_url, '_blank');
                          }
                        }}
                        className="h-7 px-2 text-xs"
                      >
                        <Download className="w-3 h-3" />
                      </Button>
                    </div>
                    <img 
                      src={sale.driver_license_photo_url} 
                      alt="Driver's License" 
                      className="w-full h-64 object-cover rounded-lg border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => window.open(sale.driver_license_photo_url, '_blank')}
                    />
                  </div>
                )}
                {sale.yard_sign_opted_out && !sale.yard_sign_photo_url && (
                  <div className="flex items-center justify-center h-64 rounded-lg border border-slate-200 bg-slate-50">
                    <p className="text-sm text-slate-500">Customer opted out of yard sign</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Customer Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Customer Information
            </h2>
            {customer ? (
              <div className="space-y-4">
                <Link
                  to={createPageUrl('CustomerDetail') + `?id=${customer.id}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                    <User className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-slate-400 mb-0.5">Name</p>
                    <p className="text-slate-800 group-hover:text-indigo-600 transition-colors">
                      {customerName}
                    </p>
                  </div>
                </Link>
                <a
                  href={`mailto:${customer.email}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Email</p>
                    <p className="text-slate-800 group-hover:text-green-600 transition-colors">
                      {customer.email}
                    </p>
                  </div>
                </a>
                {customer.phone && (
                  <a
                    href={`tel:${customer.phone}`}
                    className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Phone className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Phone</p>
                      <p className="text-slate-800 group-hover:text-blue-600 transition-colors">
                        {customer.phone}
                      </p>
                    </div>
                  </a>
                )}
              </div>
            ) : (
              <p className="text-slate-400 text-center py-4">Loading customer information...</p>
            )}
          </motion.div>

          {/* Sale Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Related Sale
            </h2>
            {sale ? (
              <div className="space-y-4">
                <Link
                  to={createPageUrl('SaleDetail') + `?id=${sale.id}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Sale Amount</p>
                    <p className="text-slate-800 group-hover:text-emerald-600 transition-colors text-lg font-semibold">
                      {sale.sale_amount ? `$${sale.sale_amount.toLocaleString()}` : 'N/A'}
                    </p>
                    {sale.invoice_number && (
                      <p className="text-xs text-slate-500 mt-1">Invoice #{sale.invoice_number}</p>
                    )}
                  </div>
                </Link>
                {project.installation_date && (
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-yellow-50 border border-yellow-100">
                    <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                      <CalendarIcon className="w-5 h-5 text-yellow-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-yellow-600 mb-0.5">Installation Date</p>
                      <div className="flex items-center gap-2">
                        <p className="text-slate-800 font-semibold">
                          {format(new Date(project.installation_date + 'T00:00:00'), 'MMMM d, yyyy')}
                        </p>
                        {project.installation_date_status && (
                          <span className="text-xs font-semibold text-red-600 bg-red-100 px-2 py-1 rounded capitalize">
                            {project.installation_date_status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <Button
                  disabled={downloadingChecklistPDF}
                  onClick={async () => {
                    setDownloadingChecklistPDF(true);
                    try {
                      await generatePreInstallPDF({
                        customerName: customer ? `${customer.first_name} ${customer.last_name}` : 'Customer',
                        productInfo: project.pre_install_product_info || '',
                        signatureUrl: project.pre_install_checklist_signature_url,
                        saleDate: sale?.sale_date
                      });
                    } finally {
                      setDownloadingChecklistPDF(false);
                    }
                  }}
                  variant="outline"
                  className="w-full border-green-200 text-green-700 hover:bg-green-50"
                >
                  {downloadingChecklistPDF ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                  Download Pre-Install Checklist
                </Button>
                {sale.contract_file_url && (
                  <Button
                    onClick={() => window.open(sale.contract_file_url, '_blank')}
                    variant="outline"
                    className="w-full border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Contract
                  </Button>
                )}


              </div>
            ) : (
              <p className="text-slate-400 text-center py-4">Loading sale information...</p>
            )}
          </motion.div>

          {/* Order Processor Tools */}
          {(currentUser?.role === 'admin' || currentTeamMember?.role === 'Order Processor' || currentTeamMember?.role === 'Customer Experience Coordinator') && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Order Processor Tools
              </h2>
              <div className="space-y-3">
                {!project.installation_date && (
                  <Button
                    onClick={handleSetInstallationClick}
                    variant="outline"
                    className="w-full border-blue-200 text-blue-600 hover:bg-blue-50"
                  >
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    Set Installation Date
                  </Button>
                )}
                {project.installation_date && (
                  <Button
                    onClick={handleRescheduleClick}
                    variant="outline"
                    className="w-full border-yellow-200 text-yellow-600 hover:bg-yellow-50"
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Reschedule Installation
                  </Button>
                )}
                {sale?.contract_file_url && (
                  <Button
                    onClick={() => window.open(sale.contract_file_url, '_blank')}
                    variant="outline"
                    className="w-full border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Contract
                  </Button>
                )}
                <Button
                  onClick={() => updateProjectMutation.mutate({ status: 'Materials Ordered' })}
                  disabled={updateProjectMutation.isPending || project.status === 'Materials Ordered'}
                  className="w-full bg-purple-600 hover:bg-purple-700"
                >
                  {updateProjectMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Mark Materials Ordered'
                  )}
                </Button>

                {/* Installation Status Buttons */}
                {project.installation_date && (
                  <div className="pt-3 border-t border-slate-200 space-y-2">
                    <p className="text-xs font-medium text-slate-500 uppercase">Installation Status</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        onClick={() => {
                          setUpdatingStatus('pending payment');
                          updateProjectMutation.mutate({ installation_date_status: 'pending payment' });
                        }}
                        disabled={updateProjectMutation.isPending}
                        variant="outline"
                        size="sm"
                        className="border-orange-200 text-orange-600 hover:bg-orange-50"
                      >
                        {updatingStatus === 'pending payment' && updateProjectMutation.isPending ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Updating...
                          </>
                        ) : project.installation_date_status === 'pending payment' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Pending Payment
                          </>
                        ) : (
                          'Pending Payment'
                        )}
                      </Button>
                      <Button
                        onClick={() => {
                          setUpdatingStatus('pending contract');
                          updateProjectMutation.mutate({ installation_date_status: 'pending contract' });
                        }}
                        disabled={updateProjectMutation.isPending}
                        variant="outline"
                        size="sm"
                        className="border-orange-200 text-orange-600 hover:bg-orange-50"
                      >
                        {updatingStatus === 'pending contract' && updateProjectMutation.isPending ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Updating...
                          </>
                        ) : project.installation_date_status === 'pending contract' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Pending Contract
                          </>
                        ) : (
                          'Pending Contract'
                        )}
                      </Button>
                      <Button
                        onClick={() => {
                          setUpdatingStatus('on hold');
                          updateProjectMutation.mutate({ installation_date_status: 'on hold' });
                        }}
                        disabled={updateProjectMutation.isPending}
                        variant="outline"
                        size="sm"
                        className="border-orange-200 text-orange-600 hover:bg-orange-50"
                      >
                        {updatingStatus === 'on hold' && updateProjectMutation.isPending ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Updating...
                          </>
                        ) : project.installation_date_status === 'on hold' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            On Hold
                          </>
                        ) : (
                          'On Hold'
                        )}
                      </Button>
                      <Button
                        onClick={() => {
                          setUpdatingStatus('pending cancellation');
                          updateProjectMutation.mutate({ installation_date_status: 'pending cancellation' });
                        }}
                        disabled={updateProjectMutation.isPending}
                        variant="outline"
                        size="sm"
                        className="border-red-200 text-red-600 hover:bg-red-50"
                      >
                        {updatingStatus === 'pending cancellation' && updateProjectMutation.isPending ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Updating...
                          </>
                        ) : project.installation_date_status === 'pending cancellation' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Pending Cancellation
                          </>
                        ) : (
                          'Pending Cancellation'
                        )}
                      </Button>
                      <Button
                        onClick={() => {
                          setUpdatingStatus('clear');
                          const wasOnHold = project.installation_date_status && ['pending payment','pending contract','on hold','pending cancellation'].includes(project.installation_date_status);
                          updateProjectMutation.mutate({ installation_date_status: '', ...(wasOnHold ? { hold_cleared_date: new Date().toISOString() } : {}) });
                        }}
                        disabled={updateProjectMutation.isPending}
                        variant="outline"
                        size="sm"
                        className="border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        {updatingStatus === 'clear' && updateProjectMutation.isPending ? (
                          <>
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            Clearing...
                          </>
                        ) : !project.installation_date_status ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Clear Status
                          </>
                        ) : (
                          'Clear Status'
                        )}
                      </Button>
                    </div>

                    {/* Project Status Buttons */}
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <p className="text-xs font-medium text-slate-500 uppercase">Project Status</p>
                      <Button
                        onClick={() => {
                          setUpdatingStatus('in_progress');
                          updateProjectMutation.mutate({ status: 'In Progress' });
                        }}
                        disabled={updateProjectMutation.isPending || project.status === 'In Progress'}
                        className={cn(
                          "w-full",
                          project.status === 'In Progress'
                            ? "bg-orange-500 hover:bg-orange-500 cursor-default"
                            : "bg-orange-500 hover:bg-orange-600"
                        )}
                      >
                        {updatingStatus === 'in_progress' && updateProjectMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</>
                        ) : project.status === 'In Progress' ? (
                          <><CheckCircle2 className="w-4 h-4 mr-2" />In Progress</>
                        ) : (
                          'Mark as In Progress'
                        )}
                      </Button>
                      <Button
                        onClick={() => {
                          setUpdatingStatus('completed');
                          updateProjectMutation.mutate({ status: 'Completed' });
                        }}
                        disabled={updateProjectMutation.isPending || project.status === 'Completed'}
                        className={cn(
                          "w-full",
                          project.status === 'Completed'
                            ? "bg-green-600 hover:bg-green-600 cursor-default"
                            : "bg-green-600 hover:bg-green-700"
                        )}
                      >
                        {updatingStatus === 'completed' && updateProjectMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</>
                        ) : project.status === 'Completed' ? (
                          <><CheckCircle2 className="w-4 h-4 mr-2" />Completed</>
                        ) : (
                          'Mark as Completed'
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Operations Status Buttons */}
          {currentTeamMember?.role === 'Operations' && currentUser?.role !== 'admin' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Project Status
              </h2>
              <div className="space-y-2">
                <Button
                  onClick={() => {
                    setUpdatingStatus('in_progress');
                    updateProjectMutation.mutate({ status: 'In Progress' });
                  }}
                  disabled={updateProjectMutation.isPending || project.status === 'In Progress'}
                  className={cn(
                    "w-full",
                    project.status === 'In Progress'
                      ? "bg-orange-500 hover:bg-orange-500 cursor-default"
                      : "bg-orange-500 hover:bg-orange-600"
                  )}
                >
                  {updatingStatus === 'in_progress' && updateProjectMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</>
                  ) : project.status === 'In Progress' ? (
                    <><CheckCircle2 className="w-4 h-4 mr-2" />In Progress</>
                  ) : (
                    'Mark as In Progress'
                  )}
                </Button>
                <Button
                  onClick={() => {
                    setUpdatingStatus('completed');
                    updateProjectMutation.mutate({ status: 'Completed' });
                  }}
                  disabled={updateProjectMutation.isPending || project.status === 'Completed'}
                  className={cn(
                    "w-full",
                    project.status === 'Completed'
                      ? "bg-green-600 hover:bg-green-600 cursor-default"
                      : "bg-green-600 hover:bg-green-700"
                  )}
                >
                  {updatingStatus === 'completed' && updateProjectMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</>
                  ) : project.status === 'Completed' ? (
                    <><CheckCircle2 className="w-4 h-4 mr-2" />Completed</>
                  ) : (
                    'Mark as Completed'
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Customer Experience - Using inline component to reduce file size */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.21 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Customer Experience</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'welcome_call_attempted', label: 'Welcome Call Attempted', dateField: 'welcome_call_attempted_date', color: 'blue' },
                  { id: 'welcome_call_completed', label: 'Welcome Call Completed', dateField: 'welcome_call_completed_date', color: 'green' },
                  { id: 'check_in_attempted', label: 'Check-In Attempted', dateField: 'check_in_attempted_date', color: 'blue' },
                  { id: 'check_in_completed', label: 'Check-In Completed', dateField: 'check_in_completed_date', color: 'green' },
                  { id: 'pre_install_call_attempted', label: 'Pre-Install Call Attempted', dateField: 'pre_install_call_attempted_date', color: 'blue' },
                  { id: 'pre_install_call_completed', label: 'Pre-Install Call Completed', dateField: 'pre_install_call_completed_date', color: 'green' },
                  { id: 'qa_in_progress', label: 'QA In Progress', dateField: 'qa_in_progress_date', color: 'indigo' },
                  { id: 'qa_completed', label: 'QA Completed', dateField: 'qa_completed_date', color: 'emerald' }
                ].map(action => (
                  <Button key={action.id} onClick={() => handleCustomerExperienceAction(action.id)} variant="outline" size="sm" className={cn(`border-${action.color}-200 text-${action.color}-600 hover:bg-${action.color}-50`, project[action.dateField] && `bg-${action.color}-50`)}>
                    {project[action.dateField] && <CheckCircle2 className="w-3 h-3 mr-1" />}
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Assigned Team */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.23 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
                Assigned Team
              </h2>
              <Button
                onClick={handleAssignClick}
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Assign Team
              </Button>
            </div>

            <div className="space-y-3">
              {projectManager && (
                <div className="flex items-center gap-4 p-4 rounded-xl bg-indigo-50 border border-indigo-100">
                  <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center">
                    <User className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm text-indigo-600 font-medium">Project Manager</p>
                    <p className="text-slate-800 font-semibold">
                      {projectManager.first_name} {projectManager.last_name}
                    </p>
                  </div>
                </div>
              )}

              {installationManager && (
                <div className="flex items-center gap-4 p-4 rounded-xl bg-blue-50 border border-blue-100">
                  <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                    <User className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-blue-600 font-medium">Installation Manager</p>
                    <p className="text-slate-800 font-semibold">
                      {installationManager.first_name} {installationManager.last_name}
                    </p>
                  </div>
                </div>
              )}

              {!projectManager && !installationManager && (
                <p className="text-slate-400 text-center py-6">No team members assigned yet</p>
              )}
            </div>
          </motion.div>

          {/* Customer Tracker Link */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Customer Tracker
            </h2>
            {project.project_tracker_url ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50">
                  <LinkIcon className="w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    value={project.project_tracker_url}
                    readOnly
                    className="flex-1 bg-transparent text-sm text-slate-600 outline-none"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCopyTrackerUrl}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  <a
                    href={project.project_tracker_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View Customer Tracker
                  </a>
                  {customer?.phone && (
                    <>
                      <Button
                        onClick={handleSendTrackerSMS}
                        disabled={sendingSMS}
                        variant="outline"
                        size="sm"
                        className="border-green-200 text-green-600 hover:bg-green-50"
                      >
                        {sendingSMS ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <MessageSquare className="w-4 h-4 mr-2" />
                            Send Tracker Text
                          </>
                        )}
                      </Button>
                      {smsPreview && (
                        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                          <p className="text-xs text-slate-500 mb-1">Preview:</p>
                          <p className="text-sm text-slate-700">{smsPreview}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
              </div>
            )}
          </motion.div>

          {sale?.invoice_number && (
            <RFMSOrderNotes invoiceNumber={sale.invoice_number} currentUser={currentUser} />
          )}

          {/* Project Location */}
          {sale?.location_address && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Project Location
              </h2>
              <div className="flex items-start gap-4 p-3 rounded-xl bg-slate-50 mb-4">
                <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-slate-800 font-medium">{sale.location_address}</p>
                </div>
              </div>
              {appointment?.street_view_url && (
                <div className="rounded-xl overflow-hidden border border-slate-200">
                  <img
                    src={appointment.street_view_url}
                    alt="Street view"
                    className="w-full h-64 object-cover"
                  />
                </div>
              )}
            </motion.div>
          )}

          {/* Schedule */}
          {(project.scheduled_start_date || project.scheduled_end_date) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Scheduled Dates
              </h2>
              <div className="space-y-4">
                {project.scheduled_start_date && (
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-blue-50">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <CalendarIcon className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-blue-600 mb-0.5">Start Date</p>
                      <p className="text-slate-800">
                        {format(new Date(project.scheduled_start_date + 'T00:00:00'), 'MMMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                )}
                {project.scheduled_end_date && (
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-purple-50">
                    <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                      <CalendarIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-purple-600 mb-0.5">End Date</p>
                      <p className="text-slate-800">
                        {format(new Date(project.scheduled_end_date + 'T00:00:00'), 'MMMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Actual Dates */}
          {(project.actual_start_date || project.actual_completion_date) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Actual Dates
              </h2>
              <div className="space-y-4">
                {project.actual_start_date && (
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-green-50">
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                      <CalendarIcon className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-green-600 mb-0.5">Actual Start</p>
                      <p className="text-slate-800">
                        {format(new Date(project.actual_start_date + 'T00:00:00'), 'MMMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                )}
                {project.actual_completion_date && (
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-emerald-50">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs text-emerald-600 mb-0.5">Completed</p>
                      <p className="text-slate-800">
                        {format(new Date(project.actual_completion_date + 'T00:00:00'), 'MMMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Pre-Install Checklist */}
          {(project.pre_install_checklist_signature_url || project.pre_install_product_info) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border border-green-200 rounded-2xl p-6 md:col-span-2"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <h2 className="text-sm font-semibold text-green-800 uppercase tracking-wider">Pre-Installation Checklist — Signed</h2>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloadingChecklistPDF}
                  onClick={async () => {
                    setDownloadingChecklistPDF(true);
                    try {
                      await generatePreInstallPDF({
                        customerName: customer ? `${customer.first_name} ${customer.last_name}` : 'Customer',
                        productInfo: project.pre_install_product_info || '',
                        signatureUrl: project.pre_install_checklist_signature_url,
                        saleDate: sale?.sale_date
                      });
                    } finally {
                      setDownloadingChecklistPDF(false);
                    }
                  }}
                  className="border-green-300 text-green-700 hover:bg-green-100"
                >
                  {downloadingChecklistPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                  Download PDF
                </Button>
              </div>
              <div className="space-y-3">
                {project.pre_install_product_info && (
                  <p className="text-sm text-green-800"><span className="font-semibold">Product Confirmed:</span> {project.pre_install_product_info}</p>
                )}
                {project.pre_install_checklist_signature_url && (
                  <div>
                    <p className="text-xs text-green-700 font-medium mb-2">Customer Signature:</p>
                    <img src={project.pre_install_checklist_signature_url} alt="Customer signature" className="h-20 border border-green-200 rounded-lg bg-white p-2" />
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Notes */}
          {(project.project_notes || project.materials_notes || project.quality_check_notes) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Project Details Notes
              </h2>
              <div className="space-y-4">
                {project.project_notes && (
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">Project Notes</p>
                    <p className="text-slate-600 whitespace-pre-wrap">{project.project_notes}</p>
                  </div>
                )}
                {project.materials_notes && (
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">Materials Notes</p>
                    <p className="text-slate-600 whitespace-pre-wrap">{project.materials_notes}</p>
                  </div>
                )}
                {project.quality_check_notes && (
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">Quality Check Notes</p>
                    <p className="text-slate-600 whitespace-pre-wrap">{project.quality_check_notes}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Project Images */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.54 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Project Images
            </h2>
            <div className="space-y-4">
              {/* Upload Button */}
              <label className="flex items-center justify-center w-full p-4 border-2 border-dashed border-slate-300 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  disabled={uploadingImage}
                  className="hidden"
                />
                {uploadingImage ? (
                  <>
                    <Loader2 className="w-5 h-5 text-indigo-600 animate-spin mr-2" />
                    <span className="text-sm text-slate-600">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-slate-400 mr-2" />
                    <span className="text-sm text-slate-600">Click to upload images (select multiple)</span>
                  </>
                )}
              </label>

              {/* Images Grid */}
              {project.images && project.images.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200">
                  {[...project.images].reverse().map((image, index) => {
                    const realIndex = project.images.length - 1 - index;
                    return (
                    <div key={image.url} className="rounded-lg border border-slate-200 hover:border-indigo-300 transition-colors overflow-hidden">
                      <div className="relative group">
                        <button
                          onClick={() => setLightboxIndex(realIndex)}
                          className="w-full h-full"
                        >
                          <img
                            src={image.url}
                            alt="Project"
                            className="w-full h-40 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                          />
                        </button>
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => window.open(image.url, '_blank')}
                            className="bg-white hover:bg-slate-100"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteImage(realIndex)}
                            className="bg-red-600 hover:bg-red-700 text-white"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                          <p className="text-xs text-white font-medium">{image.user_name}</p>
                          <p className="text-xs text-gray-300">
                            {new Date(image.timestamp).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </p>
                        </div>
                      </div>
                      <ImageDescriptionInput
                        initialValue={image.description || ''}
                        onSave={(desc) => handleUpdateImageDescription(realIndex, desc)}
                      />
                    </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500 text-center py-8">No images yet</p>
              )}
            </div>
          </motion.div>

          {/* Project Files */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.56 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Project Files
            </h2>
            <div className="space-y-4">
              <label className="flex items-center justify-center w-full p-4 border-2 border-dashed border-slate-300 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors cursor-pointer">
                <input
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  disabled={uploadingFile}
                  className="hidden"
                />
                {uploadingFile ? (
                  <>
                    <Loader2 className="w-5 h-5 text-indigo-600 animate-spin mr-2" />
                    <span className="text-sm text-slate-600">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Paperclip className="w-5 h-5 text-slate-400 mr-2" />
                    <span className="text-sm text-slate-600">Click to upload files (select multiple)</span>
                  </>
                )}
              </label>

              {project.files && project.files.length > 0 ? (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  {[...project.files].reverse().map((file, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors group">
                      <Paperclip className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                        <p className="text-xs text-slate-400">{file.user_name} · {new Date(file.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => window.open(file.url, '_blank')} className="h-8 px-2">
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDeleteFile(project.files.length - 1 - index)} className="h-8 px-2 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 text-center py-8">No files uploaded yet</p>
              )}
            </div>
          </motion.div>

          <DesignModsSection
            project={project}
            customer={customer}
            sale={sale}
          />

          <InspectionReportsSection
            project={project}
            customer={customer}
            sale={sale}
            currentUser={currentUser}
          />

          <InstallationCheckpointsSection
            project={project}
            currentUser={currentUser}
          />

          <ProjectClaimsSection
            project={project}
            customer={customer}
            sale={sale}
            currentUser={currentUser}
          />

          <TeamNotesSection
            project={project}
            newNote={newNote}
            setNewNote={setNewNote}
            onAddNote={handleAddNote}
            onAddReaction={handleAddReaction}
            currentUser={currentUser}
            isLoading={updateProjectMutation.isPending}
          />



          {/* Activity Log */}
          {projectLogs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
            >
              <div className="flex items-center gap-3 mb-4">
                <Activity className="w-5 h-5 text-indigo-600" />
                <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
                  Activity Log
                </h2>
              </div>
              <div className="space-y-3">
                {projectLogs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)).map((log) => (
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
                            {new Date(log.created_date + (log.created_date.includes('Z') ? '' : 'Z')).toLocaleString('en-US', {
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
            </motion.div>
          )}
        </div>
      </div>

      {/* Cancel Project Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-red-700">Cancel Project</DialogTitle>
            <DialogDescription className="text-slate-500 mt-2">
              This will mark the project as Cancelled. You can restore it at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Reason for Cancellation (optional)</Label>
              <Textarea
                placeholder="Enter reason for cancellation..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCancelDialog(false); setCancelReason(''); }}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={updateProjectMutation.isPending}
              onClick={async () => {
                // Cancel the project
                await updateProjectMutation.mutateAsync({
                  status: 'Cancelled',
                  cancelled_date: new Date().toISOString(),
                  cancelled_by: currentUser?.full_name || currentUser?.email,
                  cancelled_reason: cancelReason || null,
                  pre_cancelled_status: project.status
                });
                await base44.entities.ProjectLog.create({
                  project: projectId,
                  action: 'Project Cancelled',
                  details: cancelReason ? `Reason: ${cancelReason}` : 'Project cancelled',
                  user_email: currentUser?.email,
                  user_name: currentUser?.full_name
                });
                queryClient.invalidateQueries({ queryKey: ['projectLogs', projectId] });
                setShowCancelDialog(false);
                setCancelReason('');
              }}
            >
              {updateProjectMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Cancelling...</> : 'Confirm Cancellation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProjectDialogs
        showAssignDialog={showAssignDialog} setShowAssignDialog={setShowAssignDialog}
        showEditDialog={showEditDialog} setShowEditDialog={setShowEditDialog}
        showRescheduleDialog={showRescheduleDialog} setShowRescheduleDialog={setShowRescheduleDialog}
        showSetInstallationDialog={showSetInstallationDialog} setShowSetInstallationDialog={setShowSetInstallationDialog}
        showDeleteDialog={showDeleteDialog} setShowDeleteDialog={setShowDeleteDialog}
        allTeamMembers={allTeamMembers}
        assignData={assignData} setAssignData={setAssignData}
        editData={editData} setEditData={setEditData}
        installationDateData={installationDateData} setInstallationDateData={setInstallationDateData}
        installationDateStatusData={installationDateStatusData} setInstallationDateStatusData={setInstallationDateStatusData}
        handleAssignSubmit={handleAssignSubmit}
        handleEditSubmit={handleEditSubmit}
        handleRescheduleSubmit={handleRescheduleSubmit}
        handleSetInstallationSubmit={handleSetInstallationSubmit}
        onDeleteConfirm={() => deleteProjectMutation.mutate()}
        updateProjectMutation={updateProjectMutation}
        deleteProjectMutation={deleteProjectMutation}
      />

      <PhotoLightbox photos={projectImageUrls} lightboxIndex={lightboxIndex} onClose={setLightboxIndex} />

      </div>
      );
}