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
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { toast } from 'sonner';
import CustomerForm from '@/components/customers/CustomerForm';

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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Customer not found</h2>
          <Link to={createPageUrl('Customers')} className="text-indigo-600 hover:underline">
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
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Link
            to={createPageUrl('Customers')}
            className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Customers
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row md:items-start gap-6"
          >
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-2xl shadow-xl shadow-indigo-200">
              {initials}
            </div>

            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
                {customer.first_name} {customer.last_name}
              </h1>
              <p className="text-slate-500 mt-1">Customer</p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => setShowEditDialog(true)}
                className="h-11 px-5 border-slate-200 hover:bg-slate-50"
              >
                <Pencil className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(true)}
                className="h-11 px-5 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contact Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Contact Information
            </h2>
            <div className="space-y-4">
              <a
                href={`mailto:${customer.email}`}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Email</p>
                  <p className="text-slate-800 group-hover:text-green-600 transition-colors">
                    {customer.email}
                  </p>
                </div>
              </a>
              {customer.phone && (
                <a
                  href={`tel:${customer.phone}`}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Phone className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">Phone</p>
                    <p className="text-slate-800 group-hover:text-blue-600 transition-colors">
                      {customer.phone}
                    </p>
                  </div>
                </a>
              )}
            </div>
          </motion.div>

          {/* Address */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl border border-slate-100 p-6"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Address
            </h2>
            {fullAddress ? (
              <div className="flex items-start gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-slate-800">{fullAddress}</p>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-center py-6">No address provided</p>
            )}
          </motion.div>

          {/* Lead Source */}
          {checklist?.heard_about_us && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-white rounded-2xl border border-slate-100 p-6"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Lead Source
              </h2>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-amber-50">
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-amber-600 mb-0.5">Heard About Us</p>
                  <p className="text-slate-800 font-medium">
                    {checklist.heard_about_us}{checklist.heard_about_us === 'Other' && checklist.heard_about_us_other ? ` — ${checklist.heard_about_us_other}` : ''}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Notes */}
          {customer.notes && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
            >
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
                Notes
              </h2>
              <div className="flex items-start gap-4 p-3">
                <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-purple-600" />
                </div>
                <p className="text-slate-700 whitespace-pre-wrap">{customer.notes}</p>
              </div>
            </motion.div>
          )}

          {/* Metadata */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-2xl border border-slate-100 p-6 md:col-span-2"
          >
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">
              Record Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                <Calendar className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Created</p>
                  <p className="text-sm text-slate-700">
                    {format(new Date(customer.created_date + (customer.created_date.includes('Z') ? '' : 'Z')), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                <Calendar className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Last Updated</p>
                  <p className="text-sm text-slate-700">
                    {format(new Date(customer.updated_date + (customer.updated_date.includes('Z') ? '' : 'Z')), 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50">
                <Mail className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Created By</p>
                  <p className="text-sm text-slate-700 truncate">{customer.created_by}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-800">Edit Customer</DialogTitle>
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
            <DialogTitle className="text-xl font-bold text-slate-800">Delete Customer</DialogTitle>
            <DialogDescription className="text-slate-500 mt-2">
              Are you sure you want to delete {customer.first_name} {customer.last_name}? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              className="border-slate-200"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
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