import { atom } from "jotai";

export const drawingAlertDrawingIdAtom = atom<string | null>(null);
export const setDrawingAlertDrawingIdAtom = atom(
  null,
  (_get, set, drawingId: string | null) => set(drawingAlertDrawingIdAtom, drawingId),
);
