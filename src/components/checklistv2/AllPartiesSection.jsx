import React, { useState } from 'react';
import { Users, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const TRACKS = {
  both_present: 'Both DMs Present',
  solo_one_leg: 'Solo DM Present (1 Leg)',
  single_dm: 'Single DM (No Other Parties)',
  commercial: 'Commercial (Committee / Board)'
};

const LADDER_RUNGS = [
  {
    rung: 1,
    label: "Calendar Push",
    script: "Totally hear you. When's the next window the two of you actually overlap, even for 90 minutes? Even if it's two weeks out, I'd rather book the right time than the soonest time."
  },
  {
    rung: 2,
    label: "FaceTime / Speakerphone",
    script: "OK what about this — what if we got [partner] on FaceTime or speakerphone during the consult? Our designer can hold up the samples, walk through the rooms with the camera, show [partner] everything in real time. A lot of customers do it that way. Would [partner] be down for that?"
  },
  {
    rung: 3,
    label: "Empowered Solo (Last Resort)",
    script: "OK — totally understand. I'll get you on the calendar, and I'll let our designer know that [partner] won't be there. One thing I want to be straight about — most of our customers in your situation end up wanting a second visit so [partner] can see the products before signing. That's totally fine — the consult is free, and there's no rush. Sound fair?"
  }
];

const CONSEQUENCE_STEPS = [
  {
    step: 1,
    label: "Disarm",
    script: "Hey [first name], can I ask you something kind of personal real quick?"
  },
  {
    step: 2,
    label: "Discover",
    script: "When you think about a project like this — the floor you're going to look at, walk on, live with every day for the next 10, 15 years — who else weighs in on a decision that big with you?"
  },
  {
    step: 3,
    label: "Consequence Question",
    script: "OK so [partner] is part of this too. Help me think through something — if you came in today, picked everything out yourself, signed off on a number, and then [partner] saw it for the first time when the install was done… how does that usually go in your house?",
    note: "⏸ SHUT UP. Wait for them to answer."
  },
  {
    step: 4,
    label: "Story",
    script: "Yeah, I get it. I'll tell you why I ask. When I started in this, we'd send our design consultant out and only one person would be there. We'd pick a beautiful floor, get it installed, and once or twice a week, the other partner would walk through the door, see the color, and… not love it. So we changed how we do it. Now we just do the consult with both of you in the room, samples in your hands, picking it together. Saves a ton of headache."
  },
  {
    step: 5,
    label: "Reframe",
    script: "And honestly — the consult is kind of a fun moment when both of you are there. Our designer pulls out the whole showroom, you're laying samples next to your couch, holding them up to the light, talking about what you both want the place to feel like. A lot of couples tell us it was the most fun they've had picking something for the house in years."
  },
  {
    step: 6,
    label: "Ask + Cherry",
    script: "So when's a window the two of you are both around for about 90 minutes? ... Perfect — and one more thing: because you're both going to be there, you actually unlock an extra $500 off the project. Nice bonus on top of everything else."
  }
];

export default function AllPartiesSection({ formData, onChange }) {
  const [minimsOpen, setMinimsOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [ladderOpen, setLadderOpen] = useState(false);

  const track = formData.prequal_dm_track || null;
  const belowMinimum = formData.prequal_below_minimum || false;
  const ladderCovered = formData.prequal_ladder_covered || false;

  const isComplete = !!track && !belowMinimum;

  return (
    <div className="border-2 border-indigo-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-5 py-4",
        isComplete ? "bg-green-50 border-b border-green-200" : "bg-indigo-50 border-b border-indigo-200"
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            isComplete ? "bg-green-100" : "bg-indigo-100"
          )}>
            {isComplete
              ? <CheckCircle2 className="w-5 h-5 text-green-600" />
              : <Users className="w-5 h-5 text-indigo-600" />
            }
          </div>
          <div>
            <p className="font-bold text-slate-800">Section 8 — All Parties + Soft Pre-Qual</p>
            <p className="text-xs text-slate-500">Project minimums, decision-maker discovery, and consequence ladder</p>
          </div>
        </div>
        {isComplete && (
          <span className="text-xs font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">Complete</span>
        )}
      </div>

      <div className="p-5 space-y-5 bg-white">

        {/* 8a — Project Minimums */}
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 overflow-hidden">
          <button
            type="button"
            onClick={() => setMinimsOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div>
              <p className="text-sm font-bold text-slate-800">8a — Project Minimums</p>
              <p className="text-xs text-slate-500 mt-0.5">Carpet $1,500 · LVP/Laminate $2,500 · Hardwood/Tile $3,500</p>
            </div>
            {minimsOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </button>
          {minimsOpen && (
            <div className="px-4 pb-4 border-t border-slate-200 pt-3 space-y-3">
              <p className="text-sm text-slate-700 italic leading-relaxed">
                "Quick housekeeping note — so you know how we're set up: our project minimums are $1,500 for carpet, $2,500 for LVP or laminate, and $3,500 for hardwood or tile. Based on what you've told me, you're probably going to expect at least that much, so we're good to keep going."
              </p>
              <div
                onClick={() => onChange('prequal_below_minimum', !belowMinimum)}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all",
                  belowMinimum ? "border-red-400 bg-red-50" : "border-slate-200 bg-white hover:border-red-300"
                )}
              >
                <div className={cn(
                  "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5",
                  belowMinimum ? "bg-red-500 border-red-500" : "border-slate-400 bg-white"
                )}>
                  {belowMinimum && <AlertTriangle className="w-3 h-3 text-white" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-red-700">⚠ Caller appears to be below minimum</p>
                  <p className="text-xs text-slate-500 mt-0.5">Route to Section 9 — Below Minimum exit line</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 8b — Decision-Maker Conversation */}
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 overflow-hidden">
          <button
            type="button"
            onClick={() => setDmOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div>
              <p className="text-sm font-bold text-slate-800">8b — The Decision-Maker Conversation</p>
              <p className="text-xs text-slate-500 mt-0.5">Steps 1–6 + consequence ladder for Track C</p>
            </div>
            {dmOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </button>
          {dmOpen && (
            <div className="border-t border-slate-200">
              {/* Steps 1-6 */}
              <div className="divide-y divide-slate-100">
                {CONSEQUENCE_STEPS.map((s) => (
                  <div key={s.step} className="px-4 py-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {s.step}
                      </span>
                      <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">{s.label}</p>
                    </div>
                    <p className="text-sm text-slate-700 italic leading-relaxed pl-7">"{s.script}"</p>
                    {s.note && (
                      <p className="text-xs font-bold text-red-600 pl-7 mt-1">{s.note}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Track routing guide */}
              <div className="px-4 pb-4 pt-3 bg-indigo-50 border-t border-indigo-100">
                <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2">Track Guide</p>
                <div className="space-y-2 text-xs text-slate-700">
                  <div className="flex gap-2"><span className="font-bold text-green-700">Track A</span><span>— "Just me / no one else" → confirm solo authority → skip to 8c</span></div>
                  <div className="flex gap-2"><span className="font-bold text-blue-700">Track B</span><span>— Partner confirmed present → get partner name + confirm 90 min → drop $500 cherry → 8c</span></div>
                  <div className="flex gap-2"><span className="font-bold text-orange-700">Track C</span><span>— Partner exists but uncertain → run Steps 3–6 + ladder if needed</span></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Track C Ladder */}
        <div className="rounded-lg border-2 border-orange-200 bg-orange-50 overflow-hidden">
          <button
            type="button"
            onClick={() => setLadderOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div>
              <p className="text-sm font-bold text-slate-800">Track C — Consequence Ladder</p>
              <p className="text-xs text-slate-500 mt-0.5">Run only if partner exists but presence is uncertain</p>
            </div>
            {ladderOpen ? <ChevronUp className="w-4 h-4 text-orange-500" /> : <ChevronDown className="w-4 h-4 text-orange-500" />}
          </button>
          {ladderOpen && (
            <div className="border-t border-orange-200 divide-y divide-orange-100">
              {LADDER_RUNGS.map((r) => (
                <div key={r.rung} className="px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {r.rung}
                    </span>
                    <p className="text-xs font-bold text-orange-700 uppercase tracking-wide">{r.label}</p>
                  </div>
                  <p className="text-sm text-slate-700 italic leading-relaxed pl-7">"{r.script}"</p>
                </div>
              ))}
              <div className="px-4 py-3 bg-red-50">
                <p className="text-xs font-bold text-red-700 mb-1">CRM Action — Rung 3 Only</p>
                <ul className="text-xs text-red-700 space-y-0.5 list-disc list-inside">
                  <li>Flag appointment as "Solo-DM"</li>
                  <li>Notify design consultant in advance</li>
                  <li>DO NOT promise the $500 incentive</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Outcome — Result Selection */}
        <div className="space-y-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Outcome / Result</p>
          <div className="space-y-2">
            {Object.entries(TRACKS).map(([key, label]) => {
              const selected = track === key;
              return (
                <div
                  key={key}
                  onClick={() => onChange('prequal_dm_track', selected ? null : key)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all select-none",
                    selected
                      ? key === 'solo_one_leg'
                        ? "border-orange-400 bg-orange-50"
                        : "border-indigo-400 bg-indigo-50"
                      : "border-slate-200 bg-slate-50 hover:border-indigo-300"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                    selected
                      ? key === 'solo_one_leg' ? "border-orange-500 bg-orange-500" : "border-indigo-500 bg-indigo-500"
                      : "border-slate-400 bg-white"
                  )}>
                    {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <p className={cn(
                    "text-sm font-semibold",
                    selected
                      ? key === 'solo_one_leg' ? "text-orange-800" : "text-indigo-800"
                      : "text-slate-700"
                  )}>
                    {label}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Secondary: Ladder covered — only shown for solo one-leg */}
          {track === 'solo_one_leg' && (
            <div
              onClick={() => onChange('prequal_ladder_covered', !ladderCovered)}
              className={cn(
                "ml-6 flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all select-none",
                ladderCovered ? "border-green-400 bg-green-50" : "border-orange-300 bg-orange-50 hover:border-green-400"
              )}
            >
              <div className={cn(
                "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0",
                ladderCovered ? "bg-green-500 border-green-500" : "border-orange-400 bg-white"
              )}>
                {ladderCovered && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
              </div>
              <p className={cn("text-sm font-semibold", ladderCovered ? "text-green-800" : "text-orange-700")}>
                Ladder rungs covered for Solo DM
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}