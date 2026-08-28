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
import { format } from 'date-fns';
import PageHeader from '@/components/common/PageHeader';
import ModuleCard from '@/components/dashboard/ModuleCard';
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h2 className="mb-2 text-xl font-semibold text-foreground">Lead not found</h2>
          <Link to={createPageUrl('Leads')} className="text-primary hover:underline">
            Back to leads
          </Link>
        </div>
      </div>
    );
  }

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

  const dateFmt = (value) =>
    new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          eyebrow={
            <Link
              to={createPageUrl('Leads')}
              className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Leads
            </Link>
          }
          title={fullName}
          subtitle={`Lead since ${format(new Date(lead.created_date), 'MMMM d, yyyy')}`}
          actions={
            <>
              <Button variant="accent" onClick={() => setShowChecklistDialog(true)}>
                <ClipboardCheck className="mr-2 h-4 w-4" />
                New Checklist
              </Button>
              <Button variant="outline" onClick={() => setShowEditDialog(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(true)}
                className="text-crit hover:text-crit"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Contact Information */}
          <ModuleCard title="Contact Information" icon={Mail}>
            <a
              href={`mailto:${lead.email}`}
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/12">
                <Mail className="h-4 w-4 text-brand-blue" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Email</div>
                <div className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-brand-blue">
                  {lead.email}
                </div>
              </div>
            </a>
            <a
              href={`tel:${lead.phone}`}
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-pink/12">
                <Phone className="h-4 w-4 text-brand-pink" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Phone</div>
                <div className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-brand-pink">
                  {lead.phone}
                </div>
              </div>
            </a>
          </ModuleCard>

          {/* Address */}
          <ModuleCard title="Address" icon={MapPin}>
            {hasAddress ? (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-gold/15">
                  <MapPin className="h-4 w-4 text-brand-gold" />
                </div>
                <div className="space-y-0.5 pt-0.5 text-sm text-foreground">
                  {formatAddress().map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No address on file</div>
            )}
          </ModuleCard>
        </div>

        {/* Notes */}
        <ModuleCard title="Notes" icon={FileText}>
          {lead.notes ? (
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <p className="whitespace-pre-wrap pt-0.5 text-sm text-foreground">{lead.notes}</p>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No notes added</div>
          )}
        </ModuleCard>

        {/* Record Information */}
        <ModuleCard title="Record Information" icon={Calendar}>
          <div className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2 md:grid-cols-3">
            <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5">
              <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-[11px] text-muted-foreground">Created</div>
                <div className="text-sm text-foreground">{dateFmt(lead.created_date)}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5">
              <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-[11px] text-muted-foreground">Last Updated</div>
                <div className="text-sm text-foreground">{dateFmt(lead.updated_date)}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-[11px] text-muted-foreground">Created By</div>
                <div className="truncate text-sm text-foreground">{lead.created_by}</div>
              </div>
            </div>
          </div>
        </ModuleCard>
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
