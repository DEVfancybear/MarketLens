"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

/** Click-to-open popover anchored under its trigger. */
export function Dropdown({
  trigger,
  children,
  align = "left",
  width,
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" data-chart-ui ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open && (
        <div
          data-chart-ui
          className={cn(
            "absolute top-full z-50 mt-1 rounded-md border border-terminal-border bg-terminal-panel-2 py-1 shadow-xl shadow-black/40",
            align === "right" ? "right-0" : "left-0",
          )}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover",
        active && "text-brand",
        className,
      )}
    >
      {children}
    </button>
  );
}
