import {
  TF_SECONDS,
  TIMEFRAMES,
  type Drawing,
  type DrawingIntervalVisibility,
  type Timeframe,
} from "../../../../types";

export type DrawingIntervalVisibilityPreset =
  | "all"
  | "current"
  | "current-and-above"
  | "current-and-below";

export const DRAWING_INTERVAL_VISIBILITY_PRESETS: readonly {
  id: DrawingIntervalVisibilityPreset;
  label: string;
}[] = [
  { id: "all", label: "All intervals" },
  { id: "current", label: "Current interval" },
  { id: "current-and-above", label: "Current and above" },
  { id: "current-and-below", label: "Current and below" },
];

function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && (TIMEFRAMES as readonly string[]).includes(value);
}

export function normalizeDrawingIntervalVisibility(
  value: unknown,
): DrawingIntervalVisibility | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = (value as { timeframes?: unknown }).timeframes;
  if (!Array.isArray(raw)) return undefined;
  const selected = new Set(raw.filter(isTimeframe));
  return { timeframes: TIMEFRAMES.filter((timeframe) => selected.has(timeframe)) };
}

export function isDrawingVisibleAtTimeframe(
  drawing: Pick<Drawing, "visible" | "intervalVisibility">,
  timeframe: Timeframe,
): boolean {
  if (drawing.visible === false) return false;
  const visibility = normalizeDrawingIntervalVisibility(drawing.intervalVisibility);
  return visibility === undefined || visibility.timeframes.includes(timeframe);
}

export function intervalVisibilityForPreset(
  preset: DrawingIntervalVisibilityPreset,
  current: Timeframe,
): DrawingIntervalVisibility | undefined {
  if (preset === "all") return undefined;
  const currentSeconds = TF_SECONDS[current];
  const timeframes = TIMEFRAMES.filter((timeframe) => {
    if (preset === "current") return timeframe === current;
    if (preset === "current-and-above") return TF_SECONDS[timeframe] >= currentSeconds;
    return TF_SECONDS[timeframe] <= currentSeconds;
  });
  return { timeframes };
}

export function toggleDrawingInterval(
  visibility: DrawingIntervalVisibility | undefined,
  timeframe: Timeframe,
): DrawingIntervalVisibility | undefined {
  const selected = new Set(visibility?.timeframes ?? TIMEFRAMES);
  if (selected.has(timeframe)) selected.delete(timeframe);
  else selected.add(timeframe);
  if (selected.size === TIMEFRAMES.length) return undefined;
  return { timeframes: TIMEFRAMES.filter((item) => selected.has(item)) };
}

export function matchesDrawingIntervalPreset(
  visibility: DrawingIntervalVisibility | undefined,
  preset: DrawingIntervalVisibilityPreset,
  current: Timeframe,
): boolean {
  const normalized = normalizeDrawingIntervalVisibility(visibility);
  const expected = intervalVisibilityForPreset(preset, current);
  return JSON.stringify(normalized?.timeframes) === JSON.stringify(expected?.timeframes);
}
