import { Braces, Eye, EyeOff, Settings, Trash2 } from "lucide-react";
import type { IndicatorConfig } from "@/types";
import { extractPineInputDefinitions } from "@/services/pineScript";
import {
  inputsInStatusLine,
  valuesInStatusLine,
} from "@/services/indicatorStyle";

function pineLegendInputs(indicator: IndicatorConfig): string {
  const sourceCode = indicator.sourceCode;
  if (!sourceCode) return "";
  return extractPineInputDefinitions(sourceCode)
    .filter((input) => input.kind !== "bool" && input.kind !== "color")
    .slice(0, 6)
    .map((input) => indicator.inputValues?.[input.key] ?? input.defaultValue)
    .map((value) => String(value))
    .join(" ");
}

export function indicatorLegendTitle(
  indicator: IndicatorConfig,
  valueText?: string,
): string {
  const base =
    indicator.type === "CUSTOM"
      ? indicator.name ?? "Custom script"
      : indicator.type;
  const params =
    inputsInStatusLine(indicator.styleValues)
      ? indicator.type === "CUSTOM"
        ? pineLegendInputs(indicator)
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
  if (indicators.length === 0) return null;

  return (
    <div className={["flex max-w-full flex-col items-start gap-0.5 text-[12px] leading-none text-[#d1d4dc]", className].join(" ")}>
      {indicators.map((indicator) => {
        const visible = indicator.visible !== false;
        const sourceEnabled = indicator.type === "CUSTOM" && !!indicator.sourceCode;
        const title = indicatorLegendTitle(indicator, valueTextById?.[indicator.id]);
        return (
          <div
            key={indicator.id}
            className="group flex h-6 max-w-full items-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-black/70 focus-within:bg-black/70"
          >
            <span
              className={[
                "min-w-0 truncate font-semibold",
                visible ? "text-[#d1d4dc]" : "text-[#d1d4dc]/45",
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
            <LegendButton
              title={sourceEnabled ? "Open source code" : "Source unavailable"}
              disabled={!sourceEnabled}
              onClick={() => onSource(indicator)}
            >
              <Braces size={14} />
            </LegendButton>
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
        "flex h-5 w-5 items-center justify-center rounded text-[#d1d4dc]/75 opacity-0 transition hover:bg-white/10 hover:text-white focus:opacity-100 disabled:cursor-not-allowed disabled:text-[#d1d4dc]/25 disabled:hover:bg-transparent group-hover:opacity-100",
        danger ? "hover:text-red-300" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
