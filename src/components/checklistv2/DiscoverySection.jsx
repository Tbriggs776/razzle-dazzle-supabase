import React, { useState, useEffect } from 'react';
import { Textarea } from "@/components/ui/textarea";
import { Search, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const QUESTIONS = [
  {
    field: 'discovery_q1',
    number: 'Q1',
    prompt: '"So tell me a little about your space — what kind of flooring do you have in there right now?"',
    hint: 'Capture naturally: # of rooms, current floor type, pets, kids, traffic, sq footage if mentioned.',
    placeholder: 'e.g., Carpet in 3 bedrooms, tile in kitchen/baths, has 2 dogs, high traffic hallway...',
  },
  {
    field: 'discovery_q2',
    number: 'Q2',
    prompt: '"And what\'s got you thinking about replacing it?"',
    hint: 'Reflect back: "OK, so it sounds like [reflect] — that makes total sense."',
    placeholder: 'e.g., Carpet is worn/stained, moving in, remodel, selling the house...',
  },
  {
    field: 'discovery_q3',
    number: 'Q3',
    prompt: '"And when you picture the finished space in your head — what does that look like? What\'s the vibe you\'re going for?"',
    hint: 'Colors, style, feel — modern, cozy, clean, warm, neutral...',
    placeholder: 'e.g., Light and airy, modern gray tones, warm wood look throughout...',
  },
  {
    field: 'discovery_q4',
    number: 'Q4',
    prompt: '"And on the timing side — if we don\'t get this project moving in the next few weeks, what happens? Is there pressure on it, or are you more flexible?"',
    hint: 'Urgency driver — event, sale deadline, contractor timing, etc.',
    placeholder: 'e.g., Hosting family in 6 weeks, no hard deadline but motivated, listing house in April...',
  },
  {
    field: 'discovery_q5',
    number: 'Q5',
    prompt: '"Last one — when this whole project is done and you walk in the door for the first time, how do you want to feel?"',
    hint: 'Emotional close — capture the vision.',
    placeholder: 'e.g., Proud, relieved, like it\'s finally a real home, excited to have people over...',
  },
];

function LocalTextarea({ value, onBlur, ...props }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => { setLocal(value || ''); }, [value]);
  return (
    <Textarea
      {...props}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onBlur(local)}
    />
  );
}

export default function DiscoverySection({ formData, onChange }) {
  const answeredCount = QUESTIONS.filter(q => (formData[q.field] || '').trim().length > 0).length;
  const isComplete = answeredCount === QUESTIONS.length;

  return (
    <div className="border-2 border-warn/25 rounded-xl overflow-hidden">
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-good/12 border-b border-good/25" : "bg-warn/12 border-b border-warn/25"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isComplete ? "bg-good/12" : "bg-warn/12"
          )}>
            {isComplete
              ? <CheckCircle2 className="w-5 h-5 text-good" />
              : <Search className="w-5 h-5 text-warn" />
            }
          </div>
          <div>
            <p className="font-bold text-foreground">Section 4 — Discovery</p>
            <p className="text-xs text-muted-foreground">5 questions, in order — {answeredCount} of 5 answered</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-good bg-good/12 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 space-y-5 bg-white">
        {QUESTIONS.map((q, idx) => {
          const answered = (formData[q.field] || '').trim().length > 0;
          return (
            <div key={q.field} className={cn(
              "rounded-lg border-2 p-4 space-y-3 transition-colors",
              answered ? "border-good/25 bg-good/12/40" : "border-border bg-muted"
            )}>
              <div className="flex items-start gap-3">
                <span className={cn(
                  "flex-shrink-0 text-xs font-bold px-2 py-1 rounded border h-fit",
                  answered
                    ? "bg-good/12 border-good text-good"
                    : "bg-warn/12 border-warn/25 text-warn"
                )}>
                  {q.number}
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground italic">{q.prompt}</p>
                  <p className="text-xs text-muted-foreground">{q.hint}</p>
                </div>
              </div>
              <LocalTextarea
                value={formData[q.field] || ''}
                onBlur={(v) => onChange(q.field, v)}
                placeholder={q.placeholder}
                className="min-h-[72px] text-sm bg-white"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}