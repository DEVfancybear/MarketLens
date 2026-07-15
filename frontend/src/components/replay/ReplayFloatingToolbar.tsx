"use client";

import {
  ChevronsRight,
  Gauge,
  GripVertical,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useTerminalPlatform } from "@/hooks/useTerminalPlatform";
import { ChartPopupSurface } from "@/components/chart/ChartPopupSurface";
import { useReplayClientProjection } from "@/store/replayClientStore";
import {
  exitReplaySession,
  restartActiveReplay,
  setActiveReplayPlaying,
  setActiveReplaySpeed,
  stepActiveReplay,
} from "@/services/replay/replaySocket";
import { cn } from "@/utils/cn";
import { ReplayTimingMenu } from "./ReplayTimingMenu";
import {
  cancelReplaySelectionAtom,
  requestReplayWorkspaceAtom,
  replaySelectionModeAtom,
  REPLAY_SPEEDS,
  replaySpeedDescription,
  replaySpeedLabel,
} from "./replayUiState";

function fire(command: Promise<void>): void {
  void command.catch(() => undefined);
}

export function ReplayFloatingToolbar({ mobileHosted = false }: { mobileHosted?: boolean } = {}) {
  const platform = useTerminalPlatform();
  const projection = useReplayClientProjection();
  const selection = useAtomValue(replaySelectionModeAtom);
  const cancelSelection = useSetAtom(cancelReplaySelectionAtom);
  const snapshot = projection.snapshot;
  const visible = Boolean(snapshot) ||
    selection !== "idle" ||
    projection.connection === "connecting" ||
    projection.connection === "recovering";
  if (!visible) return null;

  if (platform === "mobile") {
    // ReplaySelectionLayer owns the mobile selection HUD because it also owns
    // the current candidate and the visible confirm/cancel alternatives.
    if (selection !== "idle") return null;
    const dock = (
      <MobileReplayDock
        snapshot={snapshot}
        connection={projection.connection}
      />
    );
    return mobileHosted ? dock : (
      <div data-chart-ui className="pointer-events-none absolute inset-x-2 bottom-2 z-50 flex justify-center">
        {dock}
      </div>
    );
  }

  const playing = snapshot?.status === "playing";
  const atEnd = snapshot?.status === "completed";
  const speedIndex = Math.max(0, REPLAY_SPEEDS.findIndex((speed) => speed === snapshot?.speed));

  return (
    <div data-chart-ui className="pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div data-chart-ui className="pointer-events-auto flex h-10 items-center rounded-xl border border-terminal-border-strong bg-terminal-raised/95 shadow-floating backdrop-blur-xl">
        <div className="flex h-full w-7 items-center justify-center border-r border-terminal-border text-ink-faint">
          <GripVertical size={15} />
        </div>
        <ReplayTimingMenu compact />

        {selection !== "idle" ? (
          <div className="flex h-full items-center gap-2 border-l border-terminal-border px-3">
            <span className="h-2 w-2 rounded-full bg-brand" />
            <span className="whitespace-nowrap text-[11px] font-medium text-ink">
              Click a candle to request the Replay time
            </span>
            <button
              type="button"
              onClick={cancelSelection}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-terminal-hover hover:text-bear"
              title="Cancel"
            >
              <X size={15} />
            </button>
          </div>
        ) : snapshot ? (
          <>
            <ToolbarButton label="Restart" onClick={() => fire(restartActiveReplay())}>
              <RotateCcw size={15} />
            </ToolbarButton>
            <ToolbarButton
              label="Play / pause"
              disabled={atEnd}
              active={playing}
              onClick={() => fire(setActiveReplayPlaying(!playing))}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </ToolbarButton>
            <ToolbarButton label="Forward one bar" disabled={atEnd} onClick={() => fire(stepActiveReplay(1))}>
              <StepForward size={16} />
            </ToolbarButton>

            <div className="flex h-full items-center gap-2 border-l border-terminal-border px-3">
              <span className="text-[11px] font-medium text-ink-muted">Speed</span>
              <input
                type="range"
                min={0}
                max={REPLAY_SPEEDS.length - 1}
                step={1}
                value={speedIndex}
                onChange={(event) => {
                  const speed = REPLAY_SPEEDS[Number(event.target.value)] ?? 1;
                  fire(setActiveReplaySpeed(speed));
                }}
                className="h-1 w-28 cursor-pointer appearance-none rounded bg-terminal-border accent-brand"
                title={replaySpeedDescription(snapshot.speed)}
              />
              <span className="w-8 text-right text-[11px] font-semibold text-ink">
                {replaySpeedLabel(snapshot.speed)}
              </span>
            </div>

            <ToolbarButton label="Go to live chart" onClick={() => fire(exitReplaySession())}>
              <ChevronsRight size={16} />
            </ToolbarButton>
            <ToolbarButton label="Exit replay" danger onClick={() => fire(exitReplaySession())}>
              <X size={16} />
            </ToolbarButton>
          </>
        ) : (
          <span className="px-3 text-[11px] text-ink-muted">Preparing backend Replay...</span>
        )}
      </div>
    </div>
  );
}

