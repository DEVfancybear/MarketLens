export interface DrawingPersistenceMetricSnapshot {
  decodeFailures: number;
  quarantined: number;
  migrated: number;
  retries: number;
  conflicts: number;
}

class DrawingPersistenceMetrics {
  private counters: DrawingPersistenceMetricSnapshot = {
    decodeFailures: 0,
    quarantined: 0,
    migrated: 0,
    retries: 0,
    conflicts: 0,
  };

  add(metric: keyof DrawingPersistenceMetricSnapshot, amount = 1): void {
    this.counters[metric] += Math.max(0, amount);
  }

  snapshot(): DrawingPersistenceMetricSnapshot {
    return { ...this.counters };
  }
}

export const drawingPersistenceMetrics = new DrawingPersistenceMetrics();
