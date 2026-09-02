import React from 'react';
import { LogOut, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from "@/components/ui/checkbox";

export default function OutroSection({ formData, onChange }) {
  const isComplete = !!formData.outro_completed;

  return (
    <div className="border-2 border-info/25 rounded-xl overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-good/12 border-b border-good/25" : "bg-info/12 border-b border-info/25"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isComplete ? "bg-good/12" : "bg-info/12")}>
            {isComplete ? <CheckCircle2 className="w-5 h-5 text-good" /> : <LogOut className="w-5 h-5 text-info" />}
          </div>
          <div>
            <p className="font-bold text-foreground">Section 15 — Outro</p>
            <p className="text-xs text-muted-foreground">Close the call and send the customer off right</p>
          </div>
        </div>
        {isComplete && <span className="text-xs font-semibold text-good bg-good/12 px-3 py-1 rounded-full">Complete</span>}
      </div>

      <div className="p-5 bg-white space-y-5">
        {/* Script */}
        <div className="bg-muted border border-border rounded-lg p-4 text-sm text-foreground space-y-3">
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
            formData.outro_completed ? "bg-good/12 border-good/25" : "bg-white border-border hover:border-info/25"
          )}
          onClick={() => onChange('outro_completed', !formData.outro_completed)}
        >
          <Checkbox
            checked={!!formData.outro_completed}
            onCheckedChange={(checked) => onChange('outro_completed', checked)}
          />
          <span className={cn("text-sm font-medium", formData.outro_completed ? "text-good" : "text-foreground")}>
            Outro completed
          </span>
        </div>
      </div>
    </div>
  );
}