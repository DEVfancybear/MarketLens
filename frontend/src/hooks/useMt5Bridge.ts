"use client";
import { useEffect, useRef } from "react";
import { getDefaultStore, useAtomValue } from "jotai";
import { Mt5BridgeClient } from "@/services/mt5/Mt5BridgeClient";
import { MT5_STALE_AFTER_MS } from "@/services/mt5/protocol";
import { setMt5RuntimeHandlers } from "@/services/mt5/runtime";
import {
  applyMt5MessageAtom,
  markMt5CommandTimeoutAtom,
  mt5BridgeUrlAtom,
  mt5EnabledAtom,
  mt5LastHeartbeatAtom,
  mt5StatusAtom,
  setMt5ErrorAtom,
  setMt5StatusAtom,
} from "@/store/mt5Store";

export function useMt5Bridge() {
  const enabled = useAtomValue(mt5EnabledAtom);
  const url = useAtomValue(mt5BridgeUrlAtom);
  const lastHeartbeat = useAtomValue(mt5LastHeartbeatAtom);
  const status = useAtomValue(mt5StatusAtom);
  const clientRef = useRef<Mt5BridgeClient | null>(null);

  useEffect(() => {
    const store = getDefaultStore();
    if (!enabled) {
      store.set(setMt5StatusAtom, "disabled");
      setMt5RuntimeHandlers(null);
      return;
    }

    const client = new Mt5BridgeClient({
      url,
      token: process.env.NEXT_PUBLIC_MT5_BRIDGE_TOKEN || undefined,
      onMessage: (message) => store.set(applyMt5MessageAtom, message),
      onStatus: (nextStatus) => store.set(setMt5StatusAtom, nextStatus),
      onError: (message) => store.set(setMt5ErrorAtom, message),
      onCommandTimeout: (requestId) =>
        store.set(markMt5CommandTimeoutAtom, requestId),
    });
    clientRef.current = client;
    setMt5RuntimeHandlers({
      send: (type, payload) => client.sendCommand(type, payload),
      connect: () => client.connect(),
      disconnect: () => client.disconnect(),
    });
    client.connect();

    return () => {
      setMt5RuntimeHandlers(null);
      client.destroy();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [enabled, url]);

  useEffect(() => {
    if (!enabled || status !== "connected" || !lastHeartbeat) return;
    const id = window.setInterval(() => {
      const latest = getDefaultStore().get(mt5LastHeartbeatAtom);
      if (latest && Date.now() - latest > MT5_STALE_AFTER_MS) {
        getDefaultStore().set(setMt5StatusAtom, "stale");
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [enabled, lastHeartbeat, status]);
}
