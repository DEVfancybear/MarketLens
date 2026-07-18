"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { IChartApi, UTCTimestamp } from "lightweight-charts";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  X,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import type { Candle } from "@/types";
import {
  chartTimeZoneAtom,
  loadingAtom,
  resolvedChartTimeZoneAtom,
  setChartTimeZoneAtom,
  setCrosshairAtom,
  setTimeframeAtom,
  timeframeAtom,
} from "@/store/chartStore";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { useTerminalPlatform } from "@/hooks/useTerminalPlatform";
import { cn } from "@/utils/cn";
import { focusFirstWithin, trapFocusWithin } from "@/utils/focusManagement";
import {
  CHART_TIME_ZONE_OPTIONS,
  calendarCells,
  canSelectGoToTime,
  candlesCoverGoToTime,
  chartTimeZoneToIntlTimeZone,
  firstCandleIndexAtOrAfter,
  formatDateInput,
  formatGoToMarkerLabel,
  formatUtcOffset,
  goToSelectionDraft,
  goToDateLogicalRange,
  goToDialogPosition,
  parseLocalDateTime,
  type ChartTimeZoneId,
  type ChartTimeZoneOption,
  type ElementAnchor,
  type GoToSelection,
} from "./chartTimeNavigation";
import { getChartViewportController } from "./chartViewportController";
import {
  getTimeNavigationCatalog,
  resolveTimeNavigationShortcut,
  type TimeNavigationCatalog,
  type TimeNavigationResolution,
  type TimeNavigationShortcut,
  type TimeRangeShortcut,
} from "@/services/api/resources/timeNavigationApi";
import type { LoadedGoToHistory } from "@/hooks/useMarketData";
import { ChartPopupSurface } from "./ChartPopupSurface";

type GoToMarkerState = {
  id: number;
  time: number;
  label: string;
};
type PendingShortcutState = {
  resolution: TimeNavigationResolution;
  requestId: number;
};
type PendingGoToNavigation = {
  id: number;
  requestedTime: number;
  resolvedTime: number;
};
type ShortcutTooltipState = {
  text: string;
  left: number;
  top: number;
};

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const GO_TO_DIALOG_SIZE = { width: 302, height: 478 };
const TIME_ZONE_MENU_SIZE = { width: 250, height: 520 };

