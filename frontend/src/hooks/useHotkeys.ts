"use client";
import { useEffect } from "react";
import { getDefaultStore } from "jotai";
import { replayClientStore } from "@/store/replayClientStore";
import {
  restartActiveReplay,
  setActiveReplayPlaying,
  stepActiveReplay,
} from "@/services/replay/replaySocket";
import {
  cancelReplaySelectionAtom,
  replaySelectionModeAtom,
} from "@/store/replayUiState";
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
import { getDrawingToolForShortcut } from "@/types/drawingToolManifest";
import { loadIndicatorCatalog } from "@/services/indicatorDefinitions";

/**
 * Global keyboard shortcuts:
 *   Space        play/pause           R       restart replay
 *   →  / ←       next / prev candle   B / S   buy / sell
 *   Shift+→/←    ±10 candles          X       close position
 *   1–9          switch drawing tools
 *   Alt+T/H/J/V/C line tools; Alt+Shift+R rectangle
 *   Ctrl/Cmd+Z   undo (prevents browser tab-close)
 *   Ctrl/I       toggle backend-designated primary indicator
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

      const store = getDefaultStore();
      const replay = replayClientStore.getState().snapshot;
      const selection = store.get(replaySelectionModeAtom);
      const mod = e.ctrlKey || e.metaKey;

      // --- Escape: re-select > initial select > drawing deselect > tool cancel ---
      if (e.key === "Escape" && !mod) {
        if (selection !== "idle") {
          e.preventDefault();
          store.set(cancelReplaySelectionAtom);
          return;
        }
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

      // --- Manifest-owned drawing tool shortcuts ---
      const shortcutTool = getDrawingToolForShortcut({
        key: e.key,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      });
      if (shortcutTool) {
        e.preventDefault();
        store.set(setActiveToolAtom, shortcutTool);
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

      // --- Ctrl+I: toggle the backend-designated primary indicator ---
      if (mod && e.key === "i") {
        e.preventDefault();
        void loadIndicatorCatalog()
          .then((definitions) => definitions.find((item) => item.shortcut === "primary"))
          .then((definition) => {
            if (definition) getDefaultStore().set(toggleIndicatorAtom, definition);
          })
          .catch(() => undefined);
        return;
      }

      const fire = (command: Promise<void>) => void command.catch(() => undefined);
      const replaySelecting = selection !== "idle";
      switch (e.key) {
        case " ":
          if (replay && !replaySelecting) {
            e.preventDefault();
            fire(setActiveReplayPlaying(replay.status !== "playing"));
          }
          return;
        case "ArrowDown":
          if (replay && e.shiftKey && !replaySelecting) {
            e.preventDefault();
            fire(setActiveReplayPlaying(replay.status !== "playing"));
          }
          return;
        case "ArrowRight":
          if (replay && !replaySelecting) {
            e.preventDefault();
            fire(stepActiveReplay(e.shiftKey ? 10 : 1));
          }
          return;
        case "ArrowLeft":
          if (replay && !replaySelecting) {
            e.preventDefault();
            fire(stepActiveReplay(e.shiftKey ? -10 : -1));
          }
          return;
        case "r":
        case "R":
          if (replay && !replaySelecting) fire(restartActiveReplay());
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
