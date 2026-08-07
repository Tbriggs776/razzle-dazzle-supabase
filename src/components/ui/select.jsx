import * as React from "react"
import * as ReactDOM from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const SelectContext = React.createContext({});

function Select({ value, defaultValue, onValueChange, children, disabled }) {
  const [open, setOpen] = React.useState(false);
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const [triggerRect, setTriggerRect] = React.useState(null);
  const [labelMap, setLabelMap] = React.useState({});
  const controlled = value !== undefined;
  const currentValue = controlled ? value : internalValue;
  const containerRef = React.useRef(null);

  const registerLabel = React.useCallback((val, label) => {
    setLabelMap(prev => {
      if (prev[val] === label) return prev;
      return { ...prev, [val]: label };
    });
  }, []);

  React.useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        // Also check if click is inside the portal dropdown
        const portal = document.getElementById('select-portal');
        if (portal && portal.contains(e.target)) return;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSelect = (val) => {
    if (!controlled) setInternalValue(val);
    onValueChange?.(val);
    setOpen(false);
  };

  const handleOpen = (rect) => {
    setTriggerRect(rect);
    setOpen(true);
  };

  return (
    <SelectContext.Provider value={{ open, setOpen, handleOpen, triggerRect, currentValue, handleSelect, disabled, containerRef, labelMap, registerLabel }}>
      <div ref={containerRef} className="relative w-full">
        {children}
      </div>
    </SelectContext.Provider>
  );
}

function SelectGroup({ children }) {
  return <div>{children}</div>;
}

function SelectValue({ placeholder }) {
  const { currentValue, labelMap } = React.useContext(SelectContext);
  const displayLabel = currentValue ? (labelMap[currentValue] ?? currentValue) : null;
  return (
    <span className={cn("block truncate", !displayLabel && "text-muted-foreground")}>
      {displayLabel || placeholder || "Select..."}
    </span>
  );
}

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => {
  const { open, setOpen, handleOpen, disabled } = React.useContext(SelectContext);
  const btnRef = React.useRef(null);

  const handleClick = () => {
    if (disabled) return;
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect();
      handleOpen(rect);
    } else {
      setOpen(false);
    }
  };

  return (
    <button
      ref={(node) => {
        btnRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      type="button"
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform flex-shrink-0", open && "rotate-180")} />
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

const SelectContent = React.forwardRef(({ className, children, ...props }, ref) => {
  const { open, triggerRect } = React.useContext(SelectContext);

  const style = {
    position: 'fixed',
    top: triggerRect ? triggerRect.bottom + 4 : 0,
    left: triggerRect ? triggerRect.left : 0,
    width: triggerRect ? triggerRect.width : 0,
    zIndex: 9999,
  };

  return (
    <>
      {/* Always render hidden children so SelectItems can register their labels */}
      <div style={{ display: 'none' }}>{children}</div>

      {/* Visible portal when open */}
      {open && triggerRect && ReactDOM.createPortal(
        <div
          id="select-portal"
          ref={ref}
          style={style}
          className={cn(
            "max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
            className
          )}
          {...props}
        >
          <div className="p-1">{children}</div>
        </div>,
        document.body
      )}
    </>
  );
});
SelectContent.displayName = "SelectContent";

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-2 py-1.5 text-sm font-semibold", className)} {...props} />
));
SelectLabel.displayName = "SelectLabel";

const SelectItem = React.forwardRef(({ className, children, value, disabled, ...props }, ref) => {
  const { handleSelect, currentValue, registerLabel } = React.useContext(SelectContext);
  const selected = currentValue === value;

  React.useEffect(() => {
    if (value !== undefined && value !== null && children !== undefined) {
      let label = null;
      if (typeof children === 'string') {
        label = children;
      } else if (Array.isArray(children)) {
        label = children.map(c => (typeof c === 'string' || typeof c === 'number') ? c : '').join('');
      }
      if (label && label.trim()) registerLabel(value, label.trim());
    }
  }, [value, children, registerLabel]);

  return (
    <div
      ref={ref}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) handleSelect(value);
      }}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
        selected && "bg-accent text-accent-foreground",
        disabled && "pointer-events-none opacity-50",
        className
      )}
      {...props}
    >
      {selected && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
          <Check className="h-4 w-4" />
        </span>
      )}
      {children}
    </div>
  );
});
SelectItem.displayName = "SelectItem";

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
SelectSeparator.displayName = "SelectSeparator";

function SelectScrollUpButton() { return null; }
function SelectScrollDownButton() { return null; }
// v2

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}