"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { authUserAtom, backendSessionAtom } from "@/store/authStore";
import {
  resetMt5IntegrationAtom,
  syncMt5IntegrationAtom,
} from "@/store/mt5Store";
import {
  getIntegrationSettings,
  invalidateIntegrationSettingsRequest,
} from "@/services/api/resources/integrationsApi";

/**
 * Hydrates MT5 access from the current backend user's verification. No access
 * state is kept in browser storage, so identities cannot inherit one another's
 * bridge snapshots or permission to enter MT5 execution mode.
 */
export function useMt5IntegrationAccess() {
  const backendSession = useAtomValue(backendSessionAtom);
  const userID = useAtomValue(authUserAtom)?.uid ?? null;
  const reset = useSetAtom(resetMt5IntegrationAtom);
  const sync = useSetAtom(syncMt5IntegrationAtom);
  const sequenceRef = useRef(0);

  useEffect(() => {
    const sequence = ++sequenceRef.current;
    let cancelled = false;

    invalidateIntegrationSettingsRequest();
    reset();
    if (!backendSession || !userID) return;

    void getIntegrationSettings()
      .then((settings) => {
        if (cancelled || sequence !== sequenceRef.current) return;
        sync(settings.mt5);
      })
      .catch(() => {
        if (cancelled || sequence !== sequenceRef.current) return;
        reset();
      });

    return () => {
      cancelled = true;
    };
  }, [backendSession, reset, sync, userID]);
}
