"use client";
import { useEffect } from "react";
import { useReplayStore } from "@/store/replayStore";
import { useUIStore } from "@/store/uiStore";
import { emit } from "@/utils/bus";

/**
 * Global keyboard shortcuts:
 *   Space        play/pause           R       restart replay
 *   →  / ←       next / prev candle   B / S   buy / sell
 *   Shift+→/←    ±10 candles          X       close position
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
        (e.target as HTMLElement)?.isContentEditable
      )
        return;

      const r = useReplayStore.getState();

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
            useUIStore.getState().toggleAlertCenter();
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
