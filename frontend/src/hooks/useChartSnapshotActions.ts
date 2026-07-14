"use client";

import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { captureChart } from "@/components/chart/chartRegistry";
import { symbolAtom, timeframeAtom } from "@/store/chartStore";
import { logAtom } from "@/store/uiStore";

/** Shared chart image actions used by desktop commands and mobile chart tools. */
export function useChartSnapshotActions() {
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const log = useSetAtom(logAtom);

  const capture = useCallback(async () => {
    try {
      const blob = await captureChart();
      if (!blob) log("warn", "Screenshot failed: chart not ready");
      return blob;
    } catch (error) {
      log(
        "error",
        `Screenshot failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return null;
    }
  }, [log]);

  const download = useCallback(async () => {
    const blob = await capture();
    if (!blob) return false;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${symbol}_${timeframe}_${Date.now()}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    log("info", "Screenshot saved");
    return true;
  }, [capture, log, symbol, timeframe]);

  const copy = useCallback(async () => {
    const blob = await capture();
    if (!blob) return false;
    const clipboard = navigator.clipboard as unknown as {
      write?: (items: unknown[]) => Promise<void>;
    };
    const ClipboardItemCtor = (
      globalThis as unknown as {
        ClipboardItem?: new (items: Record<string, Blob>) => unknown;
      }
    ).ClipboardItem;
    if (!clipboard.write || !ClipboardItemCtor) {
      log("warn", "Copy image is not supported in this browser");
      return false;
    }
    try {
      await clipboard.write([
        new ClipboardItemCtor({ [blob.type || "image/png"]: blob }),
      ]);
      log("info", "Screenshot copied");
      return true;
    } catch (error) {
      log(
        "error",
        `Copy image failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return false;
    }
  }, [capture, log]);

  return { capture, download, copy };
}
