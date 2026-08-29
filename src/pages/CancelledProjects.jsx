import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { announceDelivery } from '@/lib/deliveryToast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, Loader2, ClipboardCheck, Calendar as CalendarIcon, MapPin, Clock, XCircle, AlertTriangle, Ban, RotateCcw, CheckCircle, Send } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function CancelledProjects() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all' | 'cancelled' | 'pending_cancellation'
  const [cancelDialog, setCancelDialog] = useState(null); // { project, customerName }
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [uncancelling, setUncancelling] = useState(null); // project id being uncancelled
  const [clearingPending, setClearingPending] = useState(null); // project id being cleared
  const [savingAttempt, setSavingAttempt] = useState(null); // project id being flagged as actively worked
  const [updateTexts, setUpdateTexts] = useState({}); // { [projectId]: string }
  const [sendingUpdate, setSendingUpdate] = useState(null); // project id currently sending an update

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const handleUncancelProject = async (project) => {
    setUncancelling(project.id);
    try {
      const sale = sales.find(s => s.id === project.sale);
      const restoreStatus = project.pre_cancelled_status || 'Accepted';
      await base44.entities.Project.update(project.id, {
        status: restoreStatus,
        installation_date_status: null,
        cancelled_date: null,
        cancelled_by: null,
        cancelled_reason: null,
        pre_cancelled_status: null
      });
      if (sale) {
        await base44.entities.Sale.update(sale.id, {
          is_cancelled: false,
          cancelled_date: null,
          cancelled_reason: null
        });
      }
      queryClient.invalidateQueries({ queryKey: ['allProjectsForCancelled'] });
    } finally {
      setUncancelling(null);
    }
  };

  const handleFlagSaveAttempt = async (project) => {
    setSavingAttempt(project.id);
    try {
      const userName = currentUser?.full_name || currentUser?.email || 'Unknown';
      const now = new Date().toISOString();
      await base44.entities.Project.update(project.id, {
        cancellation_save_attempt_by: userName,
        cancellation_save_attempt_date: now
      });
      // Non-blocking, but no longer silent: this SMS is how the cancellation list
      // learns someone tried to save the job.
      announceDelivery(
        base44.functions.invoke('sendCancellationSaveAttempt', { project_id: project.id }),
        { saved: 'Save attempt recorded', sent: 'the alert did not go out' },
      );
      queryClient.invalidateQueries({ queryKey: ['allProjectsForCancelled'] });
    } finally {
      setSavingAttempt(null);
    }
  };

  const handleClearSaveAttempt = async (project) => {
    setSavingAttempt(project.id);
    try {
      await base44.entities.Project.update(project.id, {
        cancellation_save_attempt_by: null,
        cancellation_save_attempt_date: null
      });
      queryClient.invalidateQueries({ queryKey: ['allProjectsForCancelled'] });
    } finally {
      setSavingAttempt(null);
    }
  };

  const handleSendUpdate = async (project) => {
    const text = (updateTexts[project.id] || '').trim();
    if (!text) return;
    setSendingUpdate(project.id);
    try {
      const userName = currentUser?.full_name || currentUser?.email || 'Unknown';
      const now = new Date().toISOString();
      const existing = Array.isArray(project.cancellation_updates) ? project.cancellation_updates : [];
      await base44.entities.Project.update(project.id, {
        cancellation_updates: [...existing, { content: text, user_name: userName, timestamp: now }]
      });
      announceDelivery(
        base44.functions.invoke('sendCancellationUpdate', { project_id: project.id, message: text }),
        { saved: 'Update saved', sent: 'the alert did not go out' },
      );
      setUpdateTexts(prev => ({ ...prev, [project.id]: '' }));
      queryClient.invalidateQueries({ queryKey: ['allProjectsForCancelled'] });
    } finally {
      setSendingUpdate(null);
    }
  };

  const handleClearPending = async (project) => {
    setClearingPending(project.id);
    try {
      const customer = customers.find(c => c.id === project.customer);
      const sale = sales.find(s => s.id === project.sale);
      await base44.entities.Project.update(project.id, {
        installation_date_status: null,
        pending_cancellation_date: null
      });
      announceDelivery(
        base44.functions.invoke('sendCancellationStatusAlert', {
          type: 'cleared',
          customerName: customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown',
          invoiceNumber: sale?.invoice_number || null,
          installDate: project.installation_date || null,
          clearedBy: currentUser?.full_name || currentUser?.email || 'Unknown'
        }),
        { saved: 'Pending cancellation cleared', sent: 'the alert did not go out' },
      );
      queryClient.invalidateQueries({ queryKey: ['allProjectsForCancelled'] });
    } finally {
      setClearingPending(null);
    }
  };

  const handleCancelProject = async () => {
    if (!cancelDialog) return;
    setCancelling(true);
    try {
      const project = cancelDialog.project;
      const sale = sales.find(s => s.id === project.sale);
      const now = new Date().toISOString();
      const reason = cancelReason.trim() || null;

      // Cancel the project
      await base44.entities.Project.update(project.id, {
        status: 'Cancelled',
        installation_date_status: null,
        cancelled_date: now,
        cancelled_by: currentUser?.full_name || currentUser?.email || 'Unknown',
        cancelled_reason: reason,
        pre_cancelled_status: project.status
      });

      // Mark the linked sale as cancelled so it's excluded from reports
      if (sale) {
        await base44.entities.Sale.update(sale.id, {
          is_cancelled: true,
          cancelled_date: now,
          cancelled_reason: reason
        });
      }

      const customer = customers.find(c => c.id === cancelDialog.project.customer);
      announceDelivery(
        base44.functions.invoke('sendCancellationStatusAlert', {
          type: 'cancelled',
          customerName: customer ? `${customer.first_name} ${customer.last_name}` : cancelDialog.customerName,
          invoiceNumber: sales.find(s => s.id === cancelDialog.project.sale)?.invoice_number || null,
          installDate: cancelDialog.project.installation_date || null,
          reason: cancelReason.trim() || null
        }),
        { saved: 'Project cancelled', sent: 'the alert did not go out' },
      );
      queryClient.invalidateQueries({ queryKey: ['allProjectsForCancelled'] });
      setCancelDialog(null);
      setCancelReason('');
    } finally {
      setCancelling(false);
    }
  };

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['allProjectsForCancelled'],
    queryFn: () => base44.entities.Project.list('-created_date', 500)
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list('-created_date', 500)
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['sales'],
    queryFn: () => base44.entities.Sale.list('-created_date', 500)
  });

  const cancelledProjects = projects.filter(p => p.status === 'Cancelled');
  const pendingCancellationProjects = projects.filter(p => p.installation_date_status === 'pending cancellation');

  const baseFiltered = (() => {
    if (filterType === 'cancelled') return cancelledProjects;
    if (filterType === 'pending_cancellation') return pendingCancellationProjects;
    // 'all' = union of both (no duplicates)
    const ids = new Set(cancelledProjects.map(p => p.id));
    return [
      ...cancelledProjects,
      ...pendingCancellationProjects.filter(p => !ids.has(p.id))
    ];
  })();

  const filteredProjects = (() => {
    if (!searchQuery.trim()) return baseFiltered;
    const normalize = (str) => str.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const query = normalize(searchQuery);
    const tokens = query.split(' ').filter(Boolean);
    return baseFiltered.filter(project => {
      const customer = customers.find(c => c.id === project.customer);
      const firstName = customer?.first_name?.toLowerCase() || '';
      const lastName = customer?.last_name?.toLowerCase() || '';
      const name = `${firstName} ${lastName}`.trim();
      const nameReversed = `${lastName} ${firstName}`.trim();
      const sale = sales.find(s => s.id === project.sale);
      const invoice = sale?.invoice_number?.toLowerCase() || '';
      return tokens.every(t => name.includes(t) || nameReversed.includes(t) || invoice.includes(t));
    });
  })();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Cancellations</h1>
              <p className="text-muted-foreground mt-1">Cancelled and pending cancellation projects</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 gap-y-2 text-sm text-muted-foreground">
              <span className="bg-red-100 text-red-700 border border-red-200 rounded-lg px-3 py-1.5 font-medium dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25">
                {cancelledProjects.length} Cancelled
              </span>
              <span className="bg-orange-100 text-orange-700 border border-orange-200 rounded-lg px-3 py-1.5 font-medium dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25">
                {pendingCancellationProjects.length} Pending Cancellation
              </span>
            </div>
          </div>

          {/* Search */}
          <div className="relative mt-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search by customer name or invoice number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 h-12 bg-card border-border"
            />
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 mt-4 overflow-x-auto pb-1">
            <Button
              variant={filterType === 'all' ? 'default' : 'outline'}
              onClick={() => setFilterType('all')}
              className={cn("h-9 whitespace-nowrap", filterType === 'all' ? 'bg-primary text-primary-foreground hover:opacity-90' : '')}
            >
              All ({cancelledProjects.length + pendingCancellationProjects.filter(p => p.status !== 'Cancelled').length})
            </Button>
            <Button
              variant={filterType === 'cancelled' ? 'default' : 'outline'}
              onClick={() => setFilterType('cancelled')}
              className={cn("h-9 whitespace-nowrap", filterType === 'cancelled' ? 'bg-red-600 hover:bg-red-700 text-white' : 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10')}
            >
              🚫 Cancelled ({cancelledProjects.length})
            </Button>
            <Button
              variant={filterType === 'pending_cancellation' ? 'default' : 'outline'}
              onClick={() => setFilterType('pending_cancellation')}
              className={cn("h-9 whitespace-nowrap", filterType === 'pending_cancellation' ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'border-orange-200 text-orange-700 hover:bg-orange-50 dark:border-orange-500/30 dark:text-orange-300 dark:hover:bg-orange-500/10')}
            >
              ⚠️ Pending Cancellation ({pendingCancellationProjects.length})
            </Button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-2xl border border-border">
            <ClipboardCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground">No projects found</h3>
            <p className="text-muted-foreground mt-1">
              {searchQuery ? 'Try adjusting your search' : 'No cancelled or pending cancellation projects'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filteredProjects.map((project, index) => {
              const customer = customers.find(c => c.id === project.customer);
              const customerName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown';
              const sale = sales.find(s => s.id === project.sale);
              const isCancelled = project.status === 'Cancelled';
              const isPendingCancellation = project.installation_date_status === 'pending cancellation';

              return (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className={cn(
                    "bg-card rounded-xl border transition-all hover:shadow-md",
                    isCancelled ? "border-red-200 hover:border-red-300 dark:border-red-500/30 dark:hover:border-red-500/50" : "border-orange-200 hover:border-orange-300 dark:border-orange-500/30 dark:hover:border-orange-500/50"
                  )}
                >
                  <div className="px-6 pt-4 pb-0 flex flex-wrap justify-end gap-2 gap-y-2">
                    {isCancelled && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-500/30 dark:text-green-300 dark:hover:bg-green-500/10"
                        disabled={uncancelling === project.id}
                        onClick={(e) => {
                          e.preventDefault();
                          handleUncancelProject(project);
                        }}
                      >
                        {uncancelling === project.id ? (
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4 mr-1.5" />
                        )}
                        Restore Project
                      </Button>
                    )}
                    {isPendingCancellation && !isCancelled && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-500/30 dark:text-green-300 dark:hover:bg-green-500/10"
                          disabled={clearingPending === project.id}
                          onClick={(e) => {
                            e.preventDefault();
                            handleClearPending(project);
                          }}
                        >
                          {clearingPending === project.id ? (
                            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4 mr-1.5" />
                          )}
                          Clear Pending
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="bg-destructive text-destructive-foreground hover:opacity-90"
                          onClick={(e) => {
                            e.preventDefault();
                            setCancelDialog({ project, customerName });
                            setCancelReason('');
                          }}
                        >
                          <Ban className="w-4 h-4 mr-1.5" />
                          Cancel Project
                        </Button>
                      </>
                    )}
                    {project.cancellation_save_attempt_by ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-border text-muted-foreground hover:bg-secondary"
                        disabled={savingAttempt === project.id}
                        onClick={(e) => {
                          e.preventDefault();
                          handleClearSaveAttempt(project);
                        }}
                      >
                        {savingAttempt === project.id ? (
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4 mr-1.5" />
                        )}
                        Clear Working
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-500/10"
                        disabled={savingAttempt === project.id}
                        onClick={(e) => {
                          e.preventDefault();
                          handleFlagSaveAttempt(project);
                        }}
                      >
                        {savingAttempt === project.id ? (
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        ) : (
                          <ClipboardCheck className="w-4 h-4 mr-1.5" />
                        )}
                        Working — Trying to Save
                      </Button>
                    )}
                  </div>
                <Link to={createPageUrl('ProjectDetail') + `?id=${project.id}`} className="block p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {isCancelled ? (
                            <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
                          )}
                          <h3 className="text-lg font-semibold text-foreground">{customerName}</h3>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {isCancelled && (
                            <Badge className="bg-red-100 text-red-800 border border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/25">
                              🚫 Cancelled
                            </Badge>
                          )}
                          {isPendingCancellation && !isCancelled && (
                            <Badge className="bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25">
                              ⚠️ Pending Cancellation
                            </Badge>
                          )}
                          {isPendingCancellation && isCancelled && (
                            <Badge className="bg-orange-100 text-orange-800 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25">
                              ⚠️ Pending Cancellation
                            </Badge>
                          )}
                          {project.status !== 'Cancelled' && (
                            <Badge className="bg-secondary text-secondary-foreground border border-border">
                              {project.status}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Save attempt indicator */}
                    {project.cancellation_save_attempt_by && (
                      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-3 space-y-1 dark:bg-blue-500/10 dark:border-blue-500/20">
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          <span className="font-medium">🛠️ Working this — trying to save:</span> {project.cancellation_save_attempt_by}
                        </p>
                        {project.cancellation_save_attempt_date && (
                          <p className="text-xs text-blue-600 dark:text-blue-300">
                            Flagged {format(new Date(project.cancellation_save_attempt_date), 'MMM d, yyyy h:mm a')}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Cancellation details */}
                    {isCancelled && (project.cancelled_by || project.cancelled_date || project.cancelled_reason) && (
                      <div className="bg-red-50 border border-red-100 rounded-lg p-3 mb-3 space-y-1 dark:bg-red-500/10 dark:border-red-500/20">
                        {project.cancelled_by && (
                          <p className="text-xs text-red-700 dark:text-red-300"><span className="font-medium">Cancelled by:</span> {project.cancelled_by}</p>
                        )}
                        {project.cancelled_date && (
                          <p className="text-xs text-red-700 dark:text-red-300">
                            <span className="font-medium">Date:</span> {format(new Date(project.cancelled_date), 'MMM d, yyyy h:mm a')}
                          </p>
                        )}
                        {project.cancelled_reason && (
                          <p className="text-xs text-red-700 dark:text-red-300"><span className="font-medium">Reason:</span> {project.cancelled_reason}</p>
                        )}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span>Created: {project.created_date ? format(new Date(project.created_date), 'MMM d, yyyy') : 'N/A'}</span>
                      </div>
                      {isPendingCancellation && !isCancelled && project.pending_cancellation_date && (
                        <div className="flex items-center gap-2 text-sm text-orange-600 font-medium dark:text-orange-400">
                          <AlertTriangle className="w-4 h-4 text-orange-500" />
                          <span>Pending Cancel: {format(new Date(project.pending_cancellation_date), 'MMM d, yyyy')} ({Math.floor((Date.now() - new Date(project.pending_cancellation_date).getTime()) / 86400000)} days)</span>
                        </div>
                      )}
                      {project.installation_date && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                          <span>Install: {format(new Date(project.installation_date + 'T00:00:00'), 'MMM d, yyyy')}</span>
                        </div>
                      )}
                      {sale?.location_address && (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                          <span className="line-clamp-1">{sale.location_address}</span>
                        </div>
                      )}
                      {sale?.invoice_number && (
                        <div className="text-sm text-muted-foreground">
                          <span>Invoice: </span>
                          <span className="font-medium text-foreground">#{sale.invoice_number}</span>
                        </div>
                      )}
                    </div>
                  </Link>

                  {/* Manual update box — outside the Link so the textarea is interactive */}
                  <div className="px-6 pb-5 pt-3 border-t border-border">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Manual Update to Cancellation List</p>
                      {project.cancellation_updates?.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">{project.cancellation_updates.length} update(s)</span>
                      )}
                    </div>
                    <Textarea
                      placeholder="Type a manual update to send to the cancellation alert list..."
                      value={updateTexts[project.id] || ''}
                      onChange={(e) => setUpdateTexts(prev => ({ ...prev, [project.id]: e.target.value }))}
                      rows={2}
                      className="resize-none text-sm"
                    />
                    <div className="flex justify-end mt-2">
                      <Button
                        size="sm"
                        className="bg-primary text-primary-foreground hover:opacity-90"
                        disabled={sendingUpdate === project.id || !(updateTexts[project.id] || '').trim()}
                        onClick={(e) => {
                          e.preventDefault();
                          handleSendUpdate(project);
                        }}
                      >
                        {sendingUpdate === project.id ? (
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4 mr-1.5" />
                        )}
                        Send Update
                      </Button>
                    </div>
                    {project.cancellation_updates?.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {project.cancellation_updates.slice().reverse().map((u, i) => (
                          <div key={i} className="bg-secondary border border-border rounded-lg p-2.5">
                            <p className="text-xs text-foreground whitespace-pre-wrap">{u.content}</p>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {u.user_name}{u.timestamp ? ` · ${format(new Date(u.timestamp), 'MMM d, yyyy h:mm a')}` : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
      {/* Cancel Confirmation Dialog */}
      <Dialog open={!!cancelDialog} onOpenChange={(open) => { if (!open) { setCancelDialog(null); setCancelReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Project — {cancelDialog?.customerName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will mark the project as <strong>Cancelled</strong>. This action cannot be automatically undone.
            </p>
            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Reason for Cancellation (optional)</Label>
              <Textarea
                id="cancel-reason"
                placeholder="Enter reason..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelDialog(null); setCancelReason(''); }} disabled={cancelling}>
              Keep Project
            </Button>
            <Button variant="destructive" onClick={handleCancelProject} disabled={cancelling}>
              {cancelling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ban className="w-4 h-4 mr-2" />}
              Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}