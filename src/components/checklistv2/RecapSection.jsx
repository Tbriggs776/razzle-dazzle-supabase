import React from 'react';
import { RotateCcw, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const LEAD_SOURCES = [
  "Google", "Facebook/Instagram", "TV", "Billboard", "Mailer",
  "Floor Daddy Vehicle", "Referral", "Realtor Referral", "AI Search",
  "Independent News", "Homeshow", "Other"
];

export default function RecapSection({ formData, onChange }) {
  const isComplete = !!(formData.recap_completed && formData.heard_about_us);

  return (
    <div className="border-2 border-info/25 rounded-xl overflow-hidden">
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-good/12 border-b border-good/25" : "bg-info/12 border-b border-info/25"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isComplete ? "bg-good/12" : "bg-info/12")}>
            {isComplete ? <CheckCircle2 className="w-5 h-5 text-good" /> : <RotateCcw className="w-5 h-5 text-info" />}
          </div>
          <div>
            <p className="font-bold text-foreground">Section 14 — Recap</p>
            <p className="text-xs text-muted-foreground">Summarize key points and capture lead source</p>
          </div>
        </div>
        {isComplete && <span className="text-xs font-semibold text-good bg-good/12 px-3 py-1 rounded-full">Complete</span>}
      </div>

      <div className="p-5 bg-white space-y-5">
        {/* Script */}
        <div className="bg-muted border border-border rounded-lg p-4 text-sm text-foreground space-y-2">
          <p><strong>Recap Script:</strong> "Before I let you go, let me just recap everything we covered..."</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground pl-2">
            <li>Confirm customer name, address, and contact info</li>
            <li>Confirm appointment date, time block, and 2-hour window</li>
            <li>Let them know the DC will call/text en route</li>
            <li>Remind them to have all decision-makers present</li>
          </ul>
        </div>

        {/* Confirmation checkbox */}
        <div
          className={cn(
            "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
            formData.recap_completed ? "bg-good/12 border-good/25" : "bg-white border-border hover:border-info/25"
          )}
          onClick={() => onChange('recap_completed', !formData.recap_completed)}
        >
          <Checkbox
            checked={!!formData.recap_completed}
            onCheckedChange={(checked) => onChange('recap_completed', checked)}
          />
          <span className={cn("text-sm font-medium", formData.recap_completed ? "text-good" : "text-foreground")}>
            Recap completed
          </span>
        </div>

        {/* Lead Source */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">How Did You Hear About Us? <span className="text-crit">*</span></p>
          <Select value={formData.heard_about_us || ''} onValueChange={(val) => onChange('heard_about_us', val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent>
              {LEAD_SOURCES.map(source => (
                <SelectItem key={source} value={source}>{source}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {formData.heard_about_us === 'Other' && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Please Specify</p>
            <Input
              value={formData.heard_about_us_other || ''}
              onChange={(e) => onChange('heard_about_us_other', e.target.value)}
              placeholder="Please specify..."
            />
          </div>
        )}
      </div>
    </div>
  );
}