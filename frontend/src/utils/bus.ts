/** Minimal typed event bus for decoupled cross-module actions (e.g. hotkeys → trade panel). */
type Handler = (detail?: unknown) => void;

const listeners = new Map<string, Set<Handler>>();

export type BusEvent =
  | 'trade:buy'
  | 'trade:sell'
  | 'trade:close'
  | 'trade:prefill'
  | 'replay:armAtCrosshair';

export function emit(event: BusEvent, detail?: unknown) {
  listeners.get(event)?.forEach((h) => h(detail));
}

export function on(event: BusEvent, handler: Handler): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => listeners.get(event)?.delete(handler);
}
