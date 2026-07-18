import type {
  IndicatorInputValue,
  IndicatorLineStyle,
  IndicatorLineWidth,
  IndicatorResult,
} from "@/types";

export const DEFAULT_PINE_SOURCE = `// This Pine Script code is subject to the terms of the Mozilla Public License 2.0
// By Custom

//@version=6
indicator("My script", overlay=true)
plot(close, title="Close", color=color.blue)`;

export interface PineScriptMeta {
  name: string;
  shortTitle?: string;
  overlay: boolean;
  timeframe?: string;
  version?: number;
  properties?: Record<string, unknown>;
}

export interface PineCompilation {
  meta: PineScriptMeta;
  result: IndicatorResult;
  errors: string[];
}

export type PineInputKind =
  | "int"
  | "float"
  | "bool"
  | "color"
  | "source"
  | "string"
  | "timeframe";

export interface PineInputDefinition {
  key: string;
  title: string;
  kind: PineInputKind;
  defaultValue: IndicatorInputValue;
  group?: string;
  inline?: string;
  tooltip?: string;
  options?: IndicatorInputValue[];
  min?: number;
  max?: number;
  step?: number;
}

export type PineStyleTarget = "plot" | "hline" | "fill" | "line" | "box" | "label";

export interface PineStyleDefinition {
  key: string;
  title: string;
  target: PineStyleTarget;
  group: string;
  defaultVisible: boolean;
  defaultColor: string;
  defaultLineWidth?: IndicatorLineWidth;
  defaultLineStyle?: IndicatorLineStyle;
  supportsColor: boolean;
  supportsLineWidth: boolean;
  supportsLineStyle: boolean;
}
