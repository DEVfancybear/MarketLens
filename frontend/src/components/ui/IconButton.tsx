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
        title={label}
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center rounded text-ink-muted transition-colors focus-ring",
          "hover:bg-terminal-hover hover:text-ink",
          size === "sm" ? "h-7 w-7" : "h-9 w-9",
          active && "bg-brand/15 text-brand hover:bg-brand/20 hover:text-brand",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
