import React from 'react';
import { LogOut, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from "@/components/ui/checkbox";

export default function OutroSection({ formData, onChange }) {
  const isComplete = !!formData.outro_completed;

  return (
    <div className="border-2 border-indigo-200 rounded-xl overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-green-50 border-b border-green-200" : "bg-indigo-50 border-b border-indigo-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isComplete ? "bg-green-100" : "bg-indigo-100")}>
            {isComplete ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <LogOut className="w-5 h-5 text-indigo-600" />}
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 15 — Outro</p>
            <p className="text-xs text-slate-500">Close the call and send the customer off right</p>
          </div>
        </div>
        {isComplete && <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>}
      </div>

      <div className="p-5 bg-white space-y-5">
        {/* Script */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700 space-y-3">
          <p>
            <strong>Outro Script:</strong> Thank the customer for their time and confirm they've received the appointment confirmation.
          </p>
          <p>
            <strong>Visualizer Tool Note:</strong> Remind the customer about the online visualizer tool to explore flooring options before the appointment.
          </p>
        </div>

        {/* Confirmation checkbox */}
        <div
          className={cn(
            "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
            formData.outro_completed ? "bg-green-50 border-green-300" : "bg-white border-slate-200 hover:border-indigo-300"
          )}
          onClick={() => onChange('outro_completed', !formData.outro_completed)}
        >
          <Checkbox
            checked={!!formData.outro_completed}
            onCheckedChange={(checked) => onChange('outro_completed', checked)}
          />
          <span className={cn("text-sm font-medium", formData.outro_completed ? "text-green-700" : "text-slate-700")}>
            Outro completed
          </span>
        </div>
      </div>
    </div>
  );
}