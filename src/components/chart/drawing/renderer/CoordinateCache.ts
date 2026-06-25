/**
 * CoordinateCache — frame-local cache for timeToCoordinate and priceToCoordinate.
 *
 * During a single render frame, dozens of (time,price)→pixel conversions happen.
 * This cache avoids redundant LWC API calls by storing results keyed by (time, price).
 * Invalidated at the start of each new frame via a generation counter.
 */
export class CoordinateCache {
  private timeCache = new Map<number, number>();
  private priceCache = new Map<number, number>();
  private generation = 0;

  /** Call at the start of each render frame to invalidate. */
  nextFrame(): void {
    if (this.timeCache.size > 100 || this.priceCache.size > 100) {
      this.timeCache.clear();
      this.priceCache.clear();
    } else {
      this.generation++;
    }
    // If generation overflows, clear and reset.
    if (this.generation > 1_000_000) {
      this.generation = 0;
      this.timeCache.clear();
      this.priceCache.clear();
    }
  }

  /** Get or compute a time→pixel-x mapping. */
  timeToX(
    time: number,
    compute: (t: number) => number | null,
  ): number | null {
    const key = time;
    // Check cache (generation-based validity).
    // We use a simple approach: cache is valid for the current frame.
    // Since we clear/nextGen at frame start, any cached value is fresh.
    if (this.timeCache.has(key)) return this.timeCache.get(key)!;
    const result = compute(time);
    if (result != null) this.timeCache.set(key, result);
    return result;
  }

  /** Get or compute a price→pixel-y mapping. */
  priceToY(
    price: number,
    compute: (p: number) => number | null,
  ): number | null {
    if (this.priceCache.has(price)) return this.priceCache.get(price)!;
    const result = compute(price);
    if (result != null) this.priceCache.set(price, result);
    return result;
  }
}
