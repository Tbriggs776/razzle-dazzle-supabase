import React, { useState, useEffect } from 'react';
import { Clock, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from "@/components/ui/input";

function LocalInput({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return <Input {...props} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => onBlur(local)} />;
}

export default function TimeframeSection({ formData, onChange }) {
  const isComplete = !!formData.project_timeframe;

  return (
    <div className="border-2 border-info/25 rounded-xl overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-good/12 border-b border-good/25" : "bg-info/12 border-b border-info/25"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isComplete ? "bg-good/12" : "bg-info/12")}>
            {isComplete ? <CheckCircle2 className="w-5 h-5 text-good" /> : <Clock className="w-5 h-5 text-info" />}
          </div>
          <div>
            <p className="font-bold text-foreground">Section 11 — Time Frame</p>
            <p className="text-xs text-muted-foreground">When does the customer want to move forward?</p>
          </div>
        </div>
        {isComplete && <span className="text-xs font-semibold text-good bg-good/12 px-3 py-1 rounded-full">Complete</span>}
      </div>

      <div className="p-5 bg-white space-y-2">
        <p className="text-sm font-medium text-foreground">Project Timeframe</p>
        <LocalInput
          value={formData.project_timeframe || ''}
          onBlur={(v) => onChange('project_timeframe', v)}
          placeholder="e.g., Next 2 weeks, ASAP, within a month..."
        />
      </div>
    </div>
  );
}