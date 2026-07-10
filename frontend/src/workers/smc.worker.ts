/// <reference lib="webworker" />
/**
 * SMC compute worker. Heavy structure/FVG/OB/liquidity scanning runs here so
 * the main thread stays responsive during fast replay and large datasets.
 */
import { computeSmc, type SmcOptions } from '@/services/smc/smcEngine';
import type { Candle } from '@/types';

export interface SmcRequest {
  reqId: number;
  candles: Candle[];
  options?: SmcOptions;
}

self.onmessage = (e: MessageEvent<SmcRequest>) => {
  const { reqId, candles, options } = e.data;
  try {
    const startedAt = performance.now();
    const snapshot = computeSmc(candles, options);
    (self as unknown as Worker).postMessage({
      reqId,
      snapshot,
      computeMs: performance.now() - startedAt,
    });
  } catch (err) {
    (self as unknown as Worker).postMessage({ reqId, error: String(err) });
  }
};
