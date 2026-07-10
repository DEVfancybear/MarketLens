"use client";

import {
  ChevronsRight,
  GripVertical,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  X,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { useReplayClientProjection } from "@/store/replayClientStore";
import {
  exitReplaySession,
  runReplayCommand,
  stepActiveReplay,
} from "@/services/replay/replaySocket";
import { cn } from "@/utils/cn";
import { ReplayTimingMenu } from "./ReplayTimingMenu";
import {
  cancelReplaySelectionAtom,
  replaySelectionModeAtom,
  REPLAY_SPEEDS,
  replaySpeedDescription,
  replaySpeedLabel,
} from "./replayUiState";

function fire(command: Promise<void>): void {
  void command.catch(() => undefined);
}

export function ReplayFloatingToolbar() {
  const projection = useReplayClientProjection();
  const selection = useAtomValue(replaySelectionModeAtom);
  const cancelSelection = useSetAtom(cancelReplaySelectionAtom);
  const snapshot = projection.snapshot;
  const visible = Boolean(snapshot) || selection !== "idle" || projection.connection === "connecting";
  if (!visible) return null;

  const playing = snapshot?.status === "playing";
  const atEnd = snapshot?.status === "completed";
  const speedIndex = Math.max(0, REPLAY_SPEEDS.findIndex((speed) => speed === snapshot?.speed));

  return (
    <div data-chart-ui className="pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div data-chart-ui className="pointer-events-auto flex h-10 items-center rounded-md border border-terminal-border bg-terminal-panel-2 shadow-2xl shadow-black/45">
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
            <ToolbarButton label="Restart" onClick={() => fire(runReplayCommand("restart"))}>
              <RotateCcw size={15} />
            </ToolbarButton>
            <ToolbarButton
              label="Play / pause"
              disabled={atEnd}
              active={playing}
              onClick={() => fire(runReplayCommand(playing ? "pause" : "play"))}
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
                  fire(runReplayCommand("set_speed", { speed }));
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
