import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';
import { usePortalContext } from '@/lib/usePortal';

/**
 * The module route guard, on its own.
 *
 * It used to live inside Layout, which meant a page was protected only if it
 * happened to render inside LayoutWrapper. /Journey and /JourneyProjectDetail
 * replace the app chrome entirely, so they rendered bare — and a user holding
 * only the appointments module could type the URL and get the full Journey page,
 * map, calendar and Manager View.
 *
 * Access control should not be a side effect of which chrome a page uses. Wrapping
 * a route in this makes the intent explicit and survives someone later adding
 * another chrome-less route.
 *
 * RLS remains the real enforcement — this is the clean "no access" screen rather
 * than an empty page. Anything this guard misses is still refused by the database.
 */
export default function RequirePage({ pageKey, allowInstaller = false, children }) {
  const { access } = useAuth();
  // Subcontractors hold no staff modules by design, so the page-key test can only
  // ever deny them. `allowInstaller` marks the pages that are theirs to open —
  // today just the job detail their portal links into. RLS still decides which
  // rows they see there; this only stops the guard slamming the door first.
  const { data: portal, isLoading: portalLoading } = usePortalContext();

  const allowedPageKeys = React.useMemo(() => {
    const s = new Set();
    (access?.modules || []).forEach((m) => (m.pages || []).forEach((p) => s.add(p.key)));
    return s;
  }, [access]);

  // `access` is undefined while it loads. Render the page rather than flashing a
  // denial at someone who is in fact allowed — the same order Layout uses.
  if (!access || !pageKey || allowedPageKeys.has(pageKey)) {
    return children;
  }
  if (allowInstaller && (portalLoading || portal?.is_installer)) {
    return children;
  }

  const home = portal?.is_installer
    ? 'Portal'
    : access?.modules?.[0]?.pages?.[0]?.key || 'Dashboard';
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <ShieldCheck className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="mb-2 text-xl font-bold text-foreground">No access to this page</h1>
        <p className="mb-6 text-muted-foreground">
          Your role doesn&apos;t include this area. Contact an administrator if you
          think this is a mistake.
        </p>
        <Link
          to={createPageUrl(home)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
        >
          Go to my workspace
        </Link>
      </div>
    </div>
  );
}
