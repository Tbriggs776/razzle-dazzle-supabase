import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { 
  Loader2,
  User,
  Mail,
  Phone,
  MapPin,
  CheckCircle2,
  Circle,
  FileText,
  Download,
  Video,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const statusSteps = [
  'Accepted',
  'Install Scheduled',
  'Materials Ordered',
  'In Progress',
  'Quality Checks',
  'Completed'
];

export default function CustomerProjectView() {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('id');
  const showCeoVideo = urlParams.get('showCeoVideo') === 'true';
  
  const [videoModalOpen, setVideoModalOpen] = useState(false);

  useEffect(() => {
    if (showCeoVideo) {
      setVideoModalOpen(true);
    }
  }, [showCeoVideo]);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      try {
        const projects = await base44.entities.Project.filter({ id: projectId });
        return projects[0];
      } catch (error) {
        console.error('Error fetching project:', error);
        return null;
      }
    },
    enabled: !!projectId,
    retry: false
  });

  const { data: customerProjectSettings } = useQuery({
    queryKey: ['customerProjectSettings'],
    queryFn: async () => {
      try {
        const allSettings = await base44.entities.CustomerProjectSettings.list();
        return allSettings[0] || null;
      } catch (error) {
        console.error('Error fetching customer project settings:', error);
        return null;
      }
    }
  });

  const { data: customer } = useQuery({
    queryKey: ['customer', project?.customer],
    queryFn: async () => {
      try {
        const customers = await base44.entities.Customer.filter({ id: project.customer });
        return customers[0];
      } catch (error) {
        console.error('Error fetching customer:', error);
        return null;
      }
    },
    enabled: !!project?.customer,
    retry: false
  });

  const { data: sale } = useQuery({
    queryKey: ['sale', project?.sale],
    queryFn: async () => {
      try {
        const sales = await base44.entities.Sale.filter({ id: project.sale });
        return sales[0];
      } catch (error) {
        console.error('Error fetching sale:', error);
        return null;
      }
    },
    enabled: !!project?.sale,
    retry: false
  });

  const { data: projectManager } = useQuery({
    queryKey: ['projectManager', project?.project_manager],
    queryFn: async () => {
      try {
        const members = await base44.entities.TeamMember.filter({ id: project.project_manager });
        return members[0];
      } catch (error) {
        console.error('Error fetching project manager:', error);
        return null;
      }
    },
    enabled: !!project?.project_manager,
    retry: false
  });

  const { data: installationManager } = useQuery({
    queryKey: ['installationManager', project?.installation_manager],
    queryFn: async () => {
      try {
        const members = await base44.entities.TeamMember.filter({ id: project.installation_manager });
        return members[0];
      } catch (error) {
        console.error('Error fetching installation manager:', error);
        return null;
      }
    },
    enabled: !!project?.installation_manager,
    retry: false
  });

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
        </div>
      </div>
    );
  }

  const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Loading...';
  
  // Map backend status to customer-facing status
  let displayStatus = project.status;
  if (project.status === 'Scheduled' || (project.status === 'Accepted' && project.installation_date)) {
    displayStatus = 'Install Scheduled';
  }
  
  const currentStepIndex = statusSteps.indexOf(displayStatus);
  const showProgressTracker = customerProjectSettings?.show_progress_tracker !== false;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="mb-6">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                RAZZLE DAZZLE
              </h1>
              <p className="text-[10px] font-sans tracking-wider text-slate-400 uppercase mt-1">
                BY FLOOR DADDY
              </p>
            </div>
            <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-xl shadow-indigo-200 mb-6">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h2 className="text-3xl font-bold text-slate-800 tracking-tight mb-2">
              Project Tracker
            </h2>
            <p className="text-slate-500">Track your project progress</p>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="space-y-6">
          {/* Contact Numbers */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-orange-50 to-red-50 rounded-2xl border-2 border-orange-200 p-8"
          >
            <div className="space-y-4">
              <a
                href="tel:480-805-5740"
                className="flex items-center gap-4 group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                  <span className="text-2xl">🔨</span>
                </div>
                <div>
                  <p className="text-xs text-orange-600 font-medium">Installation Questions</p>
                  <p className="text-2xl font-bold text-orange-700 group-hover:text-orange-900">480-805-5740</p>
                </div>
              </a>
              
              <div className="border-t border-orange-200" />
              
              <a
                href="tel:480-764-2412"
                className="flex items-center gap-4 group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-xl bg-red-500 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                  <Phone className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-xs text-red-600 font-medium">Customer Care</p>
                  <p className="text-2xl font-bold text-red-700 group-hover:text-red-900">480-764-2412</p>
                </div>
              </a>
            </div>
          </motion.div>

          {/* Progress Tracker */}
          {showProgressTracker && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
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
                    const isScheduled = step === 'Install Scheduled';
                    
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
            </motion.div>
          )}

          {/* Customer Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Customer Information
            </h2>
            {customer && (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                  <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                    <User className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Name</p>
                    <p className="text-slate-800">{customerName}</p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Project Location */}
          {sale?.location_address && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Project Location
              </h2>
              <div className="flex items-start gap-4 p-3 rounded-xl bg-slate-50">
                <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-slate-800">{sale.location_address}</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Project Manager */}
          {projectManager && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Your Project Manager
              </h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100">
                  {projectManager.profile_photo ? (
                    <img
                      src={projectManager.profile_photo}
                      alt={`${projectManager.first_name} ${projectManager.last_name}`}
                      className="w-16 h-16 rounded-xl object-cover border-2 border-white shadow-md"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-xl border-2 border-white shadow-md">
                      {projectManager.first_name?.[0]}{projectManager.last_name?.[0]}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800 text-lg">
                      {projectManager.first_name} {projectManager.last_name}
                    </p>
                    <p className="text-xs text-indigo-600 font-medium mt-0.5">Project Manager</p>
                  </div>
                </div>
                
                <a
                  href={`mailto:${projectManager.email}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Email</p>
                    <p className="text-slate-800 group-hover:text-green-600 transition-colors">
                      {projectManager.email}
                    </p>
                  </div>
                </a>
                
                {projectManager.phone && (
                  <a
                    href={`tel:${projectManager.phone}`}
                    className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Phone className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Phone</p>
                      <p className="text-slate-800 group-hover:text-blue-600 transition-colors">
                        {projectManager.phone}
                      </p>
                    </div>
                  </a>
                )}
              </div>
            </motion.div>
          )}

          {/* Installation Manager */}
          {installationManager && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Your Installation Manager
              </h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-100">
                  {installationManager.profile_photo ? (
                    <img
                      src={installationManager.profile_photo}
                      alt={`${installationManager.first_name} ${installationManager.last_name}`}
                      className="w-16 h-16 rounded-xl object-cover border-2 border-white shadow-md"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl border-2 border-white shadow-md">
                      {installationManager.first_name?.[0]}{installationManager.last_name?.[0]}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800 text-lg">
                      {installationManager.first_name} {installationManager.last_name}
                    </p>
                    <p className="text-xs text-blue-600 font-medium mt-0.5">Installation Manager</p>
                  </div>
                </div>
                
                <a
                  href={`mailto:${installationManager.email}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Email</p>
                    <p className="text-slate-800 group-hover:text-green-600 transition-colors">
                      {installationManager.email}
                    </p>
                  </div>
                </a>
                
                {installationManager.phone && (
                  <a
                    href={`tel:${installationManager.phone}`}
                    className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Phone className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Phone</p>
                      <p className="text-slate-800 group-hover:text-blue-600 transition-colors">
                        {installationManager.phone}
                      </p>
                    </div>
                  </a>
                )}
              </div>
            </motion.div>
          )}

          {/* Contract */}
          {sale?.contract_file_url && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Your Contract
              </h2>
              <a
                href={sale.contract_file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 hover:shadow-md transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-800 mb-0.5">Sales Contract</p>
                  <p className="text-xs text-slate-500">Click to view or download</p>
                </div>
                <Download className="w-5 h-5 text-indigo-600 group-hover:text-indigo-700" />
              </a>
            </motion.div>
          )}

          {/* Scheduled Dates */}
          {(project.scheduled_start_date || project.scheduled_end_date) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Scheduled Timeline
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {project.scheduled_start_date && (
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
                    <p className="text-xs text-blue-600 font-medium mb-1">Start Date</p>
                    <p className="text-slate-800 font-semibold">
                      {format(new Date(project.scheduled_start_date + 'T00:00:00'), 'MMM d, yyyy')}
                    </p>
                  </div>
                )}
                {project.scheduled_end_date && (
                  <div className="p-4 rounded-xl bg-purple-50 border border-purple-100">
                    <p className="text-xs text-purple-600 font-medium mb-1">End Date</p>
                    <p className="text-slate-800 font-semibold">
                      {format(new Date(project.scheduled_end_date + 'T00:00:00'), 'MMM d, yyyy')}
                    </p>
                  </div>
                )}
              </div>
              </motion.div>
              )}

              {/* Meet the CEO Button */}
              <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              className="flex justify-center"
              >
              <Button
              onClick={() => setVideoModalOpen(true)}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-8 py-6 h-auto text-lg rounded-xl shadow-lg hover:shadow-xl transition-all"
              >
              <Video className="w-6 h-6 mr-3" />
              Meet the CEO
              </Button>
              </motion.div>
              </div>
              </div>

              {/* CEO Video Modal */}
              <Dialog open={videoModalOpen} onOpenChange={setVideoModalOpen}>
              <DialogContent className="max-w-4xl p-0 overflow-hidden">
              <div className="relative bg-black">
              <button
              onClick={() => setVideoModalOpen(false)}
              className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
              >
              <X className="w-5 h-5 text-white" />
              </button>
              <video
              controls
              autoPlay={showCeoVideo}
              className="w-full"
              src="https://upcdn.io/223k2X9/raw/videos/csp.mp4"
              >
              Your browser does not support the video tag.
              </video>
              </div>
              </DialogContent>
              </Dialog>
              </div>
              );
              }