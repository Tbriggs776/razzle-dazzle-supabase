import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { 
  CalendarIcon, 
  Clock,
  Download,
  Loader2,
  CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function OrderProcessorTools({ 
  project, 
  projectId, 
  sale, 
  onSetInstallationClick, 
  onRescheduleClick,
  currentUser 
}) {
  const queryClient = useQueryClient();
  const [updatingStatus, setUpdatingStatus] = useState(null);

  const updateProjectMutation = useMutation({
    mutationFn: async (updates) => {
      const previousStatus = project.status;
      await base44.entities.Project.update(projectId, updates);
      
      // Log status changes to activity log
      if (updates.status && updates.status !== previousStatus) {
        await base44.entities.ProjectLog.create({
          project: projectId,
          action: 'Status Changed',
          details: `Status changed from ${previousStatus} to ${updates.status}`,
          user_email: currentUser?.email,
          user_name: currentUser?.full_name
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projectLogs', projectId] });
      setUpdatingStatus(null);
    }
  });

  return (
    <div className="space-y-3">
      {!project.installation_date && (
        <Button
          onClick={onSetInstallationClick}
          variant="outline"
          className="w-full border-blue-200 text-blue-600 hover:bg-blue-50"
        >
          <CalendarIcon className="w-4 h-4 mr-2" />
          Set Installation Date
        </Button>
      )}
      {project.installation_date && (
        <Button
          onClick={onRescheduleClick}
          variant="outline"
          className="w-full border-yellow-200 text-yellow-600 hover:bg-yellow-50"
        >
          <Clock className="w-4 h-4 mr-2" />
          Reschedule Installation
        </Button>
      )}
      {sale?.contract_file_url && (
        <Button
          onClick={() => window.open(sale.contract_file_url, '_blank')}
          variant="outline"
          className="w-full border-indigo-200 text-indigo-600 hover:bg-indigo-50"
        >
          <Download className="w-4 h-4 mr-2" />
          Download Contract
        </Button>
      )}
      <Button
        onClick={() => updateProjectMutation.mutate({ status: 'Materials Ordered' })}
        disabled={updateProjectMutation.isPending || project.status === 'Materials Ordered'}
        className="w-full bg-purple-600 hover:bg-purple-700"
      >
        {updateProjectMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Updating...
          </>
        ) : (
          'Mark Materials Ordered'
        )}
      </Button>

      {/* Installation Status Buttons */}
      {project.installation_date && (
        <div className="pt-3 border-t border-slate-200 space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase">Installation Status</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => {
                setUpdatingStatus('pending payment');
                updateProjectMutation.mutate({ installation_date_status: 'pending payment' });
              }}
              disabled={updateProjectMutation.isPending}
              variant="outline"
              size="sm"
              className="border-orange-200 text-orange-600 hover:bg-orange-50"
            >
              {updatingStatus === 'pending payment' && updateProjectMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Updating...
                </>
              ) : project.installation_date_status === 'pending payment' ? (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Pending Payment
                </>
              ) : (
                'Pending Payment'
              )}
            </Button>
            <Button
              onClick={() => {
                setUpdatingStatus('pending contract');
                updateProjectMutation.mutate({ installation_date_status: 'pending contract' });
              }}
              disabled={updateProjectMutation.isPending}
              variant="outline"
              size="sm"
              className="border-orange-200 text-orange-600 hover:bg-orange-50"
            >
              {updatingStatus === 'pending contract' && updateProjectMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Updating...
                </>
              ) : project.installation_date_status === 'pending contract' ? (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Pending Contract
                </>
              ) : (
                'Pending Contract'
              )}
            </Button>
            <Button
              onClick={() => {
                setUpdatingStatus('on hold');
                updateProjectMutation.mutate({ installation_date_status: 'on hold' });
              }}
              disabled={updateProjectMutation.isPending}
              variant="outline"
              size="sm"
              className="border-orange-200 text-orange-600 hover:bg-orange-50"
            >
              {updatingStatus === 'on hold' && updateProjectMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Updating...
                </>
              ) : project.installation_date_status === 'on hold' ? (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  On Hold
                </>
              ) : (
                'On Hold'
              )}
            </Button>
            <Button
              onClick={() => {
                setUpdatingStatus('pending cancellation');
                updateProjectMutation.mutate({ installation_date_status: 'pending cancellation' });
              }}
              disabled={updateProjectMutation.isPending}
              variant="outline"
              size="sm"
              className="border-red-200 text-red-600 hover:bg-red-50"
            >
              {updatingStatus === 'pending cancellation' && updateProjectMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Updating...
                </>
              ) : project.installation_date_status === 'pending cancellation' ? (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Pending Cancellation
                </>
              ) : (
                'Pending Cancellation'
              )}
            </Button>
            <Button
              onClick={() => {
                setUpdatingStatus('clear');
                updateProjectMutation.mutate({ installation_date_status: '' });
              }}
              disabled={updateProjectMutation.isPending}
              variant="outline"
              size="sm"
              className="border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              {updatingStatus === 'clear' && updateProjectMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Clearing...
                </>
              ) : !project.installation_date_status ? (
                <>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Clear Status
                </>
              ) : (
                'Clear Status'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}