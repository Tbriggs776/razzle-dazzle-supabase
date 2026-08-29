import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  FileText,
  Calendar,
  Pencil,
  Trash2,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import CustomerForm from '@/components/customers/CustomerForm';
import PageHeader from '@/components/common/PageHeader';
import StatusPill from '@/components/common/StatusPill';
import ModuleCard from '@/components/dashboard/ModuleCard';

export default function CustomerDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const customerId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: async () => {
      const customers = await base44.entities.Customer.filter({ id: customerId });
      return customers[0];
    },
    enabled: !!customerId
  });

  const { data: checklist } = useQuery({
    queryKey: ['customerChecklist', customer?.converted_from_lead],
    queryFn: async () => {
      const leadId = customer.converted_from_lead;
      const appointments = await base44.entities.Appointment.filter({ customer: leadId });
      if (!appointments.length) return null;
      const checklists = await base44.entities.AppointmentSettingChecklist.filter({ appointment: appointments[0].id });
      return checklists[0] || null;
    },
    enabled: !!customer?.converted_from_lead
  });

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      await base44.entities.Customer.update(customerId, data);

      // Propagate contact info changes to AppointmentSettingChecklists
      if (customer.converted_from_lead) {
        const appointments = await base44.entities.Appointment.filter({ customer: customer.converted_from_lead });
        if (appointments.length > 0) {
          const checklistArrays = await Promise.all(
            appointments.map(a => base44.entities.AppointmentSettingChecklist.filter({ appointment: a.id }))
          );
          const checklists = checklistArrays.flat();
          if (checklists.length > 0) {
            const patch = {
              ...(data.first_name !== undefined && { customer_first_name: data.first_name }),
              ...(data.last_name !== undefined && { customer_last_name: data.last_name }),
              ...(data.phone !== undefined && { customer_phone: data.phone }),
              ...(data.email !== undefined && { customer_email: data.email }),
              ...(data.address_line1 !== undefined && { customer_street: data.address_line1 }),
              ...(data.city !== undefined && { city: data.city }),
              ...(data.state !== undefined && { state: data.state }),
              ...(data.zip !== undefined && { postal_code: data.zip }),
            };
            await Promise.all(checklists.map(c => base44.entities.AppointmentSettingChecklist.update(c.id, patch)));
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowEditDialog(false);
      toast.success('Customer updated and synced across all records');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.Customer.delete(customerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      navigate(createPageUrl('Customers'));
    }
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <h2 className="mb-2 text-xl font-semibold text-foreground">Customer not found</h2>
          <Link to={createPageUrl('Customers')} className="text-primary hover:underline">
            Back to customers
          </Link>
        </div>
      </div>
    );
  }

  const initials = `${customer.first_name?.[0] || ''}${customer.last_name?.[0] || ''}`.toUpperCase();
  const fullAddress = [
    customer.address_line1,
    customer.address_line2,
    customer.city,
    customer.state,
    customer.zip
  ].filter(Boolean).join(', ');

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          eyebrow={
            <Link
              to={createPageUrl('Customers')}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Customers
            </Link>
          }
          title={`${customer.first_name} ${customer.last_name}`}
          actions={
            <>
              <Button variant="accent" onClick={() => setShowEditDialog(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(true)}
                className="border-crit/30 text-crit hover:bg-crit/10"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </>
          }
        >
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill tone="good" dot>Customer</StatusPill>
            {customer.converted_from_lead && <StatusPill tone="info">Converted Lead</StatusPill>}
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Contact Information */}
          <ModuleCard title="Contact Information" icon={User}>
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-pink/15 font-display text-sm font-extrabold text-brand-pink">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {customer.first_name} {customer.last_name}
                </div>
                <div className="text-xs text-muted-foreground">Customer record</div>
              </div>
            </div>

            <a
              href={`mailto:${customer.email}`}
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue/15">
                <Mail className="h-4 w-4 text-brand-blue" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Email</div>
                <div className="truncate text-sm text-foreground transition-colors group-hover:text-brand-blue">
                  {customer.email}
                </div>
              </div>
            </a>

            {customer.phone && (
              <a
                href={`tel:${customer.phone}`}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-pink/15">
                  <Phone className="h-4 w-4 text-brand-pink" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Phone</div>
                  <div className="truncate text-sm text-foreground transition-colors group-hover:text-brand-pink">
                    {customer.phone}
                  </div>
                </div>
              </a>
            )}
          </ModuleCard>

          {/* Address */}
          <ModuleCard title="Address" icon={MapPin}>
            {fullAddress ? (
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-gold/15">
                  <MapPin className="h-4 w-4 text-brand-gold" />
                </div>
                <p className="text-sm text-foreground">{fullAddress}</p>
              </div>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">No address provided</div>
            )}
          </ModuleCard>

          {/* Lead Source */}
          {checklist?.heard_about_us && (
            <ModuleCard title="Lead Source" icon={MapPin}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-gold/15">
                  <MapPin className="h-4 w-4 text-brand-gold" />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Heard About Us</div>
                  <div className="text-sm font-medium text-foreground">
                    {checklist.heard_about_us}{checklist.heard_about_us === 'Other' && checklist.heard_about_us_other ? ` — ${checklist.heard_about_us_other}` : ''}
                  </div>
                </div>
              </div>
            </ModuleCard>
          )}

          {/* Notes */}
          {customer.notes && (
            <div className="md:col-span-2">
              <ModuleCard title="Notes" icon={FileText}>
                <p className="whitespace-pre-wrap px-4 py-3 text-sm text-foreground">{customer.notes}</p>
              </ModuleCard>
            </div>
          )}

          {/* Record Information */}
          <div className="md:col-span-2">
            <ModuleCard title="Record Information" icon={Calendar}>
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
                  <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Created</div>
                    <div className="text-sm text-foreground">
                      {format(new Date(customer.created_date), 'MMM d, yyyy h:mm a')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
                  <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Last Updated</div>
                    <div className="text-sm text-foreground">
                      {format(new Date(customer.updated_date), 'MMM d, yyyy h:mm a')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Created By</div>
                    <div className="truncate text-sm text-foreground">{customer.created_by}</div>
                  </div>
                </div>
              </div>
            </ModuleCard>
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-bold text-foreground">Edit Customer</DialogTitle>
          </DialogHeader>
          <CustomerForm
            customer={customer}
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
            <DialogTitle className="font-display text-xl font-bold text-foreground">Delete Customer</DialogTitle>
            <DialogDescription className="mt-2 text-muted-foreground">
              Are you sure you want to delete {customer.first_name} {customer.last_name}?
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Customer'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
