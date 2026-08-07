import React, { useState } from 'react';
import { Star, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const VALUE_ITEMS = [
  {
    number: "1",
    title: "Lifetime Labor Warranty",
    script: "Not one year, not five. Lifetime. If anything ever goes wrong because of how we installed it, we come back and fix it or replace it. Free. Compare that to the standard two-year state-backed warranty you'll get pretty much anywhere else — after those two years are up, you're basically on your own. We don't operate that way. We've got your back."
  },
  {
    number: "2",
    title: "Worry-Free Guarantee",
    script: "If you scratch, dent, or stain your floor accidentally in the first 12 months, we come fix or replace the damaged area — up to 3 planks for hardwood or LVP, or 1 square foot for carpet or tile. One claim, free. Most accidental damage falls right in that range."
  },
  {
    number: "3",
    title: "Field Manager + Full Walk-Through",
    script: "Every job gets a field manager who comes out during the install to make sure it's going right. And when it's done, they walk you through every room — to make sure you sign off and you're 100% happy before we leave. Basic floor prep is included automatically — so no surprise charges. You'll know your full number up front."
  },
  {
    number: "4",
    title: "Furniture Moving — Included",
    script: "We move your furniture for you — no extra charge, no dragging stuff to the garage yourself."
  },
  {
    number: "5",
    title: "Staged Install — Home Stays Livable",
    script: "We work in stages so the home stays livable — we can install one area at a time, leave you somewhere to sleep and somewhere to cook. We don't shut your house down for a week."
  },
  {
    number: "6",
    title: "Free Air Duct Cleaning (Qualifying Projects)",
    script: "On qualifying projects — $5,500 minimum for a single AC unit, $6,500 for two — we include free air duct cleaning on the trunk lines, because flooring installs kick up dust and we'd rather get behind the install and clean it out than have you breathing it for the next month.",
    note: "Single AC ≥ $5,500 · Two AC ≥ $6,500"
  }
];

export default function ValueStackSection({ formData, onChange }) {
  const [scriptOpen, setScriptOpen] = useState(false);

  const isComplete = !!formData.value_stack_delivered;

  return (
    <div className="border-2 border-yellow-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-green-50 border-b border-green-200" : "bg-yellow-50 border-b border-yellow-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isComplete ? "bg-green-100" : "bg-yellow-100"
          )}>
            {isComplete
              ? <CheckCircle2 className="w-5 h-5 text-green-600" />
              : <Star className="w-5 h-5 text-yellow-600" />
            }
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 7 — Value Stack</p>
            <p className="text-xs text-slate-500">Walk through every standard inclusion — do not skip</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 space-y-4 bg-white">

        {/* Opener */}
        <div className="rounded-lg border-2 border-yellow-200 bg-yellow-50 px-4 py-3">
          <p className="text-sm font-semibold text-yellow-900 italic">
            "Let me tell you what comes standard with us that you won't get anywhere else…"
          </p>
        </div>

        {/* Collapsible full script */}
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 overflow-hidden">
          <button
            type="button"
            onClick={() => setScriptOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-slate-700">View Full Script</span>
            {scriptOpen
              ? <ChevronUp className="w-4 h-4 text-slate-500" />
              : <ChevronDown className="w-4 h-4 text-slate-500" />
            }
          </button>
          {scriptOpen && (
            <div className="border-t border-slate-200 divide-y divide-slate-100">
              {VALUE_ITEMS.map((item) => (
                <div key={item.number} className="px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-yellow-400 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {item.number}
                    </span>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">{item.title}</p>
                    {item.note && (
                      <span className="ml-auto text-[10px] font-semibold text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full">{item.note}</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-700 italic leading-relaxed pl-7">"{item.script}"</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick-reference cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {VALUE_ITEMS.map((item) => (
            <div key={item.number} className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50">
              <span className="w-5 h-5 rounded-full bg-yellow-400 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {item.number}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                {item.note && <p className="text-[11px] text-yellow-700 font-medium mt-0.5">{item.note}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Completion checkbox */}
        <div
          onClick={() => onChange('value_stack_delivered', !formData.value_stack_delivered)}
          className={cn(
            "flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all select-none",
            isComplete
              ? "border-green-400 bg-green-50"
              : "border-slate-200 bg-slate-50 hover:border-yellow-400"
          )}
        >
          <div className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
            isComplete ? "bg-green-500 border-green-500" : "border-slate-400 bg-white"
          )}>
            {isComplete && <CheckCircle2 className="w-3 h-3 text-white" />}
          </div>
          <p className={cn(
            "text-sm font-semibold",
            isComplete ? "text-green-800" : "text-slate-700"
          )}>
            Full value stack delivered — customer knows everything included
          </p>
        </div>

      </div>
    </div>
  );
}