function formatClock(date: Date, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  if (timeZone) options.timeZone = timeZone;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function monthTitle(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(date);
}

function monthFromDateInput(value: string): Date {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : new Date();
}

function defaultGoToDraft(candles: Candle[], timeZone?: string) {
  const fallback = Date.now();
  const endMs = (candles[candles.length - 1]?.time ?? Math.floor(fallback / 1000)) * 1000;
  const singleDate = formatDateInput(endMs, timeZone);
  return {
    singleDate,
    singleTime: "00:00",
    month: monthFromDateInput(singleDate),
  };
}

function inputShell(className?: string) {
  return cn(
    "flex h-9 min-w-0 items-center rounded-xl border border-terminal-border-strong bg-terminal-panel px-2.5 text-[13px] font-semibold text-ink",
    "focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15",
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

function floatingMenuPosition(anchor: ElementAnchor, size: typeof TIME_ZONE_MENU_SIZE) {
  const gap = 8;
  const maxLeft = window.innerWidth - size.width - gap;
  const maxTop = window.innerHeight - size.height - gap;
  return {
    left: Math.min(Math.max(anchor.right - size.width, gap), Math.max(gap, maxLeft)),
    top: Math.min(
      Math.max(anchor.top - size.height - gap, gap),
      Math.max(gap, maxTop),
    ),
  };
}

function timeZoneOptionText(option: ChartTimeZoneOption, date: Date): string {
  if (!option.timeZone) return option.label;
  if (option.id === "UTC") return option.label;
  return `(${formatUtcOffset(date, option.timeZone)}) ${option.label}`;
}

function clearChartCrosshair(chart: IChartApi, clearStoreCrosshair: () => void) {
  clearStoreCrosshair();
  chart.clearCrosshairPosition();
  window.requestAnimationFrame(() => chart.clearCrosshairPosition());
}

function TimeZoneMenu({
  anchor,
  now,
  selected,
  onSelect,
  onClose,
}: {
  anchor: ElementAnchor | null;
  now: Date;
  selected: ChartTimeZoneId;
  onSelect: (timeZone: ChartTimeZoneId) => void;
  onClose: () => void;
}) {
  const mobile = useTerminalPlatform() === "mobile";
  const position = useMemo(
    () =>
      floatingMenuPosition(
        anchor ?? {
          left: window.innerWidth - 96,
          right: window.innerWidth - 8,
          top: window.innerHeight - 32,
          bottom: window.innerHeight,
        },
        TIME_ZONE_MENU_SIZE,
      ),
    [anchor],
  );

  return createPortal(
    <div data-chart-ui className="fixed inset-0 z-[85]">
      <ChartPopupSurface
        dragLabel="Move time zone menu"
        showDragHandle={mobile}
        dragHandleRole={mobile ? "menuitem" : undefined}
        resetKey={`${position.left}:${position.top}`}
        onDismiss={onClose}
        consumeOutsidePointerDown={mobile}
        data-chart-time-zone-menu
        role="menu"
        aria-label="Chart time zone"
        className={cn(
          "fixed max-h-[min(520px,calc(100vh-48px))] w-[250px] overflow-y-auto rounded-xl border border-terminal-border-strong bg-terminal-raised p-1.5 text-[13px] font-semibold text-ink shadow-floating",
          mobile && "mobile-chart-popup-portal",
        )}
        style={{
          left: position.left,
          top: position.top,
          maxHeight: "min(520px, calc(100dvh - 48px))",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {CHART_TIME_ZONE_OPTIONS.map((option, index) => {
          const active = option.id === selected;
          const afterPinned = index === 1;
          return (
            <div key={option.id}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => onSelect(option.id)}
                className={cn(
                  "flex h-9 w-full items-center justify-between rounded-lg px-3 text-left transition-colors hover:bg-terminal-hover",
                  active ? "bg-brand/12 text-brand" : "text-ink-muted",
                )}
              >
                <span className="truncate">{timeZoneOptionText(option, now)}</span>
              </button>
              {afterPinned && <div className="my-1 h-px bg-terminal-border" />}
            </div>
          );
        })}
      </ChartPopupSurface>
    </div>,
    document.body,
  );
}

export function ChartTimeToolbar({
  chart,
  candles,
  onLoadCandlesAroundTime,
  onTimeZoneChange,
}: {
  chart: IChartApi | null;
  candles: Candle[];
  onLoadCandlesAroundTime?: (time: number) => Promise<LoadedGoToHistory>;
  onTimeZoneChange?: (timeZone: string | undefined) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [goToOpen, setGoToOpen] = useState(false);
  const [goToAnchor, setGoToAnchor] = useState<ElementAnchor | null>(null);
  const [timeZoneOpen, setTimeZoneOpen] = useState(false);
  const [timeZoneAnchor, setTimeZoneAnchor] = useState<ElementAnchor | null>(null);
  const timeZoneId = useAtomValue(chartTimeZoneAtom);
  const setTimeZoneId = useSetAtom(setChartTimeZoneAtom);
  const setResolvedTimeZone = useSetAtom(resolvedChartTimeZoneAtom);
  const [goToMarker, setGoToMarker] = useState<GoToMarkerState | null>(null);
  const [lastGoToSelection, setLastGoToSelection] =
    useState<GoToSelection | null>(null);
  const [pendingGoToNavigation, setPendingGoToNavigation] =
    useState<PendingGoToNavigation | null>(null);
  const [activeShortcut, setActiveShortcut] =
    useState<TimeRangeShortcut | null>(null);
  const [navigationCatalog, setNavigationCatalog] =
    useState<TimeNavigationCatalog | null>(null);
  const [pendingShortcut, setPendingShortcut] =
    useState<PendingShortcutState | null>(null);
  const [tooltipState, setTooltipState] =
    useState<ShortcutTooltipState | null>(null);
  const pendingShortcutId = useRef(0);
  const goToTriggerRef = useRef<HTMLButtonElement>(null);
  const timeframe = useAtomValue(timeframeAtom);
  const loading = useAtomValue(loadingAtom);
  const setCrosshair = useSetAtom(setCrosshairAtom);
  const setTimeframe = useSetAtom(setTimeframeAtom);
  const backendExchangeTimeZone = navigationCatalog?.timeZone?.exchange;
  const activeTimeZone = chartTimeZoneToIntlTimeZone(
    timeZoneId,
    backendExchangeTimeZone,
  );

  useEffect(() => {
    setResolvedTimeZone(activeTimeZone ?? "UTC");
    onTimeZoneChange?.(activeTimeZone);
  }, [activeTimeZone, onTimeZoneChange, setResolvedTimeZone]);

  useEffect(() => {
    let cancelled = false;
    getTimeNavigationCatalog()
      .then((catalog) => {
        if (!cancelled) setNavigationCatalog(catalog);
      })
      .catch(() => {
        if (!cancelled) setNavigationCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const hotkey = navigationCatalog?.goTo.hotkey;
    if (!hotkey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== hotkey.key.toLowerCase() ||
        event.altKey !== hotkey.altKey ||
        !chart ||
        loading ||
        candles.length === 0
      ) {
        return;
      }
      event.preventDefault();
      setGoToAnchor(null);
      setGoToOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [candles.length, chart, loading, navigationCatalog]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const applyShortcutViewport = useCallback(
    (resolution: TimeNavigationResolution) => {
      if (!chart) return false;
      const viewport = getChartViewportController(chart);
      if (!viewport) return false;
      if (resolution.mode === "all") {
        viewport.fitContent("time-navigation");
        setActiveShortcut(resolution.shortcut);
        clearChartCrosshair(chart, () => setCrosshair(null));
        return true;
      }
      if (resolution.from == null || resolution.to == null) return false;
      viewport.setTimeRange(
        {
          from: resolution.from as UTCTimestamp,
          to: resolution.to as UTCTimestamp,
        },
        "time-navigation",
      );
      setActiveShortcut(resolution.shortcut);
      clearChartCrosshair(chart, () => setCrosshair(null));
      return true;
    },
    [chart, setCrosshair],
  );

  useEffect(() => {
    if (
      !pendingShortcut ||
      !chart ||
      pendingShortcut.resolution.timeframe !== timeframe ||
      loading ||
      candles.length === 0
    ) {
      return;
    }

    // Timeframe switches are asynchronous: the chart atom clears candles first,
    // then `useMarketData` seeds the target resolution. Apply the requested
    // range on the next frame so Lightweight Charts has the new series data.
    const request = pendingShortcut;
    const frame = window.requestAnimationFrame(() => {
      const applied = applyShortcutViewport(request.resolution);
      if (!applied) return;
      setPendingShortcut((current) =>
        current?.requestId === request.requestId ? null : current,
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    applyShortcutViewport,
    candles.length,
    chart,
    loading,
    pendingShortcut,
    timeframe,
  ]);

  const jumpShortcut = async (shortcut: TimeRangeShortcut) => {
    if (!chart) return;
    const anchorTime = candles[candles.length - 1]?.time;
    if (!anchorTime) return;
    pendingShortcutId.current += 1;
    const requestId = pendingShortcutId.current;
    let resolution: TimeNavigationResolution;
    try {
      resolution = await resolveTimeNavigationShortcut(shortcut, anchorTime);
    } catch {
      return;
    }
    if (requestId !== pendingShortcutId.current) return;
    setActiveShortcut(shortcut);

    if (resolution.timeframe !== timeframe) {
      setPendingShortcut({
        resolution,
        requestId,
      });
      setTimeframe(resolution.timeframe);
      return;
    }

    setPendingShortcut(null);
    applyShortcutViewport(resolution);
  };

  const showShortcutTooltip = (
    event:
      | MouseEvent<HTMLButtonElement>
      | FocusEvent<HTMLButtonElement>,
    shortcut: TimeNavigationShortcut,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltipState({
      text: shortcut.tooltip,
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    });
  };

  const openGoTo = (event: MouseEvent<HTMLButtonElement>) => {
    setGoToAnchor(elementAnchorFromRect(event.currentTarget.getBoundingClientRect()));
    setGoToOpen(true);
  };

  const closeGoTo = useCallback(() => {
    setGoToOpen(false);
    window.requestAnimationFrame(() => goToTriggerRef.current?.focus());
  }, []);

  const requestGoToNavigation = useCallback(async (requestedTime: number) => {
    let resolvedTime: number | undefined;
    if (candlesCoverGoToTime(candles, requestedTime)) {
      const index = firstCandleIndexAtOrAfter(candles, requestedTime);
      resolvedTime = index == null ? undefined : candles[index]?.time;
    }

    if (resolvedTime == null) {
      if (!onLoadCandlesAroundTime) {
        throw new Error("The selected date is outside the loaded chart history");
      }
      const loaded = await onLoadCandlesAroundTime(requestedTime);
      resolvedTime = loaded.resolvedTime;
    }

    if (!Number.isFinite(resolvedTime)) {
      throw new Error("No tradable candle exists at or after the selected time");
    }
    setLastGoToSelection({ time: requestedTime });
    setPendingGoToNavigation({
      id: Date.now(),
      requestedTime,
      resolvedTime,
    });
  }, [candles, onLoadCandlesAroundTime]);

  useEffect(() => {
    if (!chart || !pendingGoToNavigation) return;
    const index = candles.findIndex(
      (candle) => candle.time === pendingGoToNavigation.resolvedTime,
    );
    if (index < 0) return;
    const viewport = getChartViewportController(chart);
    if (!viewport) return;

    viewport.setLogicalRange(
      goToDateLogicalRange(
        index,
        chart.timeScale().getVisibleLogicalRange(),
      ),
      "time-navigation",
    );
    setGoToMarker({
      id: pendingGoToNavigation.id,
      time: pendingGoToNavigation.resolvedTime,
      label: formatGoToMarkerLabel(
        pendingGoToNavigation.resolvedTime,
        activeTimeZone,
      ),
    });
    clearChartCrosshair(chart, () => setCrosshair(null));
    setActiveShortcut(null);
    setPendingGoToNavigation(null);
  }, [
    activeTimeZone,
    candles,
    chart,
    pendingGoToNavigation,
    setCrosshair,
  ]);

  const openTimeZoneMenu = (event: MouseEvent<HTMLButtonElement>) => {
    setTimeZoneAnchor(elementAnchorFromRect(event.currentTarget.getBoundingClientRect()));
    setTimeZoneOpen(true);
  };

  return (
    <>
      <div className="chart-time-toolbar flex h-9 shrink-0 items-center border-t border-terminal-border bg-terminal-panel-2/75 px-1.5 text-xs text-ink-muted">
        <div className="flex min-w-0 items-center overflow-x-auto">
          {(navigationCatalog?.shortcuts ?? []).map((shortcut) => (
            <button
              key={shortcut.id}
              type="button"
              disabled={!chart || loading || candles.length === 0}
              onClick={() => void jumpShortcut(shortcut.id)}
              onMouseEnter={(event) => showShortcutTooltip(event, shortcut)}
              onMouseLeave={() => setTooltipState(null)}
              onFocus={(event) => showShortcutTooltip(event, shortcut)}
              onBlur={() => setTooltipState(null)}
              className={cn(
                "h-7 shrink-0 rounded-md px-2 font-semibold transition-colors disabled:cursor-default disabled:text-ink-faint disabled:opacity-50 disabled:hover:bg-transparent",
                activeShortcut === shortcut.id
                  ? "bg-brand/12 text-brand"
                  : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
              )}
            >
              {shortcut.id}
            </button>
          ))}
          <div className="mx-1 h-5 w-px shrink-0 bg-terminal-border" />
          <button
            ref={goToTriggerRef}
            type="button"
            disabled={!chart || loading || candles.length === 0}
            aria-label="Go to"
            title={`Go to${navigationCatalog ? ` (${navigationCatalog.goTo.hotkey.label})` : ""}`}
            onClick={openGoTo}
            className="flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <CalendarDays size={16} />
          </button>
        </div>
        <button
          type="button"
          aria-label="Select time zone"
          title="Time zone"
          onClick={openTimeZoneMenu}
          className="ml-auto hidden h-7 shrink-0 rounded-md px-2 font-semibold text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink sm:block"
        >
          {formatClock(now, activeTimeZone)} {formatUtcOffset(now, activeTimeZone)}
        </button>
      </div>
      {timeZoneOpen && (
        <TimeZoneMenu
          anchor={timeZoneAnchor}
          now={now}
          selected={timeZoneId}
          onSelect={(next) => {
            setTimeZoneId(next);
            setTimeZoneOpen(false);
          }}
          onClose={() => setTimeZoneOpen(false)}
        />
      )}
      {goToOpen && chart && (
        <GoToDialog
          candles={candles}
          timeZone={activeTimeZone}
          allowSpecificTime={canSelectGoToTime(
            timeframe,
            navigationCatalog?.goTo.specificTimeTimeframes ?? [],
          )}
          initialSelection={lastGoToSelection}
          anchor={goToAnchor}
          onApply={requestGoToNavigation}
          onClose={closeGoTo}
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
      {tooltipState &&
        createPortal(
          <div
            data-chart-ui
            className="pointer-events-none fixed z-[95] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-terminal-border-strong bg-terminal-raised px-2.5 py-1.5 text-xs font-semibold text-ink shadow-terminal"
            style={{ left: tooltipState.left, top: tooltipState.top }}
          >
            {tooltipState.text}
          </div>,
          document.body,
        )}
    </>
  );
}

function GoToDialog({
  candles,
  timeZone,
  allowSpecificTime,
  initialSelection,
  anchor,
  onApply,
  onClose,
}: {
  candles: Candle[];
  timeZone?: string;
  allowSpecificTime: boolean;
  initialSelection: GoToSelection | null;
  anchor: ElementAnchor | null;
  onApply: (time: number) => Promise<void>;
  onClose: () => void;
}) {
  const defaults = useMemo(() => {
    const base = defaultGoToDraft(candles, timeZone);
    if (!initialSelection) return base;
    const remembered = goToSelectionDraft(initialSelection, timeZone);
    return {
      ...base,
      ...remembered,
      month: monthFromDateInput(remembered.singleDate),
    };
  }, [candles, initialSelection, timeZone]);
  const [singleDate, setSingleDate] = useState(defaults.singleDate);
  const [singleTime, setSingleTime] = useState(defaults.singleTime);
  const [month, setMonth] = useState(defaults.month);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const cells = calendarCells(month.getFullYear(), month.getMonth());
  const selectedDate = singleDate;
  const todayDate = formatDateInput(Date.now(), timeZone);

  const setMonthFromDateDraft = (value: string) => {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
    if (!match) return;
    setMonth(new Date(Number(match[1]), Number(match[2]) - 1, 1));
  };

  const pickDate = (date: string) => {
    setSingleDate(date);
    setApplyError(null);
  };

  const apply = async () => {
    const targetTime = parseLocalDateTime(
      singleDate,
      allowSpecificTime ? singleTime : "00:00",
      timeZone,
    );
    if (targetTime == null) {
      setApplyError("Enter a valid date and time");
      return;
    }
    setApplyError(null);
    setIsApplying(true);
    try {
      await onApply(targetTime);
      setIsApplying(false);
      onClose();
    } catch (error) {
      setApplyError(
        error instanceof Error ? error.message : "Unable to load the selected date",
      );
      setIsApplying(false);
    }
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

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      focusFirstWithin(dialogRef.current, '[aria-label="Date"]'),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [dialogRef]);

  const dialog = (
    <div
      data-chart-ui
      className="platform-dialog-overlay fixed inset-0 z-[900] bg-[var(--scrim)]/70 backdrop-blur-[2px]"
      onMouseDown={isApplying ? undefined : onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="go-to-dialog-title"
        aria-busy={isApplying}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isApplying) {
            event.preventDefault();
            onClose();
            return;
          }
          trapFocusWithin(event);
        }}
        className="platform-dialog fixed w-[326px] overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised text-ink shadow-floating"
        style={dialogStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          data-dialog-header
          {...dragHandleProps}
          className={cn(
            "flex h-14 items-center justify-between border-b border-terminal-border px-5",
            dragHandleClassName,
          )}
        >
          <div id="go-to-dialog-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">Go to</div>
          <button
            type="button"
            aria-label="Close"
            disabled={isApplying}
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-terminal-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div data-dialog-body className="overflow-y-auto px-5 pt-4">
          <div className="mb-4 grid grid-cols-[minmax(0,1fr)_88px] gap-2">
            <DateInput
              value={singleDate}
              onChange={(value) => {
                setSingleDate(value);
                setMonthFromDateDraft(value);
                setApplyError(null);
              }}
            />
            <TimeInput
              value={allowSpecificTime ? singleTime : "00:00"}
              onChange={(value) => {
                setSingleTime(value);
                setApplyError(null);
              }}
              disabled={!allowSpecificTime}
            />
          </div>

          {applyError && (
            <p role="alert" className="-mt-2 mb-2 text-xs font-medium text-bear">
              {applyError}
            </p>
          )}

          <div className="mb-3 flex h-8 items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-terminal-hover hover:text-ink"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="text-sm font-semibold text-ink">
              {monthTitle(month)}
            </div>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-terminal-hover hover:text-ink"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 rounded-xl bg-terminal-panel-2 py-1.5 text-center text-[12px] font-semibold text-ink-faint">
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
                    cell.inMonth ? "text-ink" : "text-ink-faint",
                    selected && "bg-brand font-bold text-[var(--accent-contrast)]",
                    !selected && today && "border-brand",
                    !selected && "hover:bg-terminal-hover",
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>

        <div data-dialog-footer className="absolute bottom-0 left-0 right-0 flex h-16 items-center justify-end gap-3 border-t border-terminal-border bg-terminal-raised px-5">
          <button
            type="button"
            disabled={isApplying}
            onClick={onClose}
            className="h-10 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover disabled:cursor-wait disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isApplying}
            onClick={() => void apply()}
            className="flex h-10 min-w-[68px] items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover disabled:cursor-wait disabled:opacity-70"
          >
            {isApplying && <Loader2 size={15} className="animate-spin" />}
            {isApplying ? "Loading" : "Go to"}
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
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={inputShell()}>
      <input
        aria-label="Date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent tabular-nums outline-none focus-visible:!outline-none"
      />
      <CalendarDays size={16} className="shrink-0 text-ink-faint" />
    </label>
  );
}

function TimeInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={inputShell(disabled ? "opacity-50" : undefined)}>
      <input
        aria-label="Time"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent tabular-nums outline-none focus-visible:!outline-none disabled:cursor-not-allowed"
      />
      <Clock3 size={16} className="shrink-0 text-ink-faint" />
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
      <div className="h-full border-l border-dashed border-terminal-border-strong/80" />
      <div
        className="absolute left-0 -translate-x-1/2 whitespace-pre rounded-lg border border-terminal-border-strong bg-terminal-raised px-2.5 py-1.5 text-center text-[12px] font-semibold leading-[16px] text-ink shadow-floating"
        style={{ top: position.chipTop }}
      >
        {marker.label}
        <span className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-terminal-border-strong" />
      </div>
    </div>,
    document.body,
  );
}
