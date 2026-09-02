import React from 'react';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import AudioPlayer from '@/components/AudioPlayer';

export default function AppointmentAudioSection({ 
  appointment, 
  canViewRecording, 
  currentUser,
  currentTeamMember,
  recordingAppointmentId,
  startRecording,
  appointmentId
}) {
  return (
    <>
      {/* Audio Recording Player */}
      {canViewRecording && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-6"
        >
          {appointment.recording_url ? (
            <AudioPlayer audioUrl={appointment.recording_url} title="Conversation Recording" />
          ) : (
            <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-2xl border border-slate-700 p-6">
              <h3 className="text-sm font-semibold text-white mb-4">Conversation Recording</h3>
              <div className="flex items-center justify-center h-20">
                <p className="text-muted-foreground text-sm">Awaiting recording upload...</p>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Audio Recorder - Admin & Sales Manager */}
      {(currentUser?.role === 'admin' || currentTeamMember?.role === 'Sales Manager') && !appointment.recording_url && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-6"
        >
          <div className="bg-white rounded-2xl border border-border p-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Record Conversation</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {recordingAppointmentId === appointmentId 
                ? 'Recording in progress (continues even if you navigate away)...' 
                : 'Click below to start recording the conversation'}
            </p>
            {recordingAppointmentId !== appointmentId && (
              <Button
                onClick={() => startRecording(appointmentId)}
                className="bg-crit hover:bg-crit"
              >
                Start Recording
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </>
  );
}