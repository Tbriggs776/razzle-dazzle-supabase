import React, { useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import LeadPicker from '@/components/leads/LeadPicker';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

const STATUSES = ["Lead", "Scheduled", "Rescheduled", "Cancelled", "Completed"];
const TIME_BLOCKS = ["9am to 11am", "12pm to 2pm", "3pm to 5pm", "6pm to 8pm"];

const CANCEL_REASONS = [
  'Customer rescheduled',
  'Customer changed mind / no longer interested',
  'Customer went with competitor',
  'Customer moved / out of area',
  'Customer unreachable / no response',
  'Scheduling conflict',
  'Duplicate appointment',
  'Financial / budget concerns',
  'Other'
];

const getTimesFromBlock = (block) => {
  const timeMap = {
    "9am to 11am": { start: "09:00", end: "11:00" },
    "12pm to 2pm": { start: "12:00", end: "14:00" },
    "3pm to 5pm": { start: "15:00", end: "17:00" },
    "6pm to 8pm": { start: "18:00", end: "20:00" }
  };
  return timeMap[block] || { start: "", end: "" };
};

export default function AppointmentForm({ appointment, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = React.useState({
    customer: appointment?.customer || '',
    status: appointment?.status || 'Scheduled',
    appointment_date: appointment?.appointment_date || '',
    appointment_block: appointment?.appointment_block || '',
    assigned_csr: appointment?.assigned_csr || '',
    assigned_dc: appointment?.assigned_dc || '',
    location_address: appointment?.location_address || '',
    internal_notes: appointment?.internal_notes || '',
    cancelled_reason_select: appointment && appointment.status === 'Cancelled' && appointment.cancelled_reason
      ? (CANCEL_REASONS.includes(appointment.cancelled_reason) ? appointment.cancelled_reason : 'Other')
      : '',
    cancelled_reason_other: appointment && appointment.cancelled_reason && !CANCEL_REASONS.includes(appointment.cancelled_reason)
      ? appointment.cancelled_reason
      : ''
  });
  const [reasonError, setReasonError] = React.useState('');


  const { data: teamMembers = [] } = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => base44.entities.TeamMember.list('first_name')
  });

  const csrMembers = teamMembers.filter(m => m.role === 'Customer Service Rep' || m.role === 'Admin');
  const dcMembers = teamMembers.filter(m => m.role === 'Design Consultant' || m.role === 'Sales Manager');

  // Auto-populate address when customer is selected.
  //
  // Was a leads.find() over every lead in the business, which is no longer
  // downloaded — so this fetches the one record instead. `cancelled` guards the
  // case where the user picks a second lead before the first lookup returns:
  // without it the slower response could overwrite the newer address.
  useEffect(() => {
    if (!formData.customer || appointment) return;
    let cancelled = false;

    (async () => {
      const rows = await base44.entities.Lead
        .filter({ id: formData.customer }, '-created_date', 1)
        .catch(() => []);
      const selectedLead = rows[0];
      if (cancelled || !selectedLead) return;

      const address = [
        selectedLead.address_line1,
        selectedLead.address_line2,
        selectedLead.city,
        selectedLead.state,
        selectedLead.zip
      ].filter(Boolean).join(', ');
      if (address) {
        setFormData(prev => ({ ...prev, location_address: address }));
      }
    })();

    return () => { cancelled = true; };
  }, [formData.customer, appointment]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.status === 'Cancelled') {
      if (!formData.cancelled_reason_select) {
        setReasonError('Please select a cancellation reason');
        return;
      }
      if (formData.cancelled_reason_select === 'Other' && !formData.cancelled_reason_other.trim()) {
        setReasonError('Please specify the cancellation reason');
        return;
      }
    }
    setReasonError('');
    
    // If creating new appointment (no appointment object), auto-assign current user as CSR
    let csrToAssign = formData.assigned_csr;
    if (!appointment && !csrToAssign) {
      try {
        const currentUser = await base44.auth.me();
        // Find team member by email to get their ID
        const csrMember = teamMembers.find(m => m.email === currentUser.email && (m.role === 'Customer Service Rep' || m.role === 'Admin'));
        if (csrMember) {
          csrToAssign = csrMember.id;
        }
      } catch (error) {
        console.error('Failed to auto-assign CSR:', error);
      }
    }

    // Compute start and end times from block
    const times = getTimesFromBlock(formData.appointment_block);
    const cancelled_reason = formData.status === 'Cancelled'
      ? (formData.cancelled_reason_select === 'Other' ? formData.cancelled_reason_other.trim() : formData.cancelled_reason_select)
      : '';
    const { cancelled_reason_select, cancelled_reason_other, ...restFormData } = formData;
    const dataToSubmit = {
      ...restFormData,
      assigned_csr: csrToAssign || formData.assigned_csr,
      appointment_start_time: times.start,
      appointment_end_time: times.end,
      cancelled_reason,
      ...(!appointment && { appointment_created_date: new Date().toISOString() })
    };
    
    onSubmit(dataToSubmit);
  };

  const requiresDate = ['Scheduled', 'Rescheduled'].includes(formData.status);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Lead Information */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Lead Information</h3>
        <div className="space-y-2">
          <Label htmlFor="customer" className="text-foreground">Lead *</Label>
          <LeadPicker
            value={formData.customer}
            onChange={(id) => handleChange('customer', id)}
          />
        </div>
      </div>

      {/* Appointment Details */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Appointment Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="status" className="text-foreground">Status *</Label>
            <Select value={formData.status} onValueChange={(value) => handleChange('status', value)} required>
              <SelectTrigger className="h-12 border-border">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="appointment_date" className="text-foreground">
              Appointment Date {requiresDate && '*'}
            </Label>
            <Input
              id="appointment_date"
              type="date"
              value={formData.appointment_date}
              onChange={(e) => handleChange('appointment_date', e.target.value)}
              required={requiresDate}
              className="h-12 border-border focus:border-info focus:ring-info transition-all"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="appointment_block" className="text-foreground">Time Block</Label>
          <Select value={formData.appointment_block} onValueChange={(value) => handleChange('appointment_block', value)}>
            <SelectTrigger className="h-12 border-border">
              <SelectValue placeholder="Select time block" />
            </SelectTrigger>
            <SelectContent>
              {TIME_BLOCKS.map((block) => (
                <SelectItem key={block} value={block}>
                  {block}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

        </div>

        {formData.status === 'Cancelled' && (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="cancelled_reason_select" className="text-foreground">Cancellation Reason *</Label>
              <Select value={formData.cancelled_reason_select} onValueChange={(value) => { handleChange('cancelled_reason_select', value); setReasonError(''); }}>
                <SelectTrigger className="h-12 border-border">
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  {CANCEL_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formData.cancelled_reason_select === 'Other' && (
              <div className="space-y-2">
                <Label htmlFor="cancelled_reason_other" className="text-foreground">Please specify</Label>
                <Textarea
                  id="cancelled_reason_other"
                  value={formData.cancelled_reason_other}
                  onChange={(e) => { handleChange('cancelled_reason_other', e.target.value); setReasonError(''); }}
                  placeholder="Enter the reason for cancelling this appointment..."
                  className="min-h-24 border-border focus:border-crit focus:ring-crit"
                />
              </div>
            )}
            {reasonError && (
              <p className="text-sm text-crit">{reasonError}</p>
            )}
          </div>
        )}
      </div>

      {/* Team Assignment */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Team Assignment</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="assigned_csr" className="text-foreground">Customer Service Rep</Label>
            <Select value={formData.assigned_csr} onValueChange={(value) => handleChange('assigned_csr', value)}>
              <SelectTrigger className="h-12 border-border">
                <SelectValue placeholder="Select CSR" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>None</SelectItem>
                {csrMembers.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.first_name} {member.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="assigned_dc" className="text-foreground">Design Consultant</Label>
            <Select value={formData.assigned_dc} onValueChange={(value) => handleChange('assigned_dc', value)}>
              <SelectTrigger className="h-12 border-border">
                <SelectValue placeholder="Select DC" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>None</SelectItem>
                {dcMembers.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.first_name} {member.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Location</h3>
        <div className="space-y-2">
          <Label htmlFor="location_address" className="text-foreground">Address</Label>
          <AddressAutocomplete
            id="location_address"
            value={formData.location_address}
            onChange={(value) => handleChange('location_address', value)}
            onPlaceSelected={(addressData) => handleChange('location_address', addressData.formatted_address)}
            className="h-12 border-border focus:border-info focus:ring-info transition-all"
            placeholder="Start typing an address..."
          />
        </div>
      </div>

      {/* Internal Notes */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Internal Notes</h3>
        <Textarea
          id="internal_notes"
          value={formData.internal_notes}
          onChange={(e) => handleChange('internal_notes', e.target.value)}
          className="min-h-32 border-border focus:border-info focus:ring-info transition-all resize-none"
          placeholder="Add internal notes about this appointment..."
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-4 pt-6 border-t border-border">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="px-6 h-11 text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isLoading}
          className="px-8 h-11 bg-info hover:bg-info text-white transition-all"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Appointment'
          )}
        </Button>
      </div>
    </form>
  );
}