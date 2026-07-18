import type { TechnicalAlertEvidence } from "@/types/technicalAlerts";

export interface BrowserAlertTriggerCandidate {
  alertId: string;
  revision: string;
  triggerPrice: number;
  targetPrice: number;
  evidence?: TechnicalAlertEvidence;
}

export type BrowserAlertTriggerAttempt<T> =
  | {
      status: "committed";
      value: T;
    }
  | { status: "retryable" }
  | { status: "discarded" };

interface PendingAttempt {
  candidate: BrowserAlertTriggerCandidate;
  attempts: number;
}

interface BrowserAlertTriggerQueueOptions<T> {
  attempt: (
    candidate: BrowserAlertTriggerCandidate,
  ) => Promise<BrowserAlertTriggerAttempt<T>>;
  isCurrent: (candidate: BrowserAlertTriggerCandidate) => boolean;
  notify: (value: T, candidate: BrowserAlertTriggerCandidate) => void;
  retryBaseMs?: number;
  retryMaxMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Retains the exact crossing evidence until PostgreSQL accepts or permanently
 * rejects it. Price cursors may advance while this queue retries, so a brief
 * API outage cannot silently consume a trendline crossing.
 */
export class BrowserAlertTriggerQueue<T> {
  private readonly pending = new Map<string, PendingAttempt>();
  private readonly inFlight = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(private readonly options: BrowserAlertTriggerQueueOptions<T>) {}

  enqueue(candidate: BrowserAlertTriggerCandidate): void {
    if (this.disposed) return;
    const existing = this.pending.get(candidate.alertId);
    if (existing?.candidate.revision === candidate.revision) return;
    this.clearTimer(candidate.alertId);
    this.pending.set(candidate.alertId, { candidate, attempts: 0 });
    void this.run(candidate.alertId);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.timers.keys()) this.clearTimer(id);
    this.pending.clear();
  }

  /** Exposed for deterministic lifecycle regression tests. */
  pendingCount(): number {
    return this.pending.size;
  }

  private async run(alertId: string): Promise<void> {
    if (this.disposed || this.inFlight.has(alertId)) return;
    const entry = this.pending.get(alertId);
    if (!entry) return;
    if (!this.options.isCurrent(entry.candidate)) {
      this.pending.delete(alertId);
      this.clearTimer(alertId);
      return;
    }

    this.inFlight.add(alertId);
    entry.attempts += 1;
    try {
      const outcome = await this.options.attempt(entry.candidate);
      if (this.pending.get(alertId) !== entry) return;
      if (outcome.status === "committed") {
        this.pending.delete(alertId);
        this.clearTimer(alertId);
        try {
          this.options.notify(outcome.value, entry.candidate);
        } catch {
          // Notification channels are best-effort after the canonical commit.
        }
        return;
      }
      if (
        outcome.status === "discarded" ||
        !this.options.isCurrent(entry.candidate)
      ) {
        this.pending.delete(alertId);
        this.clearTimer(alertId);
        return;
      }
      this.scheduleRetry(alertId, entry);
    } finally {
      this.inFlight.delete(alertId);
      if (
        !this.disposed &&
        this.pending.has(alertId) &&
        !this.timers.has(alertId) &&
        this.pending.get(alertId) !== entry
      ) {
        void this.run(alertId);
      }
    }
  }

  private scheduleRetry(alertId: string, entry: PendingAttempt): void {
    if (this.disposed || this.timers.has(alertId)) return;
    const base = this.options.retryBaseMs ?? 2_000;
    const maximum = this.options.retryMaxMs ?? 30_000;
    const delay = Math.min(base * 2 ** Math.max(0, entry.attempts - 1), maximum);
    const schedule = this.options.schedule ?? setTimeout;
    const handle = schedule(() => {
      this.timers.delete(alertId);
      void this.run(alertId);
    }, delay);
    this.timers.set(alertId, handle);
  }

  private clearTimer(alertId: string): void {
    const handle = this.timers.get(alertId);
    if (handle === undefined) return;
    (this.options.cancel ?? clearTimeout)(handle);
    this.timers.delete(alertId);
  }
}
