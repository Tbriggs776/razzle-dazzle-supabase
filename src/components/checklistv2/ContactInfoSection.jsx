import React, { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { User, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Local text field that only syncs to parent on blur
function LocalInput({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return (
    <Input
      {...props}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(local)}
    />
  );
}

function LocalPhoneInput({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return (
    <PhoneInput
      {...props}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(local)}
    />
  );
}

export default function ContactInfoSection({ formData, onChange }) {
  const isComplete = formData.customer_first_name &&
    formData.customer_last_name &&
    formData.customer_phone &&
    formData.customer_email &&
    formData.customer_street &&
    formData.city &&
    formData.state &&
    formData.postal_code &&
    formData.lives_at_address &&
    formData.home_built_era;

  const is1978OrBefore = formData.home_built_era === 'On or before 1978';

  return (
    <div className="border-2 border-blue-200 rounded-xl overflow-hidden">
      {/* Section Header */}
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-green-50 border-b border-green-200" : "bg-blue-50 border-b border-blue-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isComplete ? "bg-green-100" : "bg-blue-100"
          )}>
            {isComplete
              ? <CheckCircle2 className="w-5 h-5 text-green-600" />
              : <User className="w-5 h-5 text-blue-600" />
            }
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 3 — Customer Contact Info</p>
            <p className="text-xs text-slate-500">Name, phone, email & address</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 space-y-4 bg-white">
        {/* Name */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>First Name <span className="text-red-500">*</span></Label>
            <LocalInput
              value={formData.customer_first_name || ''}
              onBlur={(v) => onChange('customer_first_name', v)}
              placeholder="First name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Last Name <span className="text-red-500">*</span></Label>
            <LocalInput
              value={formData.customer_last_name || ''}
              onBlur={(v) => onChange('customer_last_name', v)}
              placeholder="Last name"
            />
          </div>
        </div>

        {/* Phones */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Phone <span className="text-red-500">*</span></Label>
            <LocalPhoneInput
              value={formData.customer_phone || ''}
              onBlur={(v) => onChange('customer_phone', v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Secondary Phone</Label>
            <LocalPhoneInput
              value={formData.secondary_phone || ''}
              onBlur={(v) => onChange('secondary_phone', v)}
            />
          </div>
        </div>

        {/* Email */}
        <div className="space-y-1.5">
          <Label>Email <span className="text-red-500">*</span></Label>
          <LocalInput
            type="email"
            value={formData.customer_email || ''}
            onBlur={(v) => onChange('customer_email', v)}
            placeholder="email@example.com"
          />
        </div>

        {/* Address */}
        <div className="space-y-1.5">
          <Label>Street Address <span className="text-red-500">*</span></Label>
          <LocalInput
            value={formData.customer_street || ''}
            onBlur={(v) => onChange('customer_street', v)}
            placeholder="123 Main St"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>City <span className="text-red-500">*</span></Label>
            <Input
              value={formData.city || ''}
              onChange={(e) => onChange('city', e.target.value)}
              placeholder="City"
            />
          </div>
          <div className="space-y-1.5">
            <Label>State <span className="text-red-500">*</span></Label>
            <Input
              value={formData.state || ''}
              onChange={(e) => onChange('state', e.target.value)}
              placeholder="AZ"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Postal Code <span className="text-red-500">*</span></Label>
            <Input
              value={formData.postal_code || ''}
              onChange={(e) => onChange('postal_code', e.target.value)}
              placeholder="85001"
            />
          </div>
        </div>

        {/* Additional address details */}
        <div className="space-y-1.5">
          <Label>Additional Address Details</Label>
          <LocalInput
            value={formData.additional_address_details || ''}
            onBlur={(v) => onChange('additional_address_details', v)}
            placeholder="Apt, suite, gate code, etc."
          />
        </div>

        {/* Divider */}
        <div className="border-t border-slate-100 pt-4 space-y-4">

          {/* Address confirmation */}
          <div className="space-y-1.5">
            <Label className="font-semibold text-slate-700">
              "And just to confirm — is this the address where the flooring is going in?" <span className="text-red-500">*</span>
            </Label>
            <Select value={formData.lives_at_address} onValueChange={(val) => onChange('lives_at_address', val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Yes">Yes</SelectItem>
                <SelectItem value="No">No — different address</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Home built era */}
          <div className="space-y-1.5">
            <Label className="font-semibold text-slate-700">
              "What year was the home built?" <span className="text-red-500">*</span>
            </Label>
            <Select value={formData.home_built_era} onValueChange={(val) => onChange('home_built_era', val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select era..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="On or before 1978">On or before 1978</SelectItem>
                <SelectItem value="After 1978">After 1978</SelectItem>
              </SelectContent>
            </Select>
            {is1978OrBefore && (
              <div className="flex items-center gap-3 p-4 bg-red-50 border-2 border-red-500 rounded-lg mt-2">
                <span className="text-3xl">🛑</span>
                <div>
                  <p className="text-red-700 font-bold text-lg">STOP — On or Before 1978</p>
                  <p className="text-red-600 text-sm font-medium">Asbestos risk — notify the DC and follow proper protocol before scheduling.</p>
                </div>
              </div>
            )}
          </div>

          {/* Owner occupied */}
          <div className="space-y-1.5">
            <Label className="font-semibold text-slate-700">
              "And is this a home you own, or a rental?" <span className="text-red-500">*</span>
            </Label>
            <Select value={formData.owner_occupied_status} onValueChange={(val) => onChange('owner_occupied_status', val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Owner Occupied">Owner Occupied</SelectItem>
                <SelectItem value="Renting">Renting</SelectItem>
              </SelectContent>
            </Select>
          </div>

        </div>
      </div>
    </div>
  );
}