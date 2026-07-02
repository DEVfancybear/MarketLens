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
import { useReplayStore, REPLAY_SPEEDS } from "@/store/replayStore";
import {
  replaySpeedDescription,
  replaySpeedLabel,
} from "@/services/replayEngine";
import { cn } from "@/utils/cn";
import { ReplayTimingMenu } from "./ReplayTimingMenu";

export function ReplayFloatingToolbar() {
  const r = useReplayStore();
  const visible = r.active || r.selecting || r.reSelecting;
  if (!visible) return null;

  const atEnd = r.cursor >= r.total - 1;
  const speedIndex = Math.max(0, REPLAY_SPEEDS.indexOf(r.speed));
  const selecting = r.selecting || r.reSelecting;

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="pointer-events-auto flex h-10 items-center overflow-hidden rounded-md border border-terminal-border bg-terminal-panel-2 shadow-2xl shadow-black/45">
        <div className="flex h-full w-7 items-center justify-center border-r border-terminal-border text-ink-faint">
          <GripVertical size={15} />
        </div>

        <ReplayTimingMenu compact />

        {selecting ? (
          <div className="flex h-full items-center gap-2 border-l border-terminal-border px-3">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                r.reSelecting ? "bg-choch" : "bg-brand",
              )}
            />
            <span className="whitespace-nowrap text-[11px] font-medium text-ink">
              Click a candle to choose the replay start
            </span>
            <button
              type="button"
              onClick={() =>
                r.reSelecting ? r.cancelReSelect() : r.cancelSelect()
              }
              className="ml-1 flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-terminal-hover hover:text-bear"
              title="Cancel"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <>
            <ToolbarButton
              label="Restart"
              onClick={() => {
                r.pause();
                r.restart();
              }}
            >
              <RotateCcw size={15} />
            </ToolbarButton>
            <ToolbarButton
              label="Play / pause"
              disabled={atEnd}
              active={r.playing}
              onClick={() => (r.playing ? r.pause() : r.play())}
            >
              {r.playing ? <Pause size={16} /> : <Play size={16} />}
            </ToolbarButton>
            <ToolbarButton
              label="Forward one bar"
              disabled={atEnd}
              onClick={() => {
                r.pause();
                r.step(1);
              }}
            >
              <StepForward size={16} />
            </ToolbarButton>

            <div className="flex h-full items-center gap-2 border-l border-terminal-border px-3">
              <span className="text-[11px] font-medium text-ink-muted">
                Speed
              </span>
              <input
                type="range"
                min={0}
                max={REPLAY_SPEEDS.length - 1}
                step={1}
                value={speedIndex}
                onChange={(e) => {
                  const speed = REPLAY_SPEEDS[Number(e.target.value)] ?? r.speed;
                  r.setSpeed(speed);
                }}
                className="h-1 w-28 cursor-pointer appearance-none rounded bg-terminal-border accent-brand"
                title={replaySpeedDescription(r.speed)}
              />
              <span className="w-8 text-right text-[11px] font-semibold text-ink">
                {replaySpeedLabel(r.speed)}
              </span>
            </div>

            <ToolbarButton
              label="Go to latest bar"
              disabled={atEnd}
              onClick={() => {
                r.pause();
                r.setCursor(r.total - 1);
              }}
            >
              <ChevronsRight size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="Exit replay"
              danger
              onClick={r.disarm}
            >
              <X size={16} />
            </ToolbarButton>
          </>
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
