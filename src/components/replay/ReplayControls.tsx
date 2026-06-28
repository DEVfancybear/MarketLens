"use client";
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  ChevronsRight,
  ChevronsLeft,
  Power,
} from "lucide-react";
import { useReplayStore, REPLAY_SPEEDS } from "@/store/replayStore";
import { useAtomValue } from "jotai";
import { candlesAtom } from "@/store/chartStore";
import { cn } from "@/utils/cn";
import { IconButton } from "@/components/ui/IconButton";

export function ReplayControls() {
  const r = useReplayStore();
  const candles = useAtomValue(candlesAtom);
  const atEnd = r.cursor >= r.total - 1;

  if (!r.active) {
    if (r.selecting) {
      return (
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 rounded bg-brand/15 px-3 py-1.5 text-xs font-semibold text-brand">
            <Play size={13} /> Click a bar on the chart to start replay
          </span>
          <button
            onClick={r.cancelSelect}
            className="rounded border border-terminal-border px-2.5 py-1.5 text-2xs text-ink-muted hover:bg-terminal-hover hover:text-ink"
          >
            Cancel (Esc)
          </button>
          <span className="text-2xs text-ink-faint">
            The selection cursor snaps to the nearest candle. Everything after
            it is hidden — no look-ahead.
          </span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (candles.length < 50) return;
            r.beginSelect();
          }}
          className="flex items-center gap-2 rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
        >
          <Play size={13} /> Start Replay
        </button>
        <button
          onClick={() => {
            if (candles.length < 50) return;
            r.arm(Math.floor(candles.length * 0.7), candles.length);
          }}
          className="rounded border border-terminal-border px-2.5 py-1.5 text-2xs text-ink-muted hover:bg-terminal-hover hover:text-ink"
        >
          Quick start (70%)
        </button>
        <span className="text-2xs text-ink-faint">
          Click a bar to set the start point, just like TradingView Bar Replay.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <IconButton label="Restart (R)" onClick={r.restart}>
        <RotateCcw size={15} />
      </IconButton>
      <IconButton
        label="Prev 10 (Shift+←)"
        onClick={() => {
          r.pause();
          r.step(-10);
        }}
      >
        <ChevronsLeft size={16} />
      </IconButton>
      <IconButton
        label="Prev candle (←)"
        onClick={() => {
          r.pause();
          r.step(-1);
        }}
      >
        <ChevronLeft size={16} />
      </IconButton>

      <button
        onClick={() => (r.playing ? r.pause() : r.play())}
        disabled={atEnd}
        className={cn(
          "mx-1 flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors disabled:opacity-40",
          r.playing
            ? "bg-choch hover:opacity-90"
            : "bg-brand hover:bg-brand-hover",
        )}
        title="Play / Pause (Space)"
      >
        {r.playing ? (
          <Pause size={16} />
        ) : (
          <Play size={16} className="ml-0.5" />
        )}
      </button>

      <IconButton
        label="Next candle (→)"
        onClick={() => {
          r.pause();
          r.step(1);
        }}
      >
        <ChevronRight size={16} />
      </IconButton>
      <IconButton
        label="Next 10 (Shift+→)"
        onClick={() => {
          r.pause();
          r.step(10);
        }}
      >
        <ChevronsRight size={16} />
      </IconButton>
      <IconButton label="Stop" onClick={r.stop}>
        <Square size={14} />
      </IconButton>

      <div className="mx-2 h-5 w-px bg-terminal-border" />

      {/* Speed */}
      <div className="flex items-center gap-1">
        {REPLAY_SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => r.setSpeed(s)}
            className={cn(
              "h-6 rounded px-1.5 text-2xs font-semibold transition-colors",
              r.speed === s
                ? "bg-brand/20 text-brand"
                : "text-ink-muted hover:bg-terminal-hover",
            )}
          >
            {s}x
          </button>
        ))}
      </div>

      <div className="mx-2 h-5 w-px bg-terminal-border" />

      <button
        onClick={r.disarm}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-2xs text-ink-muted hover:bg-terminal-hover hover:text-bear"
      >
        <Power size={13} /> Exit Replay
      </button>
    </div>
  );
}
