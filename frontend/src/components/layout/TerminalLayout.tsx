"use client";
import { useEffect } from "react";
import { cn } from "@/utils/cn";
import { useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  panelsAtom,
  rightOpenAtom,
  bottomOpenAtom,
  setPanelAtom,
  setBottomOpenAtom,
  setRightOpenAtom,
} from "@/store/uiStore";
import { Resizer } from "@/components/ui/Resizer";
import { useViewportMode } from "@/hooks/useViewportMode";

/**
 * Full-screen trading terminal frame:
 *
 *   ┌───────────────── Top Toolbar ─────────────────┐
 *   │ L │            Center Chart           │ Right │
 *   │ e │                                   │ Watch │
 *   │ f │                                   │ list  │
 *   │ t ├───────── Bottom Replay/Trade ─────┴───────┤
 *   └───────────────────────────────────────────────┘
 *
 * All dock sizes are persisted in the UI store and resizable via dividers.
 */
export function TerminalLayout({
  toolbar,
  leftRail,
  chart,
  watchlist,
  bottom,
}: {
  toolbar: React.ReactNode;
  leftRail: React.ReactNode;
  chart: React.ReactNode;
  watchlist: React.ReactNode;
  bottom: React.ReactNode;
}) {
  const panels = useAtomValue(panelsAtom);
  const rightOpen = useAtomValue(rightOpenAtom);
  const bottomOpen = useAtomValue(bottomOpenAtom);
  const setPanel = useSetAtom(setPanelAtom);
  const setBottomOpen = useSetAtom(setBottomOpenAtom);
  const setRightOpen = useSetAtom(setRightOpenAtom);
  const viewportMode = useViewportMode();

  useEffect(() => {
    if (viewportMode !== "desktop") setRightOpen(false);
  }, [setRightOpen, viewportMode]);

  return (
    <div className="terminal-shell flex h-dvh w-full flex-col overflow-hidden">
      <header className="app-bar-glass z-20 h-[5.5rem] shrink-0 border-b border-terminal-border shadow-[0_8px_32px_var(--shadow-color)]">
        {toolbar}
      </header>

      {/* Body: left rail | center+bottom | right watchlist */}
      <main className="relative flex min-h-0 flex-1 gap-2 p-2">
        {/* Left drawing rail (fixed width) */}
        <div
          className="workspace-surface shrink-0 overflow-hidden rounded-panel"
          style={{ width: panels.left }}
        >
          {leftRail}
        </div>

        {/* Center column = chart (+ bottom dock) */}
        <div className="relative flex min-w-0 flex-1 flex-col gap-2">
          <section aria-label="Chart workspace" className="workspace-surface min-h-0 flex-1 overflow-hidden rounded-panel">
            {chart}
          </section>

          {bottomOpen && (
            <>
              <div
                className="relative -my-1 shrink-0"
                onDoubleClick={() => setBottomOpen(false)}
              >
                <Resizer
                  axis="row"
                  edge="bottom"
                  min={140}
                  max={560}
                  value={panels.bottom}
                  onChange={(v) => setPanel("bottom", v)}
                />
                <button
                  type="button"
                  aria-label="Collapse bottom panel"
                  title="Collapse bottom panel"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setBottomOpen(false)}
                  className="absolute left-1/2 top-1/2 z-30 flex h-6 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-terminal-border-strong bg-terminal-elevated text-ink-muted shadow-panel transition-colors hover:border-brand/50 hover:bg-terminal-hover hover:text-ink"
                >
                  <ChevronDown size={15} />
                </button>
              </div>
              <div
                className="workspace-surface shrink-0 overflow-hidden rounded-panel"
                style={{ height: panels.bottom }}
              >
                {bottom}
              </div>
            </>
          )}
          {!bottomOpen && (
            <button
              type="button"
              aria-label="Show bottom panel"
              title="Show bottom panel"
              onClick={() => setBottomOpen(true)}
              className="absolute bottom-3 left-1/2 z-30 flex h-8 w-12 -translate-x-1/2 items-center justify-center rounded-full border border-terminal-border-strong bg-terminal-elevated text-ink-muted shadow-panel transition-colors hover:border-brand/50 hover:bg-terminal-hover hover:text-ink"
            >
              <ChevronUp size={16} />
            </button>
          )}
        </div>

        {/* Right watchlist dock */}
        {rightOpen && (
          <>
            {viewportMode !== "desktop" && (
              <button
                type="button"
                aria-label="Close right panel"
                className="absolute inset-0 z-30 bg-[var(--scrim)]"
                onClick={() => setRightOpen(false)}
              />
            )}
            {viewportMode === "desktop" && (
              <Resizer
                axis="col"
                edge="right"
                min={240}
                max={480}
                value={panels.right}
                onChange={(v) => setPanel("right", v)}
              />
            )}
            <div
              className={cn(
                "workspace-surface overflow-hidden rounded-panel",
                viewportMode === "desktop"
                  ? "relative shrink-0"
                  : "absolute inset-y-2 right-2 z-40 w-[min(88vw,380px)] shadow-float",
              )}
              style={viewportMode === "desktop" ? { width: panels.right } : undefined}
            >
              {watchlist}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
