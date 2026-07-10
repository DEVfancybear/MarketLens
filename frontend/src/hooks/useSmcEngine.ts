"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useChartSeries } from "@/hooks/useChartSeries";
import { setSmcSnapshotAtom } from "@/store/smcStore";
import { useSetAtom } from "jotai";
import { computeSmc } from "@/services/smc/smcEngine";
import { selectSmcInputWindow } from "@/services/smc/smcInputWindow";
import type { SmcSnapshot } from "@/types";
import {
  beginChartPerformanceMeasure,
  incrementChartPerformanceCounter,
  recordChartPerformanceDuration,
} from "@/services/chartPerformanceProbe";
import {
  getActiveChartBenchmarkCandles,
  subscribeActiveChartBenchmarkCandles,
} from "@/services/chartBenchmarkFixtures";

const THROTTLE_MS = 200;

/**
 * Recomputes the SMC snapshot from the visible candles whenever they change,
 * off-loading to a Web Worker when available and throttling so fast replay
 * doesn't flood the pipeline. Falls back to synchronous compute if the worker
 * can't be created (e.g. older browsers / SSR hydration edge cases).
 */
export function useSmcEngine() {
  const chartCandles = useChartSeries();
  const benchmarkCandles = useSyncExternalStore(
    subscribeActiveChartBenchmarkCandles,
    getActiveChartBenchmarkCandles,
    () => null,
  );
  const candles = benchmarkCandles ?? chartCandles;
  const setSnapshot = useSetAtom(setSmcSnapshotAtom);

  const workerRef = useRef<Worker | null>(null);
  const reqRef = useRef(0);
  const lastSentRef = useRef(0);
  const pendingRef = useRef<typeof candles | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentAtRef = useRef<Map<number, number>>(new Map());
  const workerInFlightRef = useRef(false);
  const dispatchRef = useRef<((data: typeof candles) => void) | null>(null);

  // Spin up the worker once.
  useEffect(() => {
    const sentAtStore = sentAtRef.current;
    try {
      const worker = new Worker(
        new URL("../workers/smc.worker.ts", import.meta.url),
      );
      worker.onmessage = (
        e: MessageEvent<{ reqId: number; snapshot?: SmcSnapshot; computeMs?: number }>,
      ) => {
        workerInFlightRef.current = false;
        const sentAt = sentAtStore.get(e.data.reqId);
        if (sentAt != null) {
          const roundTripMs = performance.now() - sentAt;
          recordChartPerformanceDuration("smc.worker.round-trip", roundTripMs, {
            reqId: e.data.reqId,
          });
          if (e.data.computeMs != null) {
            recordChartPerformanceDuration(
              "smc.worker.transfer-and-queue",
              Math.max(0, roundTripMs - e.data.computeMs),
              { reqId: e.data.reqId },
            );
          }
          sentAtStore.delete(e.data.reqId);
        }
        if (e.data.computeMs != null) {
          recordChartPerformanceDuration("smc.worker.compute", e.data.computeMs, {
            reqId: e.data.reqId,
          });
        }
        // Only accept the latest in-flight request.
        if (
          e.data.snapshot &&
          e.data.reqId === reqRef.current &&
          pendingRef.current == null
        ) {
          setSnapshot(e.data.snapshot);
        }
        const pending = pendingRef.current;
        if (pending) {
          if (timerRef.current) clearTimeout(timerRef.current);
          const delay = Math.max(0, THROTTLE_MS - (Date.now() - lastSentRef.current));
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            const latest = pendingRef.current ?? pending;
            pendingRef.current = null;
            dispatchRef.current?.(latest);
          }, delay);
        }
      };
      workerRef.current = worker;
    } catch {
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      workerInFlightRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = null;
      sentAtStore.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dispatch = (data: typeof candles) => {
      const worker = workerRef.current;
      if (worker && workerInFlightRef.current) {
        pendingRef.current = data;
        incrementChartPerformanceCounter("smc.worker.post.coalesced");
        return;
      }
      const workerData = selectSmcInputWindow(data);
      incrementChartPerformanceCounter(
        "smc.worker.post.candlesAvoided",
        data.length - workerData.length,
      );
      if (worker) {
        const reqId = ++reqRef.current;
        workerInFlightRef.current = true;
        sentAtRef.current.set(reqId, performance.now());
        incrementChartPerformanceCounter("smc.worker.post.calls");
        incrementChartPerformanceCounter("smc.worker.post.candles", workerData.length);
        // Approximation for seven numeric Candle fields; actual structured-clone
        // overhead is browser-specific and can be inspected in the trace.
        incrementChartPerformanceCounter(
          "smc.worker.post.estimatedBytes",
          workerData.length * 56,
        );
        worker.postMessage({ reqId, candles: workerData });
      } else {
        // Synchronous fallback.
        const endMeasure = beginChartPerformanceMeasure("smc.main.compute", {
          candles: workerData.length,
        });
        try {
          setSnapshot(computeSmc(workerData));
        } finally {
          endMeasure();
        }
      }
      lastSentRef.current = Date.now();
    };
    dispatchRef.current = dispatch;

    const now = Date.now();
    const since = now - lastSentRef.current;
    if (since >= THROTTLE_MS) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = null;
      dispatch(candles);
    } else {
      // Coalesce rapid updates (e.g. 100x replay) into one trailing dispatch.
      pendingRef.current = candles;
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          const latest = pendingRef.current;
          pendingRef.current = null;
          if (latest) dispatch(latest);
        }, THROTTLE_MS - since);
      }
    }
  }, [candles, setSnapshot]);
}
