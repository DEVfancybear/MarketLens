import { Braces, Eye, EyeOff, Settings, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { authStatusAtom } from "@/store/authStore";
import type { IndicatorConfig } from "@/types";
import {
  getPineRuntimeInputs,
  getPineRuntimeMeta,
} from "@/services/api/resources/pineRuntimeApi";
import type {
  PineInputDefinition,
  PineScriptMeta,
} from "@/services/pineRuntimeTypes";
import {
  inputsInStatusLine,
  valuesInStatusLine,
} from "@/services/indicatorStyle";
import { canShowPineSourceControls } from "@/services/privateWorkspaceAccess";

function pineLegendInputs(
  indicator: IndicatorConfig,
  definitions: PineInputDefinition[] = [],
): string {
  if (definitions.length === 0) return "";
  return definitions
    .filter((input) => input.kind !== "bool" && input.kind !== "color")
    .slice(0, 6)
    .map((input) => indicator.inputValues?.[input.key] ?? input.defaultValue)
    .map((value) => String(value))
    .join(" ");
}

export function indicatorLegendTitle(
  indicator: IndicatorConfig,
  valueText?: string,
  inputDefinitions?: PineInputDefinition[],
  meta?: PineScriptMeta,
): string {
  const base =
    indicator.type === "CUSTOM"
      ? meta?.shortTitle || indicator.name || meta?.name || "Custom script"
      : indicator.type;
  const params =
    inputsInStatusLine(indicator.styleValues)
      ? indicator.type === "CUSTOM"
        ? pineLegendInputs(indicator, inputDefinitions)
        : indicator.type !== "VWAP" && indicator.length
          ? String(indicator.length)
          : ""
      : "";
  const values =
    valuesInStatusLine(indicator.styleValues) && valueText
      ? valueText
      : "";
  return [base, params, values].filter(Boolean).join(" ");
}

export function IndicatorLegend({
  className = "",
  indicators,
  onToggleVisibility,
  onSettings,
  onSource,
  onRemove,
  valueTextById,
}: {
  className?: string;
  indicators: IndicatorConfig[];
  onToggleVisibility: (indicator: IndicatorConfig) => void;
  onSettings: (indicator: IndicatorConfig) => void;
  onSource: (indicator: IndicatorConfig) => void;
  onRemove: (id: string) => void;
  valueTextById?: Record<string, string>;
}) {
  const authStatus = useAtomValue(authStatusAtom);
  const canShowSourceControls = canShowPineSourceControls(authStatus);
  const [inputDefinitionsById, setInputDefinitionsById] = useState<
    Record<string, {
      sourceCode: string;
      definitions: PineInputDefinition[];
      meta: PineScriptMeta | null;
    }>
  >({});

  useEffect(() => {
    let cancelled = false;
    for (const indicator of indicators) {
      if (indicator.type !== "CUSTOM" || !indicator.sourceCode?.trim()) continue;
      if (inputDefinitionsById[indicator.id]?.sourceCode === indicator.sourceCode) continue;
      Promise.all([
        getPineRuntimeInputs(indicator.sourceCode, indicator.inputValues ?? {}),
        getPineRuntimeMeta(indicator.sourceCode),
      ])
        .then(([definitions, meta]) => {
          if (cancelled) return;
          setInputDefinitionsById((current) => ({
            ...current,
            [indicator.id]: {
              sourceCode: indicator.sourceCode ?? "",
              definitions,
              meta,
            },
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setInputDefinitionsById((current) => ({
            ...current,
            [indicator.id]: {
              sourceCode: indicator.sourceCode ?? "",
              definitions: [],
              meta: null,
            },
          }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [indicators, inputDefinitionsById]);

  if (indicators.length === 0) return null;

  return (
    <div className={["flex max-w-full flex-col items-start gap-0.5 text-[12px] leading-none text-ink", className].join(" ")}>
      {indicators.map((indicator) => {
        const visible = indicator.visible !== false;
        const sourceEnabled = indicator.type === "CUSTOM" && !!indicator.sourceCode;
        const title = indicatorLegendTitle(
          indicator,
          valueTextById?.[indicator.id],
          inputDefinitionsById[indicator.id]?.definitions,
          inputDefinitionsById[indicator.id]?.meta ?? undefined,
        );
        return (
          <div
            key={indicator.id}
            className="group flex h-6 max-w-full items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-terminal-raised/85 focus-within:bg-terminal-raised/85"
          >
            <span
              className={[
                "min-w-0 truncate font-semibold",
                visible ? "text-ink" : "text-ink/45",
              ].join(" ")}
              title={title}
            >
              {title}
            </span>
            <LegendButton
              title={visible ? "Hide indicator" : "Show indicator"}
              onClick={() => onToggleVisibility(indicator)}
            >
              {visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </LegendButton>
            <LegendButton
              title="Indicator settings"
              onClick={() => onSettings(indicator)}
            >
              <Settings size={14} />
            </LegendButton>
            {canShowSourceControls && (
              <LegendButton
                title={sourceEnabled ? "Open source code" : "Source unavailable"}
                disabled={!sourceEnabled}
                onClick={() => onSource(indicator)}
              >
                <Braces size={14} />
              </LegendButton>
            )}
            <LegendButton
              danger
              title="Remove indicator"
              onClick={() => onRemove(indicator.id)}
            >
              <Trash2 size={14} />
            </LegendButton>
          </div>
        );
      })}
    </div>
  );
}

function LegendButton({
  children,
  danger,
  disabled,
  title,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onClick();
      }}
      className={[
        "flex h-5 w-5 items-center justify-center rounded text-ink/75 opacity-0 transition hover:bg-terminal-hover hover:text-ink focus:opacity-100 disabled:cursor-not-allowed disabled:text-ink/25 disabled:hover:bg-transparent group-hover:opacity-100",
        danger ? "hover:text-red-300" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
