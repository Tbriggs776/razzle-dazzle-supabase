import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Loader2, Trophy, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPageUrl } from '@/utils';

export default function FollowUpDialog({ open, onClose, appointment, lead, currentUser }) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState('call');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');

  const saveMutation = useMutation({
    mutationFn: async ({ appointmentId, method, notes, dueDate, markLost }) => {
      if (!appointment) throw new Error('Appointment not found');

      const timestamp = new Date().toISOString();
      const userName = currentUser?.full_name || 'Unknown User';
      const userEmail = currentUser?.email || '';

      const newNote = {
        content: notes,
        user_name: userName,
        user_email: userEmail,
        timestamp,
        context: `Follow-Up (${method})`
      };

      const updatedNotes = [...(appointment.notes || []), newNote];
      const updateData = { notes: updatedNotes };

      if (markLost) {
        updateData.status = 'Lost';
      }

      await base44.entities.Appointment.update(appointmentId, updateData);

      // Find and complete the pending task for this appointment
      const tasks = await base44.entities.Task.filter({ appointment: appointmentId, status: 'pending' });
      for (const task of tasks) {
        await base44.entities.Task.update(task.id, { status: 'completed' });
      }

      // Create new follow-up task unless marked as lost
      if (!markLost && dueDate && currentUser?.email) {
        const teamMembers = await base44.entities.TeamMember.filter({ email: currentUser.email });
        if (teamMembers.length) {
          await base44.entities.Task.create({
            appointment: appointmentId,
            assigned_to: teamMembers[0].id,
            due_date: dueDate,
            status: 'pending',
            type: 'follow_up',
            notes: `Previous update: ${notes}`
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myAppointmentResults'] });
      queryClient.invalidateQueries({ queryKey: ['myResultsTasks'] });
      queryClient.invalidateQueries({ queryKey: ['myTasksSummary'] });
      queryClient.invalidateQueries({ queryKey: ['myTasks'] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      handleClose();
    }
  });

  const handleClose = () => {
    setNotes('');
    setMethod('call');
    setDueDate('');
    onClose();
  };

  const handleMarkWon = async () => {
    if (!notes.trim()) return;
    await saveMutation.mutateAsync({
      appointmentId: appointment?.id,
      method,
      notes: notes.trim(),
      dueDate: '',
      markLost: false
    });
    window.location.href = createPageUrl('ConsultantAppointmentView') + `?id=${appointment?.id}&action=sold`;
  };

  const handleMarkLost = () => {
    if (!notes.trim()) return;
    saveMutation.mutate({
      appointmentId: appointment?.id,
      method,
      notes: notes.trim(),
      dueDate: '',
      markLost: true
    });
  };

  const handleSave = () => {
    if (!notes.trim() || !dueDate) return;
    saveMutation.mutate({
      appointmentId: appointment?.id,
      method,
      notes: notes.trim(),
      dueDate,
      markLost: false
    });
  };

  const leadName = lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : 'Unknown Customer';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log Follow-Up</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{leadName}</p>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label>Follow-Up Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="call">Phone Call</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="text">Text Message</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was discussed? Next steps?"
              className="mt-1.5 min-h-32"
            />
          </div>

          <div className="border-t border-border pt-4">
            <Label>Next Follow-Up Due Date</Label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              A new follow-up task will be created automatically
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <Button
                onClick={handleMarkWon}
                disabled={!notes.trim() || saveMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Trophy className="w-4 h-4 mr-2" />
                Mark as Won
              </Button>
              <Button
                onClick={handleMarkLost}
                disabled={!notes.trim() || saveMutation.isPending}
                variant="outline"
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <>
                    <X className="w-4 h-4 mr-2" />
                    Mark as Lost
                  </>
                )}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!notes.trim() || !dueDate || saveMutation.isPending}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Follow-Up'
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
