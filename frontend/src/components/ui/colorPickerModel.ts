export const TRADINGVIEW_COLOR_PALETTE = [
  [
    "#ffffff",
    "#d1d4dc",
    "#b2b5be",
    "#9598a1",
    "#787b86",
    "#5d606b",
    "#434651",
    "#363a45",
    "#2a2e39",
    "#000000",
  ],
  [
    "#f23645",
    "#ff9800",
    "#fdd835",
    "#4caf50",
    "#089981",
    "#00bcd4",
    "#2962ff",
    "#673ab7",
    "#9c27b0",
    "#e91e63",
  ],
  [
    "#fccbcd",
    "#ffe0b2",
    "#fff9c4",
    "#c8e6c9",
    "#b2dfdb",
    "#b2ebf2",
    "#bbdefb",
    "#d1c4e9",
    "#e1bee7",
    "#f8bbd0",
  ],
  [
    "#f7a9ad",
    "#ffcc80",
    "#fff59d",
    "#a5d6a7",
    "#80cbc4",
    "#80deea",
    "#90caf9",
    "#b39ddb",
    "#ce93d8",
    "#f48fb1",
  ],
  [
    "#f77c80",
    "#ffb74d",
    "#ffee58",
    "#81c784",
    "#4db6ac",
    "#4dd0e1",
    "#64b5f6",
    "#9575cd",
    "#ba68c8",
    "#f06292",
  ],
  [
    "#ef5350",
    "#ffa726",
    "#ffeb3b",
    "#66bb6a",
    "#26a69a",
    "#26c6da",
    "#42a5f5",
    "#7e57c2",
    "#ab47bc",
    "#ec407a",
  ],
  [
    "#b22833",
    "#f57c00",
    "#f9a825",
    "#2e7d32",
    "#00695c",
    "#00838f",
    "#1565c0",
    "#4527a0",
    "#6a1b9a",
    "#ad1457",
  ],
  [
    "#801922",
    "#e65100",
    "#f57f17",
    "#1b5e20",
    "#004d40",
    "#006064",
    "#0d47a1",
    "#311b92",
    "#4a148c",
    "#880e4f",
  ],
] as const;

export interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

const HEX_COLOR = /^#?([0-9a-f]{6})$/i;
const HEX_COLOR_WITH_ALPHA = /^#?([0-9a-f]{6})([0-9a-f]{2})$/i;
const SHORT_HEX_COLOR = /^#?([0-9a-f]{3})$/i;
const RGB_COLOR =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i;

export function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function normalizeHexColor(
  color: string | null | undefined,
  fallback = "#2962ff",
): string {
  const candidate = color?.trim() ?? "";
  const withAlpha = HEX_COLOR_WITH_ALPHA.exec(candidate);
  if (withAlpha) return `#${withAlpha[1].toLowerCase()}`;

  const full = HEX_COLOR.exec(candidate);
  if (full) return `#${full[1].toLowerCase()}`;

  const short = SHORT_HEX_COLOR.exec(candidate);
  if (short) {
    return `#${short[1]
      .split("")
      .map((character) => character.repeat(2))
      .join("")
      .toLowerCase()}`;
  }

  const rgb = RGB_COLOR.exec(candidate);
  if (rgb) {
    return rgbToHex({
      red: Number(rgb[1]),
      green: Number(rgb[2]),
      blue: Number(rgb[3]),
    });
  }

  if (candidate !== fallback) return normalizeHexColor(fallback, "#2962ff");
  return "#2962ff";
}

export function hexToRgb(color: string): RgbColor {
  const normalized = normalizeHexColor(color);
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex({ red, green, blue }: RgbColor): string {
  return `#${[red, green, blue]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function rgbToHsv({ red, green, blue }: RgbColor): HsvColor {
  const r = clampColorChannel(red) / 255;
  const g = clampColorChannel(green) / 255;
  const b = clampColorChannel(blue) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;

  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

export function hsvToRgb({
  hue,
  saturation,
  value,
}: HsvColor): RgbColor {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, saturation));
  const v = Math.max(0, Math.min(1, value));
  const chroma = v * s;
  const segment = h / 60;
  const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
  const match = v - chroma;

  let channels: [number, number, number];
  if (segment < 1) channels = [chroma, intermediate, 0];
  else if (segment < 2) channels = [intermediate, chroma, 0];
  else if (segment < 3) channels = [0, chroma, intermediate];
  else if (segment < 4) channels = [0, intermediate, chroma];
  else if (segment < 5) channels = [intermediate, 0, chroma];
  else channels = [chroma, 0, intermediate];

  return {
    red: (channels[0] + match) * 255,
    green: (channels[1] + match) * 255,
    blue: (channels[2] + match) * 255,
  };
}

export function hexToHsv(color: string): HsvColor {
  return rgbToHsv(hexToRgb(color));
}

export function hsvToHex(color: HsvColor): string {
  return rgbToHex(hsvToRgb(color));
}

export function normalizeOpacity(opacity: number | undefined): number {
  if (!Number.isFinite(opacity)) return 1;
  return Math.max(0, Math.min(1, opacity ?? 1));
}

export function colorOpacity(
  color: string | null | undefined,
  fallback = 1,
): number {
  const candidate = color?.trim() ?? "";
  const withAlpha = HEX_COLOR_WITH_ALPHA.exec(candidate);
  if (withAlpha) {
    return Number.parseInt(withAlpha[2], 16) / 255;
  }
  const rgb = RGB_COLOR.exec(candidate);
  if (rgb?.[4] !== undefined) return normalizeOpacity(Number(rgb[4]));
  return normalizeOpacity(fallback);
}

export function colorWithOpacity(color: string, opacity: number): string {
  const normalized = normalizeHexColor(color);
  const alpha = normalizeOpacity(opacity);
  if (alpha >= 0.999) return normalized;
  return `${normalized}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}
