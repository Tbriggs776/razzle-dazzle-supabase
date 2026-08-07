import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Badge } from "@/components/ui/badge";
import { 
  Calendar as CalendarIcon, 
  Clock,
  MapPin,
  User,
  Mail,
  Phone,
  Loader2,
  Check,
  Star,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const VIDEOS = [
  "https://upcdn.io/223k2X9/raw/videos/r3.mov",
  "https://upcdn.io/223k2X9/raw/videos/r1.MP4",
  "https://upcdn.io/223k2X9/raw/videos/r0.mov"
];

function VideoCarousel() {
  const [current, setCurrent] = useState(0);
  const prev = () => setCurrent(prev => (prev - 1 + VIDEOS.length) % VIDEOS.length);
  const next = () => setCurrent(prev => (prev + 1) % VIDEOS.length);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6">
      <p className="text-lg font-bold text-slate-800 text-center mb-4">What Our Customers Have to Say</p>
      <div className="relative flex items-center">
        <button onClick={prev} className="absolute left-0 z-10 p-1 rounded-full hover:bg-slate-100 transition-colors">
          <ChevronLeft className="w-5 h-5 text-slate-500" />
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
        <button onClick={next} className="absolute right-0 z-10 p-1 rounded-full hover:bg-slate-100 transition-colors">
          <ChevronRight className="w-5 h-5 text-slate-500" />
        </button>
      </div>
      <div className="flex justify-center gap-2 mt-4">
        {VIDEOS.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={cn("w-2 h-2 rounded-full transition-all", i === current ? "bg-indigo-600 w-4" : "bg-slate-300")}
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
    <div className="bg-white rounded-2xl border border-slate-100 p-6">
      <div className="text-center mb-4">
        <p className="text-lg font-bold text-slate-800">1,000s of Happy Customers</p>
        <div className="flex justify-center gap-0.5 mt-1">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="w-5 h-5 fill-yellow-400 text-yellow-400" />
          ))}
        </div>
      </div>
      <div className="relative flex items-center">
        <button onClick={prev} className="absolute left-0 z-10 p-1 rounded-full hover:bg-slate-100 transition-colors">
          <ChevronLeft className="w-5 h-5 text-slate-500" />
        </button>
        <motion.div
          key={current}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="px-8 w-full"
        >
          <div className="text-center min-h-[140px] flex flex-col justify-center">
            <p className="text-slate-600 text-sm leading-relaxed italic">"{item.text}"</p>
            <p className="mt-3 font-semibold text-slate-800 text-sm">— {item.name}</p>
          </div>
        </motion.div>
        <button onClick={next} className="absolute right-0 z-10 p-1 rounded-full hover:bg-slate-100 transition-colors">
          <ChevronRight className="w-5 h-5 text-slate-500" />
        </button>
      </div>
      <div className="flex justify-center gap-2 mt-4">
        {REVIEWS.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={cn("w-2 h-2 rounded-full transition-all", i === current ? "bg-indigo-600 w-4" : "bg-slate-300")}
          />
        ))}
      </div>
    </div>
  );
}

const statusColors = {
  'Lead': 'bg-slate-100 text-slate-700 border-slate-200',
  'Awaiting Assignment': 'bg-amber-100 text-amber-800 border-amber-200',
  'Scheduled': 'bg-blue-100 text-blue-800 border-blue-200',
  'Rescheduled': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Cancelled': 'bg-red-100 text-red-800 border-red-200',
  'Completed': 'bg-green-100 text-green-800 border-green-200'
};

