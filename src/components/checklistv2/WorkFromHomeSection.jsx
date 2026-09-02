import React from 'react';
import { Home, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function WorkFromHomeSection({ formData, onChange }) {
  const isComplete = !!formData.work_from_home;

  return (
    <div className="border-2 border-info/25 rounded-xl overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-good/12 border-b border-good/25" : "bg-info/12 border-b border-info/25"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isComplete ? "bg-good/12" : "bg-info/12"
          )}>
            {isComplete
              ? <CheckCircle2 className="w-5 h-5 text-good" />
              : <Home className="w-5 h-5 text-info" />
            }
          </div>
          <div>
            <p className="font-bold text-foreground">Section 9 — Work From Home</p>
            <p className="text-xs text-muted-foreground">Does the customer work from home?</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-good bg-good/12 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 bg-white">
        <div className="max-w-xs space-y-2">
          <p className="text-sm font-medium text-foreground">Work from Home?</p>
          <Select value={formData.work_from_home || ''} onValueChange={(val) => onChange('work_from_home', val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Yes">Yes</SelectItem>
              <SelectItem value="No">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}