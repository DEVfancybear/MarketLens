"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react";
import { useSetAtom } from "jotai";
import type { Candle } from "@/types";
import { setCrosshairAtom } from "@/store/chartStore";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { cn } from "@/utils/cn";
import {
  TIME_RANGE_SHORTCUTS,
  calendarCells,
  firstCandleIndexAtOrAfter,
  formatDateInput,
  formatGoToMarkerLabel,
  formatTimeInput,
  formatUtcOffset,
  goToDateLogicalRange,
  goToDialogPosition,
  parseLocalDateTime,
  shortcutRange,
  type ElementAnchor,
} from "./chartTimeNavigation";

type GoToTab = "date" | "range";
type RangeField = "from" | "to";
type GoToMarkerState = {
  id: number;
  time: number;
  label: string;
};

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const GO_TO_DIALOG_SIZE = { width: 302, height: 478 };

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function monthTitle(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(date);
}

function defaultRange(candles: Candle[]) {
  const fallback = Date.now();
  const endMs = (candles[candles.length - 1]?.time ?? Math.floor(fallback / 1000)) * 1000;
  const startMs = endMs - 24 * 60 * 60 * 1000;
  return {
    singleDate: formatDateInput(endMs),
    singleTime: "00:00",
    fromDate: formatDateInput(startMs),
    fromTime: formatTimeInput(startMs),
    toDate: formatDateInput(endMs),
    toTime: formatTimeInput(endMs),
    month: new Date(endMs),
  };
}

function inputShell(className?: string) {
  return cn(
    "flex h-[34px] min-w-0 items-center rounded-md border border-[#5d606b] bg-[#202020] px-2 text-[13px] font-semibold text-[#f0f3fa]",
    "focus-within:border-[#9aa4b2]",
    className,
  );
}

function elementAnchorFromRect(rect: DOMRect): ElementAnchor {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function clearChartCrosshair(chart: IChartApi, clearStoreCrosshair: () => void) {
  clearStoreCrosshair();
  chart.clearCrosshairPosition();
  window.requestAnimationFrame(() => chart.clearCrosshairPosition());
}

export function ChartTimeToolbar({
  chart,
  candles,
}: {
  chart: IChartApi | null;
  candles: Candle[];
}) {
  const [now, setNow] = useState(() => new Date());
  const [goToOpen, setGoToOpen] = useState(false);
  const [goToAnchor, setGoToAnchor] = useState<ElementAnchor | null>(null);
  const [goToMarker, setGoToMarker] = useState<GoToMarkerState | null>(null);
  const setCrosshair = useSetAtom(setCrosshairAtom);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const jumpShortcut = (shortcut: (typeof TIME_RANGE_SHORTCUTS)[number]) => {
    if (!chart) return;
    const range = shortcutRange(shortcut, candles);
    if (!range) return;
    const timeScale = chart.timeScale();
    if (range === "all") {
      timeScale.fitContent();
      clearChartCrosshair(chart, () => setCrosshair(null));
      return;
    }
    timeScale.setVisibleRange({
      from: range.from as UTCTimestamp,
      to: range.to as UTCTimestamp,
    });
    clearChartCrosshair(chart, () => setCrosshair(null));
  };

  const openGoTo = (event: MouseEvent<HTMLButtonElement>) => {
    setGoToAnchor(elementAnchorFromRect(event.currentTarget.getBoundingClientRect()));
    setGoToOpen(true);
  };

  return (
    <>
      <div className="flex h-8 shrink-0 items-center border-t border-terminal-border bg-[#0f0f0f] px-1 text-[12px] text-[#d1d4dc]">
        <div className="flex min-w-0 items-center overflow-x-auto">
          {TIME_RANGE_SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut}
              type="button"
              disabled={!chart || candles.length === 0}
              onClick={() => jumpShortcut(shortcut)}
              className="h-7 shrink-0 rounded-sm px-1.5 font-semibold text-[#f0f3fa] transition-colors hover:bg-[#2a2a2a] disabled:cursor-default disabled:text-[#5d606b] disabled:hover:bg-transparent"
            >
              {shortcut}
            </button>
          ))}
          <div className="mx-1 h-5 w-px shrink-0 bg-[#2a2e39]" />
          <button
            type="button"
            disabled={!chart || candles.length === 0}
            aria-label="Go to"
            title="Go to"
            onClick={openGoTo}
            className="flex h-7 w-8 shrink-0 items-center justify-center rounded-sm text-[#f0f3fa] transition-colors hover:bg-[#2a2a2a] disabled:cursor-default disabled:text-[#5d606b] disabled:hover:bg-transparent"
          >
            <CalendarDays size={16} />
          </button>
        </div>
        <div className="ml-auto hidden shrink-0 px-2 font-semibold text-[#f0f3fa] sm:block">
          {formatClock(now)} {formatUtcOffset(now)}
        </div>
      </div>
      {goToOpen && chart && (
        <GoToDialog
          chart={chart}
          candles={candles}
          anchor={goToAnchor}
          onJump={(time) =>
            setGoToMarker({
              id: Date.now(),
              time,
              label: formatGoToMarkerLabel(time),
            })
          }
          onNavigationApplied={() => clearChartCrosshair(chart, () => setCrosshair(null))}
          onClose={() => setGoToOpen(false)}
        />
      )}
      {chart && goToMarker && (
        <GoToJumpMarker
          key={goToMarker.id}
          chart={chart}
          marker={goToMarker}
          onDone={() => setGoToMarker(null)}
        />
      )}
    </>
  );
}

