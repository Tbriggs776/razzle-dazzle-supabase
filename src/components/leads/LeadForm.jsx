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
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Personal Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="first_name" className="text-slate-700">First Name *</Label>
            <Input
              id="first_name"
              value={formData.first_name}
              onChange={(e) => handleChange('first_name', e.target.value)}
              required
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              placeholder="John"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last_name" className="text-slate-700">Last Name *</Label>
            <Input
              id="last_name"
              value={formData.last_name}
              onChange={(e) => handleChange('last_name', e.target.value)}
              required
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              placeholder="Doe"
            />
          </div>
        </div>
      </div>

      {/* Contact Information */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Contact Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-700">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              required
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              placeholder="john@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-slate-700">Phone *</Label>
            <PhoneInput
              id="phone"
              value={formData.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              required
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Address</h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="address_line1" className="text-slate-700">Address Line 1</Label>
            <AddressAutocomplete
              id="address_line1"
              value={formData.address_line1}
              onChange={(value) => handleChange('address_line1', value)}
              onPlaceSelected={handlePlaceSelected}
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              placeholder="Start typing an address..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address_line2" className="text-slate-700">Address Line 2</Label>
            <Input
              id="address_line2"
              value={formData.address_line2}
              onChange={(e) => handleChange('address_line2', e.target.value)}
              className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
              placeholder="Apt 4B"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="city" className="text-slate-700">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
                placeholder="New York"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state" className="text-slate-700">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => handleChange('state', e.target.value)}
                className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
                placeholder="NY"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip" className="text-slate-700">ZIP Code</Label>
              <Input
                id="zip"
                value={formData.zip}
                onChange={(e) => handleChange('zip', e.target.value)}
                className="h-12 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all"
                placeholder="10001"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Additional Notes</h3>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          className="min-h-32 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 transition-all resize-none"
          placeholder="Any additional information about this lead..."
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-4 pt-6 border-t border-slate-100">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="px-6 h-11 text-slate-600 hover:text-slate-800 hover:bg-slate-100"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isLoading}
          className="px-8 h-11 bg-indigo-600 hover:bg-indigo-700 text-white transition-all"
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