import { postJson } from "@/services/api/client";
import type {
  Candle,
  IndicatorInputValues,
  IndicatorResult,
  IndicatorStyleValues,
} from "@/types";
import type {
  PineCompilation,
  PineScriptMeta,
} from "@/services/pineRuntimeTypes";

export interface PineRuntimeError {
  message: string;
  line?: number;
}

export interface PineRuntimeMetaResponse extends PineScriptMeta {
  errors: PineRuntimeError[];
}

interface RawPineRuntimeCompileResponse {
  meta: PineScriptMeta;
  result: IndicatorResult;
  errors: PineRuntimeError[];
  warnings?: PineRuntimeError[];
  unsupportedFeatures?: string[];
}

export interface PineRuntimeCompileResponse extends PineCompilation {
  result: IndicatorResult;
  warnings?: PineRuntimeError[];
  unsupportedFeatures?: string[];
}

function runtimeErrorText(errors: PineRuntimeError[] | undefined) {
  return errors?.map((item) =>
    item.line ? `Line ${item.line}: ${item.message}` : item.message,
  ) ?? [];
}

export async function getPineRuntimeMeta(sourceCode: string): Promise<PineScriptMeta> {
  const response = await postJson<PineRuntimeMetaResponse>("pine-runtime/meta", {
    sourceCode,
  });
  return {
    name: response.name,
    shortTitle: response.shortTitle,
    overlay: response.overlay,
    timeframe: response.timeframe,
    version: response.version,
    properties: response.properties,
  };
}

export async function compilePineRuntime(params: {
  scriptId?: string;
  sourceCode: string;
  candles: Candle[];
  inputOverrides?: IndicatorInputValues;
  styleOverrides?: IndicatorStyleValues;
  timeframe?: string;
  replayCutoff?: number;
}): Promise<PineRuntimeCompileResponse> {
  const response = await postJson<RawPineRuntimeCompileResponse>("pine-runtime/compile", {
    scriptId: params.scriptId,
    sourceCode: params.sourceCode,
    candles: params.candles,
    inputOverrides: params.inputOverrides ?? {},
    styleOverrides: params.styleOverrides ?? {},
    timeframe: params.timeframe,
    replayCutoff: params.replayCutoff,
  }, {
    timeout: 8_000,
  });
  return {
    ...response,
    errors: runtimeErrorText(response.errors),
  };
}
