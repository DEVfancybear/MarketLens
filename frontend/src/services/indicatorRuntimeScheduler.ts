export interface LatestPerScopeSchedulerOptions<T> {
  maxConcurrent: number;
  run: (task: T) => Promise<void>;
  onSettled?: (task: T) => void;
}

/**
 * Run at most one task per scope and retain only the newest pending task.
 *
 * Live candles can change faster than a backend indicator runtime can consume
 * them. Serializing each scope prevents an unbounded request backlog, while the
 * global limit mirrors the backend worker pool and protects multi-chart layouts.
 */
export class LatestPerScopeScheduler<T> {
  private readonly activeScopes = new Set<string>();
  private readonly pendingByScope = new Map<string, T>();
  private readonly maxConcurrent: number;
  private readonly run: (task: T) => Promise<void>;
  private readonly onSettled?: (task: T) => void;
  private activeCount = 0;
  private generation = 0;

  constructor(options: LatestPerScopeSchedulerOptions<T>) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
    this.run = options.run;
    this.onSettled = options.onSettled;
  }

  enqueue(scope: string, task: T): T | undefined {
    const replaced = this.pendingByScope.get(scope);
    this.pendingByScope.delete(scope);
    this.pendingByScope.set(scope, task);
    this.drain();
    return replaced;
  }

  clear(): void {
    this.generation += 1;
    this.pendingByScope.clear();
  }

  private nextPending(): { scope: string; task: T } | null {
    for (const [scope, task] of this.pendingByScope) {
      if (this.activeScopes.has(scope)) continue;
      this.pendingByScope.delete(scope);
      return { scope, task };
    }
    return null;
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrent) {
      const next = this.nextPending();
      if (!next) return;

      const taskGeneration = this.generation;
      this.activeCount += 1;
      this.activeScopes.add(next.scope);
      void Promise.resolve()
        .then(() => this.run(next.task))
        // The task owner handles domain failures. The scheduler must always
        // release its slot even if an unexpected runner error escapes.
        .catch(() => undefined)
        .finally(() => {
          this.activeCount -= 1;
          this.activeScopes.delete(next.scope);
          if (taskGeneration === this.generation) this.onSettled?.(next.task);
          this.drain();
        });
    }
  }
}

interface ScopedCacheEntry<T> {
  scope: string;
  value: T;
}

/** A global LRU with an additional per-scope retention limit. */
export class ScopedLruCache<T> {
  private readonly entries = new Map<string, ScopedCacheEntry<T>>();
  private readonly keysByScope = new Map<string, Set<string>>();

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    this.entries.delete(key);
    this.entries.set(key, entry);
    const scopeKeys = this.keysByScope.get(entry.scope);
    if (scopeKeys) {
      scopeKeys.delete(key);
      scopeKeys.add(key);
    }
    return entry.value;
  }

  set(key: string, scope: string, value: T, maxEntriesForScope: number): void {
    this.delete(key);
    this.entries.set(key, { scope, value });
    const scopeKeys = this.keysByScope.get(scope) ?? new Set<string>();
    scopeKeys.add(key);
    this.keysByScope.set(scope, scopeKeys);

    const scopeLimit = Math.max(1, Math.floor(maxEntriesForScope));
    while (scopeKeys.size > scopeLimit) {
      const oldest = scopeKeys.values().next().value as string | undefined;
      if (!oldest) break;
      this.delete(oldest);
    }
    while (this.entries.size > Math.max(1, this.maxEntries)) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
    this.keysByScope.clear();
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    const scopeKeys = this.keysByScope.get(entry.scope);
    scopeKeys?.delete(key);
    if (scopeKeys?.size === 0) this.keysByScope.delete(entry.scope);
  }
}
