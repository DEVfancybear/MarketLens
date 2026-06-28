"use client";
import { cn } from "@/utils/cn";
import { useAtomValue, useSetAtom } from "jotai";
import {
  panelsAtom,
  rightOpenAtom,
  bottomOpenAtom,
  setPanelAtom,
} from "@/store/uiStore";
import { Resizer } from "@/components/ui/Resizer";

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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-terminal-bg">
      {/* Top toolbar — Tight: TradingView = 36px */}
      <div className="h-9 shrink-0 border-b border-terminal-border bg-terminal-panel">
        {toolbar}
      </div>

      {/* Body: left rail | center+bottom | right watchlist */}
      <div className="flex min-h-0 flex-1">
        {/* Left drawing rail (fixed width) */}
        <div
          className="shrink-0 border-r border-terminal-border bg-terminal-panel overflow-hidden"
          style={{ width: panels.left }}
        >
          {leftRail}
        </div>

        {/* Center column = chart (+ bottom dock) */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">{chart}</div>

          {bottomOpen && (
            <>
              <Resizer
                axis="row"
                edge="bottom"
                min={140}
                max={560}
                value={panels.bottom}
                onChange={(v) => setPanel("bottom", v)}
              />
              <div
                className="shrink-0 border-t border-terminal-border bg-terminal-panel"
                style={{ height: panels.bottom }}
              >
                {bottom}
              </div>
            </>
          )}
        </div>

        {/* Right watchlist dock */}
        {rightOpen && (
          <>
            <Resizer
              axis="col"
              edge="right"
              min={220}
              max={460}
              value={panels.right}
              onChange={(v) => setPanel("right", v)}
            />
            <div
              className={cn(
                "shrink-0 border-l border-terminal-border bg-terminal-panel",
              )}
              style={{ width: panels.right }}
            >
              {watchlist}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
