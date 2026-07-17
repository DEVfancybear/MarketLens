"use client";
/**
 * Shared indicator settings dialog.
 *
 * TradingView exposes one settings surface for every indicator, while the Inputs tab is generated
 * from that script's `input.*()` declarations. This component follows the same split:
 * - CUSTOM indicators read their schema from the Go Pine runtime API.
 * - Built-ins provide small local schemas but use the exact same field renderer.
 * - Saving only stores per-instance values; the Pine runtime re-executes the script with those
 *   values on the next chart render.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  editingIndicatorIdAtom,
  indicatorsAtom,
  setEditingIndicatorAtom,
  updateIndicatorAtom,
} from "@/store/chartStore";
import type {
  BuiltInIndicatorType,
  IndicatorConfig,
  IndicatorInputValue,
  IndicatorInputValues,
  IndicatorLineStyle,
  IndicatorLineWidth,
  IndicatorStyleValue,
  IndicatorStyleValues,
} from "@/types";
import { defaultIndicator } from "@/services/indicators";
import {
  getPineRuntimeInputs,
  getPineRuntimeMeta,
  getPineRuntimeStyles,
} from "@/services/api/resources/pineRuntimeApi";
import { groupIndicatorInputRows } from "@/components/toolbar/indicatorSettingsInputRows";
import type {
  PineInputDefinition,
  PineScriptMeta,
  PineStyleDefinition,
} from "@/services/pineRuntimeTypes";
import {
  commonStyleDefaults,
  STYLE_INPUTS_IN_STATUS_LINE_KEY,
  STYLE_LABELS_ON_PRICE_SCALE_KEY,
  STYLE_OUTPUT_PRECISION_KEY,
  STYLE_VALUES_IN_STATUS_LINE_KEY,
} from "@/services/indicatorStyle";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { cn } from "@/utils/cn";

type SettingsTab = "inputs" | "style" | "visibility";

interface SettingsDraft {
  type: BuiltInIndicatorType;
  length: number;
  length2: number;
  length3: number;
  color: string;
  color2: string;
  visible: boolean;
  separatePane: boolean;
  inputValues: IndicatorInputValues;
  styleValues: IndicatorStyleValues;
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "inputs", label: "Inputs" },
  { id: "style", label: "Style" },
  { id: "visibility", label: "Visibility" },
];

const TIMEFRAME_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Chart" },
  { value: "1", label: "1 minute" },
  { value: "3", label: "3 minutes" },
  { value: "5", label: "5 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "240", label: "4 hours" },
  { value: "D", label: "1 day" },
  { value: "W", label: "1 week" },
];

const SOURCE_LABELS: Record<string, string> = {
  open: "Open",
  high: "High",
  low: "Low",
  close: "Close",
  hl2: "HL2",
  hlc3: "HLC3",
  ohlc4: "OHLC4",
  hlcc4: "HLCC4",
  volume: "Volume",
};

const SWING_SOURCE_OPTIONS: IndicatorInputValue[] = [
  "open",
  "high",
  "low",
  "close",
  "hl2",
  "hlc3",
  "ohlc4",
  "hlcc4",
];

const LINE_STYLE_OPTIONS: { value: IndicatorLineStyle; label: string }[] = [
  { value: 0, label: "Solid" },
  { value: 1, label: "Dotted" },
  { value: 2, label: "Dashed" },
  { value: 3, label: "Large dashed" },
  { value: 4, label: "Sparse dotted" },
];

const LINE_WIDTH_OPTIONS: IndicatorLineWidth[] = [1, 2, 3, 4];
const PRECISION_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "0", label: "0" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
  { value: "6", label: "6" },
  { value: "7", label: "7" },
  { value: "8", label: "8" },
];

function styleFieldKey(
  key: string,
  field: "visible" | "color" | "lineWidth" | "lineStyle",
): string {
  return `${key}.${field}`;
}

function hexColor(value: IndicatorInputValue | undefined, fallback: string) {
  const color = String(value ?? fallback);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function coerceFieldValue(
  field: PineInputDefinition,
  value: IndicatorInputValue,
): IndicatorInputValue {
  if (field.kind === "bool") return value === true || value === "true";
  if (field.kind === "int") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : Number(field.defaultValue) || 0;
  }
  if (field.kind === "float") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number(field.defaultValue) || 0;
  }
  return String(value);
}

function defaultInputValues(fields: PineInputDefinition[]): IndicatorInputValues {
  return Object.fromEntries(fields.map((field) => [field.key, field.defaultValue]));
}

function defaultStyleValues(fields: PineStyleDefinition[]): IndicatorStyleValues {
  const entries: [string, IndicatorStyleValue][] = [];
  for (const field of fields) {
    entries.push([styleFieldKey(field.key, "visible"), field.defaultVisible]);
    if (field.supportsColor) {
      entries.push([styleFieldKey(field.key, "color"), field.defaultColor]);
    }
    if (field.supportsLineWidth && field.defaultLineWidth != null) {
      entries.push([styleFieldKey(field.key, "lineWidth"), field.defaultLineWidth]);
    }
    if (field.supportsLineStyle && field.defaultLineStyle != null) {
      entries.push([styleFieldKey(field.key, "lineStyle"), field.defaultLineStyle]);
    }
  }
  return {
    ...commonStyleDefaults(),
    ...Object.fromEntries(entries),
  };
}

function compactStyleValues(
  fields: PineStyleDefinition[],
  values: IndicatorStyleValues,
): IndicatorStyleValues {
  const defaults = defaultStyleValues(fields);
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => {
      const fallback = defaults[key];
      if (fallback === undefined) return true;
      return String(value) !== String(fallback);
    }),
  );
}

function currentFieldValue(
  field: PineInputDefinition,
  values: IndicatorInputValues,
): IndicatorInputValue {
  return values[field.key] ?? field.defaultValue;
}

function builtInInputFields(type: BuiltInIndicatorType): PineInputDefinition[] {
  switch (type) {
    case "SMA":
    case "EMA":
    case "RSI":
    case "ADR":
      return [{
        key: "length",
        title: type === "ADR" ? "ADR Period" : "Length",
        kind: "int",
        defaultValue: defaultIndicator(type, "__default").length,
        min: 1,
        max: 500,
        step: 1,
      }];
    case "MACD":
      return [
        { key: "length", title: "Fast Length", kind: "int", defaultValue: 12, min: 1, max: 500, step: 1 },
        { key: "length3", title: "Slow Length", kind: "int", defaultValue: 26, min: 1, max: 500, step: 1 },
        { key: "length2", title: "Signal Smoothing", kind: "int", defaultValue: 9, min: 1, max: 200, step: 1 },
      ];
    case "SWING_SR":
      return [
        {
          key: "length",
          title: "Swing high strength",
          kind: "int",
          defaultValue: 25,
          min: 1,
          max: 500,
          step: 1,
          group: "Swing highs",
        },
        {
          key: "highSource",
          title: "High source",
          kind: "source",
          defaultValue: "high",
          options: SWING_SOURCE_OPTIONS,
          group: "Swing highs",
        },
        {
          key: "length2",
          title: "Swing low strength",
          kind: "int",
          defaultValue: 25,
          min: 1,
          max: 500,
          step: 1,
          group: "Swing lows",
        },
        {
          key: "lowSource",
          title: "Low source",
          kind: "source",
          defaultValue: "low",
          options: SWING_SOURCE_OPTIONS,
          group: "Swing lows",
        },
      ];
    case "VWAP":
      return [];
  }
}

function builtInStyleDefinitions(type: BuiltInIndicatorType): PineStyleDefinition[] {
  const primary = {
    key: "builtin:primary",
    title:
      type === "ADR"
        ? "High line"
        : type === "SWING_SR"
          ? "Swing high"
          : type,
    target: "plot" as const,
    group: "Plots",
    defaultVisible: true,
    defaultColor: defaultIndicator(type, "__default").color,
    defaultLineWidth: 2 as IndicatorLineWidth,
    defaultLineStyle: (type === "SWING_SR" ? 1 : 0) as IndicatorLineStyle,
    supportsColor: true,
    supportsLineWidth: true,
    supportsLineStyle: true,
  };
  if (type === "MACD") {
    return [
      primary,
      {
        key: "builtin:secondary",
        title: "Signal",
        target: "plot",
        group: "Plots",
        defaultVisible: true,
        defaultColor: "#ff9800",
        defaultLineWidth: 2,
        defaultLineStyle: 0,
        supportsColor: true,
        supportsLineWidth: true,
        supportsLineStyle: true,
      },
    ];
  }
  if (type === "ADR") {
    return [
      primary,
      {
        key: "builtin:secondary",
        title: "Low line",
        target: "plot",
        group: "Plots",
        defaultVisible: true,
        defaultColor: "#ef5350",
        defaultLineWidth: 2,
        defaultLineStyle: 0,
        supportsColor: true,
        supportsLineWidth: true,
        supportsLineStyle: true,
      },
    ];
  }
  if (type === "SWING_SR") {
    return [
      primary,
      {
        key: "builtin:secondary",
        title: "Swing low",
        target: "plot",
        group: "Plots",
        defaultVisible: true,
        defaultColor: "#26c6da",
        defaultLineWidth: 2,
        defaultLineStyle: 1,
        supportsColor: true,
        supportsLineWidth: true,
        supportsLineStyle: true,
      },
    ];
  }
  return [primary];
}

function initialDraft(indicator: IndicatorConfig): SettingsDraft {
  const fallback = defaultIndicator(
    indicator.type === "CUSTOM" ? "SMA" : indicator.type,
    indicator.id,
  );
  return {
    type: indicator.type === "CUSTOM" ? "SMA" : indicator.type,
    length: indicator.length || fallback.length,
    length2: indicator.length2 ?? fallback.length2 ?? 9,
    length3: indicator.length3 ?? fallback.length3 ?? 26,
    color: indicator.color || fallback.color,
    color2: indicator.color2 ?? fallback.color2 ?? "#ff9800",
    visible: indicator.visible !== false,
    separatePane: indicator.separatePane ?? fallback.separatePane ?? false,
    inputValues: indicator.inputValues ?? {},
    styleValues: indicator.styleValues ?? {},
  };
}

function groupStyleDefinitions(fields: PineStyleDefinition[]) {
  const groups: { name: string; fields: PineStyleDefinition[] }[] = [];
  for (const field of fields) {
    const name = field.group;
    const current = groups[groups.length - 1];
    if (!current || current.name !== name) {
      groups.push({ name, fields: [field] });
    } else {
      current.fields.push(field);
    }
  }
  return groups;
}

export function IndicatorSettingsDialog() {
  const editingId = useAtomValue(editingIndicatorIdAtom);
  const indicators = useAtomValue(indicatorsAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const updateIndicator = useSetAtom(updateIndicatorAtom);
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog();

  const indicator = indicators.find((item) => item.id === editingId);
  const [pineSchema, setPineSchema] = useState<{
    sourceCode: string;
    inputs: PineInputDefinition[];
    styles: PineStyleDefinition[];
    meta: PineScriptMeta | null;
  }>({ sourceCode: "", inputs: [], styles: [], meta: null });
  const pineInputs = pineSchema.inputs;
  const pineStyles = pineSchema.styles;
  const pineMeta = pineSchema.meta;

  const [activeTab, setActiveTab] = useState<SettingsTab>("inputs");
  const [draft, setDraft] = useState<SettingsDraft | null>(null);

  useEffect(() => {
    const sourceCode = indicator?.type === "CUSTOM" ? indicator.sourceCode ?? "" : "";
    if (!sourceCode.trim()) {
      setPineSchema({ sourceCode: "", inputs: [], styles: [], meta: null });
      return;
    }
    let cancelled = false;
    Promise.all([
      getPineRuntimeInputs(sourceCode, indicator?.inputValues ?? {}),
      getPineRuntimeStyles(sourceCode, indicator?.styleValues ?? {}),
      getPineRuntimeMeta(sourceCode),
    ])
      .then(([inputs, styles, meta]) => {
        if (!cancelled) setPineSchema({ sourceCode, inputs, styles, meta });
      })
      .catch(() => {
        if (!cancelled) setPineSchema({ sourceCode, inputs: [], styles: [], meta: null });
      });
    return () => {
      cancelled = true;
    };
  }, [indicator?.id, indicator?.sourceCode, indicator?.inputValues, indicator?.styleValues, indicator?.type]);

  useEffect(() => {
    if (!indicator) return;
    const next = initialDraft(indicator);
    if (indicator.type === "CUSTOM") {
      next.inputValues = {
        ...defaultInputValues(pineInputs),
        ...(pineMeta?.timeframe !== undefined
          ? { __timeframe: indicator.inputValues?.__timeframe ?? pineMeta.timeframe ?? "" }
          : {}),
        ...(indicator.inputValues ?? {}),
      };
      next.styleValues = {
        ...defaultStyleValues(pineStyles),
        ...(indicator.styleValues ?? {}),
      };
    } else {
      const builtInStyles = builtInStyleDefinitions(next.type);
      next.inputValues = {
        length: next.length,
        length2: next.length2,
        length3: next.length3,
        ...(next.type === "SWING_SR"
          ? {
              highSource: indicator.inputValues?.highSource ?? "high",
              lowSource: indicator.inputValues?.lowSource ?? "low",
            }
          : {}),
      };
      next.styleValues = {
        ...defaultStyleValues(builtInStyles),
        [styleFieldKey("builtin:primary", "color")]: next.color,
        [styleFieldKey("builtin:secondary", "color")]: next.color2,
        ...(indicator.styleValues ?? {}),
      };
    }
    setDraft(next);
    setActiveTab("inputs");
  }, [indicator, pineInputs, pineMeta, pineStyles]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editingId) setEditingIndicator(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, setEditingIndicator]);

  if (typeof document === "undefined" || !editingId || !indicator || !draft) {
    return null;
  }

  const isCustom = indicator.type === "CUSTOM";
  const title = isCustom
    ? pineMeta?.shortTitle || indicator.name || pineMeta?.name || "Custom script"
    : indicator.type;
  const inputFields = isCustom ? pineInputs : builtInInputFields(draft.type);
  const styleFields = isCustom ? pineStyles : builtInStyleDefinitions(draft.type);

  const close = () => setEditingIndicator(null);

  const updateInputValue = (key: string, value: IndicatorInputValue) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            inputValues: { ...current.inputValues, [key]: value },
          }
        : current,
    );
  };

  const updateStyleValue = (key: string, value: IndicatorStyleValue) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            styleValues: { ...current.styleValues, [key]: value },
          }
        : current,
    );
  };

  const resetDefaults = () => {
    if (isCustom) {
      setDraft((current) =>
        current
          ? {
              ...current,
              inputValues: {
                ...defaultInputValues(pineInputs),
                ...(pineMeta?.timeframe !== undefined ? { __timeframe: pineMeta.timeframe ?? "" } : {}),
              },
              styleValues: defaultStyleValues(pineStyles),
            }
          : current,
      );
      return;
    }

    const defaults = defaultIndicator(draft.type, editingId);
    setDraft({
      type: draft.type,
      length: defaults.length,
      length2: defaults.length2 ?? 9,
      length3: defaults.length3 ?? 26,
      color: defaults.color,
      color2: defaults.color2 ?? "#ff9800",
      visible: defaults.visible,
      separatePane: defaults.separatePane ?? false,
      inputValues: {
        length: defaults.length,
        length2: defaults.length2 ?? 9,
        length3: defaults.length3 ?? 26,
        ...(draft.type === "SWING_SR"
          ? { highSource: "high", lowSource: "low" }
          : {}),
      },
      styleValues: defaultStyleValues(builtInStyleDefinitions(draft.type)),
    });
  };

  const save = () => {
    if (isCustom) {
      const inputValues: IndicatorInputValues = {};
      for (const field of pineInputs) {
        inputValues[field.key] = coerceFieldValue(
          field,
          currentFieldValue(field, draft.inputValues),
        );
      }
      if (pineMeta?.timeframe !== undefined) {
        inputValues.__timeframe = draft.inputValues.__timeframe ?? "";
      }
      updateIndicator({
        id: editingId,
        patch: {
          inputValues,
          styleValues: compactStyleValues(pineStyles, draft.styleValues),
          visible: draft.visible,
        },
      });
      close();
      return;
    }

    updateIndicator({
      id: editingId,
      patch: {
        length: Number(draft.inputValues.length ?? draft.length),
        length2:
          draft.type === "MACD" || draft.type === "SWING_SR"
            ? Number(draft.inputValues.length2 ?? draft.length2)
            : undefined,
        length3: draft.type === "MACD" ? Number(draft.inputValues.length3 ?? draft.length3) : undefined,
        color: String(
          draft.styleValues[styleFieldKey("builtin:primary", "color")] ??
            draft.color,
        ),
        color2:
          draft.type === "MACD" || draft.type === "ADR" || draft.type === "SWING_SR"
            ? String(
                draft.styleValues[styleFieldKey("builtin:secondary", "color")] ??
                  draft.color2,
              )
            : undefined,
        inputValues:
          draft.type === "SWING_SR"
            ? {
                highSource: String(draft.inputValues.highSource ?? "high"),
                lowSource: String(draft.inputValues.lowSource ?? "low"),
              }
            : undefined,
        styleValues: compactStyleValues(styleFields, draft.styleValues),
        separatePane:
          draft.type === "RSI" || draft.type === "MACD"
            ? draft.separatePane
            : undefined,
        visible: draft.visible,
      },
    });
    close();
  };
  return createPortal(
    <div
      className="platform-dialog-overlay fixed inset-0 z-[1100] flex items-center justify-center bg-[var(--scrim)] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={dialogRef}
        style={dialogStyle}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} settings`}
        className="platform-dialog flex max-h-[min(760px,calc(100dvh-32px))] w-[min(540px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised text-ink shadow-floating"
      >
        <header
          data-dialog-header
          {...dragHandleProps}
          className={cn(
            "flex h-16 shrink-0 items-center justify-between px-5",
            dragHandleClassName,
          )}
        >
          <h2 className="min-w-0 truncate text-[20px] font-semibold leading-none">
            {title}
          </h2>
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
            aria-label="Close"
            title="Close"
          >
            <X size={24} strokeWidth={1.5} />
          </button>
        </header>

        <div data-dialog-tabs className="shrink-0 px-5">
          <div className="flex border-b-[3px] border-terminal-border">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative mr-6 h-9 text-[15px] font-semibold text-ink-muted transition-colors hover:text-ink",
                  activeTab === tab.id && "text-ink",
                )}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <span className="absolute -bottom-[3px] left-0 h-[3px] w-full rounded-full bg-brand" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div data-dialog-body className="min-h-[220px] flex-1 overflow-auto px-5 pb-5 pt-5">
          {activeTab === "inputs" && (
            <div className="space-y-5">
              {isCustom && pineMeta?.timeframe !== undefined && (
                <FieldRow label="Indicator Timeframe">
                  <SelectControl
                    value={String(draft.inputValues.__timeframe ?? "")}
                    options={TIMEFRAME_OPTIONS}
                    onChange={(value) => updateInputValue("__timeframe", value)}
                  />
                </FieldRow>
              )}
              <InputGroups
                fields={inputFields}
                values={draft.inputValues}
                onChange={updateInputValue}
              />
            </div>
          )}

          {activeTab === "style" && (
            <div className="space-y-5">
              <StyleGroups
                fields={styleFields}
                values={draft.styleValues}
                onChange={updateStyleValue}
              />
              <CommonStyleOptions
                values={draft.styleValues}
                onChange={updateStyleValue}
              />
            </div>
          )}

          {activeTab === "visibility" && (
            <div className="space-y-5">
              <CheckboxRow
                label="Visible"
                checked={draft.visible}
                onChange={(checked) =>
                  setDraft((current) => current ? { ...current, visible: checked } : current)
                }
              />
              {!isCustom && (draft.type === "RSI" || draft.type === "MACD") && (
                <CheckboxRow
                  label="Separate pane"
                  checked={draft.separatePane}
                  onChange={(checked) =>
                    setDraft((current) =>
                      current ? { ...current, separatePane: checked } : current,
                    )
                  }
                />
              )}
            </div>
          )}
        </div>

        <footer data-dialog-footer className="flex h-[54px] shrink-0 items-center justify-between border-t border-terminal-border px-5">
          <button
            type="button"
            onClick={resetDefaults}
            className="flex h-[34px] min-w-[104px] items-center gap-2 rounded-md border border-terminal-border-strong bg-terminal-raised px-3 text-[13px] font-medium text-ink transition-colors hover:border-brand hover:bg-terminal-raised"
          >
            Defaults
            <ChevronDown size={15} />
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={close}
              className="h-[34px] rounded-md border border-terminal-border-strong bg-transparent px-3.5 text-[14px] font-semibold text-ink transition-colors hover:bg-terminal-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="h-[34px] rounded-md border border-terminal-border-strong bg-brand px-4 text-[14px] font-semibold text-[var(--accent-contrast)] transition-colors hover:bg-brand-hover"
            >
              Ok
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function InputGroups({
  fields,
  values,
  onChange,
}: {
  fields: PineInputDefinition[];
  values: IndicatorInputValues;
  onChange: (key: string, value: IndicatorInputValue) => void;
}) {
  return (
    <div className="space-y-5">
      {groupIndicatorInputRows(fields).map((group, index) => (
        <div key={`${group.name ?? "default"}:${index}`} className="space-y-3">
          {group.name && (
            <div className="pb-3 pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              {group.name}
            </div>
          )}
          {group.rows.map((row) => (
            row.inline ? (
              <InputInlineRow
                key={row.key}
                fields={row.fields}
                values={values}
                onChange={onChange}
              />
            ) : (
              <InputField
                key={row.key}
                field={row.fields[0]}
                value={currentFieldValue(row.fields[0], values)}
                onChange={(value) => onChange(row.fields[0].key, value)}
              />
            )
          ))}
        </div>
      ))}
    </div>
  );
}

function StyleGroups({
  fields,
  values,
  onChange,
}: {
  fields: PineStyleDefinition[];
  values: IndicatorStyleValues;
  onChange: (key: string, value: IndicatorStyleValue) => void;
}) {
  return (
    <div className="space-y-5">
      {groupStyleDefinitions(fields).map((group) => (
        <div key={group.name} className="space-y-3">
          <div className="pb-3 pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            {group.name}
          </div>
          {group.fields.map((field) => (
            <StyleRow
              key={field.key}
              field={field}
              values={values}
              onChange={onChange}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function styleBoolValue(
  values: IndicatorStyleValues,
  key: string,
  fallback: boolean,
): boolean {
  const value = values[key];
  if (value === undefined) return fallback;
  return value === true || value === "true";
}

function CommonStyleOptions({
  values,
  onChange,
}: {
  values: IndicatorStyleValues;
  onChange: (key: string, value: IndicatorStyleValue) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="pb-3 pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
          Output Values
        </div>
        <FieldRow label="Precision">
          <SelectControl
            value={String(values[STYLE_OUTPUT_PRECISION_KEY] ?? "default")}
            options={PRECISION_OPTIONS}
            onChange={(value) => onChange(STYLE_OUTPUT_PRECISION_KEY, value)}
          />
        </FieldRow>
        <CheckboxRow
          label="Labels on price scale"
          checked={styleBoolValue(values, STYLE_LABELS_ON_PRICE_SCALE_KEY, true)}
          onChange={(checked) => onChange(STYLE_LABELS_ON_PRICE_SCALE_KEY, checked)}
        />
        <CheckboxRow
          label="Values in status line"
          checked={styleBoolValue(values, STYLE_VALUES_IN_STATUS_LINE_KEY, true)}
          onChange={(checked) => onChange(STYLE_VALUES_IN_STATUS_LINE_KEY, checked)}
        />
      </div>

      <div className="space-y-3">
        <div className="pb-3 pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
          Input Values
        </div>
        <CheckboxRow
          label="Inputs in status line"
          checked={styleBoolValue(values, STYLE_INPUTS_IN_STATUS_LINE_KEY, true)}
          onChange={(checked) => onChange(STYLE_INPUTS_IN_STATUS_LINE_KEY, checked)}
        />
      </div>
    </div>
  );
}

function styleValue<T extends IndicatorStyleValue>(
  values: IndicatorStyleValues,
  key: string,
  fallback: T,
): T {
  const value = values[key];
  return (value === undefined ? fallback : value) as T;
}

function StyleRow({
  field,
  values,
  onChange,
}: {
  field: PineStyleDefinition;
  values: IndicatorStyleValues;
  onChange: (key: string, value: IndicatorStyleValue) => void;
}) {
  const visibleKey = styleFieldKey(field.key, "visible");
  const colorKey = styleFieldKey(field.key, "color");
  const widthKey = styleFieldKey(field.key, "lineWidth");
  const lineStyleKey = styleFieldKey(field.key, "lineStyle");
  const visible = styleValue(values, visibleKey, field.defaultVisible);
  const color = hexColor(
    styleValue(values, colorKey, field.defaultColor),
    field.defaultColor,
  );
  const width = Number(styleValue(values, widthKey, field.defaultLineWidth ?? 2));
  const lineStyleValue = Number(
    styleValue(values, lineStyleKey, field.defaultLineStyle ?? 0),
  );

  return (
    <div className="grid min-h-[36px] grid-cols-[1fr_auto] items-center gap-3">
      <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[14px] font-medium text-ink-muted">
        <input
          type="checkbox"
          checked={visible === true}
          onChange={(event) => onChange(visibleKey, event.target.checked)}
          className="h-[18px] w-[18px] rounded border-terminal-border-strong accent-brand"
        />
        <span className="min-w-0 truncate">{field.title}</span>
      </label>

      <div className="flex items-center gap-2">
        {field.supportsColor && (
          <label className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-md border border-terminal-border-strong bg-terminal-panel-2">
            <input
              type="color"
              value={color}
              onChange={(event) => onChange(colorKey, event.target.value)}
              className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
              aria-label={`${field.title} color`}
            />
          </label>
        )}
        {field.supportsLineWidth && (
          <select
            value={Number.isFinite(width) ? String(width) : String(field.defaultLineWidth ?? 2)}
            onChange={(event) => onChange(widthKey, Number(event.target.value))}
            className="h-[30px] w-[54px] rounded-md border border-terminal-border-strong bg-terminal-raised px-2 text-[13px] text-ink-muted outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand"
            aria-label={`${field.title} line width`}
          >
            {LINE_WIDTH_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}
        {field.supportsLineStyle && (
          <select
            value={Number.isFinite(lineStyleValue) ? String(lineStyleValue) : String(field.defaultLineStyle ?? 0)}
            onChange={(event) => onChange(lineStyleKey, Number(event.target.value))}
            className="h-[30px] w-[104px] rounded-md border border-terminal-border-strong bg-terminal-raised px-2 text-[13px] text-ink-muted outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand"
            aria-label={`${field.title} line style`}
          >
            {LINE_STYLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function InputField({
  field,
  value,
  onChange,
}: {
  field: PineInputDefinition;
  value: IndicatorInputValue;
  onChange: (value: IndicatorInputValue) => void;
}) {
  if (field.kind === "bool") {
    return (
      <CheckboxRow
        label={field.title}
        checked={value === true || value === "true"}
        onChange={onChange}
      />
    );
  }

  return (
    <FieldRow label={field.title}>
      <InputControl field={field} value={value} onChange={onChange} />
    </FieldRow>
  );
}

function InputInlineRow({
  fields,
  values,
  onChange,
}: {
  fields: PineInputDefinition[];
  values: IndicatorInputValues;
  onChange: (key: string, value: IndicatorInputValue) => void;
}) {
  const first = fields[0];
  const firstIsToggle = first.kind === "bool";
  const label = first.title || fields.find((field) => field.title)?.title || first.key;
  const controlFields = firstIsToggle ? fields.slice(1) : fields;

  return (
    <div className="flex min-h-[36px] items-center gap-3">
      <div className="w-[72px] shrink-0">
        {firstIsToggle ? (
          <label className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold text-ink-muted">
            <input
              type="checkbox"
              checked={currentFieldValue(first, values) === true || currentFieldValue(first, values) === "true"}
              onChange={(event) => onChange(first.key, event.target.checked)}
              className="h-[18px] w-[18px] rounded border-terminal-border-strong accent-brand"
            />
            <span className="min-w-0 truncate">{label}</span>
          </label>
        ) : (
          <div className="min-w-0 truncate text-[14px] font-semibold text-ink-muted">
            {label}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
        {controlFields.map((field) => (
          <InputControl
            key={field.key}
            field={field}
            value={currentFieldValue(field, values)}
            onChange={(value) => onChange(field.key, value)}
            compact
          />
        ))}
      </div>
    </div>
  );
}

function InputControl({
  field,
  value,
  onChange,
  compact = false,
}: {
  field: PineInputDefinition;
  value: IndicatorInputValue;
  onChange: (value: IndicatorInputValue) => void;
  compact?: boolean;
}) {
  if (field.kind === "bool") {
    return (
      <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-[14px] font-medium text-ink-muted">
        <input
          type="checkbox"
          checked={value === true || value === "true"}
          onChange={(event) => onChange(event.target.checked)}
          className="h-[18px] w-[18px] rounded border-terminal-border-strong accent-brand"
        />
        {field.title && <span className="min-w-0 truncate">{field.title}</span>}
      </label>
    );
  }

  if (field.kind === "color") {
    return (
      <label className="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-terminal-border-strong bg-terminal-panel-2">
        <input
          type="color"
          value={hexColor(value, hexColor(field.defaultValue, "#2962ff"))}
          onChange={(event) => onChange(event.target.value)}
          className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
          aria-label={field.title || field.key}
        />
      </label>
    );
  }

  if (field.options?.length) {
    return (
      <SelectControl
        value={String(value)}
        options={field.options.map((option) => ({
          value: String(option),
          label: field.kind === "source"
            ? SOURCE_LABELS[String(option)] ?? String(option)
            : String(option),
        }))}
        onChange={onChange}
        className={compact ? "w-[108px]" : undefined}
      />
    );
  }

  if (field.kind === "int" || field.kind === "float") {
    return (
      <input
        type="number"
        min={field.min}
        max={field.max}
        step={field.step ?? (field.kind === "int" ? 1 : "any")}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onChange(coerceFieldValue(field, event.target.value))}
        className="h-[34px] w-[100px] shrink-0 rounded-md border border-terminal-border-strong bg-terminal-raised px-3 text-[14px] text-ink-muted outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand"
      />
    );
  }

  return (
    <input
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-[34px] shrink-0 rounded-md border border-terminal-border-strong bg-terminal-raised px-3 text-[14px] text-ink-muted outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand",
        compact ? "w-[108px]" : "w-[160px]",
      )}
    />
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[36px] grid-cols-[1fr_auto] items-center gap-4">
      <div className="min-w-0 text-[14px] font-medium leading-5 text-ink-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-[14px] font-medium text-ink-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-[18px] w-[18px] rounded border-terminal-border-strong accent-brand"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

function SelectControl({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-[34px] min-w-[100px] shrink-0 rounded-md border border-terminal-border-strong bg-terminal-raised px-2 text-[14px] text-ink-muted outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand",
        className,
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
