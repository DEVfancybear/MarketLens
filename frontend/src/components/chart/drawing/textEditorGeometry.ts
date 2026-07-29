export interface TextEditorPositionInput {
  left: number;
  top: number;
  editorWidth: number;
  editorHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}

export interface CenteredTextEditorPositionInput {
  x: number;
  y: number;
  editorWidth: number;
  editorHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  angleDegrees?: number;
  /** Offset along the editor's local Y axis before rotation. */
  offsetY?: number;
  padding?: number;
}

/** Keep the entire inline editor inside its chart-local containing block. */
export function clampTextEditorPosition({
  left,
  top,
  editorWidth,
  editorHeight,
  viewportWidth,
  viewportHeight,
  padding = 4,
}: TextEditorPositionInput): { left: number; top: number } {
  const safeWidth = Math.max(0, viewportWidth);
  const safeHeight = Math.max(0, viewportHeight);
  const minLeft = Math.min(padding, safeWidth);
  const minTop = Math.min(padding, safeHeight);
  const maxLeft = Math.max(minLeft, safeWidth - Math.max(0, editorWidth) - padding);
  const maxTop = Math.max(minTop, safeHeight - Math.max(0, editorHeight) - padding);
  return {
    left: Math.max(minLeft, Math.min(left, maxLeft)),
    top: Math.max(minTop, Math.min(top, maxTop)),
  };
}

/**
 * Resolve a center-anchored, optionally rotated editor inside the viewport.
 *
 * Drawing text is positioned from semantic anchors (shape center, line
 * midpoint, axis badge), while CSS inputs are boxes. Keeping this conversion
 * here prevents every text-capable drawing from inventing its own offsets.
 */
export function resolveCenteredTextEditorPosition({
  x,
  y,
  editorWidth,
  editorHeight,
  viewportWidth,
  viewportHeight,
  angleDegrees = 0,
  offsetY = 0,
  padding,
}: CenteredTextEditorPositionInput): { x: number; y: number } {
  const radians = (angleDegrees * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const safeEditorWidth = Math.max(0, editorWidth);
  const safeEditorHeight = Math.max(0, editorHeight);
  const rotatedWidth =
    Math.abs(safeEditorWidth * cos) + Math.abs(safeEditorHeight * sin);
  const rotatedHeight =
    Math.abs(safeEditorWidth * sin) + Math.abs(safeEditorHeight * cos);
  const desiredCenterX = x - sin * offsetY;
  const desiredCenterY = y + cos * offsetY;
  const clamped = clampTextEditorPosition({
    left: desiredCenterX - rotatedWidth / 2,
    top: desiredCenterY - rotatedHeight / 2,
    editorWidth: rotatedWidth,
    editorHeight: rotatedHeight,
    viewportWidth,
    viewportHeight,
    padding,
  });
  return {
    x: clamped.left + rotatedWidth / 2,
    y: clamped.top + rotatedHeight / 2,
  };
}
