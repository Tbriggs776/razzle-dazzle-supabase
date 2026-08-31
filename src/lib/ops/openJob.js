import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

/**
 * "Take me to this job."
 *
 * Every operations board shows the same handful of real things — a job, a
 * blocker sitting on a job, an exception raised against a project, a claim —
 * and clicking any of them should land on the record behind it. The catch is
 * that those rows come from three different builders with three different
 * shapes:
 *
 *   flow.js classifyJob()     -> { projectId, saleId, ... }
 *   metrics.js board/queue    -> { id, ... }  where `id` is a PROJECT on the
 *                                install board and a SALE on the ordering queue
 *   WorkflowException         -> { subject_type, subject_id }
 *
 * Copying JobFlow's two-line handler onto a page fed by a different builder
 * compiles, renders, and then silently does nothing on every click, because
 * `row.projectId` is simply undefined. That is the bug this file exists to make
 * impossible: the builders now all emit projectId/saleId, and every board uses
 * this one resolver.
 *
 * WHERE A CLAIM GOES. There is no claim detail page — ClaimsDashboard reads no
 * URL parameters at all, so `?id=` would be ignored and drop you on the
 * unfiltered list. A claim opens the PROJECT it belongs to, which is where the
 * claims section lives; that is also what ClaimsDashboard's own "open" link
 * does. Ordering is the same story in reverse: OrderProcessing takes no params,
 * so an ordering row opens its sale, not the ordering desk.
 */

/** Resolve a row to a URL, or null when there is nothing to open. */
export function jobHref(row) {
  if (!row) return null;

  // A workflow exception names its subject explicitly. subject_id alone does
  // not say which table it points at, so trust it only when it says 'project'.
  if (row.subject_type && row.subject_id) {
    return row.subject_type === 'project'
      ? createPageUrl('ProjectDetail') + `?id=${row.subject_id}`
      : null;
  }

  // A blocker carries the job it sits on.
  const job = row.job || row;

  const projectId = job.projectId ?? job.project ?? null;
  if (projectId) return createPageUrl('ProjectDetail') + `?id=${projectId}`;

  const saleId = job.saleId ?? null;
  if (saleId) return createPageUrl('SaleDetail') + `?id=${saleId}`;

  return null;
}

/** True when a row has somewhere to go — use it to avoid dead click targets. */
export const canOpenJob = (row) => jobHref(row) !== null;

/**
 * Navigate to a row's record. Does nothing (rather than navigating somewhere
 * arbitrary) when the row has no project or sale behind it.
 */
export function useOpenJob() {
  const navigate = useNavigate();
  return useCallback(
    (row) => {
      const href = jobHref(row);
      if (href) navigate(href);
    },
    [navigate]
  );
}
