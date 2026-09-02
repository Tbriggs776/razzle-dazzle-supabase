import React from 'react';
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const SCRIPT_BLOCKS = [
  {
    text: '"Before we dive in, let me tell you how we\'re different so you know what you\'re stepping into. We\'re a local, veteran-owned flooring company — not a big-box store, not private equity. When you call us, you\'re talking to actual people in Arizona who own this thing. And one thing I want you to know right up front — when our designer comes out, they\'re not there to push you toward our most expensive product or our best sellers. Flooring isn\'t one-size-fits-all. They show you what fits you — your space, your style, your budget. That\'s how we do it."'
  },
  {
    text: '"Here\'s how the experience works: I\'m going to walk you through a quick checklist so I understand what you\'re trying to accomplish — what\'s driving the project, what you want it to feel like when it\'s done, your wants and needs. That takes about 15–20 minutes. Then we send a Design Consultant out to your home — and they bring the showroom to you. You\'ll be able to touch the actual samples, see every color and texture, set them right next to your cabinets, your countertops, your couch — in your real home lighting."'
  },
  {
    text: '"The same flooring can look like a completely different product under showroom fluorescents versus your kitchen window — it\'s wild how much it changes. They\'ll measure every space you want done, and they build you a full quote right there on the spot. No sending it later, no surprises — you\'ll know exactly what the project looks like before they leave. Sound good?"'
  },
  {
    text: '"Perfect. Let me pull up my checklist — and while I do, tell me something good that\'s happening in your world today."'
  }
];

const CHECKBOXES = [
  { field: 'frame_greeted_properly', label: 'Greeted the customer warmly and professionally' },
  { field: 'frame_experience_delivered', label: 'Framed the experience — explained who we are, how the process works, and set expectations' }
];

export default function FrameExperienceSection({ formData, onChange }) {
  const isComplete = CHECKBOXES.every(cb => formData[cb.field]);

  return (
    <div className="border-2 border-purple-200 rounded-xl overflow-hidden">
      {/* Section Header */}
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-good/12 border-b border-good/25" : "bg-purple-50 border-b border-purple-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isComplete ? "bg-good/12" : "bg-purple-100"
          )}>
            {isComplete
              ? <CheckCircle2 className="w-5 h-5 text-good" />
              : <Sparkles className="w-5 h-5 text-purple-600" />
            }
          </div>
          <div>
            <p className="font-bold text-foreground">Section 2 — Frame the Experience</p>
            <p className="text-xs text-muted-foreground">Differentiate Floor Daddy & set expectations</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-good bg-good/12 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 space-y-5 bg-white">
        {/* Script */}
        <Accordion type="single" collapsible defaultValue="script">
          <AccordionItem value="script" className="border border-border rounded-lg overflow-hidden">
            <AccordionTrigger className="px-4 py-3 hover:no-underline bg-muted hover:bg-muted text-sm font-semibold text-foreground">
              📋 View Script
            </AccordionTrigger>
            <AccordionContent className="px-0 pb-0">
              <div className="divide-y divide-border">
                {SCRIPT_BLOCKS.map((block, idx) => (
                  <div key={idx} className="flex gap-3 px-4 py-3">
                    <span className="flex-shrink-0 text-xs font-bold text-purple-600 bg-purple-50 border border-purple-200 px-2 py-1 rounded h-fit mt-0.5">
                      CSR
                    </span>
                    <p className="text-sm text-foreground italic leading-relaxed">{block.text}</p>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Confirmation Checkboxes */}
        <div className="space-y-3">
          {CHECKBOXES.map(({ field, label }) => (
            <div
              key={field}
              onClick={() => onChange(field, !formData[field])}
              className={cn(
                "flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
                formData[field]
                  ? "border-good bg-good/12"
                  : "border-border bg-muted hover:border-purple-300"
              )}
            >
              <Checkbox
                checked={formData[field] || false}
                onCheckedChange={(checked) => onChange(field, checked)}
                className="data-[state=checked]:bg-good data-[state=checked]:border-good"
              />
              <Label className="cursor-pointer font-medium text-foreground">{label}</Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}