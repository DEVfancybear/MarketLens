/**
 * ClipboardManager — cut/copy/paste for drawings.
 *
 * Uses the system clipboard (navigator.clipboard) for cross-tab copy.
 * Falls back to an in-memory buffer when clipboard API is unavailable.
 */
import type { Drawing } from "@/types";
import {
  decodeDrawingList,
  encodeDrawingList,
} from "../persistence/drawingCodec";

export class ClipboardManager {
  private buffer: Drawing[] = [];

  /** Copy drawings to clipboard (serialized as JSON). */
  copy(drawings: Drawing[]): void {
    this.buffer = encodeDrawingList(drawings);
    const text = JSON.stringify(this.buffer);
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  /** Cut = copy + delete. Returns the drawings to be removed. */
  cut(drawings: Drawing[]): Drawing[] {
    this.copy(drawings);
    return drawings;
  }

  /** Read drawings from clipboard. Returns parsed drawings or empty. */
  async paste(): Promise<Drawing[]> {
    // Try clipboard API first.
    try {
      const text = await navigator.clipboard?.readText();
      if (text) {
        const parsed = decodeDrawingList(JSON.parse(text));
        if (parsed.drawings.length > 0) {
          // Offset pasted drawings slightly to avoid overlap.
          return parsed.drawings.map((d, i) => ({
            ...d,
            points: d.points.map((pt) => ({
              time: pt.time + (i + 1) * 60, // offset by 1 bar
              price: pt.price,
            })),
          }));
        }
      }
    } catch {
      // Clipboard read failed — use internal buffer.
    }
    // Fallback: internal buffer with offset.
    return this.buffer.map((d, i) => ({
      ...d,
      points: d.points.map((pt) => ({
        time: pt.time + (i + 1) * 60,
        price: pt.price,
      })),
    }));
  }

  /** Check if clipboard has content. */
  hasContent(): boolean {
    return this.buffer.length > 0;
  }
}
