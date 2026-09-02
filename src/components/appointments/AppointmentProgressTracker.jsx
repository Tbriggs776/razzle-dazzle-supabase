import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const COMPLETED_STATUSES = ['Sold', 'Lost', 'Pitch and Miss', 'One-Leg', 'Completed'];

export default function AppointmentProgressTracker({ appointment }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-border p-6 mb-6"
    >
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-6">
        Appointment Progress
      </h2>
      <div className="flex items-center justify-between relative">
        {/* Progress Line */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-muted" style={{ zIndex: 0 }}>
          <div 
            className="h-full bg-info transition-all duration-500"
            style={{ 
              width: appointment.status === 'In Route' ? '0%' : 
                     appointment.status === 'On Site' ? '50%' : '100%'
            }}
          />
        </div>

        {/* In Route */}
        <div className="flex flex-col items-center relative z-10">
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-colors",
            appointment.consultant_en_route_time ? "bg-info text-white" : "bg-muted text-muted-foreground"
          )}>
            {appointment.consultant_en_route_time ? (
              <Check className="w-5 h-5" />
            ) : (
              <span className="text-xs">1</span>
            )}
          </div>
          <p className={cn(
            "text-xs font-medium mb-1",
            appointment.consultant_en_route_time ? "text-info" : "text-muted-foreground"
          )}>
            In Route
          </p>
          {appointment.consultant_en_route_time && (
            <>
              <p className="text-xs text-muted-foreground">
                {new Date(appointment.consultant_en_route_time).toLocaleTimeString('en-US', { 
                  hour: 'numeric', 
                  minute: '2-digit', 
                  hour12: true 
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(appointment.consultant_en_route_time).toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric' 
                })}
              </p>
            </>
          )}
        </div>

        {/* On Site */}
        <div className="flex flex-col items-center relative z-10">
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-colors",
            appointment.consultant_arrived_time ? "bg-info text-white" : "bg-muted text-muted-foreground"
          )}>
            {appointment.consultant_arrived_time ? (
              <Check className="w-5 h-5" />
            ) : (
              <span className="text-xs">2</span>
            )}
          </div>
          <p className={cn(
            "text-xs font-medium mb-1",
            appointment.consultant_arrived_time ? "text-info" : "text-muted-foreground"
          )}>
            On Site
          </p>
          {appointment.consultant_arrived_time && (
            <>
              <p className="text-xs text-muted-foreground">
                {new Date(appointment.consultant_arrived_time).toLocaleTimeString('en-US', { 
                  hour: 'numeric', 
                  minute: '2-digit', 
                  hour12: true 
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(appointment.consultant_arrived_time).toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric' 
                })}
              </p>
            </>
          )}
        </div>

        {/* Completed */}
        <div className="flex flex-col items-center relative z-10">
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-colors",
            COMPLETED_STATUSES.includes(appointment.status) 
              ? appointment.status === 'Sold' 
                ? "bg-good text-white" 
                : "bg-info text-white"
              : "bg-muted text-muted-foreground"
          )}>
            {COMPLETED_STATUSES.includes(appointment.status) ? (
              <Check className="w-5 h-5" />
            ) : (
              <span className="text-xs">3</span>
            )}
          </div>
          <p className={cn(
            "text-xs font-medium mb-1",
            COMPLETED_STATUSES.includes(appointment.status) 
              ? "text-info" 
              : "text-muted-foreground"
          )}>
            Completed
          </p>
          {COMPLETED_STATUSES.includes(appointment.status) && (
            <p className={cn(
              "text-xs font-semibold",
              appointment.status === 'Sold' ? "text-good" :
              appointment.status === 'Lost' ? "text-crit" :
              "text-muted-foreground"
            )}>
              {appointment.status}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}