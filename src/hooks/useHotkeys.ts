"use client";
import { useEffect } from "react";
import { getReplayState } from "@/store/replayStore";
import { getDefaultStore } from "jotai";
import { toggleAlertCenterAtom } from "@/store/uiStore";
import {
  setActiveToolAtom,
  selectedDrawingIdAtom,
  removeDrawingAtom,
  selectAllAtom,
  duplicateDrawingAtom,
  toggleIndicatorAtom,
  editingIndicatorIdAtom,
  activeToolAtom,
  selectDrawingAtom,
} from "@/store/chartStore";
import { emit } from "@/utils/bus";
import type { DrawingTool } from "@/types";

/** Tool slots numbered 1-9 (TradingView convention). */
const TOOL_SLOTS: Record<string, DrawingTool> = {
  "1": "cursor",
  "2": "trendline",
  "3": "horizontal",
  "4": "rectangle",
  "5": "polyline",
  "6": "text",
  "7": "fibRetracement",
  "8": "long",
  "9": "short",
};

/**
 * Global keyboard shortcuts:
 *   Space        play/pause           R       restart replay
 *   →  / ←       next / prev candle   B / S   buy / sell
 *   Shift+→/←    ±10 candles          X       close position
 *   1–9          switch drawing tools
 *   Delete       remove selected drawing
 *   Ctrl/Cmd+D   duplicate selected drawing
 *   Ctrl/Cmd+A   select all drawings
 *   Ctrl/Cmd+Z   undo (prevents browser tab-close)
 *   Ctrl/I       toggle SMA indicator
 *   Escape       deselect / cancel tool
 *   Alt+A        toggle alert center
 *
 * Replay-transport keys are no-ops unless replay is armed. Keys are ignored
 * while typing in inputs.
 */
export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;

      const r = getReplayState();
      const mod = e.ctrlKey || e.metaKey;

      // --- Drawing tool hotkeys (1–9) ---
      if (!mod && !e.shiftKey && !e.altKey && TOOL_SLOTS[e.key]) {
        e.preventDefault();
        getDefaultStore().set(setActiveToolAtom, TOOL_SLOTS[e.key]);
        return;
      }

      // --- Delete selected drawing ---
      if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        const id = getDefaultStore().get(selectedDrawingIdAtom);
        if (id) {
          e.preventDefault();
          getDefaultStore().set(removeDrawingAtom, id);
        }
        return;
      }

      // --- Select all drawings ---
      if (mod && e.key === "a") {
        e.preventDefault();
        getDefaultStore().set(selectAllAtom);
        return;
      }

      // --- Duplicate selected drawing ---
      if (mod && e.key === "d") {
        const id = getDefaultStore().get(selectedDrawingIdAtom);
        if (id) {
          e.preventDefault();
          getDefaultStore().set(duplicateDrawingAtom, id);
        }
        return;
      }

      // --- Undo (prevent browser close-tab) ---
      if (mod && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        // useCommandHistory handles undo via its own listener
        return;
      }

      // --- Ctrl+I: toggle SMA ---
      if (mod && e.key === "i") {
        e.preventDefault();
        getDefaultStore().set(toggleIndicatorAtom, "SMA");
        return;
      }

      // --- Escape: deselect / cancel tool ---
      if (e.key === "Escape" && !mod) {
        const store = getDefaultStore();
        // Don't deselect if a dialog is open (indicator settings).
        if (store.get(editingIndicatorIdAtom)) return;
        if (
          store.get(selectedDrawingIdAtom) ||
          store.get(activeToolAtom) !== "cursor"
        ) {
          e.preventDefault();
          store.set(selectDrawingAtom, null);
          store.set(setActiveToolAtom, "cursor");
        }
        return;
      }

      switch (e.key) {
        case " ":
          if (r.active) {
            e.preventDefault();
            r.playing ? r.pause() : r.play();
          }
          return;
        case "ArrowRight":
          if (r.active) {
            e.preventDefault();
            r.pause();
            r.step(e.shiftKey ? 10 : 1);
          }
          return;
        case "ArrowLeft":
          if (r.active) {
            e.preventDefault();
            r.pause();
            r.step(e.shiftKey ? -10 : -1);
          }
          return;
        case "r":
        case "R":
          if (r.active) r.restart();
          return;
        case "a":
        case "A":
          if (e.altKey) {
            e.preventDefault();
            getDefaultStore().set(toggleAlertCenterAtom);
          }
          return;
        case "b":
        case "B":
          emit("trade:buy");
          return;
        case "s":
        case "S":
          emit("trade:sell");
          return;
        case "x":
        case "X":
          emit("trade:close");
          return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
