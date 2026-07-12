"use client";
import { cn } from "@/utils/cn";

/** A titled panel surface used throughout the bottom/right docks. */
export function Panel({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex h-full flex-col bg-terminal-panel", className)}>
      {(title || actions) && (
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-terminal-border bg-terminal-panel-2/45 px-3.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">
            {title}
          </span>
          <div className="flex items-center gap-1">{actions}</div>
        </div>
      )}
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>
        {children}
      </div>
    </div>
  );
}
