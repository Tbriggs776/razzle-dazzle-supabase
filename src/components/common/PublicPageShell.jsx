import React from 'react';
import { cn } from '@/lib/utils';
import BrandLogo from '@/components/BrandLogo';

/**
 * The shell for a page rendered OUTSIDE the app.
 *
 * WHY THIS EXISTS. Four pages -- SignDocument, LeadAppointmentView,
 * CustomerProjectView, InstallerApply -- each hand-rolled a near-identical header:
 * `min-h-screen bg-background`, a `border-b bg-card` bar, a BrandLogo, an uppercase
 * eyebrow, a centred `max-w-*` main. Four copies of one idea, drifting apart, and
 * every one of them put the logo on a WHITE bar. The mark was present; the brand
 * never was. That is the whole reason these pages read as generic.
 *
 * The design system's Wave 6 was meant to cover them and was never built. Nothing
 * ever said what an unshelled public page should look like, so nothing was wrong --
 * there was just no standard to be wrong about. This is that standard.
 *
 * WHO SEES THESE PAGES. Not employees. A customer tracking an install, opening a
 * link from a text message, on a phone, having just been on floordaddy.com. A
 * subcontractor on a driveway in the sun. They have no app chrome, no nav, no
 * context -- this masthead is the entire answer to "whose page is this and is it
 * real?", and on the screens where something has gone wrong it is worth the most.
 *
 * THE MASTHEAD IS NAVY, deliberately. Navy is what dominates floordaddy.com
 * (#1c244b, 25 declarations; see docs/brand-reference.md) and it is what makes a
 * white page feel like Floor Daddy rather than like a form. BrandLogo needs
 * `onDark` on it or the navy "FLOOR" wordmark disappears into the bar.
 *
 * PINK IS NOT USED HERE. One accent per view, and on these pages it belongs to
 * whatever the page is asking the person to do -- sign, book, submit. The shell
 * must not spend it first.
 */
export default function PublicPageShell({
  eyebrow,
  aside,
  width = 'narrow',      // 'narrow' = forms and documents · 'wide' = trackers with detail
  sticky = false,        // long scrolling forms want the mark to stay put
  footer = true,
  className,
  children,
}) {
  const rail = width === 'wide' ? 'max-w-4xl' : 'max-w-2xl';

  return (
    <div className={cn('flex min-h-screen flex-col bg-background text-foreground', className)}>
      <header className={cn('bg-sidebar', sticky && 'sticky top-0 z-20')}>
        <div className={cn('mx-auto flex items-center justify-between gap-3 px-4 py-3 sm:px-6', rail)}>
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo imgClassName="h-7 sm:h-8" onDark />
            {eyebrow && (
              <span className="hidden truncate font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground sm:inline">
                {eyebrow}
              </span>
            )}
          </div>
          {aside && (
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-sidebar-foreground">{aside}</div>
          )}
        </div>
        {/* The eyebrow moves under the mark on a phone rather than being dropped --
            "Secure document signing" is reassurance, and reassurance is worth more
            on the small screen, not less. */}
        {eyebrow && (
          <div className={cn('mx-auto px-4 pb-2.5 sm:hidden', rail)}>
            <span className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground">
              {eyebrow}
            </span>
          </div>
        )}
      </header>

      <main className={cn('mx-auto w-full flex-1 px-4 py-6 sm:px-6 sm:py-8', rail)}>{children}</main>

      {footer && (
        <footer className={cn('mx-auto w-full px-4 pb-8 pt-2 sm:px-6', rail)}>
          <p className="text-center text-xs text-muted-foreground">
            Floor Daddy · Sexy Flooring, Affordable Prices, Quality Install
          </p>
        </footer>
      )}
    </div>
  );
}
