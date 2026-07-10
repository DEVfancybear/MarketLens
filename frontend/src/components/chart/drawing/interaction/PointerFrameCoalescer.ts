export type ScheduleFrame = (callback: FrameRequestCallback) => number;
export type CancelFrame = (handle: number) => void;

/**
 * Applies the first pointer sample immediately, then collapses any additional
 * samples before the next animation frame to the newest one. Scheduling this
 * frame before the immediate apply lets the common canvas render callback run
 * after the trailing geometry update in the same browser frame.
 */
export class PointerFrameCoalescer<T> {
  private frame: number | null = null;
  private pending!: T;
  private hasPending = false;

  constructor(
    private readonly apply: (value: T) => void,
    private readonly schedule: ScheduleFrame = requestAnimationFrame,
    private readonly cancelFrame: CancelFrame = cancelAnimationFrame,
  ) {}

  push(value: T): void {
    if (this.frame != null) {
      this.pending = value;
      this.hasPending = true;
      return;
    }

    this.frame = this.schedule(() => {
      this.frame = null;
      if (!this.hasPending) return;
      const latest = this.pending;
      this.hasPending = false;
      this.apply(latest);
    });
    this.apply(value);
  }

  /** Flush the pointer-up sample and prevent a stale queued move after release. */
  flush(value: T): void {
    this.cancel();
    this.apply(value);
  }

  cancel(): void {
    if (this.frame != null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
    this.hasPending = false;
  }
}