function MobileReplayDock({
  snapshot,
  connection,
}: {
  snapshot: ReturnType<typeof useReplayClientProjection>["snapshot"];
  connection: string;
}) {
  const requestWorkspace = useSetAtom(requestReplayWorkspaceAtom);
  const connecting = connection === "connecting" || connection === "recovering";

  if (!snapshot) {
    return (
      <ChartPopupSurface
        dragLabel="Move Replay status"
        data-chart-ui
        data-mobile-replay-dock
        className="mobile-replay-popup w-full max-w-sm"
      >
        <button
          type="button"
          onClick={() => requestWorkspace()}
          className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl border border-terminal-border-strong bg-terminal-raised/95 px-4 text-xs font-semibold text-ink shadow-floating backdrop-blur-xl active:bg-terminal-pressed"
        >
          <LoaderCircle size={17} className="animate-spin text-brand motion-reduce:animate-none" />
          {connecting ? "Preparing Replay..." : "Open Replay status"}
        </button>
      </ChartPopupSurface>
    );
  }

  const playing = snapshot.status === "playing";
  const atEnd = snapshot.status === "completed";
  const atStart = snapshot.tracks.every((track) => track.cursorSeq <= 0);
  const terminal = snapshot.status === "closed" || snapshot.status === "failed";
  const disabled = connecting || terminal || snapshot.status === "preparing";
  const speedIndex = Math.max(0, REPLAY_SPEEDS.findIndex((speed) => speed === snapshot.speed));
  const nextSpeed = REPLAY_SPEEDS[(speedIndex + 1) % REPLAY_SPEEDS.length] ?? 1;

  return (
    <ChartPopupSurface
      dragLabel="Move Replay controls"
      data-chart-ui
      data-mobile-replay-dock
      className="mobile-replay-popup w-full max-w-sm"
    >
      <div
        role="toolbar"
        aria-label="Replay controls"
        className="mobile-replay-controls grid min-h-14 min-w-0 flex-1 items-center gap-1 rounded-2xl border border-terminal-border-strong bg-terminal-raised/95 p-1 shadow-floating backdrop-blur-xl"
      >
        <MobileDockButton
          label="Previous Replay bar"
          disabled={disabled || atStart}
          onClick={() => fire(stepActiveReplay(-1))}
        >
          <StepForward size={19} className="rotate-180" />
        </MobileDockButton>
        <MobileDockButton
          label={playing ? "Pause Replay" : "Play Replay"}
          primary
          disabled={disabled || atEnd}
          onClick={() => fire(setActiveReplayPlaying(!playing))}
        >
          {playing ? (
            <Pause size={20} />
          ) : (
            <Play size={20} fill="currentColor" />
          )}
        </MobileDockButton>
        <MobileDockButton
          label="Next Replay bar"
          disabled={disabled || atEnd}
          onClick={() => fire(stepActiveReplay(1))}
        >
          <StepForward size={19} />
        </MobileDockButton>
        <button
          type="button"
          aria-label={`Replay speed ${replaySpeedLabel(snapshot.speed)}. Set ${replaySpeedLabel(nextSpeed)}`}
          disabled={disabled}
          onClick={() => fire(setActiveReplaySpeed(nextSpeed))}
          className="flex h-12 min-w-0 flex-col items-center justify-center rounded-xl px-2 text-ink-muted transition-colors active:bg-terminal-pressed disabled:opacity-45"
        >
          <span className="text-xs font-bold tabular text-ink">{replaySpeedLabel(snapshot.speed)}</span>
          <span className="truncate text-[9px] font-semibold uppercase tracking-wide">Speed</span>
        </button>
        <MobileDockButton label="Open Replay controls" onClick={() => requestWorkspace()}>
          <Gauge size={20} />
        </MobileDockButton>
      </div>
    </ChartPopupSurface>
  );
}

function MobileDockButton({
  label,
  primary = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-12 min-w-11 items-center justify-center rounded-xl transition-colors disabled:opacity-45",
        primary
          ? "bg-brand text-[var(--accent-contrast)] shadow-accent active:bg-brand-hover"
          : "text-ink-muted active:bg-terminal-pressed active:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function ToolbarButton({
  label,
  active,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-10 w-10 items-center justify-center border-l border-terminal-border text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink disabled:opacity-40",
        active && "bg-brand text-white hover:bg-brand-hover hover:text-white",
        danger && "hover:text-bear",
      )}
    >
      {children}
    </button>
  );
}
