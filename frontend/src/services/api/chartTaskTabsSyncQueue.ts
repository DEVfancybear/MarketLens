import type { ChartTaskTabsDocument } from "@/store/chartTaskTabsStore";

export interface ChartTaskTabsSyncTransport {
  put: (
    expectedRevision: number,
    document: ChartTaskTabsDocument,
  ) => Promise<ChartTaskTabsDocument>;
  get: () => Promise<ChartTaskTabsDocument>;
  isConflict: (error: unknown) => boolean;
}

export interface ChartTaskTabsSyncRecovery {
  savePending: (uid: string, document: ChartTaskTabsDocument) => void;
  clearPending: (uid: string) => void;
  saveConflict: (uid: string, document: ChartTaskTabsDocument) => void;
}

export interface ChartTaskTabsSyncEvents {
  acknowledged: (document: ChartTaskTabsDocument) => void;
  conflicted: (
    server: ChartTaskTabsDocument,
    local: ChartTaskTabsDocument,
  ) => void;
  failed: (error: unknown) => void;
}

export class ChartTaskTabsSyncQueue {
  private readonly transport: ChartTaskTabsSyncTransport;
  private readonly recovery: ChartTaskTabsSyncRecovery;
  private readonly events: ChartTaskTabsSyncEvents;
  private readonly delayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { uid: string; document: ChartTaskTabsDocument } | null = null;
  private draining: Promise<void> | null = null;
  private uid: string | null = null;
  private revision: number | null = null;
  private generation = 0;

  constructor(
    transport: ChartTaskTabsSyncTransport,
    recovery: ChartTaskTabsSyncRecovery,
    events: ChartTaskTabsSyncEvents,
    delayMs = 250,
  ) {
    this.transport = transport;
    this.recovery = recovery;
    this.events = events;
    this.delayMs = delayMs;
  }

  enqueue(uid: string, document: ChartTaskTabsDocument): void {
    if (this.uid && this.uid !== uid) this.reset(this.uid);
    this.uid = uid;
    if (this.revision === null) this.revision = document.revision;
    this.pending = { uid, document };
    this.recovery.savePending(uid, document);
    if (!this.draining) this.schedule();
  }

  async flush(): Promise<void> {
    this.clearTimer();
    if (!this.pending && !this.draining) return;
    if (!this.draining) {
      const drainGeneration = this.generation;
      this.draining = this.drain().finally(() => {
        this.draining = null;
        if (this.pending && this.generation !== drainGeneration) {
          this.schedule();
        }
      });
    }
    await this.draining;
  }

  reset(uid?: string): void {
    const recoveryUid = uid ?? this.uid;
    this.generation += 1;
    this.clearTimer();
    this.pending = null;
    this.uid = null;
    this.revision = null;
    if (recoveryUid) this.recovery.clearPending(recoveryUid);
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delayMs);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async drain(): Promise<void> {
    const generation = this.generation;
    while (this.pending && generation === this.generation) {
      const current = this.pending;
      this.pending = null;
      const expectedRevision = this.revision ?? current.document.revision;
      try {
        const saved = await this.transport.put(
          expectedRevision,
          current.document,
        );
        if (generation !== this.generation || this.uid !== current.uid) return;
        this.revision = saved.revision;
        if (!this.pending) {
          this.recovery.clearPending(current.uid);
          this.events.acknowledged(saved);
        }
      } catch (error) {
        if (generation !== this.generation || this.uid !== current.uid) return;
        const latest = this.pendingDocument() ?? current.document;
        if (this.transport.isConflict(error)) {
          this.pending = null;
          this.recovery.saveConflict(current.uid, latest);
          try {
            const server = await this.transport.get();
            if (generation !== this.generation || this.uid !== current.uid) return;
            this.revision = server.revision;
            this.recovery.clearPending(current.uid);
            this.events.conflicted(server, latest);
          } catch (refreshError) {
            this.pending = { uid: current.uid, document: latest };
            this.recovery.savePending(current.uid, latest);
            this.events.failed(refreshError);
          }
        } else {
          this.pending = { uid: current.uid, document: latest };
          this.recovery.savePending(current.uid, latest);
          this.events.failed(error);
        }
        return;
      }
    }
  }

  private pendingDocument(): ChartTaskTabsDocument | null {
    return this.pending?.document ?? null;
  }
}
