import { QueryClient, MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';

// Global fallback so a failed WRITE never fails silently. The base44-ported pages define
// onSuccess but mostly omit onError, so a rejected create/update/delete (RLS denial,
// validation, network) previously showed the user nothing. This surfaces a toast for any
// mutation error the mutation didn't already handle itself — mutations with their own
// onError still win (no double toast). Graceful { stub } degrade is unaffected (it resolves,
// it doesn't reject).
export const queryClientInstance = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation?.options?.onError) return; // handled locally
      const msg = error?.message || 'Something went wrong saving your changes. Please try again.';
      try { toast.error(msg); } catch (_) { /* toaster not mounted (SSR/tests) */ }
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
