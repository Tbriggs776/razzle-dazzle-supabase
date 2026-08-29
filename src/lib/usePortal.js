import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { unwrapInvoke } from '@/lib/invokeResult';

/**
 * Is this login a subcontractor, and are they their company's owner?
 *
 * Answered by my_portal_context() (0096) because the CLIENT cannot tell the
 * difference on its own: a crew login holds zero staff modules, which is exactly
 * what a brand-new employee with nothing granted also looks like. One means "send
 * them to the portal", the other means "ask an admin to grant you something".
 *
 * Cached for the session — the answer changes only when someone's roster row
 * changes, which is not something to re-ask on every render. Never retried: a
 * failure here should surface, not spin.
 */
export function usePortalContext() {
  return useQuery({
    queryKey: ['portalContext'],
    queryFn: async () => unwrapInvoke(await base44.functions.invoke('myPortalContext')),
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
