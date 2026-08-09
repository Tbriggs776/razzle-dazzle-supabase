import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, CheckCircle2, Circle, Loader2, Clock, Phone, Mail, MessageCircle, Trophy, X, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ArrowUpDown } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

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

  if (isCheckingAuth || userLoading || (tasksLoading && pendingTasks.length === 0)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Please log in</h2>
          <p className="text-muted-foreground">You need to be logged in to view your tasks</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">My Tasks</h1>
              <p className="text-muted-foreground mt-1">Follow-up reminders for your appointments</p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-4 border border-amber-100 dark:border-amber-500/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center">
                  <Circle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-900 dark:text-amber-200">{pendingCount}</p>
                  <p className="text-sm text-amber-700 dark:text-amber-300">Pending Tasks</p>
                </div>
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-500/10 rounded-xl p-4 border border-green-100 dark:border-green-500/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-900 dark:text-green-200">{completedCount}</p>
                  <p className="text-sm text-green-700 dark:text-green-300">Completed Tasks</p>
                </div>
              </div>
            </div>
          </div>

          {/* DC Task Summary (Admin Only) */}
          {currentUser?.role === 'admin' && allDCs.length > 0 && (
            <div className="mt-6">
              <Label className="text-sm text-foreground mb-3 block">Task Summary by Design Consultant</Label>
              <div className="overflow-x-auto -mx-4 px-4">
                <div className="flex gap-3 pb-2 min-w-max">
                  {allDCs
                    .map(dc => {
                      const dcPending = allTasksForSummary.filter(t => t.assigned_to === dc.id).length;
                      return { dc, dcPending };
                    })
                    .sort((a, b) => b.dcPending - a.dcPending)
                    .map(({ dc, dcPending }) => (
                      <div
                        key={dc.id}
                        onClick={() => setSelectedDC(dc.id)}
                        className={cn(
                          "flex-shrink-0 w-44 bg-card rounded-xl border border-border p-4 cursor-pointer transition-all hover:shadow-lg",
                          selectedDC === dc.id && "border-primary bg-primary/10"
                        )}
                      >
                        <p className="font-semibold text-foreground mb-3 truncate">
                          {dc.first_name} {dc.last_name}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Pending</span>
                          <span className="text-lg font-bold text-amber-600 dark:text-amber-400">{dcPending}</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* DC Filter (Admin Only) */}
          {currentUser?.role === 'admin' && (
            <div className="mt-6">
              <Label className="text-sm text-foreground mb-2 block">View Tasks For</Label>
              <Select value={selectedDC} onValueChange={setSelectedDC}>
                <SelectTrigger className="w-full md:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="my">My Tasks</SelectItem>
                  <SelectItem value="all">All Design Consultants</SelectItem>
                  {allDCs.map(dc => (
                    <SelectItem key={dc.id} value={dc.id}>
                      {dc.first_name} {dc.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Filter Tabs and Sort */}
          <div className="flex gap-2 mt-6 items-center justify-between overflow-x-auto pb-2">
            <div className="flex gap-2 flex-shrink-0">
              <Button
                variant={!showCompleted ? 'default' : 'outline'}
                onClick={() => setShowCompleted(false)}
                className={!showCompleted ? 'bg-primary text-primary-foreground hover:opacity-90' : ''}
              >
                Pending ({pendingCount})
              </Button>
              <Button
                variant={showCompleted ? 'default' : 'outline'}
                onClick={() => setShowCompleted(true)}
                className={showCompleted ? 'bg-primary text-primary-foreground hover:opacity-90' : ''}
              >
                {completedLoading && showCompleted ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : null}
                Show Completed {showCompleted && completedCount > 0 ? `(${completedCount})` : ''}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortNewest(!sortNewest)}
              className="flex items-center gap-2"
            >
              <ArrowUpDown className="w-4 h-4" />
              {sortNewest ? 'Newest' : 'Oldest'}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {filteredTasks.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-secondary flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">
              {showCompleted ? 'No completed tasks' : 'No pending tasks'}
            </h3>
            <p className="text-muted-foreground">
              {showCompleted
                ? 'Complete some tasks to see them here' 
                : 'Tasks will appear here when appointments need follow-up'}
            </p>
          </motion.div>
        ) : (
          <div className="space-y-3">
            {filteredTasks.map((task, index) => {
              const appointment = appointments.find(a => a.id === task.appointment);
              const lead = leads.find(l => l.id === appointment?.customer);
              const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Customer';
              const overdue = task.status === 'pending' && isOverdue(task.due_date);
              const assignedDC = currentUser?.role === 'admin' && selectedDC === 'all' 
                ? teamMembers.find(tm => tm.id === task.assigned_to)
                : null;

              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <div className={cn(
                    "bg-card rounded-2xl border p-5 transition-all",
                    task.status === 'completed' && "border-green-200 bg-green-50/50 dark:border-green-500/25 dark:bg-green-500/10",
                    overdue && "border-red-200 bg-red-50/50 dark:border-red-500/25 dark:bg-red-500/10",
                    task.status === 'pending' && !overdue && "border-border hover:border-primary/40 hover:shadow-lg"
                  )}>
                    <div className="flex items-start gap-4">
                      {/* Status Icon */}
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                          task.status === 'completed'
                            ? "bg-green-600 text-white"
                            : "bg-muted"
                        )}
                      >
                        {task.status === 'completed' && <CheckCircle2 className="w-4 h-4" />}
                      </div>

                      {/* Delete Button */}
                      <button
                        onClick={() => {
                          if (confirm('Delete this task?')) {
                            deleteMutation.mutate(task.id);
                          }
                        }}
                        className="flex-shrink-0 p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                        title="Delete task"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      {/* Content */}
                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <Link
                              to={createPageUrl('AppointmentDetail') + `?id=${task.appointment}`}
                              className={cn(
                                "font-semibold text-lg hover:text-primary transition-colors",
                                task.status === 'completed' ? "line-through text-muted-foreground" : "text-foreground"
                              )}
                            >
                              {leadName}
                            </Link>
                            {assignedDC && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Assigned to: {assignedDC.first_name} {assignedDC.last_name}
                              </p>
                            )}
                            {task.notes && (
                              <p className={cn(
                                "text-sm mt-1",
                                task.status === 'completed' ? "text-muted-foreground" : "text-muted-foreground"
                              )}>
                                {task.notes}
                              </p>
                            )}
                          </div>

                          {/* Due Date Badge */}
                          <Badge 
                            variant="outline" 
                            className={cn(
                              'flex items-center gap-1',
                              overdue && 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25',
                              !overdue && task.status === 'pending' && 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/25',
                              task.status === 'completed' && 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/25'
                            )}
                          >
                            <Clock className="w-3 h-3" />
                            {format(new Date(task.due_date), 'MMM d, yyyy')}
                            {overdue && ' - Overdue'}
                          </Badge>
                        </div>

                        {/* Appointment Status & Contact Info */}
                        {appointment && (
                          <div className="space-y-2 mt-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="secondary" className="text-xs">
                                {appointment.status}
                              </Badge>
                              {appointment.appointment_date && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <CalendarIcon className="w-3 h-3" />
                                  {format(new Date(appointment.appointment_date), 'MMM d')}
                                </span>
                              )}
                              {appointment.not_sold_deal_size > 0 && (
                                <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25">
                                  Deal Size: ${Number(appointment.not_sold_deal_size).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 flex-wrap overflow-x-auto">
                               {lead?.phone && (
                                 <a 
                                   href={`tel:${lead.phone}`}
                                   className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                                   onClick={(e) => e.stopPropagation()}
                                 >
                                   <Phone className="w-3.5 h-3.5" />
                                   {lead.phone}
                                 </a>
                               )}
                               {lead?.email && (
                                 <a 
                                   href={`mailto:${lead.email}`}
                                   className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                                   onClick={(e) => e.stopPropagation()}
                                 >
                                   <Mail className="w-3.5 h-3.5" />
                                   {lead.email}
                                 </a>
                               )}
                               <Button
                                 variant={task.status === 'pending' ? 'default' : 'outline'}
                                 size="sm"
                                 onClick={() => {
                                   if (task.status === 'completed') {
                                     uncompleteMutation.mutate(task.id);
                                   } else {
                                     setFollowUpDialog({ 
                                       taskId: task.id, 
                                       appointmentId: task.appointment,
                                       leadName 
                                     });
                                   }
                                 }}
                                 className={cn(
                                   "h-7 text-xs",
                                   task.status === 'pending' && "bg-primary text-primary-foreground hover:opacity-90"
                                 )}
                               >
                                 <MessageCircle className="w-3 h-3 mr-1" />
                                 {task.status === 'pending' ? 'Log Follow-Up' : 'Reopen Task'}
                               </Button>
                             </div>

                            {/* Notes Section */}
                            {appointment?.notes && appointment.notes.length > 0 && (
                             <div className="mt-3 border-t border-border pt-3">
                               <p className="text-xs font-semibold text-muted-foreground mb-2">Appointment Notes</p>
                               <div className="max-h-32 overflow-y-auto space-y-2 pr-2 overscroll-contain overflow-x-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
                                 {[...appointment.notes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((note, idx) => (
                                   <div key={idx} className="bg-muted rounded-lg p-2.5 border border-border break-words">
                                      <div className="flex items-start justify-between gap-2 mb-1">
                                        <p className="text-xs font-semibold text-foreground">{note.user_name}</p>
                                        {note.context && (
                                          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                                            {note.context}
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground leading-relaxed">{note.content}</p>
                                      {note.timestamp && (
                                        <p className="text-[10px] text-muted-foreground mt-1">
                                          {format(new Date(note.timestamp), 'MMM d, yyyy h:mm a')}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            </div>
                            )}
                            </div>
                            </div>
                            </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Follow-Up Dialog */}
      <Dialog open={!!followUpDialog} onOpenChange={(open) => !open && setFollowUpDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Log Follow-Up</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {followUpDialog?.leadName}
            </p>
          </DialogHeader>
          <div className="space-y-4 mt-4">
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
                  className="mt-1.5 w-full px-3 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted disabled:cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
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
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Trophy className="w-4 h-4 mr-2" />
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
    </div>
  );
}