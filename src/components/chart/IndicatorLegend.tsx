import { Braces, Eye, EyeOff, Settings, Trash2 } from "lucide-react";
import type { IndicatorConfig } from "@/types";

function pineLegendInputs(sourceCode: string | undefined): string {
  if (!sourceCode) return "";
  const values: string[] = [];
  const inputPattern = /\binput(?:\.(int|float|string|bool|color|source))?\s*\(\s*(?:defval\s*=\s*)?([^,\)\n]+)/g;
  for (const match of sourceCode.matchAll(inputPattern)) {
    const kind = match[1];
    if (kind === "bool" || kind === "color") continue;
    const raw = match[2].trim();
    if (/^(true|false|color\.|na\b)/i.test(raw)) continue;
    const cleaned = raw.replace(/^["']|["']$/g, "");
    const numeric = Number(cleaned);
    values.push(
      Number.isFinite(numeric) && /^[-+]?\d+(?:\.\d+)?$/.test(cleaned)
        ? String(numeric)
        : cleaned,
    );
    if (values.length >= 6) break;
  }
  return values.join(" ");
}

export function indicatorLegendTitle(indicator: IndicatorConfig): string {
  const base =
    indicator.type === "CUSTOM"
      ? indicator.name ?? "Custom script"
      : indicator.type;
  const params =
    indicator.type === "CUSTOM"
      ? pineLegendInputs(indicator.sourceCode)
      : indicator.type !== "VWAP" && indicator.length
        ? String(indicator.length)
        : "";
  return params ? `${base} ${params}` : base;
}

export function IndicatorLegend({
  className = "",
  indicators,
  onToggleVisibility,
  onSettings,
  onSource,
  onRemove,
}: {
  className?: string;
  indicators: IndicatorConfig[];
  onToggleVisibility: (indicator: IndicatorConfig) => void;
  onSettings: (indicator: IndicatorConfig) => void;
  onSource: (indicator: IndicatorConfig) => void;
  onRemove: (id: string) => void;
}) {
  if (indicators.length === 0) return null;

  return (
    <div className={["flex max-w-full flex-col items-start gap-1 text-[12px] leading-none text-white", className].join(" ")}>
      {indicators.map((indicator) => {
        const visible = indicator.visible !== false;
        const sourceEnabled = indicator.type === "CUSTOM" && !!indicator.sourceCode;
        const settingsEnabled = indicator.type !== "CUSTOM";
        return (
          <div
            key={indicator.id}
            className="group flex h-7 max-w-full items-center gap-1 rounded border border-white/15 bg-black/80 px-2 shadow-[0_1px_3px_rgba(0,0,0,0.45)]"
          >
            <span
              className={[
                "min-w-0 truncate font-semibold",
                visible ? "text-white" : "text-white/45",
              ].join(" ")}
              title={indicatorLegendTitle(indicator)}
            >
              {indicatorLegendTitle(indicator)}
            </span>
            <LegendButton
              title={visible ? "Hide indicator" : "Show indicator"}
              onClick={() => onToggleVisibility(indicator)}
            >
              {visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </LegendButton>
            <LegendButton
              title={settingsEnabled ? "Indicator settings" : "Settings"}
              disabled={!settingsEnabled}
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
        "flex h-5 w-5 items-center justify-center rounded text-white/75 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent",
        danger ? "hover:text-red-300" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
