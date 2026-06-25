/**
 * PerformanceMonitor — dev-only FPS and render-time tracker.
 *
 * Excluded from production builds via tree-shaking (only imported
 * in development). Tracks frame count, render duration, hit-test
 * duration, and draw call count.
 */
export class PerformanceMonitor {
  private frames = 0;
  private totalRenderMs = 0;
  private totalHitTestMs = 0;
  private drawCalls = 0;
  private visibleDrawings = 0;
  private skippedDrawings = 0;
  private lastLogTime = 0;
  private static instance: PerformanceMonitor | null = null;

  static get(): PerformanceMonitor {
    if (process.env.NODE_ENV !== "development") {
      return new PerformanceMonitor(); // no-op
    }
    if (!this.instance) this.instance = new PerformanceMonitor();
    return this.instance;
  }

  recordFrame(renderMs: number, hitMs: number, drawn: number, skipped: number, total: number): void {
    if (process.env.NODE_ENV !== "development") return;
    this.frames++;
    this.totalRenderMs += renderMs;
    this.totalHitTestMs += hitMs;
    this.drawCalls += drawn;
    this.visibleDrawings = total;
    this.skippedDrawings += skipped;

    const now = performance.now();
    if (now - this.lastLogTime > 2000) {
      const avgFps = Math.round(this.frames / ((now - this.lastLogTime) / 1000));
      const avgRender = (this.totalRenderMs / this.frames).toFixed(2);
      const avgHit = (this.totalHitTestMs / this.frames).toFixed(2);
      console.debug(
        `[Perf] ${avgFps} FPS | render: ${avgRender}ms | hit: ${avgHit}ms | ` +
        `drawn: ${this.drawCalls}/${this.visibleDrawings} | skipped: ${this.skippedDrawings}`,
      );
      this.frames = 0;
      this.totalRenderMs = 0;
      this.totalHitTestMs = 0;
      this.drawCalls = 0;
      this.skippedDrawings = 0;
      this.lastLogTime = now;
    }
  }
}
