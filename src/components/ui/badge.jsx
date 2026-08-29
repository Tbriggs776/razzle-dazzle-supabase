import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        // Semantic soft fills — status color, kept separate from the pink brand accent.
        //
        // Opacity MUST be a multiple of 5. Tailwind v3's opacity scale has no 12,
        // so the previous `bg-good/12` compiled to NOTHING and good/crit/info
        // rendered as bare coloured text with no pill fill — app-wide, in every
        // module, since the kit shipped. Only `warn` looked right because it
        // happened to use /15. Verified against the built stylesheet, not by eye.
        good: "border-transparent bg-good/15 text-good",
        warn: "border-transparent bg-warn/15 text-warn",
        crit: "border-transparent bg-crit/15 text-crit",
        info: "border-transparent bg-info/15 text-info",
        neutral: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}) {
  return (<div className={cn(badgeVariants({ variant }), className)} {...props} />);
}

export { Badge, badgeVariants }
