import type {
  BackendDrawingBatchRequest,
  BackendDrawingBatchResponse,
  BackendDrawingDelete,
  BackendDrawingWrite,
} from "@/services/api/resources/drawingsApi";

export interface DrawingSyncQueueSnapshot {
  upserts: BackendDrawingWrite[];
  deletes: BackendDrawingDelete[];
  retryAttempt: number;
}

export interface DrawingSyncQueueOptions {
  send: (batch: BackendDrawingBatchRequest) => Promise<BackendDrawingBatchResponse>;
  canSend?: () => boolean;
  persist?: (snapshot: DrawingSyncQueueSnapshot) => void;
  onSuccess?: (
    response: BackendDrawingBatchResponse,
    request: BackendDrawingBatchRequest,
  ) => void;
  onError?: (error: unknown, retryAttempt: number) => void;
  debounceMs?: number;
  maxRetryMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

function upsertKey(item: BackendDrawingWrite): string {
  return item.clientId || item.payload.id;
}

function deleteKey(item: BackendDrawingDelete): string {
  return item.clientId || item.id || `${item.symbol ?? ""}:unknown`;
}

/**
 * Revision-aware, retrying drawing outbox. Mutations are persisted before any
 * network attempt, so symbol changes, logout, reload, and tab close preserve
 * work rather than dropping a debounced batch.
 */
export class DrawingSyncQueue {
  private readonly upserts = new Map<string, BackendDrawingWrite>();
  private readonly deletes = new Map<string, BackendDrawingDelete>();
  private readonly options: Required<
    Pick<DrawingSyncQueueOptions, "debounceMs" | "maxRetryMs" | "schedule" | "cancel">
  > &
    DrawingSyncQueueOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private inFlightRequest: BackendDrawingBatchRequest | null = null;
  private retryAttempt = 0;

  constructor(options: DrawingSyncQueueOptions) {
    this.options = {
      debounceMs: 800,
      maxRetryMs: 30_000,
      schedule: (callback, delay) => setTimeout(callback, delay),
      cancel: (handle) => clearTimeout(handle),
      ...options,
    };
  }

  hydrate(snapshot: DrawingSyncQueueSnapshot | null | undefined): void {
    if (!snapshot) return;
    for (const item of snapshot.upserts ?? []) this.upserts.set(upsertKey(item), item);
    for (const item of snapshot.deletes ?? []) this.deletes.set(deleteKey(item), item);
    this.retryAttempt = Math.max(0, snapshot.retryAttempt ?? 0);
    this.persist();
  }

  enqueueUpsert(item: BackendDrawingWrite): void {
    const key = upsertKey(item);
    this.deletes.delete(key);
    this.upserts.set(key, item);
    this.persist();
    this.schedule(this.options.debounceMs);
  }

  enqueueDelete(item: BackendDrawingDelete): void {
    const key = deleteKey(item);
    this.upserts.delete(key);
    this.deletes.set(key, item);
    this.persist();
    this.schedule(this.options.debounceMs);
  }

  resume(): void {
    if (this.size > 0) this.schedule(0);
  }

  preserveAndCancel(): void {
    if (this.timer) this.options.cancel(this.timer);
    this.timer = null;
    this.persist();
  }

  get size(): number {
    return this.upserts.size + this.deletes.size;
  }

  snapshot(): DrawingSyncQueueSnapshot {
    const upserts = new Map(this.upserts);
    const deletes = new Map(this.deletes);
    for (const item of this.inFlightRequest?.upserts ?? []) {
      const key = upsertKey(item);
      if (!upserts.has(key) && !deletes.has(key)) upserts.set(key, item);
    }
    for (const item of this.inFlightRequest?.deletes ?? []) {
      const key = deleteKey(item);
      if (!upserts.has(key) && !deletes.has(key)) deletes.set(key, item);
    }
    return {
      upserts: [...upserts.values()],
      deletes: [...deletes.values()],
      retryAttempt: this.retryAttempt,
    };
  }

  async flushNow(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.options.canSend && !this.options.canSend()) {
      this.persist();
      return;
    }
    const request = {
      upserts: [...this.upserts.values()],
      deletes: [...this.deletes.values()],
    };
    if (request.upserts.length === 0 && request.deletes.length === 0) return;
    this.inFlightRequest = request;
    this.upserts.clear();
    this.deletes.clear();
    this.persist();

    this.inFlight = this.options
      .send(request)
      .then((response) => {
        this.retryAttempt = 0;
        this.inFlightRequest = null;
        this.options.onSuccess?.(response, request);
      })
      .catch((error) => {
        // Do not overwrite newer mutations queued while this request was active.
        for (const item of request.upserts) {
          const key = upsertKey(item);
          if (!this.deletes.has(key) && !this.upserts.has(key)) this.upserts.set(key, item);
        }
        for (const item of request.deletes) {
          const key = deleteKey(item);
          if (!this.upserts.has(key) && !this.deletes.has(key)) this.deletes.set(key, item);
        }
        this.retryAttempt++;
        this.inFlightRequest = null;
        this.options.onError?.(error, this.retryAttempt);
        const delay = Math.min(
          this.options.maxRetryMs,
          this.options.debounceMs * 2 ** Math.min(this.retryAttempt, 8),
        );
        this.schedule(delay);
      })
      .finally(() => {
        this.inFlightRequest = null;
        this.inFlight = null;
        this.persist();
        if (this.size > 0 && this.retryAttempt === 0) this.schedule(0);
      });
    return this.inFlight;
  }

  private schedule(delay: number): void {
    if (this.options.canSend && !this.options.canSend()) return;
    if (this.timer) this.options.cancel(this.timer);
    this.timer = this.options.schedule(() => {
      this.timer = null;
      void this.flushNow();
    }, delay);
  }

  private persist(): void {
    this.options.persist?.(this.snapshot());
  }
}
