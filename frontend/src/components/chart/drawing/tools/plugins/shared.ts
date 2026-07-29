/**
 * Shared canvas drawing helpers used by all tool plugins.
 */

// Canvas `ctx.font` cannot resolve CSS custom properties: `"28px var(--font-sans)"`
// is an UNPARSEABLE font string, so the whole assignment is silently ignored and
// size/bold/italic never take effect. Resolve `--font-sans` to a concrete family
// once (cached) and build canvas font strings from it instead.
let _fontFamily: string | null = null;
export function fontFamily(): string {
  if (_fontFamily) return _fontFamily;
  if (typeof window !== "undefined") {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-sans")
      .trim();
    _fontFamily = v || '"Inter", system-ui, sans-serif';
  } else {
    _fontFamily = '"Inter", system-ui, sans-serif';
  }
  return _fontFamily;
}

/** Build a valid canvas font string (optionally bold / italic / weight). */
export function canvasFont(
  sizePx: number,
  opts?: { bold?: boolean; italic?: boolean; weight?: number },
): string {
  const i = opts?.italic ? "italic " : "";
  const w = opts?.weight != null ? `${opts.weight} ` : "";
  const b = opts?.bold ? "bold " : "";
  return `${i}${w}${b}${sizePx}px ${fontFamily()}`;
}

export function applyStyle(
  g: CanvasRenderingContext2D,
  style: string | undefined,
) {
  if (style === "dashed") g.setLineDash([6, 3]);
  else if (style === "dotted") g.setLineDash([2, 3]);
  else g.setLineDash([]);
}

export function line(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

/**
 * Filled triangular arrowhead at the tip (x2,y2), oriented along the segment
 * (x1,y1)→(x2,y2). Used by the Path tool (TradingView draws a single arrow at
 * the end of the connected segments).
 */
export function arrowHead(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  size = 11,
) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7; // ~26° half-angle
  g.save();
  g.setLineDash([]);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x2, y2);
  g.lineTo(
    x2 - size * Math.cos(ang - spread),
    y2 - size * Math.sin(ang - spread),
  );
  g.lineTo(
    x2 - size * Math.cos(ang + spread),
    y2 - size * Math.sin(ang + spread),
  );
  g.closePath();
  g.fill();
  g.restore();
}

/**
 * Draws a filled shape's inner label (TradingView "+ Add text" content) inside
 * the given screen-space box, honouring alignment/bold/italic/color/font size.
 * No-op when the drawing has no text. Shared by every fillable shape tool
 * (Rectangle/RotatedRect/Circle/Ellipse/Triangle) so they render identically.
 */
export function renderShapeText(
  g: CanvasRenderingContext2D,
  d: { text?: string; fontSize?: number; bold?: boolean; italic?: boolean; textColor?: string; color: string; textHAlign?: "left" | "center" | "right"; textVAlign?: "top" | "middle" | "bottom" },
  ox: number,
  oy: number,
  w: number,
  h: number,
) {
  if (!d.text) return;
  g.save();
  g.setLineDash([]);
  const fs = d.fontSize ?? 14;
  g.font = canvasFont(fs, { bold: d.bold, italic: d.italic });
  g.fillStyle = d.textColor || d.color;
  const pad = 6;
  const hAlign = d.textHAlign ?? "center";
  const vAlign = d.textVAlign ?? "middle";
  g.textAlign = hAlign;
  g.textBaseline =
    vAlign === "middle" ? "middle" : vAlign === "top" ? "top" : "bottom";
  const tx =
    hAlign === "left" ? ox + pad : hAlign === "right" ? ox + w - pad : ox + w / 2;
  const ty =
    vAlign === "top" ? oy + pad : vAlign === "bottom" ? oy + h - pad : oy + h / 2;
  for (const [i, ln] of d.text.split("\n").entries())
    g.fillText(ln, tx, ty + i * fs * 1.25);
  g.restore();
}

