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
    <section className={cn("flex h-full flex-col bg-terminal-panel", className)}>
      {(title || actions) && (
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-terminal-border px-4">
          <span className="text-xs font-semibold tracking-[-0.01em] text-ink">
            {title}
          </span>
          <div className="flex items-center gap-1">{actions}</div>
        </div>
      )}
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