function GoToDialog({
  chart,
  candles,
  anchor,
  onJump,
  onNavigationApplied,
  onClose,
}: {
  chart: IChartApi;
  candles: Candle[];
  anchor: ElementAnchor | null;
  onJump: (time: number) => void;
  onNavigationApplied: () => void;
  onClose: () => void;
}) {
  const defaults = useMemo(() => defaultRange(candles), [candles]);
  const [tab, setTab] = useState<GoToTab>("date");
  const [singleDate, setSingleDate] = useState(defaults.singleDate);
  const [singleTime, setSingleTime] = useState(defaults.singleTime);
  const [fromDate, setFromDate] = useState(defaults.fromDate);
  const [fromTime, setFromTime] = useState(defaults.fromTime);
  const [toDate, setToDate] = useState(defaults.toDate);
  const [toTime, setToTime] = useState(defaults.toTime);
  const [activeRangeField, setActiveRangeField] = useState<RangeField>("from");
  const [month, setMonth] = useState(defaults.month);

  const cells = calendarCells(month.getFullYear(), month.getMonth());
  const selectedDate =
    tab === "date" ? singleDate : activeRangeField === "from" ? fromDate : toDate;
  const todayDate = formatDateInput(Date.now());

  const setMonthFromDateDraft = (value: string) => {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
    if (!match) return;
    setMonth(new Date(Number(match[1]), Number(match[2]) - 1, 1));
  };

  const pickDate = (date: string) => {
    if (tab === "date") {
      setSingleDate(date);
    } else if (activeRangeField === "from") {
      setFromDate(date);
    } else {
      setToDate(date);
    }
  };

  const apply = () => {
    if (tab === "date") {
      const targetTime = parseLocalDateTime(singleDate, singleTime);
      if (targetTime == null) return;
      const index = firstCandleIndexAtOrAfter(candles, targetTime);
      if (index == null) return;
      const range = goToDateLogicalRange(
        index,
        chart.timeScale().getVisibleLogicalRange(),
      );
      chart.timeScale().setVisibleLogicalRange(range);
      onJump(candles[index].time);
      onNavigationApplied();
      onClose();
      return;
    }

    const from = parseLocalDateTime(fromDate, fromTime);
    const to = parseLocalDateTime(toDate, toTime);
    if (from == null || to == null) return;
    chart.timeScale().setVisibleRange({
      from: Math.min(from, to) as UTCTimestamp,
      to: Math.max(from, to) as UTCTimestamp,
    });
    onNavigationApplied();
    onClose();
  };

  const shiftMonth = (delta: number) => {
    setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const initialPosition = useCallback(
    () =>
      goToDialogPosition(
        anchor ?? {
          left: 16,
          top: window.innerHeight - 40,
          right: 48,
          bottom: window.innerHeight - 12,
        },
        { width: window.innerWidth, height: window.innerHeight },
        GO_TO_DIALOG_SIZE,
      ),
    [anchor],
  );
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog({ initialPosition });

  const dialog = (
    <div data-chart-ui className="fixed inset-0 z-[90]" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="fixed w-[302px] overflow-hidden rounded-md border border-[#2b2b2b] bg-[#1f1f1f] text-[#d1d4dc] shadow-2xl shadow-black/60"
        style={dialogStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          {...dragHandleProps}
          className={cn(
            "flex h-[56px] items-center justify-between px-5",
            dragHandleClassName,
          )}
        >
          <div className="text-[20px] font-semibold text-[#d1d4dc]">Go to</div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-[#d1d4dc] hover:bg-[#2a2a2a]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5">
          <div className="relative mb-4 flex h-10 items-end gap-5 border-b-4 border-[#55575f]">
            <button
              type="button"
              onClick={() => setTab("date")}
              className={cn(
                "relative h-8 text-[14px] font-semibold",
                tab === "date" ? "text-[#f0f3fa]" : "text-[#b2b5be]",
              )}
            >
              Date
              {tab === "date" && (
                <span className="absolute -bottom-1 left-0 h-1 w-full rounded bg-[#f0f3fa]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab("range")}
              className={cn(
                "relative h-8 text-[14px] font-semibold",
                tab === "range" ? "text-[#f0f3fa]" : "text-[#b2b5be]",
              )}
            >
              Custom range
              {tab === "range" && (
                <span className="absolute -bottom-1 left-0 h-1 w-full rounded bg-[#f0f3fa]" />
              )}
            </button>
          </div>

          {tab === "date" ? (
            <div className="mb-4 grid grid-cols-[minmax(0,1fr)_88px] gap-2">
              <DateInput
                value={singleDate}
                onChange={(value) => {
                  setSingleDate(value);
                  setMonthFromDateDraft(value);
                }}
              />
              <TimeInput value={singleTime} onChange={setSingleTime} />
            </div>
          ) : (
            <div className="mb-4 space-y-3">
              <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
                <DateInput
                  value={fromDate}
                  onFocus={() => setActiveRangeField("from")}
                  onChange={(value) => {
                    setFromDate(value);
                    setMonthFromDateDraft(value);
                  }}
                />
                <TimeInput value={fromTime} onChange={setFromTime} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
                <DateInput
                  value={toDate}
                  onFocus={() => setActiveRangeField("to")}
                  onChange={(value) => {
                    setToDate(value);
                    setMonthFromDateDraft(value);
                  }}
                />
                <TimeInput value={toTime} onChange={setToTime} />
              </div>
            </div>
          )}

          <div className="mb-3 flex h-8 items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
              className="flex h-8 w-8 items-center justify-center rounded text-[#b2b5be] hover:bg-[#2a2a2a] hover:text-[#f0f3fa]"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="text-[14px] font-semibold text-[#d1d4dc]">
              {monthTitle(month)}
            </div>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
              className="flex h-8 w-8 items-center justify-center rounded text-[#55575f] hover:bg-[#2a2a2a] hover:text-[#f0f3fa]"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 rounded-md bg-[#2a2a2a] py-1 text-center text-[13px] italic text-[#a4a7ad]">
            {WEEKDAYS.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1 pb-[78px] text-center text-[16px] font-semibold">
            {cells.map((cell) => {
              const selected = cell.date === selectedDate;
              const today = cell.date === todayDate;
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => pickDate(cell.date)}
                  className={cn(
                    "mx-auto flex h-9 w-9 items-center justify-center rounded-md border-b-4 border-transparent",
                    cell.inMonth ? "text-[#f0f3fa]" : "text-[#55575f]",
                    selected && "bg-[#f0f3fa] font-bold text-[#131722]",
                    !selected && today && "border-[#d1d4dc]",
                    !selected && "hover:bg-[#2a2a2a]",
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 flex h-[66px] items-center justify-end gap-3 border-t border-[#434651] bg-[#1f1f1f] px-5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-[#f0f3fa] px-4 text-[14px] font-semibold text-[#f0f3fa] hover:bg-[#2a2a2a]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="h-9 rounded-md bg-[#f0f3fa] px-4 text-[14px] font-semibold text-[#131722] hover:bg-white"
          >
            Go to
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

function DateInput({
  value,
  onChange,
  onFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
}) {
  return (
    <label className={inputShell()}>
      <input
        value={value}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
      />
      <CalendarDays size={16} className="shrink-0 text-[#b2b5be]" />
    </label>
  );
}

function TimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={inputShell()}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
      />
      <Clock3 size={16} className="shrink-0 text-[#b2b5be]" />
    </label>
  );
}

function GoToJumpMarker({
  chart,
  marker,
  onDone,
}: {
  chart: IChartApi;
  marker: GoToMarkerState;
  onDone: () => void;
}) {
  const [position, setPosition] = useState<{
    x: number;
    top: number;
    bottom: number;
    chipTop: number;
  } | null>(null);

  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const start = performance.now();
    const timeout = window.setTimeout(onDone, 3600);
    const chartElement = chart.chartElement();
    const chartScope = chartElement.parentElement ?? chartElement;

    const dismissOnChartInteraction = () => {
      if (!disposed) onDone();
    };

    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissOnChartInteraction();
    };

    const project = () => {
      if (disposed) return;
      const x = chart.timeScale().timeToCoordinate(marker.time as UTCTimestamp);
      if (chartElement && x != null) {
        const rect = chartElement.getBoundingClientRect();
        const height = Math.max(0, rect.bottom - rect.top);
        setPosition({
          x: rect.left + x,
          top: rect.top,
          bottom: rect.bottom,
          chipTop: Math.min(Math.max(96, height * 0.14), 128),
        });
      }
      if (performance.now() - start < 700) {
        frame = window.requestAnimationFrame(project);
      }
    };

    frame = window.requestAnimationFrame(project);
    window.addEventListener("resize", project);
    // Listen on the chart wrapper, not only the Lightweight Charts element.
    // Drawing canvases and app overlays can sit as siblings above the chart; a
    // capture listener on the shared wrapper makes any chart interaction clear
    // the temporary Go-to chip just like TradingView.
    chartScope.addEventListener("pointerdown", dismissOnChartInteraction, true);
    chartScope.addEventListener("wheel", dismissOnChartInteraction, {
      capture: true,
      passive: true,
    });
    chartScope.addEventListener("touchstart", dismissOnChartInteraction, {
      capture: true,
      passive: true,
    });
    window.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", project);
      chartScope.removeEventListener(
        "pointerdown",
        dismissOnChartInteraction,
        true,
      );
      chartScope.removeEventListener("wheel", dismissOnChartInteraction, true);
      chartScope.removeEventListener(
        "touchstart",
        dismissOnChartInteraction,
        true,
      );
      window.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [chart, marker.time, onDone]);

  if (!position) return null;

  return createPortal(
    <div
      data-chart-ui
      className="pointer-events-none fixed z-[80]"
      style={{
        left: position.x,
        top: position.top,
        height: Math.max(0, position.bottom - position.top),
      }}
    >
      <div className="h-full border-l border-dashed border-[#8a8d93]/80" />
      <div
        className="absolute left-0 -translate-x-1/2 whitespace-pre rounded-sm bg-[#5c5c5c] px-2.5 py-1.5 text-center text-[12px] font-semibold leading-[16px] text-white shadow-lg shadow-black/40"
        style={{ top: position.chipTop }}
      >
        {marker.label}
        <span className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-[#5c5c5c]" />
      </div>
    </div>,
    document.body,
  );
}
