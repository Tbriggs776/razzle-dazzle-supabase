import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Phone, Mail, MessageCircle, Trophy, X, Trash2, ArrowUpDown, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import KpiTile from '@/components/dashboard/KpiTile';
import ModuleCard from '@/components/dashboard/ModuleCard';
import WorkRow from '@/components/dashboard/WorkRow';

export default function MyTasks() {
  const [showCompleted, setShowCompleted] = useState(false);
  const [followUpDialog, setFollowUpDialog] = useState(null); // { taskId, appointmentId, leadName }
  const [followUpMethod, setFollowUpMethod] = useState('call');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [markAsWonOrLost, setMarkAsWonOrLost] = useState(false);
  const [sortNewest, setSortNewest] = useState(true); // true = newest first, false = oldest first
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [selectedDC, setSelectedDC] = useState('my'); // 'my' | specific DC ID | 'all'
  const queryClient = useQueryClient();

  // Check authentication
  React.useEffect(() => {
    const checkAuth = async () => {
      const isAuthenticated = await base44.auth.isAuthenticated();
      if (!isAuthenticated) {
        base44.auth.redirectToLogin(window.location.href);
      } else {
        setIsCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  // Get current user
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false,
    enabled: !isCheckingAuth
  });

  // Get all design consultants (for admin view)
  const { data: allDCs = [] } = useQuery({
    queryKey: ['allDesignConsultants'],
    queryFn: () => base44.entities.TeamMember.filter({
      role: { $in: ['Design Consultant', 'Sales Manager'] },
      is_active: true
    }),
    enabled: currentUser?.role === 'admin'
  });

  // Fetch ALL pending tasks for admin summary cards
  const { data: allTasksForSummary = [] } = useQuery({
    queryKey: ['allTasksForSummary'],
    queryFn: () => base44.entities.Task.filter({ status: 'pending' }),
    enabled: currentUser?.role === 'admin'
  });

  // Helper to get the assigned_to ID for current user/selection
  const getTaskFilter = async (status) => {
    if (!currentUser?.email) return [];
    const baseFilter = { status };

    if (currentUser.role === 'admin') {
      if (selectedDC === 'all') {
        return await base44.entities.Task.filter(baseFilter);
      }
      if (selectedDC !== 'my') {
        return await base44.entities.Task.filter({ ...baseFilter, assigned_to: selectedDC });
      }
    }

    const teamMembers = await base44.entities.TeamMember.filter({ email: currentUser.email });
    if (!teamMembers.length) return [];
    return await base44.entities.Task.filter({ ...baseFilter, assigned_to: teamMembers[0].id });
  };

  // Only fetch pending tasks by default
  const { data: pendingTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['myTasks', 'pending', selectedDC, currentUser?.email],
    queryFn: () => getTaskFilter('pending'),
    enabled: !!currentUser?.email
  });

  // Only fetch completed tasks when user requests them
  const { data: completedTasks = [], isLoading: completedLoading } = useQuery({
    queryKey: ['myTasks', 'completed', selectedDC, currentUser?.email],
    queryFn: () => getTaskFilter('completed'),
    enabled: !!currentUser?.email && showCompleted
  });

  const tasks = showCompleted ? [...pendingTasks, ...completedTasks] : pendingTasks;

  // Get team member info for tasks (for admin view)
  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list(),
    enabled: currentUser?.role === 'admin' && (selectedDC === 'all')
  });

  // Only fetch appointments + leads that tasks actually reference, in one chained query
  const appointmentIds = useMemo(() => [...new Set(tasks.map(t => t.appointment).filter(Boolean))], [tasks]);

  const { data: { appointments, leads } = { appointments: [], leads: [] } } = useQuery({
    queryKey: ['taskAppointmentsAndLeads', appointmentIds.join(',')],
    queryFn: async () => {
      if (!appointmentIds.length) return { appointments: [], leads: [] };

      // Batch fetch in chunks of 25 using filter with $in to avoid per-record API calls
      const CHUNK = 25;
      const appointmentChunks = [];
      for (let i = 0; i < appointmentIds.length; i += CHUNK) {
        appointmentChunks.push(appointmentIds.slice(i, i + CHUNK));
      }
      const appointmentResults = await Promise.all(
        appointmentChunks.map(chunk =>
          base44.entities.Appointment.filter({ id: { $in: chunk } }, '-created_date', chunk.length).catch(() => [])
        )
      );
      const fetchedAppointments = appointmentResults.flat();

      const leadIds = [...new Set(fetchedAppointments.map(a => a.customer).filter(Boolean))];
      const leadChunks = [];
      for (let i = 0; i < leadIds.length; i += CHUNK) {
        leadChunks.push(leadIds.slice(i, i + CHUNK));
      }
      const leadResults = await Promise.all(
        leadChunks.map(chunk =>
          base44.entities.Lead.filter({ id: { $in: chunk } }, '-created_date', chunk.length).catch(() => [])
        )
      );
      const fetchedLeads = leadResults.flat();

      return { appointments: fetchedAppointments, leads: fetchedLeads };
    },
    enabled: appointmentIds.length > 0
  });

  const completeMutation = useMutation({
    mutationFn: async (taskId) => {
      await base44.entities.Task.update(taskId, { status: 'completed' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    }
  });

  const uncompleteMutation = useMutation({
    mutationFn: async (taskId) => {
      await base44.entities.Task.update(taskId, { status: 'pending' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (taskId) => {
      await base44.entities.Task.delete(taskId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    }
  });

  const saveFollowUpMutation = useMutation({
    mutationFn: async ({ taskId, appointmentId, method, notes, dueDate, markLost }) => {
      const appointment = appointments.find(a => a.id === appointmentId);
      if (!appointment) throw new Error('Appointment not found');

      // Add note to appointment
      const timestamp = new Date().toISOString();
      const userName = currentUser?.full_name || 'Unknown User';
      const userEmail = currentUser?.email || '';

      const newNote = {
        content: notes,
        user_name: userName,
        user_email: userEmail,
        timestamp: timestamp,
        context: `Follow-Up (${method})`
      };

      const updatedNotes = [...(appointment.notes || []), newNote];
      const updateData = { notes: updatedNotes };

      // Mark as lost if requested
      if (markLost) {
        updateData.status = 'Lost';
      }

      await base44.entities.Appointment.update(appointmentId, updateData);

      // Mark current task as completed
      await base44.entities.Task.update(taskId, { status: 'completed' });

      // Always create new task unless marked as lost
      if (!markLost && dueDate && currentUser?.email) {
        const teamMembers = await base44.entities.TeamMember.filter({
          email: currentUser.email
        });
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
      queryClient.invalidateQueries({ queryKey: ['myTasks'] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      setFollowUpDialog(null);
      setFollowUpNotes('');
      setFollowUpMethod('call');
      setNewTaskDueDate('');
      setMarkAsWonOrLost(false);
    }
  });

  const filteredTasks = tasks.slice().sort((a, b) => {
    const dateA = new Date(a.due_date);
    const dateB = new Date(b.due_date);
    return sortNewest ? dateB - dateA : dateA - dateB;
  });

  const pendingCount = pendingTasks.length;
  const completedCount = completedTasks.length;

  const isOverdue = (dueDate) => {
    return new Date(dueDate) < new Date() && new Date(dueDate).toDateString() !== new Date().toDateString();
  };

  const overdueCount = pendingTasks.filter((t) => isOverdue(t.due_date)).length;

  if (isCheckingAuth || userLoading || (tasksLoading && pendingTasks.length === 0)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="mb-2 text-xl font-semibold text-foreground">Please log in</h2>
          <p className="text-muted-foreground">You need to be logged in to view your tasks</p>
        </div>
      </div>
    );
  }

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Tasks"
          title="My Tasks"
          subtitle="Follow-up reminders for your appointments."
          actions={isAdmin ? (
            <Select value={selectedDC} onValueChange={setSelectedDC}>
              <SelectTrigger className="h-9 w-56 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="my">My Tasks</SelectItem>
                <SelectItem value="all">All Design Consultants</SelectItem>
                {allDCs.map((dc) => (
                  <SelectItem key={dc.id} value={dc.id}>
                    {dc.first_name} {dc.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile
            label="Open Tasks"
            value={pendingCount}
            hero
            foot="Pending follow-ups"
          />
          <KpiTile
            label="Overdue"
            value={overdueCount}
            dir="up"
            deltaTone="bad"
            delta={overdueCount > 0 ? 'Past due' : undefined}
            foot="Pending tasks past their due date"
          />
          <KpiTile
            label="Completed"
            value={completedCount}
            foot={showCompleted ? 'Marked done' : 'Toggle "Completed" to load'}
          />
        </div>

        {/* DC Task Summary (Admin Only) */}
        {isAdmin && allDCs.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Task Load by Consultant
            </div>
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {allDCs
                .map((dc) => {
                  const dcPending = allTasksForSummary.filter((t) => t.assigned_to === dc.id).length;
                  return { dc, dcPending };
                })
                .sort((a, b) => b.dcPending - a.dcPending)
                .map(({ dc, dcPending }) => (
                  <div key={dc.id} className="w-44 shrink-0">
                    <KpiTile
                      label={`${dc.first_name} ${dc.last_name}`}
                      value={dcPending}
                      foot="Pending tasks"
                      onClick={() => setSelectedDC(dc.id)}
                      className={cn(selectedDC === dc.id && 'border-brand-pink/50 ring-1 ring-brand-pink/30')}
                    />
                  </div>
                ))}
            </div>
          </div>
        )}

        <ModuleCard
          title="Tasks"
          subtitle={`${filteredTasks.length} ${filteredTasks.length === 1 ? 'task' : 'tasks'} · ${showCompleted ? 'Pending + completed' : 'Pending only'} · ${sortNewest ? 'Newest first' : 'Oldest first'}`}
          icon={ListChecks}
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex rounded-lg border border-border bg-card p-0.5">
                <button
                  onClick={() => setShowCompleted(false)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                    !showCompleted ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Pending ({pendingCount})
                </button>
                <button
                  onClick={() => setShowCompleted(true)}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                    showCompleted ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {completedLoading && showCompleted && <Loader2 className="h-3 w-3 animate-spin" />}
                  Completed{showCompleted && completedCount > 0 ? ` (${completedCount})` : ''}
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortNewest(!sortNewest)}
                className="gap-2"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {sortNewest ? 'Newest' : 'Oldest'}
              </Button>
            </div>
          }
        >
          {filteredTasks.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">
                {showCompleted ? 'No completed tasks' : 'No pending tasks'}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {showCompleted
                  ? 'Complete some tasks to see them here'
                  : 'Tasks will appear here when appointments need follow-up'}
              </p>
            </div>
          ) : (
            filteredTasks.map((task) => {
              const appointment = appointments.find((a) => a.id === task.appointment);
              const lead = leads.find((l) => l.id === appointment?.customer);
              const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Customer';
              const overdue = task.status === 'pending' && isOverdue(task.due_date);
              const assignedDC = isAdmin && selectedDC === 'all'
                ? teamMembers.find((tm) => tm.id === task.assigned_to)
                : null;
              const isCompleted = task.status === 'completed';

              const statusTone = isCompleted ? 'good' : overdue ? 'crit' : 'warn';
              const statusLabel = isCompleted ? 'Done' : overdue ? 'Overdue' : 'Pending';

              const meta = [
                task.notes,
                appointment?.status,
                appointment?.appointment_date && `Appt ${format(new Date(appointment.appointment_date), 'MMM d')}`,
                appointment?.not_sold_deal_size > 0 &&
                  `Deal $${Number(appointment.not_sold_deal_size).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                assignedDC && `${assignedDC.first_name} ${assignedDC.last_name}`,
              ]
                .filter(Boolean)
                .join('  ·  ');

              return (
                <div key={task.id}>
                  <WorkRow
                    lead={
                      <span className={cn('block', overdue && 'text-crit')}>
                        {format(new Date(task.due_date), 'MMM d')}
                      </span>
                    }
                    primary={
                      <Link
                        to={createPageUrl('AppointmentDetail') + `?id=${task.appointment}`}
                        className={cn(
                          'transition-colors hover:text-primary',
                          isCompleted && 'text-muted-foreground line-through'
                        )}
                      >
                        {leadName}
                      </Link>
                    }
                    meta={meta}
                    trailing={<StatusPill tone={statusTone}>{statusLabel}</StatusPill>}
                  />

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3">
                    {lead?.phone && (
                      <a
                        href={`tel:${lead.phone}`}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {lead.phone}
                      </a>
                    )}
                    {lead?.email && (
                      <a
                        href={`mailto:${lead.email}`}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Mail className="h-3.5 w-3.5" />
                        {lead.email}
                      </a>
                    )}

                    <div className="ml-auto flex items-center gap-1.5">
                      <Button
                        variant={isCompleted ? 'outline' : 'default'}
                        size="sm"
                        onClick={() => {
                          if (isCompleted) {
                            uncompleteMutation.mutate(task.id);
                          } else {
                            setFollowUpDialog({
                              taskId: task.id,
                              appointmentId: task.appointment,
                              leadName,
                            });
                          }
                        }}
                        className="gap-1"
                      >
                        <MessageCircle className="h-3 w-3" />
                        {isCompleted ? 'Reopen Task' : 'Log Follow-Up'}
                      </Button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this task?')) {
                            deleteMutation.mutate(task.id);
                          }
                        }}
                        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title="Delete task"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {appointment?.notes && appointment.notes.length > 0 && (
                    <div className="px-4 pb-4">
                      <div className="rounded-lg border border-border bg-muted/40 p-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Appointment Notes
                        </p>
                        <div
                          className="max-h-32 space-y-2 overflow-y-auto overflow-x-hidden overscroll-contain pr-2"
                          style={{ WebkitOverflowScrolling: 'touch' }}
                        >
                          {[...appointment.notes]
                            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                            .map((note, idx) => (
                              <div key={idx} className="break-words rounded-lg border border-border bg-card p-2.5">
                                <div className="mb-1 flex items-start justify-between gap-2">
                                  <p className="text-xs font-semibold text-foreground">{note.user_name}</p>
                                  {note.context && (
                                    <span className="shrink-0 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {note.context}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs leading-relaxed text-muted-foreground">{note.content}</p>
                                {note.timestamp && (
                                  <p className="mt-1 text-[10px] text-muted-foreground">
                                    {format(new Date(note.timestamp), 'MMM d, yyyy h:mm a')}
                                  </p>
                                )}
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </ModuleCard>
      </div>

      {/* Follow-Up Dialog */}
      <Dialog open={!!followUpDialog} onOpenChange={(open) => !open && setFollowUpDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Log Follow-Up</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {followUpDialog?.leadName}
            </p>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div>
              <Label>Follow-Up Method</Label>
              <Select value={followUpMethod} onValueChange={setFollowUpMethod}>
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
                value={followUpNotes}
                onChange={(e) => setFollowUpNotes(e.target.value)}
                placeholder="What was discussed? Next steps?"
                className="mt-1.5 min-h-32"
              />
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div>
                <Label>Next Follow-Up Due Date *</Label>
                <input
                  type="date"
                  value={newTaskDueDate}
                  onChange={(e) => setNewTaskDueDate(e.target.value)}
                  disabled={markAsWonOrLost}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:bg-muted"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  A new follow-up task will be created automatically
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    if (!followUpNotes.trim()) return;
                    setMarkAsWonOrLost(true);
                    await saveFollowUpMutation.mutateAsync({
                      taskId: followUpDialog.taskId,
                      appointmentId: followUpDialog.appointmentId,
                      method: followUpMethod,
                      notes: followUpNotes.trim(),
                      dueDate: '',
                      markLost: false
                    });
                    window.location.href = `/ConsultantAppointmentView?id=${followUpDialog?.appointmentId}&action=sold`;
                  }}
                  disabled={!followUpNotes.trim() || saveFollowUpMutation.isPending}
                  className="flex-1 bg-good text-white hover:bg-good/90"
                >
                  <Trophy className="mr-2 h-4 w-4" />
                  Mark as Won
                </Button>
                <Button
                  onClick={() => {
                    if (!followUpNotes.trim()) return;
                    setMarkAsWonOrLost(true);
                    saveFollowUpMutation.mutate({
                      taskId: followUpDialog.taskId,
                      appointmentId: followUpDialog.appointmentId,
                      method: followUpMethod,
                      notes: followUpNotes.trim(),
                      dueDate: '',
                      markLost: true
                    });
                  }}
                  disabled={!followUpNotes.trim() || saveFollowUpMutation.isPending}
                  variant="outline"
                  className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                >
                  {saveFollowUpMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <X className="mr-2 h-4 w-4" />
                      Mark as Lost
                    </>
                  )}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setFollowUpDialog(null)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (!followUpNotes.trim() || !newTaskDueDate) return;
                    saveFollowUpMutation.mutate({
                      taskId: followUpDialog.taskId,
                      appointmentId: followUpDialog.appointmentId,
                      method: followUpMethod,
                      notes: followUpNotes.trim(),
                      dueDate: newTaskDueDate,
                      markLost: false
                    });
                  }}
                  disabled={!followUpNotes.trim() || !newTaskDueDate || saveFollowUpMutation.isPending}
                  className="flex-1 bg-primary text-primary-foreground hover:opacity-90"
                >
                  {saveFollowUpMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
    </div>
  );
}
