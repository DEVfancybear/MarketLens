"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  getFavoriteTimeframes,
  replaceFavoriteTimeframes,
} from "@/services/api/resources/settingsApi";
import { userFacingErrorMessage } from "@/services/feedback/errorReporter";
import { localStore } from "@/services/storage";
import { authStatusAtom, backendSessionAtom } from "@/store/authStore";
import { logAtom } from "@/store/uiStore";
import type { Timeframe } from "@/types";
import {
  addFavoriteTimeframe,
  DEFAULT_FAVORITE_TIMEFRAMES,
  normalizeFavoriteTimeframes,
  TIMEFRAME_FAVORITES_KEY,
  toggleFavoriteTimeframe,
} from "@/components/toolbar/timeframeSelectorModel";

/** One local/cloud favorite interval state for desktop and mobile selectors. */
export function useTimeframeFavorites() {
  const [favorites, setFavorites] = useState<Timeframe[]>(
    DEFAULT_FAVORITE_TIMEFRAMES,
  );
  const authStatus = useAtomValue(authStatusAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const log = useSetAtom(logAtom);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const revisionRef = useRef(0);

  useEffect(() => {
    const saved = localStore.get<string[]>(
      TIMEFRAME_FAVORITES_KEY,
      DEFAULT_FAVORITE_TIMEFRAMES,
    );
    const next = normalizeFavoriteTimeframes(saved);
    setFavorites(next.length ? next : DEFAULT_FAVORITE_TIMEFRAMES);
  }, []);

  useEffect(() => {
    if (authStatus !== "anonymous") return;
    localStore.remove(TIMEFRAME_FAVORITES_KEY);
    setFavorites(DEFAULT_FAVORITE_TIMEFRAMES);
  }, [authStatus]);

  useEffect(() => {
    if (authStatus === "anonymous" || !backendSession) return;
    let cancelled = false;
    const requestRevision = revisionRef.current;
    void getFavoriteTimeframes()
      .then(({ timeframes }) => {
        if (cancelled || requestRevision !== revisionRef.current) return;
        const normalized = normalizeFavoriteTimeframes(timeframes);
        setFavorites(normalized);
        localStore.set(TIMEFRAME_FAVORITES_KEY, normalized);
      })
      .catch((error) => {
        if (cancelled) return;
        log(
          "warn",
          `Timeframe favorites loaded from local cache: ${userFacingErrorMessage(error, "unknown error")}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, backendSession, log]);

  const persist = useCallback(
    (values: readonly string[]) => {
      const normalized = normalizeFavoriteTimeframes(values);
      revisionRef.current += 1;
      setFavorites(normalized);
      localStore.set(TIMEFRAME_FAVORITES_KEY, normalized);
      if (!backendSession) return;
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => replaceFavoriteTimeframes(normalized))
        .then(() => undefined)
        .catch((error) => {
          log(
            "error",
            `Timeframe favorites sync failed: ${userFacingErrorMessage(error, "unknown error")}`,
          );
        });
    },
    [backendSession, log],
  );

  const toggleFavorite = useCallback(
    (timeframe: Timeframe) => persist(toggleFavoriteTimeframe(favorites, timeframe)),
    [favorites, persist],
  );
  const addFavorite = useCallback(
    (timeframe: Timeframe) => persist(addFavoriteTimeframe(favorites, timeframe)),
    [favorites, persist],
  );

  return { favorites, toggleFavorite, addFavorite };
}
