"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { authStatusAtom, backendSessionAtom } from "@/store/authStore";
import { logAtom } from "@/store/uiStore";
import {
  getDrawingToolFavorites,
  replaceDrawingToolFavorites,
} from "@/services/api/resources/drawingsApi";
import { userFacingErrorMessage } from "@/services/feedback/errorReporter";
import { normalizeFavoriteDrawingTools } from "@/types/drawingToolManifest";
import type { DrawingTool } from "@/types";

const FAVORITES_STORAGE_KEY = "tv:favTools";

function readLocalFavorites(): DrawingTool[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? normalizeFavoriteDrawingTools(
          parsed.filter((item): item is string => typeof item === "string"),
        )
      : [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(tools: readonly string[]) {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(tools));
  } catch {
    // Storage can be unavailable in private browsing; favorites still work for
    // the current React session.
  }
}

function clearLocalFavorites() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(FAVORITES_STORAGE_KEY);
  } catch {
    // Storage is optional.
  }
}

/** Shared desktop/mobile drawing favorites backed by the same API and cache. */
export function useDrawingToolFavorites(): [
  ReadonlySet<DrawingTool>,
  (tool: DrawingTool) => void,
] {
  const backendSession = useAtomValue(backendSessionAtom);
  const authStatus = useAtomValue(authStatusAtom);
  const log = useSetAtom(logAtom);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [favorites, setFavorites] = useState<Set<DrawingTool>>(
    () => new Set(readLocalFavorites()),
  );

  useEffect(() => {
    if (authStatus === "anonymous") {
      clearLocalFavorites();
      setFavorites(new Set());
      return;
    }
    if (!backendSession) return;
    let cancelled = false;
    void getDrawingToolFavorites()
      .then((result) => {
        if (cancelled) return;
        const tools = normalizeFavoriteDrawingTools(result.tools);
        setFavorites(new Set(tools));
        writeLocalFavorites(tools);
      })
      .catch((error) => {
        if (cancelled) return;
        log(
          "warn",
          `Drawing tool favorites loaded from local cache: ${userFacingErrorMessage(error, "unknown error")}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, backendSession, log]);

  const persist = useCallback(
    (tools: readonly string[]) => {
      const normalized = normalizeFavoriteDrawingTools(tools);
      writeLocalFavorites(normalized);
      if (!backendSession) return;
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => replaceDrawingToolFavorites(normalized))
        .then(() => undefined)
        .catch((error) => {
          log(
            "error",
            `Drawing tool favorites sync failed: ${userFacingErrorMessage(error, "unknown error")}`,
          );
        });
    },
    [backendSession, log],
  );

  const toggle = useCallback(
    (tool: DrawingTool) => {
      setFavorites((current) => {
        const next = new Set(current);
        if (next.has(tool)) next.delete(tool);
        else next.add(tool);
        const normalized = normalizeFavoriteDrawingTools([...next]);
        persist(normalized);
        return new Set(normalized);
      });
    },
    [persist],
  );

  return [favorites, toggle];
}
