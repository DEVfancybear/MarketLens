"use client";
import { useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  ChevronDown,
  ChevronsLeft,
  Shuffle,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { candlesAtom } from "@/store/chartStore";
import { setBottomTabAtom } from "@/store/uiStore";
import { useReplayStore } from "@/store/replayStore";
import { indexNearestByTime } from "@/services/replayEngine";
import { parseDateInput } from "@/utils/time";
import { cn } from "@/utils/cn";
import { Dropdown } from "@/components/ui/Dropdown";

function toInputDateTime(timeSec?: number): string {
  if (!timeSec) return "";
  return new Date(timeSec * 1000).toISOString().slice(0, 16);
}

export function ReplayTimingMenu({
  compact = false,
}: {
  compact?: boolean;
}) {
  const r = useReplayStore();
  const candles = useAtomValue(candlesAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const [dateMode, setDateMode] = useState(false);
  const current = candles[r.cursor] ?? candles[Math.floor(candles.length * 0.7)];
  const [dateInput, setDateInput] = useState(() =>
    toInputDateTime(current?.time),
  );

  const canReplay = candles.length >= 2;
  const label = useMemo(() => {
    if (r.selecting || r.reSelecting) return "Select bar";
    if (!r.active) return "Replay timing";
    return "Select bar";
  }, [r.active, r.selecting, r.reSelecting]);

  const armAt = (idx: number) => {
    if (!canReplay) return;
    const clamped = Math.max(0, Math.min(candles.length - 1, idx));
    r.arm(clamped, candles.length);
    setBottomTab("replay");
  };

  const selectBar = () => {
    if (!canReplay) return;
    if (r.active) r.beginReSelect();
    else r.beginSelect();
    setBottomTab("replay");
  };

  const selectFirst = () => armAt(0);

  const selectRandom = () => {
    if (!canReplay) return;
    const max = Math.max(0, candles.length - 2);
    armAt(Math.floor(Math.random() * (max + 1)));
  };

  const selectDate = () => {
    const t = parseDateInput(dateInput);
    if (t == null || !canReplay) return;
    armAt(indexNearestByTime(candles, t));
  };

  return (
    <Dropdown
      align="left"
      width={compact ? 218 : 250}
      trigger={(open) => (
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded text-left font-medium transition-colors",
            compact
              ? "h-8 px-2 text-[11px]"
              : "h-9 px-2.5 text-xs",
            open
              ? "bg-brand text-white"
              : "text-ink hover:bg-terminal-hover",
          )}
          title="Replay timing"
        >
          <BarChart3 size={compact ? 14 : 15} />
          <span className="whitespace-nowrap">{label}</span>
          <ChevronDown size={13} className="opacity-75" />
        </button>
      )}
    >
      {(close) => (
        <div className="py-1">
          <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-normal text-ink-faint">
            Replay timing
          </div>
          {dateMode ? (
            <div className="space-y-2 px-3 pb-2 pt-1">
              <label className="block text-[10px] uppercase tracking-normal text-ink-faint">
                Select date
              </label>
              <input
                type="datetime-local"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className="h-8 w-full rounded border border-terminal-border bg-terminal-bg px-2 text-[11px] text-ink outline-none focus:border-brand"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    selectFirst();
                    close();
                    setDateMode(false);
                  }}
                  disabled={!canReplay}
                  className="flex h-8 items-center justify-center gap-1.5 rounded border border-terminal-border text-[11px] text-ink-muted hover:bg-terminal-hover disabled:opacity-40"
                >
                  <ChevronsLeft size={13} /> First day
                </button>
                <button
                  type="button"
                  onClick={() => {
                    selectDate();
                    close();
                    setDateMode(false);
                  }}
                  disabled={!canReplay}
                  className="h-8 rounded bg-brand px-2 text-[11px] font-semibold text-white hover:bg-brand-hover disabled:opacity-40"
                >
                  Jump
                </button>
              </div>
            </div>
          ) : (
            <>
              <TimingItem
                icon={<BarChart3 size={16} />}
                label="Select bar"
                onClick={() => {
                  selectBar();
                  close();
                }}
                disabled={!canReplay}
              />
              <TimingItem
                icon={<CalendarClock size={16} />}
                label="Select date..."
                onClick={() => {
                  setDateInput(toInputDateTime(current?.time));
                  setDateMode(true);
                }}
                disabled={!canReplay}
              />
              <TimingItem
                icon={<Shuffle size={16} />}
                label="Random bar"
                onClick={() => {
                  selectRandom();
                  close();
                }}
                disabled={!canReplay}
              />
            </>
          )}
        </div>
      )}
    </Dropdown>
  );
}

function TimingItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-full items-center gap-3 px-3 text-left text-[13px] text-ink hover:bg-brand hover:text-white disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="text-current">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
