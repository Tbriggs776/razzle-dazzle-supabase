import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { Loader2 } from "lucide-react";

export default function LeadForm({ lead, onSubmit, onCancel, isLoading }) {
  const [formData, setFormData] = React.useState({
    first_name: lead?.first_name || '',
    last_name: lead?.last_name || '',
    email: lead?.email || '',
    phone: lead?.phone || '',
    address_line1: lead?.address_line1 || '',
    address_line2: lead?.address_line2 || '',
    city: lead?.city || '',
    state: lead?.state || '',
    zip: lead?.zip || '',
    notes: lead?.notes || ''
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handlePlaceSelected = (addressData) => {
    setFormData(prev => ({
      ...prev,
      address_line1: addressData.address_line1,
      city: addressData.city,
      state: addressData.state,
      zip: addressData.zip
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Personal Information */}
      <div className="space-y-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Personal Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="first_name">First Name *</Label>
            <Input
              id="first_name"
              value={formData.first_name}
              onChange={(e) => handleChange('first_name', e.target.value)}
              required
              className="h-12"
              placeholder="John"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name">Last Name *</Label>
            <Input
              id="last_name"
              value={formData.last_name}
              onChange={(e) => handleChange('last_name', e.target.value)}
              required
              className="h-12"
              placeholder="Doe"
            />
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div className="space-y-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              required
              className="h-12"
              placeholder="john@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone *</Label>
            <PhoneInput
              id="phone"
              value={formData.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              required
              className="h-12"
            />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="space-y-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address</h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="address_line1">Address Line 1</Label>
            <AddressAutocomplete
              id="address_line1"
              value={formData.address_line1}
              onChange={(value) => handleChange('address_line1', value)}
              onPlaceSelected={handlePlaceSelected}
              className="h-12"
              placeholder="Start typing an address..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address_line2">Address Line 2</Label>
            <Input
              id="address_line2"
              value={formData.address_line2}
              onChange={(e) => handleChange('address_line2', e.target.value)}
              className="h-12"
              placeholder="Apt 4B"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                className="h-12"
                placeholder="New York"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => handleChange('state', e.target.value)}
                className="h-12"
                placeholder="NY"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip">ZIP Code</Label>
              <Input
                id="zip"
                value={formData.zip}
                onChange={(e) => handleChange('zip', e.target.value)}
                className="h-12"
                placeholder="10001"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional Notes</h3>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          className="min-h-32 resize-none"
          placeholder="Any additional information about this lead..."
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-4 pt-6 border-t border-border">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="px-6 h-11"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="accent"
          disabled={isLoading}
          className="px-8 h-11"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Lead'
          )}
        </Button>
      </div>
    </form>
  );
}
