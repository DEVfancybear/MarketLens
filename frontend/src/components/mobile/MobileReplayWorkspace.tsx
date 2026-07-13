"use client";

import { useState, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Gauge,
  LoaderCircle,
  Pause,
  Play,
  Power,
  RotateCcw,
} from "lucide-react";
import { backendSessionAtom } from "@/store/authStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import {
  exitReplaySession,
  restartActiveReplay,
  setActiveReplayPlaying,
  setActiveReplaySpeed,
  stepActiveReplay,
} from "@/services/replay/replaySocket";
import { isReplayBackendV1Enabled } from "@/services/replay/backendReplayFlag";
import {
  beginReplayReselectionAtom,
  beginReplaySelectionAtom,
  cancelReplaySelectionAtom,
  replayControlMessage,
  replaySelectionModeAtom,
  REPLAY_SPEEDS,
  replaySpeedDescription,
  replaySpeedLabel,
} from "@/store/replayUiState";
import type { ReplaySessionSnapshot } from "@/services/api/resources/replayApi";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtMoney, fmtPrice } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";
import { cn } from "@/utils/cn";

export interface MobileReplayWorkspaceProps {
  returnToChart: () => void;
}

type PendingAction =
  | "playback"
  | "step-back"
  | "step-forward"
  | "restart"
  | "speed"
  | "exit";

