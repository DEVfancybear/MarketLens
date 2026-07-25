import { getJson, postJson } from "@/services/api/client";
import type { Candle, IndicatorConfig, IndicatorResult } from "@/types";
import type { IndicatorRuntimeContext } from "@/services/indicatorRuntimePolicy";
import type {
  PineInputDefinition,
  PineStyleDefinition,
} from "@/services/pineRuntimeTypes";

export interface IndicatorRuntimeError {
  message: string;
  line?: number;
}

export interface IndicatorRuntimeResponse {
  result: IndicatorResult;
  errors: IndicatorRuntimeError[];
  warnings?: IndicatorRuntimeError[];
}

export interface IndicatorRuntimeDefinition {
  type: string;
  name: string;
  shortTitle?: string;
  description?: string;
  overlay: boolean;
  timeframe?: string;
  version?: number;
  properties?: Record<string, unknown>;
  inputs: PineInputDefinition[];
  styles: PineStyleDefinition[];
  legacyInputBindings?: Record<string, string>;
  legacyStyleBindings?: Record<string, string>;
  requiresHistoryContext: boolean;
  sourceAvailable: boolean;
  shortcut?: string;
}

interface IndicatorCatalogResponse {
  indicators: IndicatorRuntimeDefinition[];
  errors: IndicatorRuntimeError[];
}

interface IndicatorDefinitionResponse {
  definition: IndicatorRuntimeDefinition;
  errors: IndicatorRuntimeError[];
}

export async function listIndicatorRuntimeCatalog(): Promise<IndicatorRuntimeDefinition[]> {
  const response = await getJson<IndicatorCatalogResponse>("indicator-runtime/catalog");
  if (response.errors.length > 0) throw new Error(response.errors[0].message);
  return response.indicators;
}

export async function getIndicatorRuntimeDefinition(request: {
  indicatorType?: string;
  sourceCode?: string;
}): Promise<IndicatorRuntimeDefinition> {
  const response = await postJson<IndicatorDefinitionResponse>(
    "indicator-runtime/definition",
    request,
  );
  if (response.errors.length > 0) throw new Error(response.errors[0].message);
  return response.definition;
}

/**
 * Calculate any catalog or user-source indicator through one backend path.
 * The browser sends instance state unchanged and only consumes chart primitives.
 */
export async function computeIndicatorRuntime(
  config: IndicatorConfig,
  candles: Candle[],
  ctx?: IndicatorRuntimeContext,
): Promise<IndicatorRuntimeResponse> {
  return postJson<IndicatorRuntimeResponse>(
    "indicator-runtime/compute",
    {
      indicatorType: config.type,
      indicatorId: config.id,
      sourceCode: config.sourceCode,
      timeframe: ctx?.timeframe,
      symbol: ctx?.symbol,
      symbolType: ctx?.symbolType,
      mintick: ctx?.mintick,
      timezone: ctx?.timezone,
      replayCutoff: ctx?.replayCutoff,
      config,
      candles,
    },
    { timeout: 8_000 },
  );
}
