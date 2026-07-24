export type WatchlistSyncTask = () => Promise<void>;

/**
 * Serializes full-layout writes per watchlist.
 *
 * A layout write replaces every symbol and section, so allowing two writes for
 * one list to overlap can make an older response win or make the backend's
 * delete-and-reinsert transaction collide. Different watchlists remain
 * independent and can still sync concurrently.
 */
export class WatchlistSyncQueue {
  private readonly pending = new Map<string, Promise<void>>();

  enqueue(watchlistId: string, task: WatchlistSyncTask): Promise<void> {
    const previous = this.pending.get(watchlistId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.pending.set(watchlistId, next);

    void next.then(
      () => this.release(watchlistId, next),
      () => this.release(watchlistId, next),
    );
    return next;
  }

  private release(watchlistId: string, task: Promise<void>): void {
    if (this.pending.get(watchlistId) === task) {
      this.pending.delete(watchlistId);
    }
  }
}
