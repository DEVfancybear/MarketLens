export interface TextEditorPositionInput {
  left: number;
  top: number;
  editorWidth: number;
  editorHeight: number;
  viewportWidth: number;
  viewportHeight: number;
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
