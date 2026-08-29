import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { SignedImage, openSignedFile, resolveFileUrl } from '@/lib/fileUrl';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Clock,
  User,
  Mail,
  Phone,
  Loader2,
  DollarSign,
  Edit,
  CheckCircle2,
  MapPin,
  UserPlus,
  Copy,
  Link as LinkIcon,
  ExternalLink,
  Trash2,
  Download,
  MessageSquare,
  Activity,
  Upload,
  X,
  Paperclip
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import SyncBadge from '@/components/common/SyncBadge';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import SubjectThread from '@/components/threads/SubjectThread';
import WorkRow from '@/components/dashboard/WorkRow';
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

// Domain project status → StatusPill tone.
const STATUS_TONE = {
  'Cancelled': 'crit',
  'Accepted': 'info',
  'Materials Ordered': 'info',
  'Scheduled': 'warn',
  'In Progress': 'warn',
  'Quality Checks': 'info',
  'Completed': 'good',
};

const statusSteps = [
  'Accepted',
  'Scheduled',
  'Materials Ordered',
  'In Progress',
  'Quality Checks',
  'Completed'
];

// Customer-experience action button tints, mapped onto the semantic status tokens
// (attempted → info, completed → good). Keyed by the same `color` field the action
// list carries, so the button-rendering logic below is unchanged.
const CX_ACTION_COLORS = {
  blue: 'border-info/30 text-info hover:bg-info/10',
  green: 'border-good/30 text-good hover:bg-good/10',
  indigo: 'border-info/30 text-info hover:bg-info/10',
  emerald: 'border-good/30 text-good hover:bg-good/10'
};
const CX_ACTION_ACTIVE = {
  blue: 'bg-info/10',
  green: 'bg-good/10',
  indigo: 'bg-info/10',
  emerald: 'bg-good/10'
};

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

        const { data: smsRes, error: smsErr } = await base44.functions.invoke('sendSMS', {
          to: customer.phone,
          message
        });
        if (smsErr) throw smsErr;
        const sent = smsRes?.success === true; // legacy shape { success, messageSid, ... }

        // Log the attempt + its real outcome (not a blanket "sent")
        await base44.entities.ProjectLog.create({
          project: projectId,
          action: sent ? 'SMS Sent' : 'SMS Not Sent',
          details: sent
            ? `Project tracker SMS sent to ${customer.first_name} ${customer.last_name} (${customer.phone})`
            : `Project tracker SMS could not be sent (SMS not connected) — ${customer.first_name} ${customer.last_name}`,
          user_email: currentUser?.email,
          user_name: currentUser?.full_name
        });

        queryClient.invalidateQueries({ queryKey: ['projectLogs', projectId] });

        if (sent) toast.success('SMS sent successfully!');
        else toast.info('SMS isn’t connected yet — nothing was sent.');
      }
    } catch (error) {
      console.error('Failed to send SMS:', error);
      toast.error('Failed to send SMS');
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
      toast.error('Failed to log action');
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
      toast.error('Failed to add note');
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

      const newImages = await Promise.all(files.map(async (file) => {
        const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
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
      toast.error('Failed to upload image');
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
      toast.error('Failed to delete image');
    }
  };

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploadingFile(true);
    try {
      const newFiles = await Promise.all(files.map(async (file) => {
        const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
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
      toast.error('Failed to upload file');
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
      toast.error('Failed to delete file');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Project not found</h2>
          <Link to={createPageUrl('Projects')} className="text-primary hover:underline">
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
      { date: project.welcome_call_attempted_date, label: 'Welcome Call Attempted', tone: 'info' },
      { date: project.welcome_call_completed_date, label: 'Welcome Call Completed', tone: 'good' },
      { date: project.check_in_attempted_date, label: 'Check-In Attempted', tone: 'info' },
      { date: project.check_in_completed_date, label: 'Check-In Completed', tone: 'good' },
      { date: project.pre_install_call_attempted_date, label: 'Pre-Install Call Attempted', tone: 'info' },
      { date: project.pre_install_call_completed_date, label: 'Pre-Install Call Completed', tone: 'good' },
      { date: project.qa_in_progress_date, label: 'QA In Progress', tone: 'info' },
      { date: project.qa_completed_date, label: 'QA Completed', tone: 'good' }
    ].filter(a => a.date);

    if (actions.length === 0) return null;

    return actions.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  };

  const latestCustomerExperience = getLatestCustomerExperience();

  const isGlueDown = (() => {
    if (!sale) return false;
    const lines = sale.rfms_order_data?.result?.lines || sale.rfms_order_data?.order?.result?.lines;
    return lines?.some(l => [l.styleName, l.supplierName, l.colorName, l.description].some(v => v?.toLowerCase().includes('glue')));
  })();

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">

        <PageHeader
          eyebrow={
            <Link
              to={createPageUrl('Projects')}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Projects
            </Link>
          }
          title={customerName}
          actions={
            <>
              {project.project_tracker_url && (
                <Button
                  onClick={() => window.open(project.project_tracker_url, '_blank')}
                  variant="outline"
                  size="sm"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Customer View
                </Button>
              )}
              <Button onClick={handleEditClick} variant="accent" size="sm">
                <Edit className="w-4 h-4 mr-2" />
                Edit Project
              </Button>
              {project.status !== 'Cancelled' ? (
                <Button
                  onClick={() => setShowCancelDialog(true)}
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
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
                  size="sm"
                  className="border-good/30 text-good hover:bg-good/10"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Restore Project
                </Button>
              )}
              <Button
                onClick={() => setShowDeleteDialog(true)}
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </>
          }
        >
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={STATUS_TONE[project.status] || 'neutral'} dot>
                {project.status}
              </StatusPill>
              {project.installation_date_status && (
                <StatusPill tone="crit">{project.installation_date_status}</StatusPill>
              )}
              {latestCustomerExperience && (
                <StatusPill tone={latestCustomerExperience.tone}>
                  {latestCustomerExperience.label}
                </StatusPill>
              )}
              {sale?.invoice_number && <SyncBadge status="synced" label="RFMS" />}
              {isGlueDown && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/10 px-2.5 py-0.5 text-[11px] font-semibold text-warn">
                  🔧 Glue Down Project
                </span>
              )}
            </div>

            <TagSelector
              selectedTagIds={project.tags || []}
              onChange={(tags) => updateProjectMutation.mutate({ tags })}
              className="w-full sm:w-64"
            />

            {project.created_by && (
              <p className="text-xs text-muted-foreground">
                Created by <span className="font-medium text-foreground">{project.created_by}</span>
                {project.created_date && (
                  <> on {format(new Date(project.created_date), 'MMM d, yyyy')} at {format(new Date(project.created_date), 'h:mm a')}</>
                )}
              </p>
            )}
          </div>
        </PageHeader>

        {/* Cancelled banner */}
        {project.status === 'Cancelled' && (
          <div className="flex items-center gap-3 rounded-xl border border-crit/25 bg-crit/10 px-5 py-4">
            <span className="text-2xl">🚫</span>
            <div className="flex-1">
              <p className="text-sm font-bold uppercase tracking-wide text-crit">Project Cancelled</p>
              {project.cancelled_date && (
                <p className="mt-0.5 text-sm text-crit">
                  {project.cancelled_by && <span>By {project.cancelled_by} · </span>}
                  {format(new Date(project.cancelled_date), 'MMM d, yyyy h:mm a')}
                </p>
              )}
              {project.cancelled_reason && (
                <p className="mt-0.5 text-sm text-crit">Reason: {project.cancelled_reason}</p>
              )}
            </div>
          </div>
        )}

        {/* Pre-1978 notice */}
        {isPreConstruction1978 && (
          <div className="flex items-center gap-3 rounded-xl border border-crit/25 bg-crit/10 px-5 py-4">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-crit">Pre-1978 Home — Lead Paint &amp; Asbestos Notice Required</p>
              <p className="mt-0.5 text-sm text-crit">This home was built on or before 1978. Ensure all required lead paint disclosures, asbestos precautions, and EPA RRP protocols are followed.</p>
            </div>
          </div>
        )}

        <ProjectProgressTracker project={project} projectLogs={projectLogs} />

        {/* KPI summary */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label="Sale Amount"
            value={sale?.sale_amount ? `$${sale.sale_amount.toLocaleString()}` : '—'}
            hero
            foot={sale?.invoice_number ? `Invoice #${sale.invoice_number}` : 'Linked sale'}
          />
          <KpiTile
            label="Installation Date"
            value={project.installation_date ? format(new Date(project.installation_date + 'T00:00:00'), 'MMM d, yyyy') : 'Not set'}
            foot={project.installation_date_status || (project.installation_date ? 'Scheduled' : 'Awaiting schedule')}
          />
          <KpiTile
            label="Install Stage"
            value={currentStepIndex >= 0 ? `${currentStepIndex + 1} / ${statusSteps.length}` : '—'}
            foot={displayStatus}
          />
        </div>

        {/* Sale Documentation Photos */}
        {sale && (sale.folder_photo_url || sale.yard_sign_photo_url || sale.driver_license_photo_url) && (
          <ModuleCard title="Sale Documentation Photos">
            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 lg:grid-cols-3">
              {sale.folder_photo_url && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">RAZZLE DAZZLE Folder</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const signedUrl = await resolveFileUrl(sale.folder_photo_url);
                        if (!signedUrl) return;
                        const link = document.createElement('a');
                        link.href = signedUrl;
                        link.download = 'folder-photo.jpg';
                        link.click();
                      }}
                      className="h-7 px-2 text-xs"
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                  </div>
                  <SignedImage
                    src={sale.folder_photo_url}
                    alt="RAZZLE DAZZLE Folder"
                    className="h-64 w-full cursor-pointer rounded-lg border border-border object-cover transition-opacity hover:opacity-90"
                    onClick={() => openSignedFile(sale.folder_photo_url)}
                  />
                </div>
              )}
              {sale.yard_sign_photo_url && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">Yard Sign</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const signedUrl = await resolveFileUrl(sale.yard_sign_photo_url);
                        if (!signedUrl) return;
                        const link = document.createElement('a');
                        link.href = signedUrl;
                        link.download = 'yard-sign-photo.jpg';
                        link.click();
                      }}
                      className="h-7 px-2 text-xs"
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                  </div>
                  <SignedImage
                    src={sale.yard_sign_photo_url}
                    alt="Yard Sign"
                    className="h-64 w-full cursor-pointer rounded-lg border border-border object-cover transition-opacity hover:opacity-90"
                    onClick={() => openSignedFile(sale.yard_sign_photo_url)}
                  />
                </div>
              )}
              {sale.driver_license_photo_url && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">Driver's License</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const signedUrl = await resolveFileUrl(sale.driver_license_photo_url);
                        if (!signedUrl) return;
                        try {
                          const response = await fetch(signedUrl, {
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
                          window.open(signedUrl, '_blank');
                        }
                      }}
                      className="h-7 px-2 text-xs"
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                  </div>
                  <SignedImage
                    src={sale.driver_license_photo_url}
                    alt="Driver's License"
                    className="h-64 w-full cursor-pointer rounded-lg border border-border object-cover transition-opacity hover:opacity-90"
                    onClick={() => openSignedFile(sale.driver_license_photo_url)}
                  />
                </div>
              )}
              {sale.yard_sign_opted_out && !sale.yard_sign_photo_url && (
                <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-muted">
                  <p className="text-sm text-muted-foreground">Customer opted out of yard sign</p>
                </div>
              )}
            </div>
          </ModuleCard>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Customer Information */}
          <ModuleCard title="Customer Information" icon={User}>
            {customer ? (
              <div className="space-y-1 p-3">
                <Link
                  to={createPageUrl('CustomerDetail') + `?id=${customer.id}`}
                  className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="mb-0.5 text-xs text-muted-foreground">Name</p>
                    <p className="text-foreground transition-colors group-hover:text-primary">
                      {customerName}
                    </p>
                  </div>
                </Link>
                <a
                  href={`mailto:${customer.email}`}
                  className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-good/15">
                    <Mail className="h-5 w-5 text-good" />
                  </div>
                  <div>
                    <p className="mb-0.5 text-xs text-muted-foreground">Email</p>
                    <p className="text-foreground transition-colors group-hover:text-good">
                      {customer.email}
                    </p>
                  </div>
                </a>
                {customer.phone && (
                  <a
                    href={`tel:${customer.phone}`}
                    className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-blue/15">
                      <Phone className="h-5 w-5 text-brand-blue" />
                    </div>
                    <div>
                      <p className="mb-0.5 text-xs text-muted-foreground">Phone</p>
                      <p className="text-foreground transition-colors group-hover:text-brand-blue">
                        {customer.phone}
                      </p>
                    </div>
                  </a>
                )}
              </div>
            ) : (
              <p className="py-8 text-center text-muted-foreground">Loading customer information...</p>
            )}
          </ModuleCard>

          {/* Assigned Team */}
          <ModuleCard
            title="Assigned Team"
            icon={UserPlus}
            action={
              <Button onClick={handleAssignClick} size="sm">
                <UserPlus className="w-4 h-4 mr-2" />
                Assign Team
              </Button>
            }
          >
            <div className="space-y-3 p-4">
              {projectManager && (
                <div className="flex items-center gap-4 rounded-xl border border-primary/20 bg-primary/10 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-primary">Project Manager</p>
                    <p className="font-semibold text-foreground">
                      {projectManager.first_name} {projectManager.last_name}
                    </p>
                  </div>
                </div>
              )}

              {installationManager && (
                <div className="flex items-center gap-4 rounded-xl border border-brand-blue/20 bg-brand-blue/10 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-blue/15">
                    <User className="h-6 w-6 text-brand-blue" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-brand-blue">Installation Manager</p>
                    <p className="font-semibold text-foreground">
                      {installationManager.first_name} {installationManager.last_name}
                    </p>
                  </div>
                </div>
              )}

              {!projectManager && !installationManager && (
                <p className="py-6 text-center text-muted-foreground">No team members assigned yet</p>
              )}
            </div>
          </ModuleCard>
        </div>

        {/* Related Sale */}
        <ModuleCard title="Related Sale" icon={DollarSign}>
          {sale ? (
            <>
              <WorkRow
                lead={sale.sale_amount ? `$${sale.sale_amount.toLocaleString()}` : 'N/A'}
                primary={sale.invoice_number ? `Invoice #${sale.invoice_number}` : 'Sale record'}
                meta={sale.sale_date ? format(new Date(sale.sale_date), 'MMM d, yyyy') : 'Open sale record'}
                status="View Sale"
                tone="good"
                onClick={() => navigate(createPageUrl('SaleDetail') + `?id=${sale.id}`)}
              />
              <div className="space-y-3 p-4">
                {project.installation_date && (
                  <div className="flex items-center gap-4 rounded-xl border border-warn/20 bg-warn/10 p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warn/15">
                      <CalendarIcon className="h-5 w-5 text-warn" />
                    </div>
                    <div className="flex-1">
                      <p className="mb-0.5 text-xs text-warn">Installation Date</p>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground">
                          {format(new Date(project.installation_date + 'T00:00:00'), 'MMMM d, yyyy')}
                        </p>
                        {project.installation_date_status && (
                          <span className="rounded bg-crit/15 px-2 py-1 text-xs font-semibold capitalize text-crit">
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
                  className="w-full border-good/30 text-good hover:bg-good/10"
                >
                  {downloadingChecklistPDF ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                  Download Pre-Install Checklist
                </Button>
                {sale.contract_file_url && (
                  <Button
                    onClick={() => openSignedFile(sale.contract_file_url)}
                    variant="outline"
                    className="w-full border-primary/30 text-primary hover:bg-primary/10"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Contract
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-muted-foreground">Loading sale information...</p>
          )}
        </ModuleCard>

        {/* Order Processor Tools */}
        {(currentUser?.role === 'admin' || currentTeamMember?.role === 'Order Processor' || currentTeamMember?.role === 'Customer Experience Coordinator') && (
          <ModuleCard title="Order Processor Tools" icon={Clock}>
            <div className="space-y-3 p-4">
              {!project.installation_date && (
                <Button
                  onClick={handleSetInstallationClick}
                  variant="outline"
                  className="w-full border-brand-blue/30 text-brand-blue hover:bg-brand-blue/15"
                >
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  Set Installation Date
                </Button>
              )}
              {project.installation_date && (
                <Button
                  onClick={handleRescheduleClick}
                  variant="outline"
                  className="w-full border-warn/30 text-warn hover:bg-warn/10"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Reschedule Installation
                </Button>
              )}
              {sale?.contract_file_url && (
                <Button
                  onClick={() => openSignedFile(sale.contract_file_url)}
                  variant="outline"
                  className="w-full border-primary/30 text-primary hover:bg-primary/10"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Contract
                </Button>
              )}
              <Button
                onClick={() => updateProjectMutation.mutate({ status: 'Materials Ordered' })}
                disabled={updateProjectMutation.isPending || project.status === 'Materials Ordered'}
                className="w-full bg-info text-background hover:bg-info/90"
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
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Installation Status</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={() => {
                        setUpdatingStatus('pending payment');
                        updateProjectMutation.mutate({ installation_date_status: 'pending payment' });
                      }}
                      disabled={updateProjectMutation.isPending}
                      variant="outline"
                      size="sm"
                      className="border-warn/30 text-warn hover:bg-warn/10"
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
                      className="border-warn/30 text-warn hover:bg-warn/10"
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
                      className="border-warn/30 text-warn hover:bg-warn/10"
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
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
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
                      className="border-border text-muted-foreground hover:bg-muted"
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
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Project Status</p>
                    <Button
                      onClick={() => {
                        setUpdatingStatus('in_progress');
                        updateProjectMutation.mutate({ status: 'In Progress' });
                      }}
                      disabled={updateProjectMutation.isPending || project.status === 'In Progress'}
                      className={cn(
                        "w-full text-white",
                        project.status === 'In Progress'
                          ? "bg-warn hover:bg-warn cursor-default"
                          : "bg-warn hover:bg-warn/90"
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
                        "w-full text-white",
                        project.status === 'Completed'
                          ? "bg-good hover:bg-good cursor-default"
                          : "bg-good hover:bg-good/90"
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
          </ModuleCard>
        )}

        {/* Operations Status Buttons */}
        {currentTeamMember?.role === 'Operations' && currentUser?.role !== 'admin' && (
          <ModuleCard title="Project Status" icon={Activity}>
            <div className="space-y-2 p-4">
              <Button
                onClick={() => {
                  setUpdatingStatus('in_progress');
                  updateProjectMutation.mutate({ status: 'In Progress' });
                }}
                disabled={updateProjectMutation.isPending || project.status === 'In Progress'}
                className={cn(
                  "w-full text-white",
                  project.status === 'In Progress'
                    ? "bg-warn hover:bg-warn cursor-default"
                    : "bg-warn hover:bg-warn/90"
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
                  "w-full text-white",
                  project.status === 'Completed'
                    ? "bg-good hover:bg-good cursor-default"
                    : "bg-good hover:bg-good/90"
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
          </ModuleCard>
        )}

        {/* Conversation about this job — internal, homeowner and crew in one
            place, separated by audience rather than by tool. */}
        <SubjectThread subjectType="project" subjectId={project.id} defaultTopic="This job" />

        {/* Customer Experience */}
        <ModuleCard title="Customer Experience" icon={Phone}>
          <div className="p-4">
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
                <Button key={action.id} onClick={() => handleCustomerExperienceAction(action.id)} variant="outline" size="sm" className={cn(CX_ACTION_COLORS[action.color], project[action.dateField] && CX_ACTION_ACTIVE[action.color])}>
                  {project[action.dateField] && <CheckCircle2 className="w-3 h-3 mr-1" />}
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        </ModuleCard>

        {/* Customer Tracker */}
        <ModuleCard title="Customer Tracker" icon={LinkIcon}>
          {project.project_tracker_url ? (
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2 rounded-xl bg-muted p-3">
                <LinkIcon className="h-5 w-5 text-muted-foreground" />
                <input
                  type="text"
                  value={project.project_tracker_url}
                  readOnly
                  className="flex-1 bg-transparent text-sm text-muted-foreground outline-none"
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
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
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
                      className="border-good/30 text-good hover:bg-good/10"
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
                      <div className="rounded-lg border border-border bg-muted p-3">
                        <p className="mb-1 text-xs text-muted-foreground">Preview:</p>
                        <p className="text-sm text-foreground">{smsPreview}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          )}
        </ModuleCard>

        {sale?.invoice_number && (
          <RFMSOrderNotes invoiceNumber={sale.invoice_number} currentUser={currentUser} />
        )}

        {/* Project Location */}
        {sale?.location_address && (
          <ModuleCard title="Project Location" icon={MapPin}>
            <div className="p-4">
              <div className="mb-4 flex items-start gap-4 rounded-xl bg-muted p-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-warn/15">
                  <MapPin className="h-5 w-5 text-warn" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{sale.location_address}</p>
                </div>
              </div>
              {appointment?.street_view_url && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <img
                    src={appointment.street_view_url}
                    alt="Street view"
                    className="h-64 w-full object-cover"
                  />
                </div>
              )}
            </div>
          </ModuleCard>
        )}

        {/* Schedule + Actual Dates */}
        {((project.scheduled_start_date || project.scheduled_end_date) || (project.actual_start_date || project.actual_completion_date)) && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {(project.scheduled_start_date || project.scheduled_end_date) && (
              <ModuleCard title="Scheduled Dates" icon={CalendarIcon}>
                <div className="space-y-4 p-4">
                  {project.scheduled_start_date && (
                    <div className="flex items-center gap-4 rounded-xl bg-brand-blue/15 p-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-blue/15">
                        <CalendarIcon className="h-5 w-5 text-brand-blue" />
                      </div>
                      <div>
                        <p className="mb-0.5 text-xs text-brand-blue">Start Date</p>
                        <p className="text-foreground">
                          {format(new Date(project.scheduled_start_date + 'T00:00:00'), 'MMMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  )}
                  {project.scheduled_end_date && (
                    <div className="flex items-center gap-4 rounded-xl bg-info/10 p-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/15">
                        <CalendarIcon className="h-5 w-5 text-info" />
                      </div>
                      <div>
                        <p className="mb-0.5 text-xs text-info">End Date</p>
                        <p className="text-foreground">
                          {format(new Date(project.scheduled_end_date + 'T00:00:00'), 'MMMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </ModuleCard>
            )}

            {(project.actual_start_date || project.actual_completion_date) && (
              <ModuleCard title="Actual Dates" icon={CalendarIcon}>
                <div className="space-y-4 p-4">
                  {project.actual_start_date && (
                    <div className="flex items-center gap-4 rounded-xl bg-good/10 p-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-good/15">
                        <CalendarIcon className="h-5 w-5 text-good" />
                      </div>
                      <div>
                        <p className="mb-0.5 text-xs text-good">Actual Start</p>
                        <p className="text-foreground">
                          {format(new Date(project.actual_start_date + 'T00:00:00'), 'MMMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  )}
                  {project.actual_completion_date && (
                    <div className="flex items-center gap-4 rounded-xl bg-good/10 p-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-good/15">
                        <CheckCircle2 className="h-5 w-5 text-good" />
                      </div>
                      <div>
                        <p className="mb-0.5 text-xs text-good">Completed</p>
                        <p className="text-foreground">
                          {format(new Date(project.actual_completion_date + 'T00:00:00'), 'MMMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </ModuleCard>
            )}
          </div>
        )}

        {/* Pre-Install Checklist */}
        {(project.pre_install_checklist_signature_url || project.pre_install_product_info) && (
          <ModuleCard
            title="Pre-Installation Checklist — Signed"
            icon={CheckCircle2}
            className="border-good/25 bg-good/5"
            action={
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
                className="border-good/30 text-good hover:bg-good/10"
              >
                {downloadingChecklistPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                Download PDF
              </Button>
            }
          >
            <div className="space-y-3 p-4">
              {project.pre_install_product_info && (
                <p className="text-sm text-foreground"><span className="font-semibold">Product Confirmed:</span> {project.pre_install_product_info}</p>
              )}
              {project.pre_install_checklist_signature_url && (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Customer Signature:</p>
                  <SignedImage src={project.pre_install_checklist_signature_url} alt="Customer signature" className="h-20 rounded-lg border border-good/25 bg-white p-2" />
                </div>
              )}
            </div>
          </ModuleCard>
        )}

        {/* Project Details Notes */}
        {(project.project_notes || project.materials_notes || project.quality_check_notes) && (
          <ModuleCard title="Project Details Notes">
            <div className="space-y-4 p-4">
              {project.project_notes && (
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">Project Notes</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{project.project_notes}</p>
                </div>
              )}
              {project.materials_notes && (
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">Materials Notes</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{project.materials_notes}</p>
                </div>
              )}
              {project.quality_check_notes && (
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">Quality Check Notes</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{project.quality_check_notes}</p>
                </div>
              )}
            </div>
          </ModuleCard>
        )}

        {/* Project Images */}
        <ModuleCard title="Project Images">
          <div className="space-y-4 p-4">
            {/* Upload Button */}
            <label className="flex w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border p-4 transition-colors hover:border-primary/40 hover:bg-primary/10">
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
                  <Loader2 className="w-5 h-5 text-primary animate-spin mr-2" />
                  <span className="text-sm text-muted-foreground">Uploading...</span>
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5 text-muted-foreground mr-2" />
                  <span className="text-sm text-muted-foreground">Click to upload images (select multiple)</span>
                </>
              )}
            </label>

            {/* Images Grid */}
            {project.images && project.images.length > 0 ? (
              <div className="grid grid-cols-2 gap-4 border-t border-border pt-2 md:grid-cols-3">
                {[...project.images].reverse().map((image, index) => {
                  const realIndex = project.images.length - 1 - index;
                  return (
                  <div key={image.url} className="overflow-hidden rounded-lg border border-border transition-colors hover:border-primary/40">
                    <div className="relative group">
                      <button
                        onClick={() => setLightboxIndex(realIndex)}
                        className="h-full w-full"
                      >
                        <SignedImage
                          src={image.url}
                          alt="Project"
                          className="h-40 w-full cursor-pointer object-cover transition-opacity hover:opacity-90"
                        />
                      </button>
                      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black bg-opacity-0 opacity-0 transition-all group-hover:bg-opacity-40 group-hover:opacity-100">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openSignedFile(image.url)}
                          className="bg-card hover:bg-muted"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteImage(realIndex)}
                          className="bg-destructive text-destructive-foreground hover:opacity-90"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                        <p className="text-xs font-medium text-white">{image.user_name}</p>
                        <p className="text-xs text-white/70">
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
              <p className="py-8 text-center text-sm text-muted-foreground">No images yet</p>
            )}
          </div>
        </ModuleCard>

        {/* Project Files */}
        <ModuleCard title="Project Files" icon={Paperclip}>
          <div className="space-y-4 p-4">
            <label className="flex w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border p-4 transition-colors hover:border-primary/40 hover:bg-primary/10">
              <input
                type="file"
                multiple
                onChange={handleFileUpload}
                disabled={uploadingFile}
                className="hidden"
              />
              {uploadingFile ? (
                <>
                  <Loader2 className="w-5 h-5 text-primary animate-spin mr-2" />
                  <span className="text-sm text-muted-foreground">Uploading...</span>
                </>
              ) : (
                <>
                  <Paperclip className="w-5 h-5 text-muted-foreground mr-2" />
                  <span className="text-sm text-muted-foreground">Click to upload files (select multiple)</span>
                </>
              )}
            </label>

            {project.files && project.files.length > 0 ? (
              <div className="space-y-2 border-t border-border pt-2">
                {[...project.files].reverse().map((file, index) => (
                  <div key={index} className="group flex items-center gap-3 rounded-lg bg-muted p-3 transition-colors hover:bg-muted/70">
                    <Paperclip className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{file.user_name} · {new Date(file.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openSignedFile(file.url)} className="h-8 px-2">
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteFile(project.files.length - 1 - index)} className="h-8 px-2 text-destructive opacity-0 transition-opacity hover:opacity-80 group-hover:opacity-100">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No files uploaded yet</p>
            )}
          </div>
        </ModuleCard>

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
          <ModuleCard title="Activity Log" icon={Activity}>
            <div className="space-y-3 p-4">
              {projectLogs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)).map((log) => (
                <div key={log.id} className="flex gap-4 rounded-xl bg-muted p-4 transition-colors hover:bg-muted/70">
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-foreground">{log.action}</p>
                        {log.details && (
                          <p className="mt-1 text-sm text-muted-foreground">{log.details}</p>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-xs text-muted-foreground">
                          {new Date(log.created_date).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{log.user_name || log.user_email}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ModuleCard>
        )}
      </div>

      {/* Cancel Project Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-destructive">Cancel Project</DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2">
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
