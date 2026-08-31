import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { graphFromRows } from '@/lib/ops/flow';

/**
 * The published stage graph + the SQL classifier's verdicts, together.
 *
 * Every board that classifies jobs goes through this hook: ops_stage /
 * ops_department are the published identity (label, owner, SLA, tone), and
 * job_stage is the ONLY stage derivation in the system. There is no client-side
 * fallback on purpose — `error` is set when either half cannot load, and the
 * page must show that instead of a silently stale board.
 */
export function usePublishedFlow() {
  const stagesQ = useQuery({
    queryKey: ['ops', 'publishedStages'],
    // Explicit sort: ops_stage has no created_date — the client's default
    // '-created_date' orderBy would 400 (42703) and kill every board.
    queryFn: () => base44.entities.OpsStage.list('sort_order'),
    staleTime: 5 * 60 * 1000,
  });
  const deptsQ = useQuery({
    queryKey: ['ops', 'publishedDepartments'],
    queryFn: () => base44.entities.OpsDepartment.list('sort_order'),
    staleTime: 5 * 60 * 1000,
  });
  const viewQ = useQuery({
    queryKey: ['ops', 'jobStageRows'],
    // The classifier view also has no created_date; sale_id is a real column.
    queryFn: () => base44.entities.JobStage.list('sale_id'),
    staleTime: 30000,
  });

  const graph = useMemo(
    () => graphFromRows(stagesQ.data, deptsQ.data),
    [stagesQ.data, deptsQ.data]
  );

  const isLoading = stagesQ.isLoading || deptsQ.isLoading || viewQ.isLoading;
  const error =
    stagesQ.error || deptsQ.error || viewQ.error ||
    (!isLoading && !graph ? new Error('No published flow graph — publish one from Edit flow') : null);

  return {
    graph,
    stageRows: viewQ.data ?? null,
    isLoading,
    error,
    refetch: () => { stagesQ.refetch(); deptsQ.refetch(); viewQ.refetch(); },
  };
}
