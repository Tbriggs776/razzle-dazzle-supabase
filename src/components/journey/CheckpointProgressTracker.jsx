import React from 'react';
import { Check, Clock, AlertCircle, Lock, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = [
  { key: 'pre_install_checklist', label: 'Job Brief', short: 'JB' },
  { key: 'job_start_checklist', label: 'Job Start', short: 'JSC' },
  { key: 'floor_prep_checklist', label: 'Floor Prep', short: 'FPC' },
  { key: 'installation_checklist', label: 'Install', short: 'INST' },
  { key: 'final_walkthrough_checklist', label: 'Final Walk', short: 'FWC' },
];

export default function CheckpointProgressTracker({ checkpoints, activeStep, onStepClick, preInstallComplete }) {
  const getCheckpoint = (stepKey) => checkpoints.find(c => c.step_key === stepKey);

  const getStepState = (index) => {
    const step = STEPS[index];
    const cp = getCheckpoint(step.key);
    if (step.key === 'pre_install_checklist' && preInstallComplete) return 'completed';
    if (!cp || cp.status === 'Pending') return 'locked';
    if (cp.status === 'Completed') return 'completed';
    if (cp.status === 'PrepApproved') return 'in_progress';
    if (cp.status === 'SubmittedForApproval') return 'pending_approval';
    if (cp.status === 'Rejected') return 'rejected';
    return 'locked';
  };

  // A step is unlocked if the previous step is completed
  const isUnlocked = (index) => {
    if (index === 0) return true;
    return getStepState(index - 1) === 'completed';
  };

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, index) => {
        const state = getStepState(index);
        const unlocked = isUnlocked(index);
        const isActive = activeStep === step.key;

        return (
          <React.Fragment key={step.key}>
            {/* Each step is an interactive, disable-able control, so the tones stay as
                hand-rolled classes on the <button> rather than a StatusPill — StatusPill
                renders a Badge <div> and cannot carry onClick/disabled. The good/info/
                warn/crit tokens below are the same ones StatusPill's tones resolve to. */}
            <button
              onClick={() => unlocked && onStepClick?.(step.key)}
              disabled={!unlocked}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-sm font-medium shrink-0",
                isActive && "ring-2 ring-primary",
                // Opacity modifiers must be multiples of 5 — Tailwind emits no rule for
                // /12, which would leave these three states with no fill at all.
                state === 'completed' && "bg-good/15 text-good",
                state === 'in_progress' && "bg-info/15 text-info",
                state === 'pending_approval' && "bg-warn/15 text-warn",
                state === 'rejected' && "bg-crit/15 text-crit",
                state === 'locked' && unlocked && "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground",
                state === 'locked' && !unlocked && "bg-muted/50 text-muted-foreground/50 cursor-not-allowed"
              )}
            >
              {state === 'completed' && <Check className="w-4 h-4" />}
              {state === 'in_progress' && <Clock className="w-4 h-4" />}
              {state === 'pending_approval' && <Clock className="w-4 h-4" />}
              {state === 'rejected' && <AlertCircle className="w-4 h-4" />}
              {state === 'locked' && !unlocked && <Lock className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{step.label}</span>
              <span className="sm:hidden">{step.short}</span>
            </button>
            {index < STEPS.length - 1 && (
              <ArrowRight className={cn("w-4 h-4 shrink-0", state === 'completed' ? 'text-good/70' : state === 'in_progress' ? 'text-info/70' : 'text-muted-foreground/40')} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}