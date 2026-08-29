import React from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure, invokeNotSent } from '@/lib/invokeResult';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  Calendar as CalendarIcon, 
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
  X
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import OrderProcessorTools from './OrderProcessorTools';
import PhotoLightbox from '@/components/PhotoLightbox';

const statusColors = {
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

export default function ProjectDetailView({ 
  project, 
  customer, 
  sale, 
  appointment,
  projectManager,
  installationManager,
  projectLogs,
  currentUser,
  currentTeamMember,
  smsPreview,
  onEditClick,
  onDeleteClick,
  onSetInstallationClick,
  onRescheduleClick,
  onAssignClick
}) {
  const queryClient = useQueryClient();
  const [sendingSMS, setSendingSMS] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [lightboxIndex, setLightboxIndex] = React.useState(null);
  const projectImageUrls = (project.images || []).map(img => typeof img === 'string' ? img : img.url);

  const daysSinceCleared = React.useMemo(() => {
    const baseDate = project.hold_cleared_date || project.created_date;
    if (!baseDate) return 0;
    const base = new Date(baseDate);
    return Math.floor((Date.now() - base.getTime()) / (1000 * 60 * 60 * 24));
  }, [project.hold_cleared_date, project.created_date]);

  const handleCopyJobInfo = (sale) => {
    const jobName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
    const cgNumber = sale?.invoice_number || 'N/A';
    const createdDate = project.created_date
      ? format(new Date(project.created_date), 'MM/dd/yyyy')
      : 'N/A';
    const status = project.installation_date_status || project.status;
    const text = `Job: ${jobName} | CG#: ${cgNumber} | Created: ${createdDate} | Status: ${status} | Days: ${daysSinceCleared}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const [newNote, setNewNote] = React.useState('');
  const [uploadingImage, setUploadingImage] = React.useState(false);

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

        const res = await base44.functions.invoke('sendSMS', { to: customer.phone, message });
        const failed = invokeFailure(res);
        const notSent = invokeNotSent(res);

        // The old code wrote an "SMS Sent" ProjectLog entry and toasted
        // "SMS sent successfully!" whatever came back. That log is permanent and
        // is what anyone later checks to answer "did we tell the customer?" —
        // so a silent failure did not just mislead the sender, it recorded the
        // wrong answer for good. Log what actually happened.
        const sentOk = !failed && !notSent;
        await base44.entities.ProjectLog.create({
          project: project.id,
          action: sentOk ? 'SMS Sent' : 'SMS Not Sent',
          details: sentOk
            ? `Project tracker SMS sent to ${customer.first_name} ${customer.last_name} (${customer.phone})`
            : `Project tracker SMS NOT sent to ${customer.first_name} ${customer.last_name} (${customer.phone}) — ${failed || notSent}`,
          user_email: currentUser?.email,
          user_name: currentUser?.full_name
        });

        queryClient.invalidateQueries({ queryKey: ['projectLogs', project.id] });

        if (failed) toast.error(`Not sent — ${failed}`);
        else if (notSent) toast.warning(`Nothing went out — ${notSent}`, { duration: 8000 });
        else toast.success('SMS sent successfully!');
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
      await base44.entities.Project.update(project.id, {
        [fieldName]: new Date().toISOString()
      });

      // Log the activity
      await base44.entities.ProjectLog.create({
        project: project.id,
        action: actionLabels[actionType],
        details: `Customer experience milestone logged`,
        user_email: currentUser?.email,
        user_name: currentUser?.full_name
      });

      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      queryClient.invalidateQueries({ queryKey: ['projectLogs', project.id] });
    } catch (error) {
      console.error('Failed to log action:', error);
      toast.error('Failed to log action');
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;

    const updatedNotes = [
      ...(project.notes || []),
      {
        content: newNote,
        user_name: currentUser?.full_name || currentUser?.email,
        user_email: currentUser?.email,
        timestamp: new Date().toISOString()
      }
    ];

    try {
      await base44.entities.Project.update(project.id, { notes: updatedNotes });
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      setNewNote('');
    } catch (error) {
      console.error('Failed to add note:', error);
      toast.error('Failed to add note');
    }
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    try {

      const { file_url: fileUrl } = await base44.integrations.Core.UploadFile({ file });
      
      const updatedImages = [
        ...(project.images || []),
        {
          url: fileUrl,
          user_name: currentUser?.full_name || currentUser?.email,
          user_email: currentUser?.email,
          timestamp: new Date().toISOString()
        }
      ];

      await base44.entities.Project.update(project.id, { images: updatedImages });
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    } catch (error) {
      console.error('Failed to upload image:', error);
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleDeleteImage = async (indexToDelete) => {
    const updatedImages = project.images.filter((_, index) => index !== indexToDelete);
    try {
      await base44.entities.Project.update(project.id, { images: updatedImages });
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    } catch (error) {
      console.error('Failed to delete image:', error);
      toast.error('Failed to delete image');
    }
  };

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
              {project.created_date && (
                <p className="text-xs text-slate-400 mt-1">
                  Project created: {format(new Date(project.created_date), 'MMMM d, yyyy h:mm a')}
                </p>
              )}
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
                  onClick={onEditClick}
                  variant="outline"
                  className="border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Project
                </Button>
                <Button
                  onClick={onDeleteClick}
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>

            {/* Progress Tracker */}
            <div className="bg-white rounded-xl p-6 border border-slate-100">
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider text-center mb-8">
                Project Progress
              </h2>
              <div className="relative">
                {/* Progress Line */}
                <div className="absolute top-5 left-0 right-0 h-1 bg-slate-200">
                  <div 
                    className="h-full bg-indigo-600 transition-all duration-500"
                    style={{ width: `${(currentStepIndex / (statusSteps.length - 1)) * 115}%` }}
                  />
                </div>

                {/* Steps */}
                <div className="relative flex justify-between">
                  {statusSteps.map((step, index) => {
                    const isCompleted = index < currentStepIndex;
                    const isCurrent = index === currentStepIndex;
                    const isScheduled = step === 'Scheduled';

                    return (
                      <div key={step} className="flex flex-col items-center" style={{ width: `${100 / statusSteps.length}%` }}>
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border-4 border-white",
                          isCompleted || isCurrent ? "bg-indigo-600" : "bg-slate-200"
                        )}>
                          {isCompleted || isCurrent ? (
                            <CheckCircle2 className="w-5 h-5 text-white" />
                          ) : (
                            <Circle className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <p className={cn(
                          "mt-3 text-xs font-medium text-center px-1",
                          isCurrent ? "text-indigo-600" : isCompleted ? "text-slate-700" : "text-slate-400"
                        )}>
                          {step}
                        </p>
                        {isScheduled && project.installation_date && (
                          <div className="mt-1">
                            <p className="text-xs text-slate-500">
                              {format(new Date(project.installation_date + 'T00:00:00'), 'MMM d')}
                            </p>
                            {project.installation_date_status && (
                              <p className="text-xs text-red-600 font-medium mt-0.5">
                                {project.installation_date_status}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Admin Quick Copy Block */}
            {currentUser?.role === 'admin' && daysSinceCleared >= 3 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Quick Copy — {daysSinceCleared} days in status</p>
                    <p className="text-sm font-mono text-slate-700 break-all">
                      Job: {customerName} | CG#: {sale?.invoice_number || 'N/A'} | Created: {project.created_date ? format(new Date(project.created_date), 'MM/dd/yyyy') : 'N/A'} | Status: {project.installation_date_status || project.status} | Days: {daysSinceCleared}
                    </p>
                  </div>
                  <Button
                    onClick={() => handleCopyJobInfo(sale)}
                    variant="outline"
                    className="border-amber-300 text-amber-700 hover:bg-amber-100 flex-shrink-0"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {/* Content - (rest continues on page component) */}
      <PhotoLightbox photos={projectImageUrls} lightboxIndex={lightboxIndex} onClose={setLightboxIndex} />
    </div>
  );
}