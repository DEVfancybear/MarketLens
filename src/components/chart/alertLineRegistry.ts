import type { IPriceLine } from "lightweight-charts";

/**
 * Shared registry of native alert price lines, keyed by alert ID.
 * AlertLines writes to it; AlertOverlay reads during drag to update
 * the native line's price in real-time so the trendline follows the
 * cursor smoothly (TradingView behaviour).
 */
export const alertLineRegistry = new Map<string, IPriceLine>();

/**
 * Alert IDs currently being dragged by AlertOverlay. AlertLines' reconciliation
 * effect can re-run for reasons unrelated to the alert's price (e.g. any
 * alertStore change re-renders it, since `useAlertStore` subscribes to the
 * whole combined atom) — without this guard it would see the imperatively
 * dragged native line's price differ from the still-uncommitted store price
 * and destroy + recreate the line at the stale price, snapping it back
 * mid-drag/mid-hold.
 */
export const draggingAlertIds = new Set<string>();
