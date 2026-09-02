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
  'Lead': 'bg-muted text-foreground border-border',
  'Awaiting Assignment': 'bg-warn/12 text-warn border-warn/25',
  'Scheduled': 'bg-info/12 text-info border-info/25',
  'Rescheduled': 'bg-warn/12 text-warn border-warn/25',
  'In Route': 'bg-cyan-100 text-cyan-800 border-cyan-200',
  'On Site': 'bg-good/12 text-good border-good/25',
  'Cancelled': 'bg-crit/12 text-crit border-crit/25',
  'Completed': 'bg-muted text-foreground border-border',
  'Sold': 'bg-good/12 text-good border-good/25',
  'Lost': 'bg-crit/12 text-crit border-crit/25',
  'Pitch and Miss': 'bg-warn/12 text-warn border-warn/25',
  'One-Leg': 'bg-warn/12 text-warn border-warn/25',
  'Credit Decline': 'bg-crit/12 text-crit border-crit/25',
  'Follow-Up': 'bg-crit/12 text-crit border-crit/25'
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
        className="group block bg-white rounded-2xl border border-border p-6 hover:border-info/25 hover:shadow-lg hover:shadow-indigo-50 transition-all duration-300"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground group-hover:text-info transition-colors">
              {leadName}
            </h3>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="secondary" className={cn('border', statusColors[appointment.status])}>
                {appointment.status}
              </Badge>
              {(appointment.status === 'Scheduled' || appointment.status === 'Awaiting Assignment') && (
                <Badge variant="secondary" className={cn('border', appointment.assigned_dc ? 'bg-good/12 text-good border-good/25' : 'bg-warn/12 text-warn border-warn/25')}>
                  {appointment.assigned_dc ? 'Assigned' : 'Unassigned'}
                </Badge>
              )}
              {appointment.rfms_sync_status === 'synced' && (
                <Badge variant="secondary" className="border bg-good/12 text-good border-good/25">
                  RFMS Synced
                </Badge>
              )}
              {appointment.rfms_sync_status === 'error' && (
                <Badge variant="secondary" className="border bg-crit/12 text-crit border-crit/25">
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
                      ? 'bg-info/12 text-info border-info/25'
                      : 'bg-muted text-muted-foreground border-border'
                  )}
                >
                  GCal: {appointment.google_calendar_event_id || 'None'}
                </Badge>
              )}
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-info group-hover:translate-x-1 transition-all flex-shrink-0" />
        </div>

        <div className="space-y-3">
          {appointment.appointment_date && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span>{format(new Date(appointment.appointment_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}</span>
            </div>
          )}
          
          {appointment.appointment_block && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span>{appointment.appointment_block}</span>
            </div>
          )}

          {appointment.location_address && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span className="truncate">{appointment.location_address}</span>
            </div>
          )}

          {csr && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="truncate"><span className="text-muted-foreground">Booked by:</span> {csr.first_name} {csr.last_name}</span>
            </div>
          )}
          {dc && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="truncate"><span className="text-muted-foreground">DC:</span> {dc.first_name} {dc.last_name}</span>
            </div>
          )}

          {duration && (
            <div className="flex items-center gap-2 text-sm font-medium text-info bg-info/12 rounded-lg px-3 py-1.5">
              <Clock className="w-4 h-4" />
              <span>
                {duration.hours > 0 ? `${duration.hours}h ${duration.minutes}m` : `${duration.minutes}m`} on site
              </span>
            </div>
          )}

          {checklist?.project_budget && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <span>{checklist.project_budget}</span>
            </div>
          )}

          {appointment.created_date && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
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