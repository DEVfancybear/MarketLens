"use client";

import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  Power,
  RotateCcw,
  X,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { backendSessionAtom } from "@/store/authStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import {
  exitReplaySession,
  runReplayCommand,
  setActiveReplaySpeed,
  stepActiveReplay,
} from "@/services/replay/replaySocket";
import { isReplayBackendV1Enabled } from "@/services/replay/backendReplayFlag";
import { cn } from "@/utils/cn";
import { IconButton } from "@/components/ui/IconButton";
import { ReplayTimingMenu } from "./ReplayTimingMenu";
import {
  beginReplayReselectionAtom,
  beginReplaySelectionAtom,
  cancelReplaySelectionAtom,
  replaySelectionModeAtom,
  REPLAY_SPEEDS,
  replaySpeedDescription,
  replaySpeedLabel,
  replayControlMessage,
} from "./replayUiState";

function fire(command: Promise<void>): void {
  void command.catch(() => undefined);
}

export function ReplayControls() {
  const projection = useReplayClientProjection();
  const backendSession = useAtomValue(backendSessionAtom);
  const selection = useAtomValue(replaySelectionModeAtom);
  const beginSelect = useSetAtom(beginReplaySelectionAtom);
  const beginReselect = useSetAtom(beginReplayReselectionAtom);
  const cancelSelection = useSetAtom(cancelReplaySelectionAtom);
  const snapshot = projection.snapshot;
  const active = Boolean(snapshot);
  const playing = snapshot?.status === "playing";
  const atEnd = snapshot?.status === "completed";
  const enabled = isReplayBackendV1Enabled();

  if (selection !== "idle") {
    return (
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 rounded bg-brand/15 px-3 py-1.5 text-xs font-semibold text-brand">
          <BarChart3 size={13} /> Click a bar on the chart to choose the Replay time
        </span>
        <button
          onClick={cancelSelection}
          className="flex items-center gap-1 rounded border border-terminal-border px-2.5 py-1.5 text-2xs text-ink-muted hover:bg-terminal-hover hover:text-ink"
        >
          <X size={12} /> Cancel (Esc)
        </button>
        <span className="text-2xs text-ink-faint">
          The backend validates the requested UTC time and owns all revealed bars.
        </span>
      </div>
    );
  }

  if (!active) {
    const unavailable = replayControlMessage({
      enabled,
      authenticated: backendSession,
      connection: projection.connection,
      error: projection.error,
    });
    return (
      <div className="flex items-center gap-3">
        <ReplayTimingMenu />
        <button
          disabled={!enabled || !backendSession || projection.connection === "connecting"}
          onClick={beginSelect}
          className="flex items-center gap-2 rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={13} /> Start Replay
        </button>
        <span className="text-2xs text-ink-faint">
          {unavailable ?? "Select a bar, date, or random UTC time."}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <IconButton label="Restart (R)" onClick={() => fire(runReplayCommand("restart"))}>
        <RotateCcw size={15} />
      </IconButton>
      <IconButton label="Rewind 10 bars" onClick={() => fire(stepActiveReplay(-10))}>
        <ChevronsLeft size={16} />
      </IconButton>
      <IconButton label="Previous bar" onClick={() => fire(stepActiveReplay(-1))}>
        <ChevronLeft size={16} />
      </IconButton>
      <button
        onClick={() => fire(runReplayCommand(playing ? "pause" : "play"))}
        disabled={atEnd || projection.connection === "connecting"}
        className={cn(
          "mx-1 flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors disabled:opacity-40",
          playing ? "bg-choch hover:opacity-90" : "bg-brand hover:bg-brand-hover",
        )}
        title="Play / Pause (Space)"
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <IconButton label="Next bar" onClick={() => fire(stepActiveReplay(1))}>
        <ChevronRight size={16} />
      </IconButton>
      <IconButton label="Forward 10 bars" onClick={() => fire(stepActiveReplay(10))}>
        <ChevronsRight size={16} />
      </IconButton>

      <div className="mx-2 h-5 w-px bg-terminal-border" />
      <ReplayTimingMenu compact />
      <div className="mx-2 h-5 w-px bg-terminal-border" />

      <div className="flex items-center gap-2 px-1">
        <span className="text-2xs font-medium text-ink-muted">Speed</span>
        <input
          type="range"
          min={0}
          max={REPLAY_SPEEDS.length - 1}
          step={1}
          value={Math.max(0, REPLAY_SPEEDS.findIndex((speed) => speed === snapshot?.speed))}
          onChange={(event) => {
            const speed = REPLAY_SPEEDS[Number(event.target.value)] ?? 1;
            fire(setActiveReplaySpeed(speed));
          }}
          className="h-1 w-28 cursor-pointer appearance-none rounded bg-terminal-border accent-brand"
          title={replaySpeedDescription(snapshot?.speed ?? 1)}
        />
        <span className="w-8 text-right text-2xs font-semibold text-ink">
          {replaySpeedLabel(snapshot?.speed ?? 1)}
        </span>
      </div>

      <div className="mx-2 h-5 w-px bg-terminal-border" />
      <button
        onClick={() => {
          if (playing) fire(runReplayCommand("pause"));
          beginReselect();
        }}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-2xs text-ink-muted transition-colors hover:bg-terminal-hover hover:text-choch"
        title="Choose another backend Replay time"
      >
        <BarChart3 size={13} /> Select Bar
      </button>
      <div className="mx-2 h-5 w-px bg-terminal-border" />
      <button
        onClick={() => {
          cancelSelection();
          fire(exitReplaySession());
        }}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-2xs text-ink-muted hover:bg-terminal-hover hover:text-bear"
      >
        <Power size={13} /> Exit Replay
      </button>
      {projection.error && <span className="ml-2 text-2xs text-bear">{projection.error}</span>}
    </div>
  );
}
