import { postJson } from "@/services/api/client";
import type {
  Candle,
  IndicatorInputValue,
  IndicatorInputValues,
  IndicatorResult,
  IndicatorStyleValues,
} from "@/types";
import type {
  PineCompilation,
  PineInputDefinition,
  PineScriptMeta,
  PineStyleDefinition,
} from "@/services/pineScript";

export interface PineRuntimeError {
  message: string;
  line?: number;
}

export interface PineRuntimeMetaResponse extends PineScriptMeta {
  errors: PineRuntimeError[];
}

export interface PineRuntimeInputsResponse {
  inputs: PineInputDefinition[];
  errors: PineRuntimeError[];
}

export interface PineRuntimeStylesResponse {
  styles: PineStyleDefinition[];
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
    overlay: response.overlay,
    timeframe: response.timeframe,
  };
}

export async function getPineRuntimeInputs(
  sourceCode: string,
  inputOverrides: IndicatorInputValues = {},
): Promise<PineInputDefinition[]> {
  const response = await postJson<PineRuntimeInputsResponse>("pine-runtime/inputs", {
    sourceCode,
    inputOverrides,
  });
  return response.inputs;
}

export async function getPineRuntimeStyles(
  sourceCode: string,
  styleOverrides: IndicatorStyleValues = {},
): Promise<PineStyleDefinition[]> {
  const response = await postJson<PineRuntimeStylesResponse>("pine-runtime/styles", {
    sourceCode,
    styleOverrides,
  });
  return response.styles;
}

export async function compilePineRuntime(params: {
  scriptId?: string;
  sourceCode: string;
  candles: Candle[];
  inputOverrides?: IndicatorInputValues;
  styleOverrides?: IndicatorStyleValues;
  timeframe?: string;
}): Promise<PineRuntimeCompileResponse> {
  const response = await postJson<RawPineRuntimeCompileResponse>("pine-runtime/compile", {
    scriptId: params.scriptId,
    sourceCode: params.sourceCode,
    candles: params.candles,
    inputOverrides: params.inputOverrides ?? {},
    styleOverrides: params.styleOverrides ?? {},
    timeframe: params.timeframe,
  }, {
    timeout: 8_000,
  });
  return {
    ...response,
    errors: runtimeErrorText(response.errors),
  };
}

export type { IndicatorInputValue };
