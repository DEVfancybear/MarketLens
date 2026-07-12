"use client";
import { forwardRef } from "react";
import { cn } from "@/utils/cn";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label?: string;
  size?: "sm" | "md";
}

/** Square toolbar button with active state and tooltip-on-title. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(
  function IconButton(
    { active, label, size = "md", className, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={rest.type ?? "button"}
        title={label}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        data-ui="icon-button"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-ink-muted transition-[color,background-color,border-color,box-shadow] focus-ring",
          "hover:bg-terminal-hover hover:text-ink active:bg-terminal-pressed disabled:pointer-events-none",
          size === "sm" ? "h-8 w-8" : "h-9 w-9",
          active && "border-brand/30 bg-brand-soft text-brand shadow-[inset_0_1px_0_var(--panel-highlight)] hover:border-brand/45 hover:bg-brand/20 hover:text-brand",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
