import React, { useState, useEffect } from 'react';
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Ruler, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const FLOORING_OPTIONS = ['Carpet', 'LVP', 'Laminate', 'Tile', 'Hardwood', 'Sheet Vinyl', 'Open to Options'];

function LocalTextarea({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return <Textarea {...props} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => onBlur(local)} />;
}

export default function ScopeSection({ formData, onChange }) {
  const toggleFlooringProduct = (option) => {
    const current = formData.scope_flooring_products || [];
    const updated = current.includes(option)
      ? current.filter(o => o !== option)
      : [...current, option];
    onChange('scope_flooring_products', updated);
  };

  const isComplete = !!(formData.scope_gap_fill_notes);

  return (
    <div className="border-2 border-teal-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-good/12 border-b border-good/25" : "bg-teal-50 border-b border-teal-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isComplete ? "bg-good/12" : "bg-teal-100"
          )}>
            {isComplete
              ? <CheckCircle2 className="w-5 h-5 text-good" />
              : <Ruler className="w-5 h-5 text-teal-600" />
            }
          </div>
          <div>
            <p className="font-bold text-foreground">Section 5 — Scope</p>
            <p className="text-xs text-muted-foreground">Gap-fill from discovery — confirm rooms, flooring type & special flags</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-good bg-good/12 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 space-y-5 bg-white">

        {/* Reflect & Gap-Fill */}
        <div className="rounded-lg border-2 border-border bg-muted p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground italic">
              "OK let me make sure I've got the scope right. From what you've described, we're looking at [reflect rooms, sq footage, current flooring]. Anything I'm missing?"
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Scope Summary / Gap-Fill Notes <span className="text-crit">*</span></Label>
            <LocalTextarea
              value={formData.scope_gap_fill_notes || ''}
              onBlur={(v) => onChange('scope_gap_fill_notes', v)}
              placeholder="Confirm rooms, sq footage, current flooring, anything missed in discovery..."
              className="min-h-[72px] text-sm bg-white"
            />
          </div>
        </div>

        {/* Flooring type (if not captured) */}
        <div className="rounded-lg border-2 border-border bg-muted p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground italic">
            "What type of flooring are you leaning toward — or are you open to options?" <span className="text-xs font-normal text-muted-foreground not-italic">(if not already captured)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {FLOORING_OPTIONS.map(option => {
              const selected = (formData.scope_flooring_products || []).includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleFlooringProduct(option)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
                    selected
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white text-foreground border-border hover:border-teal-400'
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>

        {/* Pets / Kids */}
        <div className="rounded-lg border-2 border-border bg-muted p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground italic">
            "Any pets or kids I should know about for durability planning?" <span className="text-xs font-normal text-muted-foreground not-italic">(if not already captured)</span>
          </p>
          <LocalTextarea
            value={formData.scope_pets_kids_notes || ''}
            onBlur={(v) => onChange('scope_pets_kids_notes', v)}
            placeholder="e.g., 2 large dogs, 3 kids under 10, no pets..."
            className="min-h-[56px] text-sm bg-white"
          />
        </div>

        {/* Special Flags */}
        <div className="space-y-3">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Special Situation Flags</p>

          {/* Over existing tile */}
          <div
            onClick={() => onChange('scope_flag_over_tile', !formData.scope_flag_over_tile)}
            className={cn(
              "flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
              formData.scope_flag_over_tile
                ? "border-warn bg-warn/12"
                : "border-border bg-muted hover:border-warn/25"
            )}
          >
            <Checkbox
              checked={formData.scope_flag_over_tile || false}
              onCheckedChange={(checked) => onChange('scope_flag_over_tile', checked)}
              className="mt-0.5 data-[state=checked]:bg-warn data-[state=checked]:border-warn"
            />
            <div>
              <p className="font-semibold text-foreground text-sm">⚠ Caller wants to install over existing tile</p>
              <p className="text-xs text-muted-foreground mt-0.5">Triggers warranty / dustless demo talking point</p>
            </div>
          </div>
          {formData.scope_flag_over_tile && (
            <div className="ml-4 p-4 bg-warn/12 border-2 border-warn/25 rounded-lg space-y-2">
              <p className="text-xs font-bold text-warn uppercase tracking-wide">Script — Over Tile</p>
              <p className="text-sm text-warn italic leading-relaxed">
                "Want to flag something for you up front, because it ties directly into our lifetime labor warranty. We don't install LVP, laminate, or hardwood over existing tile. The reason is our warranty — we stand behind every install for a lifetime, and installing over tile creates risk we can't guarantee around. The good news: we include the tile demo as part of the project — you don't have to remove anything yourself. And we use a dustless tile demo system that cuts the dust and cleanup down to almost nothing. So we just remove what's there, prep the subfloor, and lay the new floor right. That's how we have to do it to honor the warranty — and honestly, it's how it should be done."
              </p>
            </div>
          )}

          {/* Out of scope items */}
          <div
            onClick={() => onChange('scope_flag_out_of_scope', !formData.scope_flag_out_of_scope)}
            className={cn(
              "flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all",
              formData.scope_flag_out_of_scope
                ? "border-crit bg-crit/12"
                : "border-border bg-muted hover:border-crit/25"
            )}
          >
            <Checkbox
              checked={formData.scope_flag_out_of_scope || false}
              onCheckedChange={(checked) => onChange('scope_flag_out_of_scope', checked)}
              className="mt-0.5 data-[state=checked]:bg-crit data-[state=checked]:border-crit"
            />
            <div>
              <p className="font-semibold text-foreground text-sm">⚠ Caller mentioned out-of-scope work</p>
              <p className="text-xs text-muted-foreground mt-0.5">Bathroom, kitchen, drywall, cabinets, etc. → see Section 9 exit line</p>
            </div>
          </div>
        </div>

        {/* 5a — Baseboards */}
        <div className="rounded-lg border-2 border-border bg-muted p-4 space-y-3">
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">5a — Baseboards</p>
            <p className="text-sm font-semibold text-foreground italic">"Are we including new baseboards in this project?"</p>
          </div>
          <div className="flex gap-2">
            {['Yes', 'No', 'Unsure'].map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => onChange('scope_baseboards', formData.scope_baseboards === opt ? '' : opt)}
                className={cn(
                  'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                  formData.scope_baseboards === opt
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white text-foreground border-border hover:border-teal-400'
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          {formData.scope_baseboards === 'Yes' && (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg">
              <p className="text-sm text-teal-800 italic">
                "Perfect — we're the only company in the valley that offers a painted baseboard service. We can install them and paint them to match your new floor. Most companies leave that to you to figure out."
              </p>
            </div>
          )}
        </div>

        {/* 5b — Tile Removal */}
        <div className="rounded-lg border-2 border-border bg-muted p-4 space-y-3">
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">5b — Tile Removal</p>
            <p className="text-sm font-semibold text-foreground italic">Is tile being pulled as part of this project?</p>
          </div>
          <div className="flex gap-2">
            {['Yes', 'No'].map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => onChange('scope_tile_removal', formData.scope_tile_removal === opt ? '' : opt)}
                className={cn(
                  'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                  formData.scope_tile_removal === opt
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white text-foreground border-border hover:border-teal-400'
                )}
              >
                {opt}
              </button>
            ))}
          </div>
          {formData.scope_tile_removal === 'Yes' && (
            <div className="p-3 bg-info/12 border border-info/25 rounded-lg">
              <p className="text-sm text-info italic">
                "And since we're pulling out tile — quick heads up. Tile demo is a dust disaster — weeks of cleanup, dust in places you didn't even know dust could get to. We have a dustless tile demo system that cuts that down to almost nothing. It's an optional add-on the designer can quote you on at the consult — most customers who add it say it's worth every dollar for skipping weeks of dust."
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}