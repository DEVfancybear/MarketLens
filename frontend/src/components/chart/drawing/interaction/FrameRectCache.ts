/**
 * Browser layout is stable for the duration of a display frame. Pointer input,
 * hit arbitration and rendering can otherwise read the same canvas rect several
 * times and accidentally force repeated layout work in one frame.
 */
let rects = new WeakMap<Element, DOMRect>();
let clearFrame: number | null = null;

export function getFrameClientRect(element: Element): DOMRect {
  const cached = rects.get(element);
  if (cached) return cached;

  const rect = element.getBoundingClientRect();
  rects.set(element, rect);
  if (clearFrame == null && typeof globalThis.requestAnimationFrame === "function") {
    clearFrame = globalThis.requestAnimationFrame(() => {
      rects = new WeakMap<Element, DOMRect>();
      clearFrame = null;
    });
  }
  return rect;
}

export function invalidateFrameClientRect(element?: Element): void {
  if (element) rects.delete(element);
  else rects = new WeakMap<Element, DOMRect>();
}
