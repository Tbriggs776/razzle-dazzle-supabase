import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  Mail, 
  Phone, 
  MapPin, 
  Pencil, 
  Trash2, 
  Loader2,
  Calendar,
  FileText,
  ClipboardCheck,
  Plus
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import LeadForm from '@/components/leads/LeadForm';

export default function LeadDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const leadId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showChecklistDialog, setShowChecklistDialog] = useState(false);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: async () => {
      const leads = await base44.entities.Lead.filter({ id: leadId });
      return leads[0];
    },
    enabled: !!leadId
  });

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.Lead.update(leadId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setShowEditDialog(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.Lead.delete(leadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      navigate(createPageUrl('Leads'));
    }
  });

  const createChecklistMutation = useMutation({
    mutationFn: async () => {
      // Create appointment first
      const appointment = await base44.entities.Appointment.create({
        customer: leadId,
        status: 'Lead'
      });

      // Create checklist
      const checklist = await base44.entities.AppointmentSettingChecklist.create({
        appointment: appointment.id,
        customer_first_name: lead.first_name,
        customer_last_name: lead.last_name,
        customer_phone: lead.phone,
        customer_email: lead.email,
        customer_street: lead.address_line1 || '',
        city: lead.city || '',
        state: lead.state || '',
        postal_code: lead.zip || ''
      });

      return checklist;
    },
    onSuccess: (checklist) => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] });
      navigate(createPageUrl('ChecklistDetail') + `?id=${checklist.id}`);
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Lead not found</h2>
          <Link to={createPageUrl('Leads')} className="text-primary hover:underline">
            Back to leads
          </Link>
        </div>
      </div>
    );
  }

  const initials = `${lead.first_name?.[0] || ''}${lead.last_name?.[0] || ''}`.toUpperCase();
  const fullName = `${lead.first_name} ${lead.last_name}`;
  const hasAddress = lead.address_line1 || lead.city || lead.state || lead.zip;

  const formatAddress = () => {
    const parts = [];
    if (lead.address_line1) parts.push(lead.address_line1);
    if (lead.address_line2) parts.push(lead.address_line2);
    const cityStateZip = [lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
    if (cityStateZip) parts.push(cityStateZip);
    return parts;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link
            to={createPageUrl('Leads')}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Leads
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row md:items-center gap-6"
          >
            {/* Avatar */}
            <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl shadow-lg">
              {initials}
            </div>

            {/* Name & Actions */}
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-foreground tracking-tight">{fullName}</h1>
              <p className="text-muted-foreground mt-1">
                Lead since {format(new Date(lead.created_date), 'MMMM d, yyyy')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => setShowChecklistDialog(true)}
                className="h-11 px-5 bg-primary text-primary-foreground hover:opacity-90"
              >
                <ClipboardCheck className="w-4 h-4 mr-2" />
                New Checklist
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowEditDialog(true)}
                className="h-11 px-5 border-border hover:bg-secondary"
              >
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(true)}
                className="h-11 px-5 border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contact Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Contact Information
            </h2>
            <div className="space-y-4">
              <a
                href={`mailto:${lead.email}`}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-blue/12 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-brand-blue" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                  <p className="text-foreground group-hover:text-brand-blue transition-colors">
                    {lead.email}
                  </p>
                </div>
              </a>

              <a
                href={`tel:${lead.phone}`}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-pink/12 flex items-center justify-center">
                  <Phone className="w-5 h-5 text-brand-pink" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                  <p className="text-foreground group-hover:text-brand-pink transition-colors">
                    {lead.phone}
                  </p>
                </div>
              </a>
            </div>
          </motion.div>

          {/* Address */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card rounded-2xl border border-border p-6"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Address
            </h2>
            {hasAddress ? (
              <div className="flex items-start gap-4 p-3">
                <div className="w-10 h-10 rounded-lg bg-brand-gold/15 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-brand-gold" />
                </div>
                <div className="space-y-1">
                  {formatAddress().map((line, index) => (
                    <p key={index} className="text-foreground">{line}</p>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-6">No address on file</p>
            )}
          </motion.div>

          {/* Notes */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-card rounded-2xl border border-border p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Notes
            </h2>
            {lead.notes ? (
              <div className="flex items-start gap-4 p-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <p className="text-foreground whitespace-pre-wrap">{lead.notes}</p>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-6">No notes added</p>
            )}
          </motion.div>

          {/* Metadata */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-card rounded-2xl border border-border p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
              Record Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-4 p-3 rounded-xl bg-secondary">
                <Calendar className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Created</p>
                  <p className="text-sm text-foreground">
                    {new Date(lead.created_date).toLocaleString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric', 
                      hour: 'numeric', 
                      minute: '2-digit', 
                      hour12: true 
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-secondary">
                <Calendar className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Last Updated</p>
                  <p className="text-sm text-foreground">
                    {new Date(lead.updated_date).toLocaleString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric', 
                      hour: 'numeric', 
                      minute: '2-digit', 
                      hour12: true 
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-secondary">
                <Mail className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Created By</p>
                  <p className="text-sm text-foreground truncate">{lead.created_by}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent 
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          onInteractOutside={(e) => {
            // Prevent closing when clicking on Google Places autocomplete dropdown
            const target = e.target;
            if (target.closest('.pac-container')) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-foreground">Edit Lead</DialogTitle>
          </DialogHeader>
          <LeadForm
            lead={lead}
            onSubmit={(data) => updateMutation.mutate(data)}
            onCancel={() => setShowEditDialog(false)}
            isLoading={updateMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-foreground">Delete Lead</DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2">
              Are you sure you want to delete <span className="font-semibold">{fullName}</span>? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              className="border-border"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:opacity-90"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Lead'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Checklist Dialog */}
      <Dialog open={showChecklistDialog} onOpenChange={setShowChecklistDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-foreground">Create Checklist</DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2">
              This will create a new appointment setting checklist for <span className="font-semibold">{fullName}</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setShowChecklistDialog(false)}
              className="border-border"
            >
              Cancel
            </Button>
            <Button
              onClick={() => createChecklistMutation.mutate()}
              disabled={createChecklistMutation.isPending}
              className="bg-primary text-primary-foreground hover:opacity-90"
            >
              {createChecklistMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Checklist
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}