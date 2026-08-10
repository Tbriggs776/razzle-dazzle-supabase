import React from 'react';
import { cn } from '@/lib/utils';

// Standard responsive page shell. base44 boxed most screens into a narrow centered
// column (max-w-2xl/4xl) that wastes desktop width; this centralizes the content width
// + fluid padding so every screen uses the viewport well on desktop and stays dialed on
// mobile. Tune the whole app's density here in ONE place.
//
//   width="wide"    data-dense screens: lists, tables, dashboards, reports (fill the screen)
//   width="default" mixed content, medium forms
//   width="narrow"  single-record reading views, focused forms, customer-facing pages
//
// Vertical rhythm + horizontal gutters scale with the breakpoint. `as` lets a page use
// <main>/<section> semantics; extra classes merge in.
const WIDTHS = {
  wide: 'max-w-screen-2xl',   // ~1536px — dense data uses the whole desktop
  default: 'max-w-6xl',       // ~1152px
  narrow: 'max-w-3xl',        // ~768px — comfortable reading measure
};

export default function PageContainer({ children, width = 'wide', className, as: Tag = 'div', ...rest }) {
  return (
    <Tag
      className={cn('mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-6 lg:py-8', WIDTHS[width] || WIDTHS.wide, className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
