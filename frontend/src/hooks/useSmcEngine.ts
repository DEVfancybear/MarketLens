"use client";
import { useEffect, useRef } from "react";
import { useVisibleCandles } from "@/hooks/useVisibleCandles";
import { setSmcSnapshotAtom } from "@/store/smcStore";
import { useSetAtom } from "jotai";
import { computeSmc } from "@/services/smc/smcEngine";
import type { SmcSnapshot } from "@/types";

const THROTTLE_MS = 90;

/**
 * Recomputes the SMC snapshot from the visible candles whenever they change,
 * off-loading to a Web Worker when available and throttling so fast replay
 * doesn't flood the pipeline. Falls back to synchronous compute if the worker
 * can't be created (e.g. older browsers / SSR hydration edge cases).
 */
export function useSmcEngine() {
  const candles = useVisibleCandles();
  const setSnapshot = useSetAtom(setSmcSnapshotAtom);

  const workerRef = useRef<Worker | null>(null);
  const reqRef = useRef(0);
  const lastSentRef = useRef(0);
  const pendingRef = useRef<typeof candles | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spin up the worker once.
  useEffect(() => {
    try {
      const worker = new Worker(
        new URL("../workers/smc.worker.ts", import.meta.url),
      );
      worker.onmessage = (
        e: MessageEvent<{ reqId: number; snapshot?: SmcSnapshot }>,
      ) => {
        // Only accept the latest in-flight request.
        if (e.data.snapshot && e.data.reqId === reqRef.current) {
          setSnapshot(e.data.snapshot);
        }
      };
      workerRef.current = worker;
    } catch {
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dispatch = (data: typeof candles) => {
      const worker = workerRef.current;
      const reqId = ++reqRef.current;
      if (worker) {
        worker.postMessage({ reqId, candles: data });
      } else {
        // Synchronous fallback.
        setSnapshot(computeSmc(data));
      }
      lastSentRef.current = Date.now();
    };

    const now = Date.now();
    const since = now - lastSentRef.current;
    if (since >= THROTTLE_MS) {
      dispatch(candles);
    } else {
      // Coalesce rapid updates (e.g. 100x replay) into one trailing dispatch.
      pendingRef.current = candles;
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (pendingRef.current) dispatch(pendingRef.current);
          pendingRef.current = null;
        }, THROTTLE_MS - since);
      }
    }
  }, [candles, setSnapshot]);
}
