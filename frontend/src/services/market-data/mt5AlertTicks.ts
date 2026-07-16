import { mt5ChartPrice } from "./mt5Price";

export interface Mt5AlertTickInput {
  symbol?: string;
  bid?: number;
  ask?: number;
  /** Broker/chart epoch in seconds. */
  timestamp?: number;
  /** Broker/chart epoch in milliseconds when supplied by MT5. */
  time_msc?: number;
  /** Backend receive epoch in milliseconds; used only as replay ordering/cursor. */
  received_at?: number;
}

export interface NormalizedMt5AlertTick {
  price: number;
  /** Broker market epoch; dynamic drawing geometry is evaluated at this time. */
  timestamp: number;
  /** Backend receive epoch; freshness and replay cursors use this value. */
  receivedAt: number;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Keeps chart time and receive time deliberately separate. Receive ordering is
 * stable even when a broker clock is skewed or market timestamps arrive out of
 * order, while line projection still uses the same epoch as drawing anchors.
 */
export function normalizeMt5AlertTicks(
  values: readonly Mt5AlertTickInput[],
  symbol: string,
): NormalizedMt5AlertTick[] {
  const normalizedSymbol = symbol.trim().toUpperCase();
  return values
    .map((value, index) => {
      if (value.symbol?.trim().toUpperCase() !== normalizedSymbol) return null;
      const price = mt5ChartPrice(Number(value.bid), Number(value.ask));
      const timestamp = finitePositive(value.time_msc)
        ? value.time_msc
        : finitePositive(value.timestamp)
          ? value.timestamp * 1000
          : undefined;
      if (price === undefined || timestamp === undefined) return null;
      const receivedAt = finitePositive(value.received_at)
        ? value.received_at
        : timestamp;
      return { price, timestamp, receivedAt, index };
    })
    .filter(
      (value): value is NormalizedMt5AlertTick & { index: number } => value !== null,
    )
    .sort((left, right) => left.receivedAt - right.receivedAt || left.index - right.index)
    .map(({ price, timestamp, receivedAt }) => ({ price, timestamp, receivedAt }));
}
