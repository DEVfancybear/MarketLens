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
import { backendSessionAtom } from "@/store/authStore";
import { symbolAtom, timeframeAtom } from "@/store/chartStore";
import { setBottomTabAtom } from "@/store/uiStore";
import {
  activeChartSlotAtom,
  chartLayoutPresetAtom,
  chartPanesAtom,
  replayLayoutModeAtom,
} from "@/store/replayLayoutStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import {
  moveActiveReplayTo,
  startReplaySession,
} from "@/services/replay/replaySocket";
import { parseDateInput } from "@/utils/time";
import { cn } from "@/utils/cn";
import { Dropdown } from "@/components/ui/Dropdown";
import {
  beginReplayReselectionAtom,
  beginReplaySelectionAtom,
  replaySelectionModeAtom,
  replaySessionInputAt,
} from "./replayUiState";

function toInputDateTime(timeSec?: number): string {
  if (!timeSec) return "";
  return new Date(timeSec * 1000).toISOString().slice(0, 16);
}

export function ReplayTimingMenu({ compact = false }: { compact?: boolean }) {
  const projection = useReplayClientProjection();
  const backendSession = useAtomValue(backendSessionAtom);
  const selection = useAtomValue(replaySelectionModeAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const layoutPreset = useAtomValue(chartLayoutPresetAtom);
  const replayMode = useAtomValue(replayLayoutModeAtom);
  const panes = useAtomValue(chartPanesAtom);
  const activeSlot = useAtomValue(activeChartSlotAtom);
  const beginSelect = useSetAtom(beginReplaySelectionAtom);
  const beginReselect = useSetAtom(beginReplayReselectionAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const [dateMode, setDateMode] = useState(false);
  const snapshot = projection.snapshot;
  const currentTime = snapshot
    ? Math.floor(Date.parse(snapshot.simulatedTime) / 1000)
    : Math.floor(Date.now() / 1000);
  const [dateInput, setDateInput] = useState(() => toInputDateTime(currentTime));
  const canReplay = backendSession;
  const label = useMemo(() => {
    if (selection !== "idle") return "Select bar";
    return snapshot ? "Select time" : "Replay timing";
  }, [selection, snapshot]);

  const startAt = (time: number) => {
    if (!canReplay) return;
    setBottomTab("replay");
    void startReplaySession(
      replaySessionInputAt(
        time,
        { symbol, chartTimeframe: timeframe },
        replayMode,
        layoutPreset,
        1,
        { panes, activeSlot },
      ),
    ).catch(() => undefined);
  };

  const moveTo = (time: number) => {
    if (!snapshot) {
      startAt(time);
      return;
    }
    const iso = new Date(time * 1000).toISOString();
    void moveActiveReplayTo(iso).catch(() => undefined);
  };

  const selectBar = () => {
    if (!canReplay) return;
    if (snapshot) beginReselect();
    else beginSelect();
    setBottomTab("replay");
  };

  const selectDate = () => {
    const time = parseDateInput(dateInput);
    if (time != null) moveTo(time);
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
            compact ? "h-8 px-2 text-[11px]" : "h-9 px-2.5 text-xs",
            open ? "bg-brand text-white" : "text-ink hover:bg-terminal-hover",
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
            Backend Replay timing
          </div>
          {dateMode ? (
            <div className="space-y-2 px-3 pb-2 pt-1">
              <input
                type="datetime-local"
                value={dateInput}
                onChange={(event) => setDateInput(event.target.value)}
                className="h-8 w-full rounded border border-terminal-border bg-terminal-bg px-2 text-[11px] text-ink outline-none focus:border-brand"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const first = snapshot?.tracks[0]?.dataset.firstAvailableTime;
                    if (first) moveTo(Date.parse(first) / 1000);
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
              <TimingItem icon={<BarChart3 size={16} />} label="Select bar" onClick={() => { selectBar(); close(); }} disabled={!canReplay} />
              <TimingItem
                icon={<CalendarClock size={16} />}
                label="Select date..."
                onClick={() => {
                  setDateInput(toInputDateTime(currentTime));
                  setDateMode(true);
                }}
                disabled={!canReplay}
              />
              <TimingItem
                icon={<Shuffle size={16} />}
                label="Random bar"
                onClick={() => {
                  const first = snapshot?.tracks[0]?.dataset.firstAvailableTime;
                  const last = snapshot?.tracks[0]?.dataset.lastAvailableTime;
                  const from = first ? Date.parse(first) / 1000 : Date.now() / 1000 - 30 * 86400;
                  const to = last ? Date.parse(last) / 1000 : Date.now() / 1000;
                  moveTo(Math.floor(from + Math.random() * Math.max(1, to - from)));
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