export default function LeadAppointmentView() {
  const urlParams = new URLSearchParams(window.location.search);
  const appointmentId = urlParams.get('id');

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

  const { data: dc } = useQuery({
    queryKey: ['teamMember', appointment?.assigned_dc],
    queryFn: async () => {
      if (!appointment?.assigned_dc) return null;
      try {
        const members = await base44.entities.TeamMember.filter({ id: appointment.assigned_dc });
        return members[0];
      } catch (error) {
        console.error('Error fetching DC:', error);
        return null;
      }
    },
    enabled: !!appointment?.assigned_dc,
    retry: false
  });

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
        </div>
      </div>
    );
  }

  const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Loading...';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
          >
            {/* Logo */}
            <div className="text-center md:text-left">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                RAZZLE DAZZLE
              </h1>
              <p className="text-[9px] font-sans tracking-wider text-slate-400 uppercase mt-0.5">
                BY FLOOR DADDY
              </p>
            </div>

            {/* Appointment Header */}
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-xl shadow-indigo-200">
                <CalendarIcon className="w-10 h-10" />
              </div>

              <div className="flex-1">
                <h2 className="text-3xl font-bold text-slate-800 tracking-tight">Your Appointment</h2>
                <p className="text-slate-500 text-sm mt-2">Questions or need to modify your appointment?</p>
                <a href="tel:5555550100" className="text-indigo-600 font-bold text-xl mt-1 hover:underline">(555) 555-0100</a>
                <div className="flex items-center gap-2 mt-3">
                  <Badge variant="secondary" className={cn('border', statusColors[appointment.status])}>
                    {appointment.status}
                  </Badge>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Progress Tracker */}
        {(appointment.status === 'Scheduled' || appointment.status === 'Rescheduled' || appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg') && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="bg-white rounded-2xl border border-slate-100 p-6">
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-6 text-center">
                Appointment Progress
              </h2>
              <div className="relative">
                {/* Progress Bar Background */}
                <div className="absolute top-5 left-0 right-0 h-2 bg-slate-100 rounded-full" />
                
                {/* Progress Bar Fill */}
                <div 
                  className="absolute top-5 left-0 h-2 bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-500"
                  style={{ 
                    width: (appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg')
                      ? '100%' 
                      : appointment.consultant_en_route_time 
                        ? '50%' 
                        : '0%' 
                  }}
                />
                
                {/* Steps */}
                <div className="relative flex justify-between">
                  {/* Step 1: Scheduled */}
                  <div className="flex flex-col items-center" style={{ width: '33%' }}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                      appointment.status === 'Scheduled' || appointment.status === 'Rescheduled' || appointment.consultant_en_route_time || appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg'
                        ? 'bg-indigo-600 border-indigo-600'
                        : 'bg-white border-slate-200'
                    }`}>
                      {appointment.status === 'Scheduled' || appointment.status === 'Rescheduled' || appointment.consultant_en_route_time || appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg' ? (
                        <Check className="w-5 h-5 text-white" />
                      ) : (
                        <span className="text-slate-400 font-semibold">1</span>
                      )}
                    </div>
                    <p className={`mt-3 text-sm font-medium text-center ${
                      appointment.status === 'Scheduled' || appointment.status === 'Rescheduled' || appointment.consultant_en_route_time || appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg'
                        ? 'text-indigo-600'
                        : 'text-slate-400'
                    }`}>
                      Scheduled
                    </p>
                    {appointment.appointment_date && (
                      <p className="text-xs text-slate-500 mt-1 text-center">
                        {format(new Date(appointment.appointment_date + 'T00:00:00'), 'MMM d')}
                      </p>
                    )}
                  </div>

                  {/* Step 2: En Route */}
                  <div className="flex flex-col items-center" style={{ width: '33%' }}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                      appointment.consultant_en_route_time || appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg'
                        ? 'bg-indigo-600 border-indigo-600'
                        : 'bg-white border-slate-200'
                    }`}>
                      {appointment.consultant_en_route_time || appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg' ? (
                        <Check className="w-5 h-5 text-white" />
                      ) : (
                        <span className="text-slate-400 font-semibold">2</span>
                      )}
                    </div>
                    <p className={`mt-3 text-sm font-medium text-center ${
                      appointment.consultant_en_route_time || appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg'
                        ? 'text-indigo-600'
                        : 'text-slate-400'
                    }`}>
                      En Route
                    </p>
                    {appointment.consultant_en_route_time && (
                      <p className="text-xs text-slate-500 mt-1 text-center">
                        {new Date(appointment.consultant_en_route_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </p>
                    )}
                  </div>

                  {/* Step 3: Completed */}
                  <div className="flex flex-col items-center" style={{ width: '33%' }}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                      appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg'
                        ? 'bg-indigo-600 border-indigo-600'
                        : 'bg-white border-slate-200'
                    }`}>
                      {appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg' ? (
                        <Check className="w-5 h-5 text-white" />
                      ) : (
                        <span className="text-slate-400 font-semibold">3</span>
                      )}
                    </div>
                    <p className={`mt-3 text-sm font-medium text-center ${
                      appointment.status === 'Completed' || appointment.status === 'Sold' || appointment.status === 'Lost' || appointment.status === 'Pitch and Miss' || appointment.status === 'One-Leg'
                        ? 'text-indigo-600'
                        : 'text-slate-400'
                    }`}>
                      Completed
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Appointment Details */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Appointment Details
            </h2>
            <div className="space-y-4">
              {appointment.appointment_date && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <CalendarIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Date</p>
                    <p className="text-slate-800">
                      {format(new Date(appointment.appointment_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
              )}

              {appointment.appointment_block && (
                <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Time Block</p>
                    <p className="text-slate-800">{appointment.appointment_block}</p>
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
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Location
            </h2>
            {appointment.location_address ? (
              <div className="flex items-start gap-4 p-3">
                <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-slate-800">{appointment.location_address}</p>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-center py-6">No location specified</p>
            )}
          </motion.div>

          {/* Design Consultant */}
          {dc && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Your Design Consultant
              </h2>
              <div className="p-4 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl">
                <div className="float-left mr-5 mb-2 w-40 h-40 rounded-xl overflow-hidden shadow-lg flex-shrink-0">
                  {dc.profile_photo ? (
                    <img 
                      src={dc.profile_photo} 
                      alt={`${dc.first_name} ${dc.last_name}`}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-2xl">
                      {`${dc.first_name?.[0] || ''}${dc.last_name?.[0] || ''}`.toUpperCase()}
                    </div>
                  )}
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-1">
                  {dc.first_name} {dc.last_name}
                </h3>
                <p className="text-sm text-slate-500 mb-2">Design Consultant</p>
                {dc.bio && (
                  <p className="text-sm text-slate-600 leading-relaxed">{dc.bio}</p>
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
              className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
            >
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
                  <User className="w-8 h-8 text-amber-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">
                  Design Consultant Pending
                </h3>
                <p className="text-slate-500 max-w-md mx-auto">
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
          className="mt-6"
        >
          <ReviewCarousel />
        </motion.div>

        {/* Video Carousel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-8"
        >
          <VideoCarousel />
        </motion.div>

        {/* Comparison Image */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-8"
        >
          <img
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69402063235e76365e0f0fdd/381808dd5_comparison-img-fd.jpg"
            alt="Floor Daddy Comparison Chart"
            className="w-full rounded-2xl shadow-sm"
          />
        </motion.div>
      </div>
    </div>
  );
}