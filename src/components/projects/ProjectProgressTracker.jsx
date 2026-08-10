import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const statusSteps = [
  'Accepted',
  'Scheduled',
  'Materials Ordered',
  'In Progress',
  'Quality Checks',
  'Completed'
];

export default function ProjectProgressTracker({ project, projectLogs = [] }) {
  let displayStatus = project.status;
  if (project.status === 'Accepted' && project.installation_date) {
    displayStatus = 'Scheduled';
  }
  const currentStepIndex = statusSteps.indexOf(displayStatus);

  const getStatusTimestamp = (step) => {
    if (step === 'Accepted') {
      return project.created_date
        ? new Date(project.created_date)
        : null;
    }
    const log = projectLogs
      .filter(l => l.action && l.action.toLowerCase().includes(step.toLowerCase()))
      .sort((a, b) => new Date(a.created_date) - new Date(b.created_date))[0];
    return log?.created_date
      ? new Date(log.created_date)
      : null;
  };

  return (
    <div className="bg-white rounded-xl p-6 border border-slate-100">
      <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider text-center mb-8">
        Project Progress
      </h2>
      <div className="relative">
        {/* Progress Line */}
        <div className="absolute top-5 left-0 right-0 h-1 bg-slate-200">
          <div
            className="h-full bg-indigo-600 transition-all duration-500"
            style={{ width: `${(currentStepIndex / (statusSteps.length - 1)) * 115}%` }}
          />
        </div>

        {/* Steps */}
        <div className="relative flex justify-between">
          {statusSteps.map((step, index) => {
            const isCompleted = index < currentStepIndex;
            const isCurrent = index === currentStepIndex;
            const isScheduled = step === 'Scheduled';
            const timestamp = (isCompleted || isCurrent) ? getStatusTimestamp(step) : null;

            return (
              <div key={step} className="flex flex-col items-center" style={{ width: `${100 / statusSteps.length}%` }}>
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border-4 border-white",
                  isCompleted || isCurrent ? "bg-indigo-600" : "bg-slate-200"
                )}>
                  {isCompleted || isCurrent ? (
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                <p className={cn(
                  "mt-3 text-xs font-medium text-center px-1",
                  isCurrent ? "text-indigo-600" : isCompleted ? "text-slate-700" : "text-slate-400"
                )}>
                  {step}
                </p>
                {timestamp && (
                  <p className="mt-0.5 text-[10px] text-slate-400 text-center px-1 leading-tight">
                    {format(timestamp, 'M/d/yy h:mm a')}
                  </p>
                )}
                {isScheduled && project.installation_date && (
                  <div className="mt-1 text-center">
                    <p className="text-xs text-slate-500">
                      {format(new Date(project.installation_date + 'T00:00:00'), 'MMM d')}
                    </p>
                    {project.installation_date_status && (
                      <p className="text-xs text-red-600 font-medium mt-0.5">
                        {project.installation_date_status}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}