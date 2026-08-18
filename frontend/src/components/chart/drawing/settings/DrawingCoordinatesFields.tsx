import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { resolvedChartTimeZoneAtom } from "@/store/chartStore";
import type { Candle, Point } from "../../../../types";
import {
  fromLocalDateTimeInput,
  nearestCandleIndex,
  timeAtCandleIndex,
  toLocalDateTimeInput,
  updateDrawingPoint,
} from "../coordinates/drawingCoordinates";

function ExactNumberField({
  label,
  value,
  onCommit,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(String(value));
  };
  return (
    <input
      type="number"
      step="any"
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
      className="h-[34px] w-full min-w-0 rounded-[5px] border border-terminal-border-strong bg-terminal-raised px-2.5 text-[12px] text-ink-muted outline-hidden transition-colors focus:border-brand focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

export function DrawingCoordinatesFields({
  points,
  candles,
  labels,
  showPrice = true,
  onChange,
}: {
  points: readonly Point[];
  candles: readonly Candle[];
  labels?: readonly string[];
  /** Calculated tools such as Regression Trend own their vertical values. */
  showPrice?: boolean;
  onChange: (points: Point[]) => void;
}) {
  const timeZone = useAtomValue(resolvedChartTimeZoneAtom);
  const patchPoint = (index: number, patch: Partial<Point>) =>
    onChange(updateDrawingPoint(points, index, patch));

  return (
    <div className="space-y-5" data-coordinate-editor>
      {points.map((point, index) => {
        const title = labels?.[index] ?? `Point ${index + 1}`;
        const barIndex = nearestCandleIndex(candles, point.time);
        return (
          <section key={index} aria-label={`${title} coordinates`}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {title}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {showPrice && (
                <label
                  className="grid min-w-0 grid-cols-1 gap-1 text-[10px] text-ink-faint"
                  data-coordinate-field
                >
                  <span>Price</span>
                  <ExactNumberField
                    label={`${title} price`}
                    value={Number(point.price.toFixed(8))}
                    onCommit={(price) => patchPoint(index, { price })}
                  />
                </label>
              )}
              <label
                className="grid min-w-0 grid-cols-1 gap-1 text-[10px] text-ink-faint"
                data-coordinate-field
              >
                <span>Unix time</span>
                <ExactNumberField
                  label={`${title} Unix time`}
                  value={point.time}
                  onCommit={(time) => patchPoint(index, { time: Math.round(time) })}
                />
              </label>
              <label
                className="grid min-w-0 grid-cols-1 gap-1 text-[10px] text-ink-faint"
                data-coordinate-field
              >
                <span>Date / time</span>
                <input
                  type="datetime-local"
                  aria-label={`${title} date and time`}
                  value={toLocalDateTimeInput(point.time, timeZone)}
                  onChange={(event) => {
                    const time = fromLocalDateTimeInput(
                      event.target.value,
                      timeZone,
                    );
                    if (time != null) patchPoint(index, { time });
                  }}
                  className="h-[34px] min-w-0 w-full rounded-[5px] border border-terminal-border-strong bg-terminal-raised px-2 text-[11px] text-ink-muted outline-hidden focus:border-brand focus:ring-1 focus:ring-brand"
                />
              </label>
              <label
                className="grid min-w-0 grid-cols-1 gap-1 text-[10px] text-ink-faint"
                data-coordinate-field
              >
                <span>Bar index</span>
                <ExactNumberField
                  label={`${title} bar index`}
                  value={barIndex ?? 0}
                  disabled={barIndex == null}
                  onCommit={(nextIndex) => {
                    const time = timeAtCandleIndex(candles, nextIndex);
                    if (time != null) patchPoint(index, { time });
                  }}
                />
              </label>
            </div>
          </section>
        );
      })}
    </div>
  );
}
