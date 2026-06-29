/**
 * Shared canvas drawing helpers used by all tool plugins.
 */

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
  g.lineTo(x2 - size * Math.cos(ang - spread), y2 - size * Math.sin(ang - spread));
  g.lineTo(x2 - size * Math.cos(ang + spread), y2 - size * Math.sin(ang + spread));
  g.closePath();
  g.fill();
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
) {
  g.save();
  g.font = "11px var(--font-sans)";
  const w = g.measureText(text).width + 10;
  g.fillStyle = color;
  g.globalAlpha = 0.85;
  g.beginPath();
  // Use arcTo-based roundRect for cross-browser compatibility.
  const r = 4;
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + 18, r);
  g.arcTo(x + w, y + 18, x, y + 18, r);
  g.arcTo(x, y + 18, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = "#fff";
  g.textBaseline = "middle";
  g.fillText(text, x + 5, y + 9);
  g.restore();
}
