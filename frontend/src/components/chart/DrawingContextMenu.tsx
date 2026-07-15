"use client";
import { createPortal } from "react-dom";
import { useAtomValue } from "jotai";
import { drawingsAtom } from "@/store/chartStore";
import { useDrawingActions } from "./drawing/useDrawingActions";
import { cn } from "@/utils/cn";
import { useFloatingSurface } from "@/hooks/useFloatingSurface";
import { useTerminalPlatform } from "@/hooks/useTerminalPlatform";
import { ChartPopupSurface } from "./ChartPopupSurface";

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
  const drawings = useAtomValue(drawingsAtom);
  const drawing = drawings.find((d) => d.id === state.id) ?? null;
  const items = useDrawingActions(drawing, onClose);
  const mobile = useTerminalPlatform() === "mobile";
  const { surfaceRef, layout } = useFloatingSurface({
    x: state.x,
    y: state.y,
  });

  if (typeof document === "undefined" || !drawing) return null;

  return createPortal(
    <ChartPopupSurface
      ref={surfaceRef}
      dragLabel="Move drawing actions menu"
      showDragHandle={mobile}
      dragHandleRole={mobile ? "menuitem" : undefined}
      resetKey={`${state.id}:${state.x}:${state.y}`}
      onDismiss={onClose}
      consumeOutsidePointerDown={mobile}
      className={cn(
        "context-menu-pop fixed z-[120] min-w-[190px] overflow-x-hidden overflow-y-auto rounded-md border border-terminal-border bg-terminal-panel-2 py-1 shadow-2xl",
        mobile && "mobile-chart-popup-portal",
      )}
      style={{
        left: layout.x,
        top: layout.y,
        maxWidth: layout.maxWidth || undefined,
        maxHeight: layout.maxHeight || undefined,
      }}
      role="menu"
    >
      <div className="px-3 py-1 text-2xs font-semibold text-ink-faint">
        {drawing.tool}
      </div>
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
    </ChartPopupSurface>,
    document.body,
  );
}
