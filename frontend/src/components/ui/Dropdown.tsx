"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";
import { getViewportRect } from "@/utils/viewport";

type PortalPosition = {
  left: number;
  top: number;
  maxHeight: number;
  maxWidth: number;
};

/** Click-to-open popover anchored under its trigger. */
export function Dropdown({
  trigger,
  children,
  align = "left",
  width,
  portal = true,
}: {
  trigger: (open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  width?: number;
  /**
   * Render outside clipping/stacking ancestors and keep the panel in the
   * viewport. This is the safe default for terminal overlays; opt out only
   * when a consumer intentionally needs local positioning.
   */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [portalPosition, setPortalPosition] = useState<PortalPosition | null>(null);

  const focusTrigger = useCallback(() => {
    triggerRef.current
      ?.querySelector<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")
      ?.focus();
  }, []);

  const focusPortalItem = useCallback((last = false) => {
    requestAnimationFrame(() => {
      const items = popoverRef.current?.querySelectorAll<HTMLElement>(
        "[role^='menuitem'], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      );
      if (!items?.length) return;
      items[last ? items.length - 1 : 0]?.focus();
    });
  }, []);

  const updatePortalPosition = useCallback(() => {
    if (!portal || !open || !triggerRef.current || !popoverRef.current) return;

    const viewportPadding = 8;
    const gap = 8;
    const viewport = getViewportRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const panel = popoverRef.current;
    const maxWidth = Math.max(0, viewport.width - viewportPadding * 2);
    const panelWidth = Math.min(
      width ?? panel.getBoundingClientRect().width,
      maxWidth,
    );
    const naturalHeight = panel.scrollHeight;
    const spaceBelow = viewport.bottom - triggerRect.bottom - gap - viewportPadding;
    const spaceAbove = triggerRect.top - viewport.top - gap - viewportPadding;
    const openBelow =
      spaceBelow >= Math.min(naturalHeight, 240) || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(0, openBelow ? spaceBelow : spaceAbove);
    const visibleHeight = Math.min(naturalHeight, maxHeight);
    const preferredLeft =
      align === "right" ? triggerRect.right - panelWidth : triggerRect.left;
    const left = Math.min(
      Math.max(viewport.left + viewportPadding, preferredLeft),
      Math.max(
        viewport.left + viewportPadding,
        viewport.right - panelWidth - viewportPadding,
      ),
    );
    const top = openBelow
      ? triggerRect.bottom + gap
      : Math.max(
          viewport.top + viewportPadding,
          triggerRect.top - gap - visibleHeight,
        );

    setPortalPosition({ left, top, maxHeight, maxWidth });
  }, [align, open, portal, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      focusTrigger();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [focusTrigger, open]);

  useLayoutEffect(() => {
    if (!portal || !open) {
      setPortalPosition(null);
      return;
    }

    updatePortalPosition();
    const onViewportChange = () => updatePortalPosition();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    visualViewport?.addEventListener("resize", onViewportChange);
    visualViewport?.addEventListener("scroll", onViewportChange);
    const observer = new ResizeObserver(onViewportChange);
    if (popoverRef.current) observer.observe(popoverRef.current);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      visualViewport?.removeEventListener("resize", onViewportChange);
      visualViewport?.removeEventListener("scroll", onViewportChange);
      observer.disconnect();
    };
  }, [open, portal, updatePortalPosition]);

  const panel = open ? (
    <div
      ref={popoverRef}
      data-chart-ui
      data-dropdown-portal={portal || undefined}
      className={cn(
        portal ? "fixed z-[80]" : "absolute top-full z-50 mt-2",
        "overflow-x-hidden overflow-y-auto rounded-xl border border-terminal-border-strong bg-terminal-raised py-1.5 shadow-terminal backdrop-blur-xl",
        !portal && (align === "right" ? "right-0" : "left-0"),
      )}
      style={
        portal
          ? {
              left: portalPosition?.left ?? 0,
              top: portalPosition?.top ?? 0,
              width,
              maxWidth: portalPosition?.maxWidth,
              maxHeight: portalPosition?.maxHeight,
              visibility: portalPosition ? "visible" : "hidden",
            }
          : { width }
      }
    >
      {children(() => setOpen(false))}
    </div>
  ) : null;

  return (
    <div
      className="relative"
      data-chart-ui
      ref={ref}
      onKeyDown={(event) => {
        if (
          !portal ||
          !triggerRef.current?.contains(event.target as Node) ||
          (event.key !== "ArrowDown" && event.key !== "ArrowUp")
        ) {
          return;
        }
        event.preventDefault();
        setOpen(true);
        focusPortalItem(event.key === "ArrowUp");
      }}
    >
      <div
        ref={triggerRef}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setOpen(true);
          if (portal) focusPortalItem();
        }}
      >
        {trigger(open)}
      </div>
      {portal && panel ? createPortal(panel, document.body) : panel}
    </div>
  );
}

export function MenuItem({
  active,
  onClick,
  children,
  className,
  disabled = false,
  role,
  "aria-checked": ariaChecked,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  "aria-checked"?: boolean;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={ariaChecked}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-8 w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-muted",
        active && "bg-brand/10 text-brand",
        className,
      )}
    >
      {children}
    </button>
  );
}
