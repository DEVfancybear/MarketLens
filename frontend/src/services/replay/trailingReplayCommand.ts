export class TrailingReplayCommand<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: T | null = null;
  private waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  constructor(
    private readonly delayMs: number,
    private readonly merge: (current: T | null, incoming: T) => T,
    private readonly execute: (value: T) => Promise<void>,
  ) {}

  schedule(value: T): Promise<void> {
    this.pending = this.merge(this.pending, value);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
    return new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const value = this.pending;
    this.pending = null;
    const waiters = this.waiters.splice(0);
    if (value === null) return;
    try {
      await this.execute(value);
      for (const waiter of waiters) waiter.resolve();
    } catch (error) {
      for (const waiter of waiters) waiter.reject(error);
    }
  }
}