/**
 * Draws a TradingView-style text label attached to a line segment. A selected
 * empty trendline shows "+ Add text"; once saved, the drawing's own `text`
 * is rendered on the line and moves/rotates with it.
 */
export function renderLineText(
  g: CanvasRenderingContext2D,
  d: {
    text?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    textColor?: string;
    color: string;
  },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  selected: boolean,
) {
  const text = d.text?.trim() || (selected ? "+ Add text" : "");
  if (!text) return;

  const placeholder = !d.text?.trim();
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  let angle = Math.atan2(y2 - y1, x2 - x1);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;

  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.setLineDash([]);
  const fs = d.fontSize ?? 12;
  g.font = canvasFont(fs, {
    bold: d.bold,
    italic: d.italic || placeholder,
  });
  g.fillStyle = d.textColor || d.color;
  g.globalAlpha = placeholder ? 0.72 : 1;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const lines = text.split("\n");
  const lineHeight = fs * 1.22;
  const offsetY = -7;
  for (const [i, lineText] of lines.entries()) {
    g.fillText(
      lineText,
      0,
      offsetY + (i - (lines.length - 1) / 2) * lineHeight,
    );
  }
  g.restore();
}

export function handle(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) {
  g.save();
  g.fillStyle = "#fff";
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.setLineDash([]);
  g.beginPath();
  g.arc(x, y, 4, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
}

/** TradingView-style edge-center resize handle used by box geometries. */
export function squareHandle(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) {
  const size = 8;
  g.save();
  g.fillStyle = "#fff";
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.setLineDash([]);
  g.beginPath();
  g.rect(x - size / 2, y - size / 2, size, size);
  g.fill();
  g.stroke();
  g.restore();
}

/**
 * Visual screen angle (degrees) of the segment p1→p2, measured from the
 * horizontal axis. Positive = upward (TradingView convention, where the
 * y-axis is inverted because canvas y grows downward).
 */
export function angleDeg(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  return (Math.atan2(y1 - y2, x2 - x1) * 180) / Math.PI;
}

/**
 * Draw a small arc at the origin point illustrating the angle between the
 * horizontal baseline and the segment p1→p2 (TradingView "Trend angle" style).
 */
export function angleArc(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
) {
  const radius = 28;
  // Baseline points to the right; the segment ends at the screen angle.
  const a = Math.atan2(y2 - y1, x2 - x1); // canvas-space angle (y down)
  g.save();
  g.strokeStyle = color;
  g.globalAlpha = 0.6;
  g.lineWidth = 1;
  g.setLineDash([]);
  // Reference baseline (dashed, horizontal to the right).
  g.beginPath();
  g.setLineDash([4, 3]);
  g.moveTo(x1, y1);
  g.lineTo(x1 + radius + 14, y1);
  g.stroke();
  // Arc sweeping from the baseline to the trend segment.
  g.beginPath();
  g.setLineDash([]);
  const ccw = a < 0; // upward segments sweep counter-clockwise in canvas space
  g.arc(x1, y1, radius, 0, a, ccw);
  g.stroke();
  g.restore();
}

export function chip(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  bgAlpha?: number,
  /** Border radius (default 4). TradingView positions use 2 for tighter look. */
  radius?: number,
  /** Optional font size (px, default 11) and text colour (default #fff). */
  opts?: { fontSize?: number; textColor?: string },
) {
  g.save();
  const fs = opts?.fontSize ?? 11;
  g.font = canvasFont(fs, { weight: 500 });
  const w = g.measureText(text).width + 6; // 3 px horizontal padding each side
  g.fillStyle = color;
  g.globalAlpha = bgAlpha ?? 0.85;
  const r = radius ?? 4;
  const h = Math.max(15, fs + 4); // chip height grows with font size
  g.beginPath();
  // arcTo-based roundRect for cross-browser compatibility.
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = opts?.textColor ?? "#fff";
  g.textBaseline = "middle";
  // Vertically centered in the chip.
  g.fillText(text, x + 3, y + h / 2 + 0.5);
  g.restore();
}
