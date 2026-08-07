import React, { useState, useEffect } from 'react';
import { DollarSign, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Textarea } from "@/components/ui/textarea";

const CREDIT_RANGES = ['Above 700', '600-700', 'Below 600'];

function LocalTextarea({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return <Textarea {...props} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => onBlur(local)} />;
}

export default function FinancingSection({ formData, onChange }) {
  const isComplete = !!(formData.financing_notes || formData.credit_score_range);

  return (
    <div className="border-2 border-indigo-200 rounded-xl overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-green-50 border-b border-green-200" : "bg-indigo-50 border-b border-indigo-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isComplete ? "bg-green-100" : "bg-indigo-100"
          )}>
            {isComplete
              ? <CheckCircle2 className="w-5 h-5 text-green-600" />
              : <DollarSign className="w-5 h-5 text-indigo-600" />
            }
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 10 — Financing</p>
            <p className="text-xs text-slate-500">Financing details and credit score range</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 bg-white space-y-5">
        {/* Free-form notes */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Financing Notes</p>
          <LocalTextarea
            value={formData.financing_notes || ''}
            onBlur={(v) => onChange('financing_notes', v)}
            placeholder="e.g., 60 months 0% interest was a key factor, customer interested in Synchrony..."
            className="min-h-20"
          />
        </div>

        {/* Credit score checkboxes */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Credit Score Range</p>
          <div className="space-y-2">
            {CREDIT_RANGES.map((range) => {
              const selected = formData.credit_score_range === range;
              return (
                <div
                  key={range}
                  onClick={() => onChange('credit_score_range', selected ? null : range)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all select-none",
                    selected ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-slate-50 hover:border-indigo-300"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                    selected ? "border-indigo-500 bg-indigo-500" : "border-slate-400 bg-white"
                  )}>
                    {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <p className={cn("text-sm font-semibold", selected ? "text-indigo-800" : "text-slate-700")}>
                    {range}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}