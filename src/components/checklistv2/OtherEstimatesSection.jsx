import React, { useState, useEffect } from 'react';
import { BarChart3, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function LocalInput({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return <Input {...props} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => onBlur(local)} />;
}

export default function OtherEstimatesSection({ formData, onChange }) {
  const isComplete = !!formData.collected_other_estimates;

  return (
    <div className="border-2 border-indigo-200 rounded-xl overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-green-50 border-b border-green-200" : "bg-indigo-50 border-b border-indigo-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isComplete ? "bg-green-100" : "bg-indigo-100")}>
            {isComplete ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <BarChart3 className="w-5 h-5 text-indigo-600" />}
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 12 — Other Estimates</p>
            <p className="text-xs text-slate-500">Has the customer collected other estimates?</p>
          </div>
        </div>
        {isComplete && <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>}
      </div>

      <div className="p-5 bg-white space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Collected Other Estimates?</p>
          <Select value={formData.collected_other_estimates || ''} onValueChange={(val) => onChange('collected_other_estimates', val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Yes">Yes</SelectItem>
              <SelectItem value="No">No</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formData.collected_other_estimates === 'Yes' && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Which Other Companies?</p>
            <LocalInput
              value={formData.other_companies_estimates || ''}
              onBlur={(v) => onChange('other_companies_estimates', v)}
              placeholder="Enter company names..."
            />
          </div>
        )}
      </div>
    </div>
  );
}