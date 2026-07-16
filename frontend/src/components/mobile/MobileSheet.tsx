"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  createMobileSheetGestureState,
  transitionMobileSheetGesture,
  type MobileSheetGestureEvent,
} from "./mobileSheetGesture";

export function MobileSheet({ title, children, onClose, fullscreen = false }: {
  title: string; children: ReactNode; onClose: () => void; fullscreen?: boolean;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const gestureRef = useRef(createMobileSheetGestureState());
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // A small shared platform dialog can open above this full-screen sheet
      // (for example, naming a watchlist). Let the topmost dialog own Escape
      // and focus traversal instead of closing or refocusing the sheet below.
      if ((document.activeElement as HTMLElement | null)?.closest("[data-platform-dialog]")) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  const applyGesture = (gestureEvent: MobileSheetGestureEvent) => {
    const transition = transitionMobileSheetGesture(
      gestureRef.current,
      gestureEvent,
    );
    gestureRef.current = transition.state;
    if (transition.handled) setOffset(transition.state.offset);
    if (transition.dismiss) onClose();
    return transition.handled;
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    const handled = applyGesture({
      type: "start",
      pointerId: event.pointerId,
      clientY: event.clientY,
      isPrimary: event.isPrimary,
    });
    if (handled) event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    applyGesture({
      type: "move",
      pointerId: event.pointerId,
      clientY: event.clientY,
    });
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    applyGesture({ type: "finish", pointerId: event.pointerId });
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    applyGesture({ type: "cancel", pointerId: event.pointerId });
  };

  return (
    <div data-chart-ui className="mobile-scrim" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={sheetRef} role="dialog" aria-modal="true" aria-label={title} className={cn("mobile-sheet", fullscreen && "mobile-sheet--fullscreen")} style={{ transform: `translate3d(0, ${offset}px, 0)` }}>
        <div className="mobile-sheet__handle" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}><span aria-hidden="true" /></div>
        <header className="mobile-sheet__header"><h2>{title}</h2><button ref={closeRef} type="button" className="mobile-icon-button" onClick={onClose} aria-label={`Close ${title}`}><X size={20} /></button></header>
        <div className="mobile-sheet__content">{children}</div>
      </section>
    </div>
  );
}
