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
