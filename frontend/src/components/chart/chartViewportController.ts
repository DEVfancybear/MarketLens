import type {
  IChartApi,
  IRange,
  LogicalRange,
  Time,
} from "lightweight-charts";

export type ChartViewportCause =
  | "user"
  | "initial-fit"
  | "history-prepend"
  | "replay-realign"
  | "time-navigation"
  | "reset"
  | "benchmark";

export interface ChartViewportSnapshot {
  revision: number;
  programmaticWrites: number;
  cause: ChartViewportCause;
  logicalRange: LogicalRange | null;
}

export interface ChartViewportDefaults {
  rightOffset: number;
  barSpacing: number;
  minBarSpacing: number;
}

export interface LogicalRangeInput {
  from: number;
  to: number;
}

type Listener = (snapshot: ChartViewportSnapshot) => void;

const controllers = new WeakMap<IChartApi, ChartViewportController>();

function cloneRange(range: LogicalRange | null): LogicalRange | null {
  return range ? { from: range.from, to: range.to } : null;
}

function rangesEqual(a: LogicalRange | null, b: LogicalRange | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(Number(a.from) - Number(b.from)) < 0.0001 &&
    Math.abs(Number(a.to) - Number(b.to)) < 0.0001;
}

/**
 * Single programmatic writer for the main trading-chart viewport.
 *
 * User gestures still belong to Lightweight Charts. Every application-driven
 * fit, jump, restore, replay alignment, reset, and benchmark mutation must go
 * through this controller so delayed work can be attributed and inspected.
 */
export class ChartViewportController {
  private readonly listeners = new Set<Listener>();
  private applying = false;
  private settlingCause: ChartViewportCause | null = null;
  private settlingUntil = 0;
  private snapshotValue: ChartViewportSnapshot;

  private readonly handleUserRange = (range: LogicalRange | null) => {
    if (this.applying || rangesEqual(range, this.snapshotValue.logicalRange)) return;
    if (this.settlingCause && Date.now() <= this.settlingUntil) {
      this.publish(this.settlingCause, false, range);
      return;
    }
    this.settlingCause = null;
    this.publish("user", false, range);
  };

  constructor(private readonly chart: IChartApi) {
    this.snapshotValue = {
      revision: 0,
      programmaticWrites: 0,
      cause: "user",
      logicalRange: cloneRange(chart.timeScale().getVisibleLogicalRange()),
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(this.handleUserRange);
    controllers.set(chart, this);
  }

  snapshot(): ChartViewportSnapshot {
    return {
      ...this.snapshotValue,
      logicalRange: cloneRange(this.snapshotValue.logicalRange),
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called only from real DOM input, never from range notifications. */
  beginUserInteraction(): void {
    this.settlingCause = null;
    this.settlingUntil = 0;
  }

  setLogicalRange(range: LogicalRangeInput, cause: ChartViewportCause): boolean {
    const current = this.chart.timeScale().getVisibleLogicalRange();
    const logicalRange = range as LogicalRange;
    if (rangesEqual(current, logicalRange)) {
      this.publish(cause, false, current);
      this.startSettling(cause);
      return false;
    }
    return this.write(cause, () => this.chart.timeScale().setVisibleLogicalRange(logicalRange));
  }

  /**
   * Apply a deferred range only when no newer viewport mutation has happened.
   *
   * Data replacement schedules a next-frame range restore so prepending older
   * candles does not move a user's current view. A Go-to jump (or a real user
   * gesture) can happen before that frame runs; in that case the restore is
   * stale and must not overwrite the newer viewport decision.
   */
  setLogicalRangeIfRevision(
    range: LogicalRangeInput,
    cause: ChartViewportCause,
    expectedRevision: number,
  ): boolean {
    if (this.snapshotValue.revision !== expectedRevision) return false;
    return this.setLogicalRange(range, cause);
  }

  setTimeRange(range: IRange<Time>, cause: ChartViewportCause): boolean {
    return this.write(cause, () => this.chart.timeScale().setVisibleRange(range));
  }

  fitContent(cause: ChartViewportCause): boolean {
    return this.write(cause, () => this.chart.timeScale().fitContent());
  }

  reset(defaults: ChartViewportDefaults): boolean {
    return this.write("reset", () => {
      const timeScale = this.chart.timeScale();
      timeScale.applyOptions(defaults);
      timeScale.resetTimeScale();
      timeScale.scrollToRealTime();
      this.chart.priceScale("right", 0).applyOptions({ autoScale: true });
    });
  }

  destroy(): void {
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.handleUserRange);
    this.listeners.clear();
    controllers.delete(this.chart);
  }

  private write(cause: ChartViewportCause, mutation: () => void): boolean {
    this.applying = true;
    try {
      mutation();
    } finally {
      this.applying = false;
    }
    this.publish(cause, true, this.chart.timeScale().getVisibleLogicalRange());
    this.startSettling(cause);
    return true;
  }

  private startSettling(cause: ChartViewportCause) {
    this.settlingCause = cause;
    this.settlingUntil = Date.now() + 1_000;
  }

  private publish(
    cause: ChartViewportCause,
    programmatic: boolean,
    range: LogicalRange | null,
  ) {
    this.snapshotValue = {
      revision: this.snapshotValue.revision + 1,
      programmaticWrites:
        this.snapshotValue.programmaticWrites + (programmatic ? 1 : 0),
      cause,
      logicalRange: cloneRange(range),
    };
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export function installChartViewportController(chart: IChartApi) {
  return controllers.get(chart) ?? new ChartViewportController(chart);
}

export function getChartViewportController(chart: IChartApi | null | undefined) {
  return chart ? controllers.get(chart) ?? null : null;
}
