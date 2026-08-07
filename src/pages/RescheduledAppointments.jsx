import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AppointmentCard from '@/components/appointments/AppointmentCard';

export default function RescheduledAppointments() {
  const [searchQuery, setSearchQuery] = useState('');

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['rescheduledAppointments'],
    queryFn: () => base44.entities.Appointment.filter({ status: 'Rescheduled' }, '-updated_date')
  });

  // Filter appointments
  const filteredAppointments = appointments.filter(appointment => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      appointment.location_address?.toLowerCase().includes(query) ||
      appointment.internal_notes?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Link
            to={createPageUrl('Appointments')}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            All Appointments
          </Link>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Rescheduled Appointments</h1>
              <p className="text-slate-500 mt-1">View all rescheduled appointments</p>
            </div>
          </div>

          {/* Search */}
          <div className="mt-8 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search rescheduled appointments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-14 bg-slate-50 border-slate-200 rounded-xl text-base focus:bg-white focus:border-yellow-500 focus:ring-yellow-500 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-yellow-600 animate-spin" />
          </div>
        ) : filteredAppointments.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-yellow-50 flex items-center justify-center mb-6">
              <RefreshCw className="w-10 h-10 text-yellow-400" />
            </div>
            <h3 className="text-xl font-semibold text-slate-800 mb-2">
              {searchQuery ? 'No appointments found' : 'No rescheduled appointments'}
            </h3>
            <p className="text-slate-500 mb-6">
              {searchQuery
                ? 'Try adjusting your search query'
                : 'No appointments have been rescheduled'}
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredAppointments.map((appointment, index) => (
                <AppointmentCard key={appointment.id} appointment={appointment} index={index} />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Results count */}
        {!isLoading && filteredAppointments.length > 0 && (
          <p className="text-center text-sm text-slate-400 mt-8">
            Showing {filteredAppointments.length} rescheduled appointment{filteredAppointments.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}