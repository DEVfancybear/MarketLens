import { Check } from "lucide-react";
import { TIMEFRAMES, type DrawingIntervalVisibility, type Timeframe } from "../../../../types";
import { cn } from "../../../../utils/cn";
import {
  DRAWING_INTERVAL_VISIBILITY_PRESETS,
  intervalVisibilityForPreset,
  matchesDrawingIntervalPreset,
  toggleDrawingInterval,
} from "../visibility/drawingIntervalVisibility";

export function DrawingIntervalVisibilityFields({
  value,
  currentTimeframe,
  onChange,
}: {
  value: DrawingIntervalVisibility | undefined;
  currentTimeframe: Timeframe;
  onChange: (value: DrawingIntervalVisibility | undefined) => void;
}) {
  const selected = new Set(value?.timeframes ?? TIMEFRAMES);
  return (
    <div className="space-y-5" data-interval-visibility>
      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Quick presets
        </div>
        <div className="grid grid-cols-2 gap-2">
          {DRAWING_INTERVAL_VISIBILITY_PRESETS.map((preset) => {
            const active = matchesDrawingIntervalPreset(value, preset.id, currentTimeframe);
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(intervalVisibilityForPreset(preset.id, currentTimeframe))}
                className={cn(
                  "rounded border px-2 py-1.5 text-left text-[11px] transition-colors",
                  active
                    ? "border-[#2962ff] bg-[#2962ff]/15 text-ink"
                    : "border-terminal-border-strong text-ink-muted hover:bg-terminal-hover",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </section>
      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Show on intervals
        </div>
        <div className="grid grid-cols-4 gap-2">
          {TIMEFRAMES.map((timeframe) => {
            const checked = selected.has(timeframe);
            return (
              <button
                key={timeframe}
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-label={`Show on ${timeframe}`}
                onClick={() => onChange(toggleDrawingInterval(value, timeframe))}
                className={cn(
                  "flex h-8 items-center justify-center gap-1 rounded border text-[11px]",
                  checked
                    ? "border-[#6a6d75] bg-terminal-hover text-ink"
                    : "border-[#3f4248] text-[#737780]",
                )}
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-current">
                  {checked && <Check size={10} />}
                </span>
                {timeframe}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
