import type { IPriceLine } from "lightweight-charts";

/**
 * Shared registry of native alert price lines, keyed by alert ID.
 * AlertLines writes to it; AlertOverlay reads during drag to update
 * the native line's price in real-time so the trendline follows the
 * cursor smoothly (TradingView behaviour).
 */
export const alertLineRegistry = new Map<string, IPriceLine>();
