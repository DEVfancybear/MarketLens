/**
 * Shared price/tick math for Long / Short position drawings.
 *
 * TradingView treats the Inputs tab's `Ticks` and `Price` fields as two
 * synchronized views of the same level distance:
 *
 *   ticks = abs(levelPrice - entryPrice) / symbolTickSize
 *   level = entryPrice +/- ticks * symbolTickSize
 *
 * Keep that rule centralized.  The settings dialog, canvas labels, hit-test
 * statistics, and any future position-template logic should all use this file
 * instead of reintroducing price-magnitude heuristics.
 */

const DEFAULT_TICK_SIZE = 0.0001;

/**
 * Return a usable positive tick size.
 *
 * Market metadata is the source of truth, but drawings can be loaded before a
 * symbol registry entry exists or from old persisted sessions.  A tiny fallback
 * keeps the UI editable without throwing.
 */
export function safeTickSize(
  tickSize: number | null | undefined,
  fallback = DEFAULT_TICK_SIZE,
): number {
  return Number.isFinite(tickSize) && Number(tickSize) > 0
    ? Number(tickSize)
    : fallback;
}

/**
 * Count decimal places needed to display one tick exactly.
 *
 * Handles normal decimal notation (`0.01`) and scientific notation
 * (`1e-8`) because exchange filters sometimes arrive in either form.
 */
export function decimalPlacesFromStep(step: number): number {
  const safeStep = safeTickSize(step);
  const text = safeStep.toString().toLowerCase();
  if (text.includes("e-")) {
    const exponent = Number(text.split("e-")[1]);
    return Number.isFinite(exponent) ? Math.max(0, exponent) : 0;
  }
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.max(0, text.length - dot - 1);
}

/**
 * Snap a raw price to the nearest valid symbol tick.
 *
 * The extra guard digits absorb floating-point artifacts from values such as
 * `61915.1 + 1467 * 0.1`, then the final UI formatter clamps to tick precision.
 */
export function roundToTick(price: number, tickSize: number): number {
  if (!Number.isFinite(price)) return 0;
  const tick = safeTickSize(tickSize);
  const precision = decimalPlacesFromStep(tick);
  const rounded = Math.round(price / tick) * tick;
  return Number(rounded.toFixed(Math.max(precision + 4, 8)));
}

/**
 * Convert a price distance to whole ticks, matching TradingView's integer tick
 * fields.  We round instead of floor so a snapped price that carries a tiny
 * binary-float residue still maps back to the original tick count.
 */
export function ticksBetween(
  entryPrice: number,
  levelPrice: number,
  tickSize: number,
): number {
  const tick = safeTickSize(tickSize);
  if (!Number.isFinite(entryPrice) || !Number.isFinite(levelPrice)) return 0;
  return Math.max(0, Math.round(Math.abs(levelPrice - entryPrice) / tick));
}

/**
 * Build a target/stop price from an entry, a tick distance, and the side of the
 * entry where the level must live.
 */
export function levelFromTicks(
  entryPrice: number,
  ticks: number,
  direction: 1 | -1,
  tickSize: number,
): number {
  const tick = safeTickSize(tickSize);
  const safeTicks = Number.isFinite(ticks)
    ? Math.max(0, Math.round(Math.abs(ticks)))
    : 0;
  return roundToTick(entryPrice + direction * safeTicks * tick, tick);
}

/**
 * Format a price using the symbol tick's precision, then trim cosmetic trailing
 * zeros so BTCUSDT with tick `0.1` renders like TradingView (`61915.1`) while
 * forex/metals can still keep their finer precision.
 */
