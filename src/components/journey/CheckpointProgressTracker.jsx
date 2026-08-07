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
            <button
              onClick={() => unlocked && onStepClick?.(step.key)}
              disabled={!unlocked}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-sm font-medium shrink-0",
                isActive && "ring-2 ring-indigo-400",
                state === 'completed' && "bg-green-50 text-green-700",
                state === 'in_progress' && "bg-blue-50 text-blue-700",
                state === 'pending_approval' && "bg-amber-50 text-amber-700",
                state === 'rejected' && "bg-red-50 text-red-700",
                state === 'locked' && unlocked && "bg-slate-100 text-slate-600 hover:bg-slate-200",
                state === 'locked' && !unlocked && "bg-slate-50 text-slate-300 cursor-not-allowed"
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
              <ArrowRight className={cn("w-4 h-4 shrink-0", state === 'completed' ? 'text-green-400' : state === 'in_progress' ? 'text-blue-400' : 'text-slate-300')} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}