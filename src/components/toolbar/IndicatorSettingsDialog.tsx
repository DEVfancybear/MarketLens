"use client";
/**
 * Shared indicator settings dialog.
 *
 * TradingView exposes one settings surface for every indicator, while the Inputs tab is generated
 * from that script's `input.*()` declarations. This component follows the same split:
 * - CUSTOM indicators read their schema from `extractPineInputDefinitions()`.
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
} from "@/types";
import { defaultIndicator } from "@/services/indicators";
import {
  extractPineInputDefinitions,
  extractPineScriptMeta,
  type PineInputDefinition,
} from "@/services/pineScript";
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
  volume: "Volume",
};

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
    case "VWAP":
      return [];
  }
}

function builtInStyleFields(type: BuiltInIndicatorType): PineInputDefinition[] {
  const primary = {
    key: "color",
    title: type === "ADR" ? "High line color" : "Color",
    kind: "color" as const,
    defaultValue: defaultIndicator(type, "__default").color,
  };
  if (type === "MACD") {
    return [
      primary,
      { key: "color2", title: "Signal color", kind: "color", defaultValue: "#ff9800" },
    ];
  }
  if (type === "ADR") {
    return [
      primary,
      { key: "color2", title: "Low line color", kind: "color", defaultValue: "#ef5350" },
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
  };
}

function groupFields(fields: PineInputDefinition[]) {
  const groups: { name: string | null; fields: PineInputDefinition[] }[] = [];
  for (const field of fields) {
    const name = field.group ?? null;
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

  const indicator = indicators.find((item) => item.id === editingId);
  const pineInputs = useMemo(
    () =>
      indicator?.type === "CUSTOM"
        ? extractPineInputDefinitions(indicator.sourceCode ?? "")
        : [],
    [indicator],
  );
  const pineMeta = useMemo(
    () =>
      indicator?.type === "CUSTOM"
        ? extractPineScriptMeta(indicator.sourceCode ?? "")
        : null,
    [indicator],
  );

  const [activeTab, setActiveTab] = useState<SettingsTab>("inputs");
  const [draft, setDraft] = useState<SettingsDraft | null>(null);

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
    } else {
      next.inputValues = {
        length: next.length,
        length2: next.length2,
        length3: next.length3,
        color: next.color,
        color2: next.color2,
      };
    }
    setDraft(next);
    setActiveTab("inputs");
  }, [indicator, pineInputs, pineMeta]);

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
  const title = isCustom ? indicator.name ?? pineMeta?.name ?? "Custom script" : indicator.type;
  const inputFields = isCustom ? pineInputs : builtInInputFields(draft.type);
  const styleFields = isCustom ? [] : builtInStyleFields(draft.type);

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

  const updateDraftField = (key: keyof SettingsDraft, value: IndicatorInputValue) => {
    setDraft((current) =>
      current ? { ...current, [key]: value, inputValues: { ...current.inputValues, [key]: value } } : current,
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
        color: defaults.color,
        color2: defaults.color2 ?? "#ff9800",
      },
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
        length2: draft.type === "MACD" ? Number(draft.inputValues.length2 ?? draft.length2) : undefined,
        length3: draft.type === "MACD" ? Number(draft.inputValues.length3 ?? draft.length3) : undefined,
        color: String(draft.inputValues.color ?? draft.color),
        color2:
          draft.type === "MACD" || draft.type === "ADR"
            ? String(draft.inputValues.color2 ?? draft.color2)
            : undefined,
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
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/35"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} settings`}
        className="flex max-h-[min(760px,calc(100vh-32px))] w-[380px] flex-col overflow-hidden rounded-md border border-[#242424] bg-[#1f1f1f] text-ink shadow-2xl shadow-black/70"
      >
        <header className="flex h-16 shrink-0 items-center justify-between px-5">
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

        <div className="shrink-0 px-5">
          <div className="flex border-b-[3px] border-[#5b5b5b]">
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
                  <span className="absolute -bottom-[3px] left-0 h-[3px] w-full rounded-full bg-ink" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-[220px] flex-1 overflow-auto px-5 pb-5 pt-5">
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
            <InputGroups
              fields={styleFields}
              values={draft.inputValues}
              onChange={(key, value) => {
                updateInputValue(key, value);
                if (key === "color" || key === "color2") updateDraftField(key, value);
              }}
            />
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

        <footer className="flex h-[54px] shrink-0 items-center justify-between border-t border-[#3a3a3a] px-5">
          <button
            type="button"
            onClick={resetDefaults}
            className="flex h-9 items-center gap-2 rounded-md border border-[#4b4b4b] px-3 text-[14px] font-medium text-ink transition-colors hover:bg-terminal-hover"
          >
            Defaults
            <ChevronDown size={15} />
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={close}
              className="h-9 rounded-md border border-[#d1d4dc] px-4 text-[15px] font-medium text-ink transition-colors hover:bg-terminal-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="h-9 rounded-md bg-[#f0f3fa] px-4 text-[15px] font-medium text-[#131722] transition-colors hover:bg-white"
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
      {groupFields(fields).map((group, index) => (
        <div key={`${group.name ?? "default"}:${index}`} className="space-y-3">
          {group.name && (
            <div className="pb-3 pt-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              {group.name}
            </div>
          )}
          {group.fields.map((field) => (
            <InputField
              key={field.key}
              field={field}
              value={currentFieldValue(field, values)}
              onChange={(value) => onChange(field.key, value)}
            />
          ))}
        </div>
      ))}
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

  if (field.kind === "color") {
    return (
      <FieldRow label={field.title}>
        <label className="flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-md border border-[#4b4b4b] bg-[#252525]">
          <input
            type="color"
            value={hexColor(value, hexColor(field.defaultValue, "#2962ff"))}
            onChange={(event) => onChange(event.target.value)}
            className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label={field.title}
          />
        </label>
      </FieldRow>
    );
  }

  if (field.options?.length) {
    return (
      <FieldRow label={field.title}>
        <SelectControl
          value={String(value)}
          options={field.options.map((option) => ({
            value: String(option),
            label: field.kind === "source"
              ? SOURCE_LABELS[String(option)] ?? String(option)
              : String(option),
          }))}
          onChange={onChange}
        />
      </FieldRow>
    );
  }

  if (field.kind === "int" || field.kind === "float") {
    return (
      <FieldRow label={field.title}>
        <input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? (field.kind === "int" ? 1 : "any")}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onChange(coerceFieldValue(field, event.target.value))}
          className="h-[34px] w-[100px] rounded-md border border-[#4b4b4b] bg-[#1f1f1f] px-3 text-[14px] text-ink outline-none transition-colors focus:border-[#868686]"
        />
      </FieldRow>
    );
  }

  return (
    <FieldRow label={field.title}>
      <input
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        className="h-[34px] w-[160px] rounded-md border border-[#4b4b4b] bg-[#1f1f1f] px-3 text-[14px] text-ink outline-none transition-colors focus:border-[#868686]"
      />
    </FieldRow>
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
      <div className="min-w-0 text-[14px] font-medium leading-5 text-ink">
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
    <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-[14px] font-medium text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-[18px] w-[18px] rounded border-[#d1d4dc] accent-[#f0f3fa]"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

function SelectControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-[34px] min-w-[100px] rounded-md border border-[#4b4b4b] bg-[#1f1f1f] px-2 text-[14px] text-ink outline-none transition-colors focus:border-[#868686]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
