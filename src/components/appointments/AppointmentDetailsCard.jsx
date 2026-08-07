import React from 'react';
import { motion } from 'framer-motion';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { format } from 'date-fns';

export default function AppointmentDetailsCard({ appointment, updateMutation }) {
  return (
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

        <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
            <CalendarIcon className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-slate-400 mb-0.5">Installation Date</p>
            <Input
              type="date"
              value={appointment.installation_date || ''}
              onChange={async (e) => {
                await updateMutation.mutateAsync({
                  installation_date: e.target.value
                });
              }}
              className="h-9 border-slate-200"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}