import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
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
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import BrandLogo from '@/components/BrandLogo';
import PublicPageShell from '@/components/common/PublicPageShell';

// Customer-facing project tracker. Floor Daddy brand (navy + razzle pink + gold),
// themed via app tokens (dark-mode aware), mobile-first: the progress tracker is a
// vertical timeline on phones and a horizontal bar on larger screens.
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

  // Public page (renders outside the auth guard). Anon has no direct table access,
  // so fetch a curated, read-only projection through the token-scoped RPC keyed by the
  // project id — see migration 0023 / get_public_project. One round-trip returns the
  // project + customer + sale + both managers + settings.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['publicProject', projectId],
    queryFn: async () => {
      // getPublicProjectSigned wraps the get_public_project projection and returns SIGNED URLs
      // for the contract PDF + manager photos (the 'uploads' bucket is private; anon can't sign).
      const res = await base44.functions.invoke('getPublicProjectSigned', { id: projectId });
      // A failed fetch must NOT render as "not found". Telling a customer
      // their project does not exist because the network hiccuped sends them
      // hunting for a bad link and generates a support call.
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data || null;
    },
    enabled: !!projectId,
    retry: false
  });

  const project = data?.project;
  const customer = data?.customer;
  const sale = data?.sale;
  const projectManager = data?.projectManager;
  const installationManager = data?.installationManager;
  const customerProjectSettings = data?.settings;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // A connection failure is not a missing record. Separate screens, because
  // only one of them means the customer should do something about their link.
  if (isError) {
    return (
      <PublicPageShell eyebrow="Project tracker" footer={false}>
        <div className="mx-auto max-w-sm py-12 text-center">
          <h2 className="mb-2 font-display text-xl font-semibold text-foreground">We could not load your project</h2>
          <p className="mb-4 text-muted-foreground">This is a connection problem, not a missing project — it is still here. Please try again in a moment.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-muted"
          >
            Try again
          </button>
        </div>
      </PublicPageShell>
    );
  }

  // Branded on purpose. "Project not found" is the moment a customer decides the
  // link they were texted is broken or fake — the mark is worth the most here, and
  // the phone number turns a dead end into a call.
  if (!project) {
    return (
      <PublicPageShell eyebrow="Project tracker" footer={false}>
        <div className="mx-auto max-w-sm py-12 text-center">
          <h2 className="font-display text-xl font-semibold text-foreground mb-2">Project not found</h2>
          <p className="text-muted-foreground">
            Please check your link, or call Customer Care on{' '}
            <a href="tel:480-764-2412" className="font-semibold text-brand-pink hover:underline">480-764-2412</a>{' '}
            for a new one.
          </p>
        </div>
      </PublicPageShell>
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

  const card = "bg-card rounded-2xl border border-border shadow-sm p-5 sm:p-6";
  const sectionLabel = "text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em]";
  const scheduledDate = project.installation_date
    ? format(new Date(project.installation_date + 'T00:00:00'), 'MMM d')
    : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      {/* A navy hero, not a white one. This is the page a customer opens from a text
          message minutes after being on floordaddy.com, where navy is what dominates
          — a white bar with a small logo on it reads as a portal, not as us. The
          badge is the page's ONE accent: pink on navy, and nothing else competes. */}
      <header className="bg-sidebar">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="mb-6 flex flex-col items-center">
              <BrandLogo imgClassName="h-12 sm:h-14" onDark />
              <p className="text-[10px] font-medium tracking-[0.18em] text-sidebar-foreground uppercase mt-3">
                Sexy Flooring · Quality Install
              </p>
            </div>
            <div className="w-20 h-20 mx-auto rounded-2xl bg-brand-pink flex items-center justify-center text-white shadow-lg ring-4 ring-brand-pink/25 mb-6">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2">
              Project Tracker
            </h2>
            <p className="text-sidebar-foreground">Follow your project every step of the way.</p>
          </motion.div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="space-y-5 sm:space-y-6">
          {/* Contact Numbers */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-accent rounded-2xl border border-brand-pink/20 p-5 sm:p-7"
          >
            <div className="space-y-4">
              <a href="tel:480-805-5740" className="flex items-center gap-4 group">
                <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 text-2xl group-hover:scale-110 transition-transform">
                  🔨
                </div>
                <div>
                  <p className="text-xs font-semibold text-accent-foreground">Installation Questions</p>
                  <p className="text-xl sm:text-2xl font-extrabold text-foreground group-hover:text-primary transition-colors">480-805-5740</p>
                </div>
              </a>

              <div className="border-t border-brand-pink/15" />

              <a href="tel:480-764-2412" className="flex items-center gap-4 group">
                <div className="w-12 h-12 rounded-xl bg-brand-pink flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                  <Phone className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-accent-foreground">Customer Care</p>
                  <p className="text-xl sm:text-2xl font-extrabold text-foreground group-hover:text-brand-pink transition-colors">480-764-2412</p>
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
              className={card}
            >
              <h2 className={cn(sectionLabel, "text-center mb-6 sm:mb-8")}>Project Progress</h2>

              {/* Mobile: vertical timeline */}
              <ol className="sm:hidden relative pl-8">
                <span className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-border" aria-hidden="true" />
                {statusSteps.map((step, index) => {
                  const isDone = index < currentStepIndex;
                  const isCurrent = index === currentStepIndex;
                  const isScheduled = step === 'Install Scheduled';
                  return (
                    <li key={step} className="relative pb-6 last:pb-0">
                      <span className={cn(
                        "absolute -left-8 top-0 w-8 h-8 rounded-full flex items-center justify-center border-4 border-card",
                        isCurrent ? "bg-brand-pink" : isDone ? "bg-primary" : "bg-muted"
                      )}>
                        {isDone || isCurrent
                          ? <CheckCircle2 className="w-4 h-4 text-white" />
                          : <Circle className="w-4 h-4 text-muted-foreground" />}
                      </span>
                      <p className={cn(
                        "font-semibold leading-8",
                        isCurrent ? "text-brand-pink" : isDone ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {step}
                      </p>
                      {isScheduled && scheduledDate && (
                        <p className="text-xs text-muted-foreground -mt-1">
                          {scheduledDate}
                          {project.installation_date_status && (
                            <span className="text-destructive font-medium"> · {project.installation_date_status}</span>
                          )}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>

              {/* Desktop: horizontal bar */}
              <div className="hidden sm:block relative">
                <div className="absolute top-5 left-0 right-0 h-1 bg-border">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.max(0, currentStepIndex) / (statusSteps.length - 1) * 100}%` }}
                  />
                </div>
                <div className="relative flex justify-between">
                  {statusSteps.map((step, index) => {
                    const isDone = index < currentStepIndex;
                    const isCurrent = index === currentStepIndex;
                    const isScheduled = step === 'Install Scheduled';
                    return (
                      <div key={step} className="flex flex-col items-center" style={{ width: `${100 / statusSteps.length}%` }}>
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border-4 border-card",
                          isCurrent ? "bg-brand-pink" : isDone ? "bg-primary" : "bg-muted"
                        )}>
                          {isDone || isCurrent
                            ? <CheckCircle2 className="w-5 h-5 text-white" />
                            : <Circle className="w-5 h-5 text-muted-foreground" />}
                        </div>
                        <p className={cn(
                          "mt-3 text-xs font-medium text-center px-1",
                          isCurrent ? "text-brand-pink" : isDone ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {step}
                        </p>
                        {isScheduled && scheduledDate && (
                          <div className="mt-1 text-center">
                            <p className="text-xs text-muted-foreground">{scheduledDate}</p>
                            {project.installation_date_status && (
                              <p className="text-xs text-destructive font-medium mt-0.5">{project.installation_date_status}</p>
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
            className={card}
          >
            <h2 className={cn(sectionLabel, "mb-4")}>Customer Information</h2>
            {customer && (
              <div className="flex items-center gap-4 p-3 rounded-xl bg-secondary">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                  <p className="text-foreground font-medium">{customerName}</p>
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
              className={card}
            >
              <h2 className={cn(sectionLabel, "mb-4")}>Project Location</h2>
              <div className="flex items-start gap-4 p-3 rounded-xl bg-secondary">
                <div className="w-10 h-10 rounded-lg bg-brand-gold/15 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-brand-gold" />
                </div>
                <p className="text-foreground">{sale.location_address}</p>
              </div>
            </motion.div>
          )}

          {/* Project Manager */}
          {projectManager && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className={card}
            >
              <h2 className={cn(sectionLabel, "mb-4")}>Your Project Manager</h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-xl bg-secondary">
                  {projectManager.profile_photo ? (
                    <img
                      src={projectManager.profile_photo}
                      alt={`${projectManager.first_name} ${projectManager.last_name}`}
                      className="w-16 h-16 rounded-xl object-cover border-2 border-card shadow-md"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl border-2 border-card shadow-md">
                      {projectManager.first_name?.[0]}{projectManager.last_name?.[0]}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-semibold text-foreground text-lg">
                      {projectManager.first_name} {projectManager.last_name}
                    </p>
                    <p className="text-xs text-primary font-semibold mt-0.5">Project Manager</p>
                  </div>
                </div>

                <a href={`mailto:${projectManager.email}`} className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group">
                  <div className="w-10 h-10 rounded-lg bg-brand-blue/15 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-brand-blue" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                    <p className="text-foreground group-hover:text-brand-blue transition-colors break-words">{projectManager.email}</p>
                  </div>
                </a>

                {projectManager.phone && (
                  <a href={`tel:${projectManager.phone}`} className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group">
                    <div className="w-10 h-10 rounded-lg bg-brand-pink/15 flex items-center justify-center flex-shrink-0">
                      <Phone className="w-5 h-5 text-brand-pink" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                      <p className="text-foreground group-hover:text-brand-pink transition-colors">{projectManager.phone}</p>
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
              className={card}
            >
              <h2 className={cn(sectionLabel, "mb-4")}>Your Installation Manager</h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-xl bg-secondary">
                  {installationManager.profile_photo ? (
                    <img
                      src={installationManager.profile_photo}
                      alt={`${installationManager.first_name} ${installationManager.last_name}`}
                      className="w-16 h-16 rounded-xl object-cover border-2 border-card shadow-md"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-brand-blue flex items-center justify-center text-white font-bold text-xl border-2 border-card shadow-md">
                      {installationManager.first_name?.[0]}{installationManager.last_name?.[0]}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-semibold text-foreground text-lg">
                      {installationManager.first_name} {installationManager.last_name}
                    </p>
                    <p className="text-xs text-brand-blue font-semibold mt-0.5">Installation Manager</p>
                  </div>
                </div>

                <a href={`mailto:${installationManager.email}`} className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group">
                  <div className="w-10 h-10 rounded-lg bg-brand-blue/15 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-brand-blue" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                    <p className="text-foreground group-hover:text-brand-blue transition-colors break-words">{installationManager.email}</p>
                  </div>
                </a>

                {installationManager.phone && (
                  <a href={`tel:${installationManager.phone}`} className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group">
                    <div className="w-10 h-10 rounded-lg bg-brand-pink/15 flex items-center justify-center flex-shrink-0">
                      <Phone className="w-5 h-5 text-brand-pink" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                      <p className="text-foreground group-hover:text-brand-pink transition-colors">{installationManager.phone}</p>
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
              className={card}
            >
              <h2 className={cn(sectionLabel, "mb-4")}>Your Contract</h2>
              <a
                href={sale.contract_file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-4 rounded-xl bg-secondary border border-border hover:shadow-md transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
                  <FileText className="w-6 h-6 text-primary-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground mb-0.5">Sales Contract</p>
                  <p className="text-xs text-muted-foreground">Tap to view or download</p>
                </div>
                <Download className="w-5 h-5 text-primary" />
              </a>
            </motion.div>
          )}

          {/* Scheduled Dates */}
          {(project.scheduled_start_date || project.scheduled_end_date) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className={card}
            >
              <h2 className={cn(sectionLabel, "mb-4")}>Scheduled Timeline</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {project.scheduled_start_date && (
                  <div className="p-4 rounded-xl bg-secondary border border-border">
                    <p className="text-xs text-brand-blue font-semibold mb-1">Start Date</p>
                    <p className="text-foreground font-semibold">
                      {format(new Date(project.scheduled_start_date + 'T00:00:00'), 'MMM d, yyyy')}
                    </p>
                  </div>
                )}
                {project.scheduled_end_date && (
                  <div className="p-4 rounded-xl bg-secondary border border-border">
                    <p className="text-xs text-brand-pink font-semibold mb-1">End Date</p>
                    <p className="text-foreground font-semibold">
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
            className="flex justify-center pt-2"
          >
            <Button
              onClick={() => setVideoModalOpen(true)}
              className="bg-brand-pink hover:bg-brand-pink/90 text-white px-8 py-6 h-auto text-lg rounded-xl shadow-lg hover:shadow-xl transition-all"
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
              src="https://zoyvqznftltlitspgdxn.supabase.co/storage/v1/object/public/public-assets/marketing/csp.mp4"
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