/** Mobile-native Replay presentation backed only by shared Replay state/services. */
export function MobileReplayWorkspace({
  returnToChart,
}: MobileReplayWorkspaceProps) {
  const projection = useReplayClientProjection();
  const backendSession = useAtomValue(backendSessionAtom);
  const selection = useAtomValue(replaySelectionModeAtom);
  const beginSelection = useSetAtom(beginReplaySelectionAtom);
  const beginReselection = useSetAtom(beginReplayReselectionAtom);
  const cancelSelection = useSetAtom(cancelReplaySelectionAtom);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

  const snapshot = projection.snapshot;
  const enabled = isReplayBackendV1Enabled();
  const connecting =
    projection.connection === "connecting" ||
    projection.connection === "recovering";

  const runAction = async (
    action: PendingAction,
    command: () => Promise<void>,
    onSuccess?: () => void,
  ) => {
    if (pending) return;
    setPending(action);
    setCommandError(null);
    try {
      await command();
      onSuccess?.();
    } catch (error) {
      setCommandError(
        error instanceof Error ? error.message : "Replay command failed",
      );
    } finally {
      setPending(null);
    }
  };

  const startFromChart = () => {
    setCommandError(null);
    beginSelection();
    returnToChart();
  };

  const selectAnotherBar = () => {
    setCommandError(null);
    if (snapshot?.status === "playing") {
      void setActiveReplayPlaying(false).catch(() => undefined);
    }
    beginReselection();
    returnToChart();
  };

  if (selection !== "idle") {
    const reselecting = selection === "reselecting";
    return (
      <section
        data-chart-ui
        aria-labelledby="mobile-replay-selection-title"
        className="flex min-h-full flex-col bg-terminal-bg p-4"
      >
        <div className="flex min-h-[55dvh] flex-col items-center justify-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/20 bg-brand/10 text-brand">
            <BarChart3 size={25} />
          </span>
          <h3
            id="mobile-replay-selection-title"
            className="text-lg font-bold text-ink"
          >
            {reselecting ? "Choose a new Replay bar" : "Choose the first Replay bar"}
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-ink-muted">
            Return to the chart, then tap the candle where the backend-owned
            Replay session should begin.
          </p>
          <div className="mt-6 grid w-full max-w-sm grid-cols-1 gap-2">
            <button
              type="button"
              onClick={returnToChart}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-[var(--accent-contrast)] shadow-accent transition-colors active:bg-brand-hover"
            >
              <BarChart3 size={18} /> Return to chart
            </button>
            <button
              type="button"
              onClick={() => cancelSelection()}
              className="flex min-h-12 items-center justify-center rounded-xl border border-terminal-border bg-terminal-panel-2 px-4 text-sm font-semibold text-ink-muted transition-colors active:bg-terminal-pressed"
            >
              Cancel selection
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!snapshot) {
    const unavailable = replayControlMessage({
      enabled,
      authenticated: backendSession,
      connection: projection.connection,
      error: projection.error,
    });
    const disabled = !enabled || !backendSession || connecting;

    return (
      <section
        data-chart-ui
        aria-labelledby="mobile-replay-idle-title"
        className="flex min-h-full flex-col bg-terminal-bg p-4"
      >
        <div className="flex min-h-[55dvh] flex-col items-center justify-center text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/20 bg-brand/10 text-brand">
            {connecting ? (
              <LoaderCircle size={25} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Play size={25} fill="currentColor" />
            )}
          </span>
          <h3 id="mobile-replay-idle-title" className="text-lg font-bold text-ink">
            Replay the market, one bar at a time
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-ink-muted">
            Select a candle on the chart. The server owns time, revealed bars and
            the isolated trading ledger.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={startFromChart}
            className="mt-6 flex min-h-12 w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-[var(--accent-contrast)] shadow-accent transition-colors active:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            {connecting ? (
              <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <BarChart3 size={18} />
            )}
            {connecting ? "Preparing Replay..." : "Select start bar on chart"}
          </button>
          <p
            role={projection.error ? "alert" : "status"}
            aria-live="polite"
            className={cn(
              "mt-3 max-w-sm text-xs leading-5",
              projection.error ? "text-bear" : "text-ink-faint",
            )}
          >
            {unavailable ?? "Replay is ready."}
          </p>
        </div>
      </section>
    );
  }

  const track = snapshot.tracks[0];
  const bars = track ? projection.barsByTrack[track.id] ?? [] : [];
  const currentBar = bars[bars.length - 1];
  const rowCount = track?.dataset.rowCount ?? 0;
  const cursor = track?.cursorSeq ?? 0;
  const progress = rowCount > 0
    ? Math.min(100, Math.max(0, (cursor / rowCount) * 100))
    : 0;
  const precision = getMarketSymbol(track?.symbol ?? "")?.pricePrecision ?? 2;
  const playing = snapshot.status === "playing";
  const completed = snapshot.status === "completed";
  const terminal = snapshot.status === "closed" || snapshot.status === "failed";
  const controlsDisabled = pending !== null || connecting || terminal || snapshot.status === "preparing";
  const openPositions = snapshot.trading?.positions.filter(
    (position) => Math.abs(position.netQuantity) > 1e-12,
  ).length ?? 0;
  const equity = snapshot.trading?.account.equity;
  const feedback = commandError ?? projection.error ?? snapshot.pauseReason ?? null;

  return (
    <section
      data-chart-ui
      aria-labelledby="mobile-replay-active-title"
      aria-busy={pending !== null || connecting}
      className="min-h-full bg-terminal-bg p-4"
    >
      <header className="flex min-w-0 items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-brand">
          <Gauge size={21} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3
              id="mobile-replay-active-title"
              className="truncate text-base font-bold text-ink"
            >
              {track?.symbol ?? "Market Replay"}
              {track?.chartTimeframe ? ` / ${track.chartTimeframe}` : ""}
            </h3>
            <ReplayStatus status={snapshot.status} />
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {formatReplayTime(snapshot.simulatedTime)}
          </p>
        </div>
        <ConnectionStatus connection={projection.connection} />
      </header>

      <div className="mt-4 rounded-2xl border border-terminal-border bg-terminal-panel p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-ink-muted">Dataset progress</span>
          <span className="font-semibold tabular text-ink">{Math.round(progress)}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Replay dataset progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="h-2 overflow-hidden rounded-full bg-terminal-panel-3"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Source row" value={`${cursor.toLocaleString()} / ${rowCount.toLocaleString()}`} />
        <Metric label="Visible bars" value={bars.length.toLocaleString()} />
        <Metric label="Last price" value={currentBar ? fmtPrice(currentBar.close, precision) : "--"} />
        <Metric label="Speed" value={replaySpeedLabel(snapshot.speed)} accent />
        <Metric label="Equity" value={equity == null ? "--" : fmtMoney(equity)} />
        <Metric label="Open positions" value={openPositions.toLocaleString()} />
      </div>

      <section aria-labelledby="mobile-replay-transport" className="mt-5">
        <h4
          id="mobile-replay-transport"
          className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint"
        >
          Transport
        </h4>
        <div className="grid grid-cols-3 gap-2">
          <TransportButton
            label="Previous bar"
            detail="-1"
            icon={<ChevronLeft size={20} />}
            disabled={controlsDisabled}
            onClick={() => void runAction("step-back", () => stepActiveReplay(-1))}
          />
          <TransportButton
            label={playing ? "Pause" : "Play"}
            icon={playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
            primary
            disabled={controlsDisabled || completed}
            onClick={() =>
              void runAction("playback", () => setActiveReplayPlaying(!playing))
            }
          />
          <TransportButton
            label="Next bar"
            detail="+1"
            icon={<ChevronRight size={20} />}
            disabled={controlsDisabled || completed}
            onClick={() => void runAction("step-forward", () => stepActiveReplay(1))}
          />
        </div>
      </section>

      <fieldset className="mt-5">
        <legend className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
          Replay speed
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {REPLAY_SPEEDS.map((speed) => {
            const active = speed === snapshot.speed;
            return (
              <button
                key={speed}
                type="button"
                aria-pressed={active}
                aria-label={`Set Replay speed to ${replaySpeedLabel(speed)}`}
                disabled={controlsDisabled}
                onClick={() =>
                  void runAction("speed", () => setActiveReplaySpeed(speed))
                }
                className={cn(
                  "min-h-11 rounded-xl border px-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                  active
                    ? "border-brand bg-brand/15 text-brand"
                    : "border-terminal-border bg-terminal-panel-2 text-ink-muted active:bg-terminal-pressed",
                )}
              >
                {replaySpeedLabel(speed)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          {replaySpeedDescription(snapshot.speed)}
        </p>
      </fieldset>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={() => void runAction("restart", restartActiveReplay)}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-terminal-border bg-terminal-panel-2 px-3 text-sm font-semibold text-ink transition-colors active:bg-terminal-pressed disabled:cursor-not-allowed disabled:opacity-45"
        >
          <RotateCcw size={18} /> Restart
        </button>
        <button
          type="button"
          disabled={connecting || terminal}
          onClick={selectAnotherBar}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-terminal-border bg-terminal-panel-2 px-3 text-sm font-semibold text-ink transition-colors active:bg-terminal-pressed disabled:cursor-not-allowed disabled:opacity-45"
        >
          <BarChart3 size={18} /> Select bar
        </button>
      </div>

      <button
        type="button"
        disabled={pending !== null}
        onClick={() => {
          cancelSelection();
          void runAction("exit", exitReplaySession, returnToChart);
        }}
        className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-bear/30 bg-bear/10 px-4 text-sm font-semibold text-bear transition-colors active:bg-bear/15 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Power size={18} /> Exit Replay
      </button>

      <div
        role={commandError || projection.error ? "alert" : "status"}
        aria-live="polite"
        className={cn(
          "mt-3 flex min-h-11 items-center rounded-xl border px-3 text-xs leading-5",
          commandError || projection.error
            ? "border-bear/30 bg-bear/10 text-bear"
            : "border-terminal-border bg-terminal-panel-2 text-ink-muted",
        )}
      >
        {pending || connecting ? (
          <span className="flex items-center gap-2">
            <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />
            Updating Replay...
          </span>
        ) : (
          feedback ?? `Replay is ${statusLabel(snapshot.status).toLowerCase()}.`
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-terminal-border bg-terminal-panel-2 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate text-sm font-semibold tabular",
          accent ? "text-brand" : "text-ink",
        )}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function TransportButton({
  label,
  detail,
  icon,
  primary = false,
  disabled,
  onClick,
}: {
  label: string;
  detail?: string;
  icon: ReactNode;
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        primary
          ? "border-brand bg-brand text-[var(--accent-contrast)] shadow-accent active:bg-brand-hover"
          : "border-terminal-border bg-terminal-panel-2 text-ink active:bg-terminal-pressed",
      )}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="truncate">{label}</span>
      {detail && <span className="text-[10px] opacity-70">{detail}</span>}
    </button>
  );
}

function ReplayStatus({ status }: { status: ReplaySessionSnapshot["status"] }) {
  const tone = status === "playing"
    ? "border-bull/25 bg-bull/10 text-bull"
    : status === "failed" || status === "closed"
      ? "border-bear/25 bg-bear/10 text-bear"
      : status === "preparing"
        ? "border-choch/25 bg-choch/10 text-choch"
        : "border-terminal-border bg-terminal-panel-2 text-ink-muted";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        tone,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function ConnectionStatus({ connection }: { connection: string }) {
  const tone = connection === "connected"
    ? "text-bull"
    : connection === "connecting" || connection === "recovering"
      ? "text-choch"
      : connection === "error" || connection === "disconnected"
        ? "text-bear"
        : "text-ink-faint";
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 text-[10px] font-semibold capitalize", tone)}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {connection}
    </span>
  );
}

function formatReplayTime(value: string): string {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? `${fmtDateTime(milliseconds / 1000)} UTC`
    : "Replay time unavailable";
}

function statusLabel(status: ReplaySessionSnapshot["status"]): string {
  switch (status) {
    case "preparing": return "Preparing";
    case "paused": return "Paused";
    case "playing": return "Playing";
    case "completed": return "Completed";
    case "closed": return "Closed";
    case "failed": return "Failed";
  }
}
