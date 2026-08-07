import React, { useState, useEffect } from 'react';
import { CalendarDays, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BLOCKS = ['9am–11am', '12pm–2pm', '3pm–5pm', '6pm–8pm'];

function LocalInput({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return <Input {...props} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => onBlur(local)} />;
}

function LocalTextarea({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return <Textarea {...props} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => onBlur(local)} />;
}

export default function AppointmentSchedulingSection({ formData, onChange }) {
  const isComplete = !!(formData.preferred_appointment_date && formData.preferred_appointment_block && formData.two_hour_window_confirmation);

  return (
    <div className="border-2 border-indigo-200 rounded-xl overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-green-50 border-b border-green-200" : "bg-indigo-50 border-b border-indigo-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isComplete ? "bg-green-100" : "bg-indigo-100")}>
            {isComplete ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <CalendarDays className="w-5 h-5 text-indigo-600" />}
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 13 — Appointment Date & Time</p>
            <p className="text-xs text-slate-500">Preferred date, time block, and scheduling notes</p>
          </div>
        </div>
        {isComplete && <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>}
      </div>

      <div className="p-5 bg-white space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Preferred Appointment Date</p>
          <Input
            type="date"
            value={formData.preferred_appointment_date || ''}
            onChange={(e) => onChange('preferred_appointment_date', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Appointment Day</p>
          <Select value={formData.appointment_day || ''} onValueChange={(val) => onChange('appointment_day', val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select day" />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map(day => <SelectItem key={day} value={day}>{day}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Preferred Appointment Block</p>
          <Select value={formData.preferred_appointment_block || ''} onValueChange={(val) => onChange('preferred_appointment_block', val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select time block" />
            </SelectTrigger>
            <SelectContent>
              {BLOCKS.map(block => <SelectItem key={block} value={block}>{block}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Two Hour Window Confirmation</p>
          <Select value={formData.two_hour_window_confirmation || ''} onValueChange={(val) => onChange('two_hour_window_confirmation', val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Yes">Yes</SelectItem>
              <SelectItem value="No">No</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Availability Notes</p>
          <LocalTextarea
            value={formData.availability_notes || ''}
            onBlur={(v) => onChange('availability_notes', v)}
            placeholder="Customer availability details..."
            className="min-h-16"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Customer Scheduling Requests</p>
          <LocalInput
            value={formData.customer_scheduling_requests || ''}
            onBlur={(v) => onChange('customer_scheduling_requests', v)}
            placeholder="e.g., Needs DC to show up right at 12, no earlier than 3:30 PM, etc."
          />
        </div>
      </div>
    </div>
  );
}