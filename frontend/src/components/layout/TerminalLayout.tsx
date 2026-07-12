"use client";
import { useLayoutEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { useAtomValue, useSetAtom } from "jotai";
import {
  CandlestickChart,
  ChevronDown,
  ChevronUp,
  Code2,
  List,
  PencilRuler,
  Play,
  X,
} from "lucide-react";
import {
  panelsAtom,
  rightOpenAtom,
  bottomOpenAtom,
  bottomTabAtom,
  setPanelAtom,
  setBottomOpenAtom,
  setRightOpenAtom,
  setBottomTabAtom,
  showRightPanelTabAtom,
} from "@/store/uiStore";
import { Resizer } from "@/components/ui/Resizer";
import { useViewport } from "@/hooks/useViewport";

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
  const bottomTab = useAtomValue(bottomTabAtom);
  const setPanel = useSetAtom(setPanelAtom);
  const setBottomOpen = useSetAtom(setBottomOpenAtom);
  const setRightOpen = useSetAtom(setRightOpenAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const showRightPanel = useSetAtom(showRightPanelTabAtom);
  const viewport = useViewport();
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [touchRightOpen, setTouchRightOpen] = useState(false);
  const { mode: viewportMode } = viewport;
  const showDrawingRail =
    viewportMode === "desktop" ||
    (viewportMode === "tablet" &&
      viewport.orientation === "landscape" &&
      viewport.width >= 900);
  const compactNavigation = !showDrawingRail;
  const rightPanelVisible =
    viewportMode === "desktop" || !compactNavigation
      ? rightOpen
      : touchRightOpen;
  const phonePineFullscreen =
    viewportMode === "phone" && bottomTab === "pine";

  useLayoutEffect(() => {
    if (viewportMode !== "desktop") {
      setRightOpen(false);
      setDrawingOpen(false);
      setTouchRightOpen(false);
    }
  }, [setRightOpen, viewportMode]);

  return (
    <div className="terminal-shell flex h-dvh w-full flex-col overflow-hidden">
      <header className="app-bar-glass z-20 h-[5.5rem] shrink-0 border-b border-terminal-border shadow-[0_8px_32px_var(--shadow-color)]">
        {toolbar}
      </header>

      {/* Body: left rail | center+bottom | right watchlist */}
      <main
        className={cn(
          "relative flex min-h-0 flex-1 gap-2 p-2",
          compactNavigation && "pb-[calc(4.5rem+env(safe-area-inset-bottom))]",
        )}
      >
        {/* Left drawing rail (fixed width) */}
        {showDrawingRail && (
          <div
            className="workspace-surface shrink-0 overflow-hidden rounded-panel"
            style={{ width: panels.left }}
          >
            {leftRail}
          </div>
        )}

        {/* Center column = chart (+ bottom dock) */}
        <div className="relative flex min-w-0 flex-1 flex-col gap-2">
          <section aria-label="Chart workspace" className="workspace-surface min-h-0 flex-1 overflow-hidden rounded-panel">
            {chart}
          </section>

          {viewportMode === "desktop" && bottomOpen && (
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
          {viewportMode === "desktop" && !bottomOpen && (
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

        {/* Touch layouts keep secondary workspaces above the chart so the
            chart never collapses into an unusable desktop-style dock. */}
        {viewportMode !== "desktop" && bottomOpen && (
          <>
            {!phonePineFullscreen && (
              <button
                type="button"
                aria-label="Close bottom panel"
                className="absolute inset-0 z-30 bg-[var(--scrim)]"
                onClick={() => setBottomOpen(false)}
              />
            )}
            <section
              aria-label={`${bottomTab} panel`}
              className={cn(
                "workspace-surface absolute z-40 flex flex-col overflow-hidden shadow-float",
                phonePineFullscreen
                  ? "inset-0 rounded-none"
                  : "inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] max-h-[min(76dvh,calc(100dvh-6rem))] rounded-t-2xl rounded-b-panel",
              )}
              style={
                phonePineFullscreen
                  ? undefined
                  : {
                      height:
                        viewportMode === "phone"
                          ? "min(76dvh, calc(100dvh - 6rem))"
                          : "min(520px, 55dvh)",
                    }
              }
            >
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-terminal-border bg-terminal-panel-2/75 px-3">
                <div className="flex items-center gap-2">
                  <span className="h-1 w-10 rounded-full bg-terminal-border-strong" />
                  <span className="text-[11px] font-semibold capitalize text-ink-muted">
                    {bottomTab === "pine" ? "Pine Editor" : bottomTab}
                  </span>
                </div>
                <button
                  type="button"
                  data-ui="icon-button"
                  aria-label="Close panel"
                  onClick={() => setBottomOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="min-h-0 flex-1">{bottom}</div>
            </section>
          </>
        )}

        {compactNavigation && drawingOpen && (
          <>
            <button
              type="button"
              aria-label="Close drawing tools"
              className="absolute inset-0 z-30 bg-[var(--scrim)]"
              onClick={() => setDrawingOpen(false)}
            />
            <aside
              aria-label="Drawing tools"
              className="workspace-surface absolute inset-y-2 left-2 z-40 overflow-hidden rounded-panel shadow-float"
              style={{ width: Math.max(56, panels.left) }}
            >
              {leftRail}
            </aside>
          </>
        )}

        {/* Right watchlist dock */}
        {rightPanelVisible && (
          <>
            {viewportMode !== "desktop" && (
              <button
                type="button"
                aria-label="Close right panel"
                className="absolute inset-0 z-30 bg-[var(--scrim)]"
                onClick={() => {
                  setTouchRightOpen(false);
                  setRightOpen(false);
                }}
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
                  : viewportMode === "phone"
                    ? "absolute inset-0 z-40 rounded-none shadow-float"
                    : "absolute inset-y-2 right-2 z-40 w-[min(88vw,380px)] shadow-float",
              )}
              style={viewportMode === "desktop" ? { width: panels.right } : undefined}
            >
              {viewportMode !== "desktop" && (
                <button
                  type="button"
                  data-ui="icon-button"
                  aria-label="Close watchlist"
                  onClick={() => {
                    setTouchRightOpen(false);
                    setRightOpen(false);
                  }}
                  className="absolute right-2 top-2 z-50 flex h-9 w-9 items-center justify-center rounded-lg border border-terminal-border bg-terminal-elevated text-ink-muted shadow-panel transition-colors hover:bg-terminal-hover hover:text-ink"
                >
                  <X size={18} />
                </button>
              )}
              {watchlist}
            </div>
          </>
        )}

        {compactNavigation && (
          <nav
            aria-label="Mobile workspace"
            className="app-bar-glass absolute inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-20 grid h-14 grid-cols-5 items-stretch rounded-2xl border border-terminal-border-strong px-1 shadow-float"
          >
            <CompactAction
              label="Chart"
              active={!drawingOpen && !touchRightOpen && !bottomOpen}
              onClick={() => {
                setDrawingOpen(false);
                setTouchRightOpen(false);
                setRightOpen(false);
                setBottomOpen(false);
              }}
            >
              <CandlestickChart size={18} />
            </CompactAction>
            <CompactAction
              label="Draw"
              active={drawingOpen}
              onClick={() => {
                setBottomOpen(false);
                setTouchRightOpen(false);
                setRightOpen(false);
                setDrawingOpen((open) => !open);
              }}
            >
              <PencilRuler size={18} />
            </CompactAction>
            <CompactAction
              label="Watch"
              active={touchRightOpen}
              onClick={() => {
                setDrawingOpen(false);
                setBottomOpen(false);
                showRightPanel("watchlist");
                setTouchRightOpen(true);
              }}
            >
              <List size={18} />
            </CompactAction>
            <CompactAction
              label="Replay"
              active={bottomOpen && bottomTab === "replay"}
              onClick={() => {
                setDrawingOpen(false);
                setTouchRightOpen(false);
                setRightOpen(false);
                setBottomTab("replay");
              }}
            >
              <Play size={18} />
            </CompactAction>
            <CompactAction
              label="Pine"
              active={bottomOpen && bottomTab === "pine"}
              onClick={() => {
                setDrawingOpen(false);
                setTouchRightOpen(false);
                setRightOpen(false);
                setBottomTab("pine");
              }}
            >
              <Code2 size={18} />
            </CompactAction>
          </nav>
        )}
      </main>
    </div>
  );
}

function CompactAction({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[9px] font-semibold transition-colors",
        active
          ? "bg-brand-soft text-brand"
          : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
