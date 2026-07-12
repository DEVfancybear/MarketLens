"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

interface DropdownPosition {
  left: number;
  top: number;
}

/** Click-to-open popover anchored under its trigger. */
export function Dropdown({
  trigger,
  children,
  align = "left",
  width,
  scrollMode = "menu",
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  width?: number;
  scrollMode?: "menu" | "content";
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition>({ left: 8, top: 8 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const triggerElement = triggerRef.current;
    if (!triggerElement) return;

    const triggerRect = triggerElement.getBoundingClientRect();
    const menuWidth = width ?? menuRef.current?.offsetWidth ?? triggerRect.width;
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const viewportPadding = 8;
    const gap = 4;
    const preferredLeft = align === "right"
      ? triggerRect.right - menuWidth
      : triggerRect.left;
    const left = Math.min(
      Math.max(viewportPadding, preferredLeft),
      Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding),
    );
    const fitsBelow = triggerRect.bottom + gap + menuHeight <= window.innerHeight - viewportPadding;
    const top = fitsBelow || menuHeight === 0
      ? triggerRect.bottom + gap
      : Math.max(viewportPadding, triggerRect.top - menuHeight - gap);

    setPosition({ left, top });
  }, [align, width]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.querySelector<HTMLElement>("button, [role='button']")?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <div className="relative" data-chart-ui ref={triggerRef}>
      <div onClick={() => setOpen((current) => !current)}>{trigger(open)}</div>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          data-chart-ui
          className={cn(
            "fixed z-50 max-h-[min(70dvh,640px)] max-w-[calc(100vw-16px)] rounded-xl border border-terminal-border-strong bg-terminal-elevated py-1.5 shadow-float ring-1 ring-white/[0.025]",
            scrollMode === "menu" ? "overflow-auto overscroll-contain" : "overflow-hidden",
          )}
          style={{ width, left: position.left, top: position.top }}
        >
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function MenuItem({
  active,
  onClick,
  children,
  className,
  disabled,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-ui="menu-item"
      className={cn(
        "mx-1 flex min-h-8 w-[calc(100%_-_8px)] items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-ink transition-colors hover:bg-terminal-hover active:bg-terminal-pressed",
        active && "bg-brand-soft text-brand",
        className,
      )}
    >
      {children}
    </button>
  );
}
