"use client";
import { forwardRef } from "react";
import { cn } from "@/utils/cn";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label?: string;
  size?: "sm" | "md";
}

/** Token-driven icon control shared by every desktop terminal surface. */
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
          "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-ink-muted transition-[background-color,color,border-color,box-shadow] focus-ring",
          "hover:border-terminal-border hover:bg-terminal-hover hover:text-ink active:bg-terminal-pressed",
          size === "sm" ? "h-8 w-8" : "h-9 w-9",
          active && "border-brand/25 bg-brand/10 text-brand hover:border-brand/35 hover:bg-brand/15 hover:text-brand",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
