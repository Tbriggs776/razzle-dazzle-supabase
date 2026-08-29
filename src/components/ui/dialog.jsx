import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Hand-rolled dialog, with the accessibility behaviour it was missing.
 *
 * @radix-ui/react-dialog IS a dependency and would provide all of this for free,
 * but swapping to it means changing the contract for ~90 DialogContent call sites
 * at once. The behaviours below are what a user actually notices, and they can be
 * added without touching a single call site, so they were — the swap remains
 * available later as a clean, separately-verifiable change.
 *
 * What was missing and is now here:
 *   - Escape closes it. Previously the only way out was the X or the overlay,
 *     which is a problem on a keyboard and a bigger one for anyone who cannot
 *     use a mouse at all.
 *   - Focus is trapped. Tab used to walk straight out of the dialog and into the
 *     page behind it, so a keyboard user ended up operating a form they could not
 *     see, underneath a modal they could not close.
 *   - Focus is restored to whatever opened the dialog. Without it, focus fell back
 *     to the top of the document on every close.
 *   - role="dialog" + aria-modal + aria-labelledby, so a screen reader announces
 *     it as a dialog and reads its title rather than dumping the page.
 *
 * The `max-h-[90vh] overflow-y-auto` in the base class is load-bearing and
 * deliberately preserved: it is what stops a tall form pushing its own submit
 * button off a short screen.
 */

const DialogContext = React.createContext({});

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function Dialog({ open, onOpenChange, defaultOpen = false, children }) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : internalOpen;
  const titleId = React.useId();

  const setOpen = (val) => {
    if (!controlled) setInternalOpen(val);
    onOpenChange?.(val);
  };

  // Lock body scroll when open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  return (
    <DialogContext.Provider value={{ isOpen, setOpen, titleId }}>
      {children}
    </DialogContext.Provider>
  );
}

function DialogTrigger({ children, asChild }) {
  const { setOpen } = React.useContext(DialogContext);
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { onClick: () => setOpen(true) });
  }
  return <button type="button" onClick={() => setOpen(true)}>{children}</button>;
}

function DialogPortal({ children }) {
  return children;
}

function DialogOverlay({ className, ...props }) {
  const { setOpen } = React.useContext(DialogContext);
  return (
    <div
      className={cn("fixed inset-0 z-50 bg-black/80 animate-in fade-in-0", className)}
      onClick={() => setOpen(false)}
      {...props}
    />
  );
}

function DialogClose({ children, asChild, className, ...props }) {
  const { setOpen } = React.useContext(DialogContext);
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { onClick: () => setOpen(false) });
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => setOpen(false)}
      {...props}
    >
      {children}
    </button>
  );
}

const DialogContent = React.forwardRef(({ className, children, ...props }, ref) => {
  const { isOpen, setOpen, titleId } = React.useContext(DialogContext);
  const localRef = React.useRef(null);
  const restoreRef = React.useRef(null);

  // Merge our ref with any forwarded one, since we need the node ourselves.
  const setRefs = React.useCallback((node) => {
    localRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  // Remember what had focus, move focus into the dialog, and put it back on close.
  React.useEffect(() => {
    if (!isOpen) return undefined;
    restoreRef.current = document.activeElement;
    // Focus the container rather than the first control: focusing whatever
    // happens to be first can land on a destructive button, and the container
    // still announces the dialog to a screen reader.
    localRef.current?.focus?.();
    return () => {
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [isOpen]);

  // Escape to close, and Tab kept inside.
  React.useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const node = localRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) { e.preventDefault(); node.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, setOpen]);

  if (!isOpen) return null;
  return (
    <>
      <DialogOverlay />
      <div
        ref={setRefs}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid max-h-[90vh] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto border bg-background p-6 shadow-lg outline-none sm:rounded-lg animate-in fade-in-0 zoom-in-95 slide-in-from-left-1/2 slide-in-from-top-[48%]",
          className
        )}
        onClick={(e) => e.stopPropagation()}
        {...props}
      >
        {children}
        <button
          type="button"
          aria-label="Close"
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
    </>
  );
});
DialogContent.displayName = "DialogContent";

function DialogHeader({ className, ...props }) {
  return (
    <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
  );
}
DialogHeader.displayName = "DialogHeader";

function DialogFooter({ className, ...props }) {
  return (
    <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
  );
}
DialogFooter.displayName = "DialogFooter";

// Takes the generated id so DialogContent's aria-labelledby resolves. An explicit
// id on the call site still wins.
const DialogTitle = React.forwardRef(({ className, id, ...props }, ref) => {
  const { titleId } = React.useContext(DialogContext);
  return (
    <h2
      ref={ref}
      id={id || titleId}
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
});
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
