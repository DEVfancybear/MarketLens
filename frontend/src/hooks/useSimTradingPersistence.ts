"use client";

import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { authUserAtom, backendSessionAtom } from "@/store/authStore";
import {
  activeSimAccountAtom,
  activeSimOwnerAtom,
  applyRemoteSimTradingAtom,
  clearRemoteSimTradingAtom,
  simTradingHydratedAtom,
} from "@/store/tradeStore";
import {
  createSimAccount,
  listSimAccounts,
  listSimPositions,
  positionFromBackend,
} from "@/services/api/resources/simTradingApi";
import { reportFrontendError } from "@/services/feedback/errorReporter";
import type { Position } from "@/types";
import type { SimAccount } from "@/services/api/resources/simTradingApi";

const hydrationByUser = new Map<string, Promise<{ account: SimAccount; positions: Position[] }>>();

function loadSimTrading(ownerId: string) {
  let promise = hydrationByUser.get(ownerId);
  if (!promise) {
    promise = (async () => {
      const accounts = await listSimAccounts();
      const account = accounts[0] ?? await createSimAccount({ name: "Default", startingEquity: 10_000, currency: "USD" });
      const positions = await listSimPositions(account.id);
      return { account, positions: positions.map(positionFromBackend) };
    })();
    hydrationByUser.set(ownerId, promise);
    void promise.then(
      () => hydrationByUser.delete(ownerId),
      () => hydrationByUser.delete(ownerId),
    );
  }
  return promise;
}

/** Lazily hydrates Phase 13 state when the Trade panel is actually mounted. */
export function useSimTradingPersistence(): void {
  const backendSession = useAtomValue(backendSessionAtom);
  const user = useAtomValue(authUserAtom);
  const hydrated = useAtomValue(simTradingHydratedAtom);
  const activeAccount = useAtomValue(activeSimAccountAtom);
  const activeOwner = useAtomValue(activeSimOwnerAtom);
  const applyRemote = useSetAtom(applyRemoteSimTradingAtom);
  const clearRemote = useSetAtom(clearRemoteSimTradingAtom);

  useEffect(() => {
    if (!backendSession || !user) {
      if (activeAccount || activeOwner) clearRemote();
      return;
    }
    if (activeOwner && activeOwner !== user.uid) clearRemote();
    if (hydrated && activeOwner === user.uid) return;
    let cancelled = false;
    void loadSimTrading(user.uid).then((snapshot) => {
      if (!cancelled) applyRemote({ ownerId: user.uid, ...snapshot });
    }).catch((error) => {
      if (!cancelled) reportFrontendError(error, { title: "Trading account sync failed", logPrefix: "Sim account hydration failed" });
    });
    return () => { cancelled = true; };
  }, [activeAccount, activeOwner, applyRemote, backendSession, clearRemote, hydrated, user]);
}
