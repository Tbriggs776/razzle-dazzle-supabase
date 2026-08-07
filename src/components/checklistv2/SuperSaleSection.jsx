import React, { useState } from 'react';
import { Sparkles, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const SCRIPT_BLOCKS = [
  {
    label: "Timing hook",
    text: "Heads up — the timing of your call is actually really good. We're running our Razzle Dazzle Super Sale right now."
  },
  {
    label: "What it's NOT",
    text: "Quick thing to know up front: it's not a 'percentage off' sale. It's something different."
  },
  {
    label: "What it IS",
    text: "It's our complete experience bundle — every upgrade, every protection, every financing option, all built into one project."
  },
  {
    label: "Why we did it",
    text: "Most flooring companies try to nickel-and-dime you on every single thing. We bundled all of it together because that's not how we want this to feel."
  },
  {
    label: "The pitch",
    text: "The Razzle Dazzle Super Sale is basically the only flooring event designed to eliminate the surprises, the stress, and the regret most people associate with a flooring project."
  },
  {
    label: "Transition to Section 7",
    text: "Let me walk you through exactly what's included…"
  }
];

export default function SuperSaleSection({ formData, onChange }) {
  const [scriptOpen, setScriptOpen] = useState(false);

  const isComplete = !!formData.super_sale_delivered;

  return (
    <div className="border-2 border-purple-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-green-50 border-b border-green-200" : "bg-purple-50 border-b border-purple-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isComplete ? "bg-green-100" : "bg-purple-100"
          )}>
            {isComplete
              ? <CheckCircle2 className="w-5 h-5 text-green-600" />
              : <Sparkles className="w-5 h-5 text-purple-600" />
            }
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 6 — The Razzle Dazzle Super Sale</p>
            <p className="text-xs text-slate-500">Deliver the headline pitch before walking through the value stack</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 space-y-4 bg-white">

        {/* Collapsible script */}
        <div className="rounded-lg border-2 border-purple-200 bg-purple-50 overflow-hidden">
          <button
            type="button"
            onClick={() => setScriptOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-purple-800">View Script</span>
            {scriptOpen
              ? <ChevronUp className="w-4 h-4 text-purple-600" />
              : <ChevronDown className="w-4 h-4 text-purple-600" />
            }
          </button>
          {scriptOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-purple-200">
              {SCRIPT_BLOCKS.map((block, i) => (
                <div key={i} className="space-y-0.5">
                  <p className="text-[10px] font-bold text-purple-500 uppercase tracking-wider">{block.label}</p>
                  <p className="text-sm text-purple-900 italic leading-relaxed">"{block.text}"</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transition note */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-500 font-medium">
            📌 Section 7 picks up immediately — these two sections work together as <strong>headline → detail</strong>. Move directly into the value stack after delivering this.
          </p>
        </div>

        {/* Completion checkbox */}
        <div
          onClick={() => onChange('super_sale_delivered', !formData.super_sale_delivered)}
          className={cn(
            "flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all select-none",
            isComplete
              ? "border-green-400 bg-green-50"
              : "border-slate-200 bg-slate-50 hover:border-purple-300"
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
            Super Sale headline delivered — ready to walk through what's included
          </p>
        </div>

      </div>
    </div>
  );
}