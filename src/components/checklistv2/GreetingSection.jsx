import React, { useState } from 'react';
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Phone, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const SCRIPT_LINES = [
  {
    speaker: 'CSR',
    text: '"It\'s a great day at Floor Daddy, this is [Name] — who do I have the pleasure of speaking with today?"'
  },
  {
    speaker: 'CSR',
    text: '"Awesome — good [morning / afternoon / evening], [First Name]. Thanks for calling us. What can Floor Daddy do for you today?"'
  }
];

const CALLER_TYPES = [
  {
    value: 'New Estimate / Flooring',
    label: 'New Estimate / Flooring',
    color: 'green',
    icon: '✅',
    instruction: 'Proceed to Section 2 — run the full appointment-setting flow.'
  },
  {
    value: 'Existing Customer',
    label: 'Existing Customer',
    color: 'amber',
    icon: '⚠️',
    instruction: 'Warranty issue, install question, or scheduling — transfer to the right team. Do NOT run the appointment-setting flow.'
  },
  {
    value: 'Contractor / Commercial / Property Manager',
    label: 'Contractor / Commercial / Property Manager',
    color: 'blue',
    icon: '🏢',
    instruction: 'Flag in CRM, capture details, and route appropriately.'
  }
];

export default function GreetingSection({ formData, onChange }) {
  const callerType = CALLER_TYPES.find(t => t.value === formData.caller_type);
  const isComplete = formData.greeting_completed && formData.caller_type;

  return (
    <div className="border-2 border-indigo-200 rounded-xl overflow-hidden">
      {/* Section Header */}
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
              : <Phone className="w-5 h-5 text-indigo-600" />
            }
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 1 — Greeting</p>
            <p className="text-xs text-slate-500">Answer the call & identify caller type</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 space-y-6 bg-white">
        {/* Script */}
        <Accordion type="single" collapsible defaultValue="script">
          <AccordionItem value="script" className="border border-slate-200 rounded-lg overflow-hidden">
            <AccordionTrigger className="px-4 py-3 hover:no-underline bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-700">
              📋 View Script
            </AccordionTrigger>
            <AccordionContent className="px-0 pb-0">
              <div className="divide-y divide-slate-100">
                {SCRIPT_LINES.map((line, idx) => (
                  <div key={idx} className="flex gap-3 px-4 py-3">
                    <span className="flex-shrink-0 text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded h-fit mt-0.5">
                      {line.speaker}
                    </span>
                    <p className="text-sm text-slate-700 italic leading-relaxed">{line.text}</p>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Caller Type Branch */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <Label className="font-semibold text-slate-700">Branch on their answer — what type of caller is this?</Label>
          </div>
          <div className="grid gap-2">
            {CALLER_TYPES.map((type) => {
              const selected = formData.caller_type === type.value;
              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => onChange('caller_type', type.value)}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all",
                    selected
                      ? type.color === 'green' ? "border-green-500 bg-green-50"
                        : type.color === 'amber' ? "border-amber-500 bg-amber-50"
                        : "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  <span className="text-xl leading-none mt-0.5">{type.icon}</span>
                  <div className="flex-1">
                    <p className={cn(
                      "font-semibold text-sm",
                      selected
                        ? type.color === 'green' ? "text-green-800"
                          : type.color === 'amber' ? "text-amber-800"
                          : "text-blue-800"
                        : "text-slate-700"
                    )}>
                      {type.label}
                    </p>
                    {selected && (
                      <p className={cn(
                        "text-xs mt-1 flex items-center gap-1",
                        type.color === 'green' ? "text-green-700"
                          : type.color === 'amber' ? "text-amber-700"
                          : "text-blue-700"
                      )}>
                        <ChevronRight className="w-3 h-3" />
                        {type.instruction}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes for non-estimate callers */}
        {formData.caller_type && formData.caller_type !== 'New Estimate / Flooring' && (
          <div className="space-y-2">
            <Label className="font-medium text-slate-700">Notes / Routing Details</Label>
            <Textarea
              value={formData.caller_type_notes || ''}
              onChange={(e) => onChange('caller_type_notes', e.target.value)}
              placeholder="Capture relevant details before transferring or routing..."
              className="min-h-20"
            />
          </div>
        )}

        {/* Completion Checkbox */}
        <div className={cn(
          "flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
          formData.greeting_completed
            ? "border-green-400 bg-green-50"
            : "border-slate-200 bg-slate-50 hover:border-indigo-300"
        )}
          onClick={() => onChange('greeting_completed', !formData.greeting_completed)}
        >
          <Checkbox
            checked={formData.greeting_completed || false}
            onCheckedChange={(checked) => onChange('greeting_completed', checked)}
            className="data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
          />
          <Label className="cursor-pointer font-semibold text-slate-700">
            Greeting completed — caller identified
          </Label>
        </div>
      </div>
    </div>
  );
}