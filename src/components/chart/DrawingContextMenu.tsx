"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, Copy, Lock, Unlock, Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react";
import { useChartStore } from "@/store/chartStore";
import { cn } from "@/utils/cn";

export interface DrawingMenuState {
  id: string;
  x: number;
  y: number;
}

interface Props {
  state: DrawingMenuState;
  onClose: () => void;
}

/** Right-click context menu for a drawing on the chart. */
export function DrawingContextMenu({ state, onClose }: Props) {
  const drawing = useChartStore((s) => s.drawings.find((d) => d.id === state.id));
  const removeDrawing = useChartStore((s) => s.removeDrawing);
  const duplicateDrawing = useChartStore((s) => s.duplicateDrawing);
  const lockDrawing = useChartStore((s) => s.lockDrawing);
  const hideDrawing = useChartStore((s) => s.hideDrawing);
  const bringToFront = useChartStore((s) => s.bringToFront);
  const sendToBack = useChartStore((s) => s.sendToBack);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    let x = state.x, y = state.y;
    if (x + width + pad > window.innerWidth) x = window.innerWidth - width - pad;
    if (y + height + pad > window.innerHeight) y = window.innerHeight - height - pad;
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [state.x, state.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined" || !drawing) return null;

  const act = (fn: (id: string) => void) => () => { fn(drawing.id); onClose(); };

  const items = [
    { icon: <Copy size={14} className="text-ink-muted" />, label: "Clone", onClick: act(duplicateDrawing) },
    { divider: true as const },
    drawing.locked
      ? { icon: <Unlock size={14} className="text-choch" />, label: "Unlock", onClick: act(lockDrawing) }
      : { icon: <Lock size={14} className="text-ink-muted" />, label: "Lock", onClick: act(lockDrawing) },
    drawing.visible === false
      ? { icon: <Eye size={14} className="text-bull" />, label: "Show", onClick: act(hideDrawing) }
      : { icon: <EyeOff size={14} className="text-ink-muted" />, label: "Hide", onClick: act(hideDrawing) },
    { divider: true as const },
    { icon: <ChevronUp size={14} className="text-ink-muted" />, label: "Bring to Front", onClick: act(bringToFront) },
    { icon: <ChevronDown size={14} className="text-ink-muted" />, label: "Send to Back", onClick: act(sendToBack) },
    { divider: true as const },
    { icon: <Trash2 size={14} className="text-bear" />, label: "Delete", onClick: act(removeDrawing), danger: true },
  ];

  return createPortal(
    <div
      ref={ref}
      className="context-menu-pop fixed z-[120] min-w-[190px] rounded-md border border-terminal-border bg-terminal-panel-2 py-1 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      <div className="px-3 py-1 text-2xs font-semibold text-ink-faint">{drawing.tool}</div>
      <div className="my-1 h-px bg-terminal-border" />
      {items.map((it, i) =>
        "divider" in it && it.divider ? (
          <div key={i} className="my-1 h-px bg-terminal-border" />
        ) : (
          <button
            key={i}
            role="menuitem"
            onClick={it.onClick}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-terminal-hover",
              "danger" in it && it.danger ? "text-bear" : "text-ink",
            )}
          >
            {it.icon}
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