export function formatPriceByTick(
  price: number,
  tickSize: number,
  fallbackPrecision = 2,
): string {
  if (!Number.isFinite(price)) return "0";
  const tick = safeTickSize(tickSize);
  const precision =
    Number.isFinite(tickSize) && tickSize > 0
      ? decimalPlacesFromStep(tick)
      : Math.max(0, fallbackPrecision);
  const fixed = roundToTick(price, tick).toFixed(precision);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

export interface PositionProjectionInput {
  side: "long" | "short";
  entryPrice: number;
  targetPrice: number;
  stopPrice: number;
  accountSize: number;
  riskValue: number;
  riskUnit: "%" | "amount";
  lotSize: number;
  leverage: number;
  /** Monetary value of a one-price-unit move for one lot/contract. */
  pointValue?: number;
  markPrice?: number | null;
}

export interface PositionProjectionMetrics {
  riskSize: number;
  quantityByRisk: number;
  quantityByLeverage: number;
  quantity: number;
  targetOffset: number;
  stopOffset: number;
  targetPercent: number;
  stopPercent: number;
  riskReward: number;
  profitPnl: number;
  lossPnl: number;
  openPnl: number;
  targetBalance: number;
  stopBalance: number;
}

function positive(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

/**
 * TradingView Long/Short Position projection math.
 *
 * QtyRisk = (RiskSize / (StopOffset * PointValue)) / LotSize
 * QtyLvg  = (AccountSize * Leverage / EntryPrice) * PointValue / LotSize
 * Qty     = min(QtyRisk, QtyLvg)
 */
export function calculatePositionProjection(
  input: PositionProjectionInput,
): PositionProjectionMetrics {
  const accountSize = positive(input.accountSize, 0);
  const entry = positive(Math.abs(input.entryPrice), 0);
  const lotSize = positive(input.lotSize, 1);
  const leverage = positive(input.leverage, 1);
  const pointValue = positive(input.pointValue, 1);
  const targetOffset = Math.abs(input.targetPrice - input.entryPrice);
  const stopOffset = Math.abs(input.entryPrice - input.stopPrice);
  const riskValue = Number.isFinite(input.riskValue)
    ? Math.max(0, input.riskValue)
    : 0;
  const riskSize =
    input.riskUnit === "%" ? accountSize * (riskValue / 100) : riskValue;
  const quantityByRisk =
    stopOffset > 0
      ? riskSize / (stopOffset * pointValue) / lotSize
      : 0;
  const quantityByLeverage =
    entry > 0 ? ((accountSize * leverage) / entry) * pointValue / lotSize : 0;
  const quantity = Math.max(
    0,
    Math.min(quantityByRisk, quantityByLeverage),
  );
  const valueMultiplier = quantity * pointValue * lotSize;
  const profitPnl = targetOffset * valueMultiplier;
  const lossPnl = -stopOffset * valueMultiplier;
  const mark = Number.isFinite(input.markPrice)
    ? Number(input.markPrice)
    : input.entryPrice;
  const openOffset =
    input.side === "long" ? mark - input.entryPrice : input.entryPrice - mark;
  const openPnl = openOffset * valueMultiplier;

  return {
    riskSize,
    quantityByRisk,
    quantityByLeverage,
    quantity,
    targetOffset,
    stopOffset,
    targetPercent: entry > 0 ? (targetOffset / entry) * 100 : 0,
    stopPercent: entry > 0 ? (stopOffset / entry) * 100 : 0,
    riskReward: stopOffset > 0 ? targetOffset / stopOffset : 0,
    profitPnl,
    lossPnl,
    openPnl,
    targetBalance: accountSize + profitPnl,
    stopBalance: accountSize + lossPnl,
  };
}

export interface PositionCloseCandle {
  time: number;
  close: number;
}

/**
 * TradingView uses the close at the drawing's right edge for historical
 * projections, and the latest close when the drawing extends into the future.
 */
export function positionMarkPrice(
  candles: readonly PositionCloseCandle[],
  rightEdgeTime: number,
): number | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  if (rightEdgeTime >= last.time) return last.close;
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    const candle = candles[i];
    if (candle.time <= rightEdgeTime) return candle.close;
  }
  return last.close;
}
