"use client";
import { useEffect } from "react";
import { getReplayState } from "@/store/replayStore";
import { getDefaultStore } from "jotai";
import { toggleAlertCenterAtom } from "@/store/uiStore";
import {
  setActiveToolAtom,
  selectedDrawingIdAtom,
  toggleIndicatorAtom,
  editingIndicatorIdAtom,
  activeToolAtom,
  selectDrawingAtom,
  editingDrawingIdAtom,
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

/** Alt+key line-tool shortcuts (TradingView LINES menu). */
const ALT_TOOL_SLOTS: Record<string, DrawingTool> = {
  t: "trendline",
  h: "horizontal",
  j: "horizRay",
  v: "vertical",
  c: "crossLine",
};

/**
 * Global keyboard shortcuts:
 *   Space        play/pause           R       restart replay
 *   →  / ←       next / prev candle   B / S   buy / sell
 *   Shift+→/←    ±10 candles          X       close position
 *   1–9          switch drawing tools
 *   Alt+T/H/J/V/C trend / horizontal / horiz-ray / vertical / cross line
 *   Ctrl/Cmd+Z   undo (prevents browser tab-close)
 *   Ctrl/I       toggle SMA indicator
 *   Escape       deselect / cancel tool
 *   Alt+A        toggle alert center
 *
 * Delete/Backspace, Ctrl/Cmd+D (duplicate), and Ctrl/Cmd+A (select all) are
 * NOT handled here — see DrawingInteractionManager's own keyboard effect,
 * which is multi-select aware and undo-tracked. Having both here and there
 * caused double-duplication and lost-undo bugs (fixed 2026-07-02).
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

      // --- Escape: re-select > initial select > drawing deselect > tool cancel ---
      if (e.key === "Escape" && !mod) {
        // Re-select mode takes top priority — cancel it before anything else.
        if (r.reSelecting) {
          e.preventDefault();
          r.cancelReSelect();
          return;
        }
        // Initial bar selection.
        if (r.selecting) {
          e.preventDefault();
          r.cancelSelect();
          return;
        }
        const store = getDefaultStore();
        // Don't deselect if a dialog is open (indicator / position settings).
        if (
          store.get(editingIndicatorIdAtom) ||
          store.get(editingDrawingIdAtom)
        )
          return;
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

      // --- Drawing tool hotkeys (1–9) ---
      if (!mod && !e.shiftKey && !e.altKey && TOOL_SLOTS[e.key]) {
        e.preventDefault();
        getDefaultStore().set(setActiveToolAtom, TOOL_SLOTS[e.key]);
        return;
      }

      // --- Alt+key line-tool shortcuts (Alt+T/H/J/V/C) ---
      if (
        e.altKey &&
        !mod &&
        !e.shiftKey &&
        ALT_TOOL_SLOTS[e.key.toLowerCase()]
      ) {
        e.preventDefault();
        getDefaultStore().set(
          setActiveToolAtom,
          ALT_TOOL_SLOTS[e.key.toLowerCase()],
        );
        return;
      }

      // Delete/Backspace, Ctrl+A (select all), and Ctrl+D (duplicate) are
      // handled by DrawingInteractionManager's own keyboard effect — it's
      // multi-select aware and undo-tracked, unlike the removed handlers that
      // used to live here. Having both meant every Ctrl+D created two
      // independent copies (confirmed via a real repro), and every Delete of
      // a single selection raced DrawingInteractionManager's undo-tracked
      // version and usually won, silently losing that delete from the undo
      // stack. Do not re-add duplicate handling for these keys here.

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

      // Replay-transport keys checked against the replay state (r).
      switch (e.key) {
        case " ":
          if (r.active && !r.reSelecting) {
            e.preventDefault();
            r.playing ? r.pause() : r.play();
          }
          return;
        case "ArrowDown":
          if (r.active && e.shiftKey && !r.reSelecting) {
            e.preventDefault();
            r.playing ? r.pause() : r.play();
          }
          return;
        case "ArrowRight":
          if (r.active && !r.reSelecting) {
            e.preventDefault();
            r.pause();
            r.step(1);
          }
          return;
        case "ArrowLeft":
          if (r.active && !r.reSelecting) {
            e.preventDefault();
            r.pause();
            r.step(e.shiftKey ? -10 : -1);
          }
          return;
        case "r":
        case "R":
          if (r.active && !r.reSelecting) r.restart();
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
