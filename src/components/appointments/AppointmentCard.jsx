import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, Clock, MapPin, Users, ChevronRight, DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

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

export default function AppointmentCard({ appointment, index, preloadedData }) {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  // Use preloaded data if available, otherwise fetch individually
  const lead = preloadedData?.leads?.find(l => l.id === appointment.customer);
  const csr = preloadedData?.teamMembers?.find(tm => tm.id === appointment.assigned_csr);
  const dc = preloadedData?.teamMembers?.find(tm => tm.id === appointment.assigned_dc);
  const checklist = preloadedData?.checklists?.find(c => c.appointment === appointment.id);

  const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Loading...';

  // Simplified duration calculation without logs
  const duration = null; // Removed to avoid extra queries, can be added back with preloaded logs if needed

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Link
        to={createPageUrl('AppointmentDetail') + `?id=${appointment.id}&from=MyAppointments`}
        className="group block bg-white rounded-2xl border border-slate-100 p-6 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-50 transition-all duration-300"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">
              {leadName}
            </h3>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="secondary" className={cn('border', statusColors[appointment.status])}>
                {appointment.status}
              </Badge>
              {(appointment.status === 'Scheduled' || appointment.status === 'Awaiting Assignment') && (
                <Badge variant="secondary" className={cn('border', appointment.assigned_dc ? 'bg-green-100 text-green-800 border-green-200' : 'bg-amber-100 text-amber-800 border-amber-200')}>
                  {appointment.assigned_dc ? 'Assigned' : 'Unassigned'}
                </Badge>
              )}
              {appointment.rfms_sync_status === 'synced' && (
                <Badge variant="secondary" className="border bg-green-50 text-green-700 border-green-200">
                  RFMS Synced
                </Badge>
              )}
              {appointment.rfms_sync_status === 'error' && (
                <Badge variant="secondary" className="border bg-red-50 text-red-700 border-red-200">
                  RFMS Error
                </Badge>
              )}
              {checklist?.photos?.length > 0 && (
                <Badge variant="secondary" className="border bg-cyan-50 text-cyan-700 border-cyan-200">
                  📷 {checklist.photos.length} photos
                </Badge>
              )}
              {currentUser?.role === 'admin' && (
                <Badge 
                  variant="secondary" 
                  className={cn('border font-mono text-xs max-w-full break-all',
                    appointment.google_calendar_event_id
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  )}
                >
                  GCal: {appointment.google_calendar_event_id || 'None'}
                </Badge>
              )}
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all flex-shrink-0" />
        </div>

        <div className="space-y-3">
          {appointment.appointment_date && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span>{format(new Date(appointment.appointment_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}</span>
            </div>
          )}
          
          {appointment.appointment_block && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Clock className="w-4 h-4 text-slate-400" />
              <span>{appointment.appointment_block}</span>
            </div>
          )}

          {appointment.location_address && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <MapPin className="w-4 h-4 text-slate-400" />
              <span className="truncate">{appointment.location_address}</span>
            </div>
          )}

          {csr && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="truncate"><span className="text-slate-400">Booked by:</span> {csr.first_name} {csr.last_name}</span>
            </div>
          )}
          {dc && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="truncate"><span className="text-slate-400">DC:</span> {dc.first_name} {dc.last_name}</span>
            </div>
          )}

          {duration && (
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg px-3 py-1.5">
              <Clock className="w-4 h-4" />
              <span>
                {duration.hours > 0 ? `${duration.hours}h ${duration.minutes}m` : `${duration.minutes}m`} on site
              </span>
            </div>
          )}

          {checklist?.project_budget && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <DollarSign className="w-4 h-4 text-slate-400" />
              <span>{checklist.project_budget}</span>
            </div>
          )}

          {appointment.created_date && (
            <div className="flex items-center gap-2 text-xs text-slate-400 pt-2 border-t border-slate-100">
              <Clock className="w-3.5 h-3.5" />
              <span>
                {format(new Date(appointment.created_date), 'MMM d, yyyy')} at {format(new Date(appointment.created_date), 'h:mm a')}
              </span>
            </div>
          )}
          </div>
          </Link>
          </motion.div>
          );
          }