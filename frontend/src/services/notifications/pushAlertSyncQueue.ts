/**
 * Serializes full-snapshot writes for one push device. Without this, a slower
 * older request can finish after a newer one and silently remove recently
 * created alerts from the closed-browser worker.
 */
export class PushAlertSyncQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue<T>(deviceToken: string, request: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(deviceToken) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(request);
    let tracked: Promise<void>;
    tracked = result
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (this.tails.get(deviceToken) === tracked) {
          this.tails.delete(deviceToken);
        }
      });
    this.tails.set(deviceToken, tracked);
    return result;
  }

  pendingDevices(): number {
    return this.tails.size;
  }
}
