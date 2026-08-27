import React from 'react';
import { cn } from '@/lib/utils';
import logoUrl from '@/assets/floordaddy-logo.webp';

// The official Floor Daddy horizontal mark (mascot + wordmark, transparent bg), cropped
// from floordaddy.com's header logo (tagline strip removed — kept as live text where wanted).
// "FLOOR" is brand navy, so on a dark surface it needs a light backing: dark mode gets a
// subtle white plate; light mode shows the mark natively on the (white) header. Size via
// `imgClassName` (height), align/space the plate via `className`.
// `onDark`: force the white plate regardless of theme (e.g. the always-navy nav rail).
export default function BrandLogo({ className, imgClassName = 'h-10', plate = true, onDark = false }) {
  return (
    <span
      className={cn(
        'inline-flex items-center',
        plate && (onDark
          ? 'bg-white rounded-lg px-2.5 py-1.5 shadow-sm'
          : 'dark:bg-white dark:rounded-lg dark:px-2.5 dark:py-1.5 dark:shadow-sm'),
        className
      )}
    >
      <img
        src={logoUrl}
        alt="Floor Daddy — Sexy Flooring, Affordable Prices, Quality Install"
        className={cn('w-auto object-contain', imgClassName)}
      />
    </span>
  );
}
