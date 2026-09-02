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
      className="bg-white rounded-2xl border border-border p-6"
    >
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
        Appointment Details
      </h2>
      <div className="space-y-4">
        {appointment.appointment_date && (
          <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors">
            <div className="w-10 h-10 rounded-lg bg-info/12 flex items-center justify-center">
              <CalendarIcon className="w-5 h-5 text-info" />
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
          <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
              <Clock className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Time Block</p>
              <p className="text-foreground">{appointment.appointment_block}</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors">
          <div className="w-10 h-10 rounded-lg bg-good/12 flex items-center justify-center">
            <CalendarIcon className="w-5 h-5 text-good" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground mb-0.5">Installation Date</p>
            <Input
              type="date"
              value={appointment.installation_date || ''}
              onChange={async (e) => {
                await updateMutation.mutateAsync({
                  installation_date: e.target.value
                });
              }}
              className="h-9 border-border"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}