import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { invokeFailure } from '@/lib/invokeResult';
import { useQuery } from '@tanstack/react-query';
import { Badge } from "@/components/ui/badge";
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  User,
  Loader2,
  Check,
  Star,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import BrandLogo from '@/components/BrandLogo';

// Customer-facing appointment page. Floor Daddy brand (navy + razzle pink + gold),
// themed via app tokens (dark-mode aware), mobile-first. Data comes from the
// token-scoped get_public_appointment RPC (anon has no direct table access).

// Self-hosted in this project's public 'public-assets' bucket (rehosted off Bytescale/upcdn.io
// so they survive base44 decommissioning).
const ASSET_BASE = "https://zoyvqznftltlitspgdxn.supabase.co/storage/v1/object/public/public-assets/marketing";
const VIDEOS = [
  `${ASSET_BASE}/r3.mov`,
  `${ASSET_BASE}/r1.MP4`,
  `${ASSET_BASE}/r0.mov`
];

const card = "bg-card rounded-2xl border border-border shadow-sm";
const sectionLabel = "text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em]";

function VideoCarousel() {
  const [current, setCurrent] = useState(0);
  const prev = () => setCurrent(prev => (prev - 1 + VIDEOS.length) % VIDEOS.length);
  const next = () => setCurrent(prev => (prev + 1) % VIDEOS.length);

  return (
    <div className={cn(card, "p-5 sm:p-6")}>
      <p className="text-lg font-bold text-foreground text-center mb-4">What Our Customers Have to Say</p>
      <div className="relative flex items-center">
        <button onClick={prev} className="absolute left-0 z-10 p-1 rounded-full hover:bg-secondary transition-colors">
          <ChevronLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <motion.div
          key={current}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="px-8 w-full"
        >
          <video
            key={VIDEOS[current]}
            src={VIDEOS[current]}
            controls
            playsInline
            className="rounded-xl mx-auto block"
            style={{ maxHeight: '80vh', width: 'auto' }}
          />
        </motion.div>
        <button onClick={next} className="absolute right-0 z-10 p-1 rounded-full hover:bg-secondary transition-colors">
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>
      <div className="flex justify-center gap-2 mt-4">
        {VIDEOS.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={cn("h-2 rounded-full transition-all", i === current ? "bg-brand-pink w-4" : "bg-border w-2")}
            aria-label={`Video ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

const REVIEWS = [
  {
    name: "Hannah P.",
    text: "I loved their attentiveness. They did such a great job installing. I love how they walked me through everything as well & don't feel as if they try to take advantage of me! My dogs also love the new flooring. I had carpet all around my downstairs and stairs and they helped me pick out the perfect floor that matched my tile. They also redid my carpet upstairs in a timely manner for a great price. 10/10 recommend."
  },
  {
    name: "Maria L.",
    text: "I had Floor Daddy install new flooring in my home, and I'm very pleased with the results. The flooring quality is excellent, the installation was smooth, and the customer service was responsive and professional. Overall, I'd give them 4.5 stars and would recommend them to anyone looking to upgrade their floors."
  },
  {
    name: "Larry W.",
    text: "From the salesperson Jed to the tile and carpet installers and Sergio who comes and inspects the work after installation, they were all very professional and very good at what they do. I highly recommend them."
  },
];

function ReviewCarousel() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(prev => (prev + 1) % REVIEWS.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const prev = () => setCurrent(prev => (prev - 1 + REVIEWS.length) % REVIEWS.length);
  const next = () => setCurrent(prev => (prev + 1) % REVIEWS.length);
  const item = REVIEWS[current];

  return (
    <div className={cn(card, "p-5 sm:p-6")}>
      <div className="text-center mb-4">
        <p className="text-lg font-bold text-foreground">1,000s of Happy Customers</p>
        <div className="flex justify-center gap-0.5 mt-1">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="w-5 h-5 fill-brand-gold text-brand-gold" />
          ))}
        </div>
      </div>
      <div className="relative flex items-center">
        <button onClick={prev} className="absolute left-0 z-10 p-1 rounded-full hover:bg-secondary transition-colors">
          <ChevronLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <motion.div
          key={current}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="px-8 w-full"
        >
          <div className="text-center min-h-[140px] flex flex-col justify-center">
            <p className="text-muted-foreground text-sm leading-relaxed italic">"{item.text}"</p>
            <p className="mt-3 font-semibold text-foreground text-sm">— {item.name}</p>
          </div>
        </motion.div>
        <button onClick={next} className="absolute right-0 z-10 p-1 rounded-full hover:bg-secondary transition-colors">
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>
      <div className="flex justify-center gap-2 mt-4">
        {REVIEWS.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={cn("h-2 rounded-full transition-all", i === current ? "bg-brand-pink w-4" : "bg-border w-2")}
            aria-label={`Review ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

// Semantic tokens, not palette colours. Each of these carried an explicit dark:
// variant; the tokens are theme-aware, so the duplication goes with them — and a
// customer reading this on a phone in dark mode now gets the same contrast we
// designed for, rather than whatever green-800-on-green-500/15 happens to give.
const statusColors = {
  'Lead': 'bg-secondary text-secondary-foreground border-border',
  'Awaiting Assignment': 'bg-warn/12 text-warn border-warn/25',
  'Scheduled': 'bg-info/12 text-info border-info/25',
  'Rescheduled': 'bg-warn/12 text-warn border-warn/25',
  'Cancelled': 'bg-crit/12 text-crit border-crit/25',
  'Completed': 'bg-good/12 text-good border-good/25',
};

export default function LeadAppointmentView() {
  const urlParams = new URLSearchParams(window.location.search);
  const appointmentId = urlParams.get('id');

  // Public page (renders outside the auth guard). Anon has no direct table access,
  // so fetch a curated, read-only projection through a token-scoped RPC keyed by the
  // unguessable appointment id — see migration 0011 / get_public_appointment.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['publicAppointment', appointmentId],
    queryFn: async () => {
      const res = await base44.functions.invoke('getPublicAppointment', { id: appointmentId });
      // A failed fetch must NOT render as "not found". Telling a customer
      // their appointment does not exist because the network hiccuped sends them
      // hunting for a bad link and generates a support call.
      const failed = invokeFailure(res);
      if (failed) throw new Error(failed);
      return res.data || null;
    },
    enabled: !!appointmentId,
    retry: false
  });

  const appointment = data?.appointment;
  const lead = data?.lead;
  const dc = data?.dc;

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
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h2 className="mb-2 text-xl font-semibold text-foreground">We could not load your appointment</h2>
          <p className="mb-4 text-muted-foreground">This is a connection problem, not a missing appointment — it is still here. Please try again in a moment.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-muted"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Appointment not found</h2>
          <p className="text-muted-foreground">Please check your link, or contact us for a new one.</p>
        </div>
      </div>
    );
  }

  // Progress-tracker state (unchanged logic).
  const finalStatuses = ['Completed', 'Sold', 'Lost', 'Pitch and Miss', 'One-Leg'];
  const isFinal = finalStatuses.includes(appointment.status);
  const isScheduledOrLater = ['Scheduled', 'Rescheduled'].includes(appointment.status) || appointment.consultant_en_route_time || isFinal;
  const isEnRouteOrLater = appointment.consultant_en_route_time || isFinal;
  const showTracker = ['Scheduled', 'Rescheduled', ...finalStatuses].includes(appointment.status);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      {/* Navy hero, matching the customer tracker — this is the same customer, days
          earlier in the same relationship, and the two pages should not look like
          they came from different companies. */}
      <header className="bg-sidebar">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-7">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
          >
            {/* Logo */}
            <div className="flex flex-col items-center sm:items-start">
              <BrandLogo imgClassName="h-10 sm:h-11" onDark />
              <p className="text-[9px] font-medium tracking-[0.18em] text-sidebar-foreground uppercase mt-2">
                Sexy Flooring · Quality Install
              </p>
            </div>

            {/* Appointment Header */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6">
              <div className="w-20 h-20 rounded-2xl bg-brand-pink flex items-center justify-center text-white shadow-lg ring-4 ring-brand-pink/25 mx-auto sm:mx-0">
                <CalendarIcon className="w-10 h-10" />
              </div>

              <div className="flex-1 text-center sm:text-left">
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">Your Appointment</h2>
                <p className="text-sidebar-foreground text-sm mt-2">Questions or need to modify your appointment?</p>
                {/* Was a 555 placeholder, shipped to customers. This is Customer
                    Care, the same line the project tracker labels "Customer Care";
                    the other Floor Daddy number (480-805-5740) is Installation
                    Questions and is the wrong one for a pre-install appointment.
                    Deliberately not repeating the old digits here — a placeholder
                    audit should come back clean. */}
                <a href="tel:602-313-3000" className="text-white font-bold text-xl mt-1 inline-block hover:underline">602-313-3000</a>
                <div className="flex items-center justify-center sm:justify-start gap-2 mt-3">
                  <Badge variant="secondary" className={cn('border', statusColors[appointment.status])}>
                    {appointment.status}
                  </Badge>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Progress Tracker */}
        {showTracker && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 sm:mb-8"
          >
            <div className={cn(card, "p-5 sm:p-6")}>
              <h2 className={cn(sectionLabel, "mb-6 text-center")}>Appointment Progress</h2>
              <div className="relative">
                {/* Progress bar background */}
                <div className="absolute top-5 left-0 right-0 h-2 bg-muted rounded-full" />
                {/* Progress bar fill */}
                <div
                  className="absolute top-5 left-0 h-2 bg-primary rounded-full transition-all duration-500"
                  style={{ width: isFinal ? '100%' : appointment.consultant_en_route_time ? '50%' : '0%' }}
                />

                <div className="relative flex justify-between">
                  {/* Step 1: Scheduled */}
                  <div className="flex flex-col items-center" style={{ width: '33%' }}>
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center border-4 border-card transition-all duration-300",
                      isScheduledOrLater ? "bg-primary" : "bg-muted"
                    )}>
                      {isScheduledOrLater ? <Check className="w-5 h-5 text-primary-foreground" /> : <span className="text-muted-foreground font-semibold">1</span>}
                    </div>
                    <p className={cn("mt-3 text-sm font-medium text-center", isScheduledOrLater ? "text-primary" : "text-muted-foreground")}>Scheduled</p>
                    {appointment.appointment_date && (
                      <p className="text-xs text-muted-foreground mt-1 text-center">
                        {format(new Date(appointment.appointment_date + 'T00:00:00'), 'MMM d')}
                      </p>
                    )}
                  </div>

                  {/* Step 2: En Route (the live/current step — pink pop) */}
                  <div className="flex flex-col items-center" style={{ width: '33%' }}>
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center border-4 border-card transition-all duration-300",
                      isEnRouteOrLater ? (isFinal ? "bg-primary" : "bg-brand-pink") : "bg-muted"
                    )}>
                      {isEnRouteOrLater ? <Check className="w-5 h-5 text-white" /> : <span className="text-muted-foreground font-semibold">2</span>}
                    </div>
                    <p className={cn("mt-3 text-sm font-medium text-center", isEnRouteOrLater ? (isFinal ? "text-primary" : "text-brand-pink") : "text-muted-foreground")}>En Route</p>
                    {appointment.consultant_en_route_time && (
                      <p className="text-xs text-muted-foreground mt-1 text-center">
                        {new Date(appointment.consultant_en_route_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </p>
                    )}
                  </div>

                  {/* Step 3: Completed */}
                  <div className="flex flex-col items-center" style={{ width: '33%' }}>
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center border-4 border-card transition-all duration-300",
                      isFinal ? "bg-primary" : "bg-muted"
                    )}>
                      {isFinal ? <Check className="w-5 h-5 text-primary-foreground" /> : <span className="text-muted-foreground font-semibold">3</span>}
                    </div>
                    <p className={cn("mt-3 text-sm font-medium text-center", isFinal ? "text-primary" : "text-muted-foreground")}>Completed</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {/* Appointment Details */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className={cn(card, "p-5 sm:p-6")}
          >
            <h2 className={cn(sectionLabel, "mb-4")}>Appointment Details</h2>
            <div className="space-y-4">
              {appointment.appointment_date && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-brand-blue/15 flex items-center justify-center flex-shrink-0">
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
                  <div className="w-10 h-10 rounded-lg bg-brand-pink/15 flex items-center justify-center flex-shrink-0">
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

          {/* Location */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className={cn(card, "p-5 sm:p-6")}
          >
            <h2 className={cn(sectionLabel, "mb-4")}>Location</h2>
            {appointment.location_address ? (
              <div className="flex items-start gap-4 p-3">
                <div className="w-10 h-10 rounded-lg bg-brand-gold/15 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-brand-gold" />
                </div>
                <p className="text-foreground">{appointment.location_address}</p>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-6">No location specified</p>
            )}
          </motion.div>

          {/* Design Consultant */}
          {dc && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className={cn(card, "p-5 sm:p-6 md:col-span-2")}
            >
              <h2 className={cn(sectionLabel, "mb-4")}>Your Design Consultant</h2>
              <div className="p-4 bg-secondary rounded-xl">
                <div className="float-left mr-5 mb-2 w-32 h-32 sm:w-40 sm:h-40 rounded-xl overflow-hidden shadow-lg flex-shrink-0">
                  {dc.profile_photo ? (
                    <img
                      src={dc.profile_photo}
                      alt={`${dc.first_name} ${dc.last_name}`}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl">
                      {`${dc.first_name?.[0] || ''}${dc.last_name?.[0] || ''}`.toUpperCase()}
                    </div>
                  )}
                </div>
                <h3 className="text-xl font-bold text-foreground mb-1">
                  {dc.first_name} {dc.last_name}
                </h3>
                <p className="text-sm text-primary font-semibold mb-2">Design Consultant</p>
                {dc.bio && (
                  <p className="text-sm text-muted-foreground leading-relaxed">{dc.bio}</p>
                )}
                <div className="clear-both" />
              </div>
            </motion.div>
          )}

          {/* No DC Assigned */}
          {!dc && appointment.status !== 'Cancelled' && appointment.status !== 'Lead' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className={cn(card, "p-5 sm:p-6 md:col-span-2")}
            >
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-brand-gold/15 flex items-center justify-center mb-4">
                  <User className="w-8 h-8 text-brand-gold" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  Design Consultant Pending
                </h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Your design consultant will be assigned soon. You'll receive an update once they're confirmed.
                </p>
              </div>
            </motion.div>
          )}
        </div>

        {/* Review Carousel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-5 sm:mt-6"
        >
          <ReviewCarousel />
        </motion.div>

        {/* Video Carousel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-6 sm:mt-8"
        >
          <VideoCarousel />
        </motion.div>

        {/* Comparison Image */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-6 sm:mt-8"
        >
          <img
            src={`${ASSET_BASE}/comparison-img-fd.jpg`}
            alt="Floor Daddy Comparison Chart"
            className="w-full rounded-2xl shadow-sm"
          />
        </motion.div>
      </div>
    </div>
  );
}
