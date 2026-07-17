import { postJson } from "@/services/api/client";
import type { Candle, IndicatorConfig, IndicatorResult } from "@/types";
import type { PineCompileContext } from "@/services/pineRuntimeCachePolicy";

export interface IndicatorRuntimeError {
  message: string;
  line?: number;
}

export interface IndicatorRuntimeResponse {
  result: IndicatorResult;
  errors: IndicatorRuntimeError[];
  warnings?: IndicatorRuntimeError[];
}

/**
 * Ask the backend indicator registry to calculate a built-in indicator.
 * Frontend code deliberately sends the instance config unchanged and only
 * consumes the returned chart primitives.
 */
export async function computeIndicatorRuntime(
  config: IndicatorConfig,
  candles: Candle[],
  ctx?: PineCompileContext,
): Promise<IndicatorRuntimeResponse> {
  return postJson<IndicatorRuntimeResponse>(
    "indicator-runtime/compute",
    {
      indicatorType: config.type,
      indicatorId: config.id,
      timeframe: ctx?.timeframe,
      config,
      candles,
    },
    { timeout: 8_000 },
  );
}
