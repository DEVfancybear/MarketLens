"use client";
/**
 * Shared indicator settings dialog.
 *
 * Every tab is generated from the backend indicator definition. The browser
 * owns field rendering only; it has no catalog names, defaults, or formulas.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  editingIndicatorIdAtom,
  activeIndicatorsAtom,
  setEditingIndicatorAtom,
  updateIndicatorAtom,
} from "@/store/chartStore";
import type {
  IndicatorConfig,
  IndicatorInputValue,
  IndicatorInputValues,
  IndicatorLineStyle,
  IndicatorLineWidth,
  IndicatorStyleValue,
  IndicatorStyleValues,
} from "@/types";
import { groupIndicatorInputRows } from "@/components/toolbar/indicatorSettingsInputRows";
import type {
  PineInputDefinition,
  PineStyleDefinition,
} from "@/services/pineRuntimeTypes";
import type { IndicatorRuntimeDefinition } from "@/services/api/resources/indicatorRuntimeApi";
import {
  indicatorInputsFromConfig,
  indicatorStylesFromConfig,
  loadIndicatorDefinition,
} from "@/services/indicatorDefinitions";
import {
  commonStyleDefaults,
  STYLE_INPUTS_IN_STATUS_LINE_KEY,
  STYLE_LABELS_ON_PRICE_SCALE_KEY,
  STYLE_OUTPUT_PRECISION_KEY,
  STYLE_VALUES_IN_STATUS_LINE_KEY,
} from "@/services/indicatorStyle";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { cn } from "@/utils/cn";
import { ColorPickerControl } from "@/components/ui/ColorPicker";

type SettingsTab = "inputs" | "style" | "visibility";

interface SettingsDraft {
  visible: boolean;
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
  return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color) ? color : fallback;
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

function initialDraft(
  indicator: IndicatorConfig,
  definition: IndicatorRuntimeDefinition,
): SettingsDraft {
  return {
    visible: indicator.visible !== false,
    inputValues: indicatorInputsFromConfig(definition, indicator),
    styleValues: {
      ...commonStyleDefaults(),
      ...indicatorStylesFromConfig(definition, indicator),
    },
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
  const indicators = useAtomValue(activeIndicatorsAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const updateIndicator = useSetAtom(updateIndicatorAtom);
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog();

  const indicator = indicators.find((item) => item.id === editingId);
  const [definition, setDefinition] = useState<IndicatorRuntimeDefinition | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("inputs");
  const [draft, setDraft] = useState<SettingsDraft | null>(null);

  useEffect(() => {
    if (!indicator) {
      setDefinition(null);
      return;
    }
    setDefinition(null);
    let cancelled = false;
    loadIndicatorDefinition({
      indicatorType: indicator.type,
      sourceCode: indicator.sourceCode,
    })
      .then((next) => {
        if (!cancelled) setDefinition(next);
      })
      .catch(() => {
        if (cancelled) return;
        setDefinition({
          type: indicator.type,
          name: indicator.name || indicator.type,
          overlay: !indicator.separatePane,
          inputs: [],
          styles: [],
          requiresHistoryContext: indicator.requiresHistoryContext ?? false,
          sourceAvailable: Boolean(indicator.sourceCode),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [indicator]);

  useEffect(() => {
    if (!indicator || !definition) {
      setDraft(null);
      return;
    }
    setDraft(initialDraft(indicator, definition));
    setActiveTab("inputs");
  }, [definition, indicator]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editingId) setEditingIndicator(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, setEditingIndicator]);

  if (
    typeof document === "undefined" ||
    !editingId ||
    !indicator ||
    !definition ||
    !draft
  ) {
    return null;
  }

  const title =
    definition.shortTitle || indicator.name || definition.name || indicator.type;
  const inputFields = definition.inputs;
  const styleFields = definition.styles;
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
    setDraft({
      visible: true,
      inputValues: defaultInputValues(inputFields),
      styleValues: defaultStyleValues(styleFields),
    });
  };

  const save = () => {
    const inputValues: IndicatorInputValues = {};
    for (const field of inputFields) {
      inputValues[field.key] = coerceFieldValue(
        field,
        currentFieldValue(field, draft.inputValues),
      );
    }
    updateIndicator({
      id: editingId,
      patch: {
        inputValues,
        styleValues: compactStyleValues(styleFields, draft.styleValues),
        visible: draft.visible,
        separatePane: !definition.overlay,
        name: definition.shortTitle || definition.name,
        requiresHistoryContext: definition.requiresHistoryContext,
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
          <ColorPickerControl
            value={color}
            onChange={(nextColor) => onChange(colorKey, nextColor)}
            label={`${field.title} color`}
            triggerClassName="h-[30px] w-[30px] bg-terminal-panel-2"
          />
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
      <ColorPickerControl
        value={hexColor(value, hexColor(field.defaultValue, "#2962ff"))}
        onChange={onChange}
        label={field.title || field.key}
        triggerClassName="bg-terminal-panel-2"
      />
    );
  }

  if (field.kind === "timeframe") {
    const options = field.options?.length
      ? field.options.map((option) => ({ value: String(option), label: String(option) }))
      : TIMEFRAME_OPTIONS;
    return (
      <SelectControl
        value={String(value)}
        options={options}
        onChange={onChange}
        className={compact ? "w-[108px]" : undefined}
      />
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
