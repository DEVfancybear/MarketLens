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

const THROTTLE_MS = 90;

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

  // Spin up the worker once.
  useEffect(() => {
    try {
      const worker = new Worker(
        new URL("../workers/smc.worker.ts", import.meta.url),
      );
      worker.onmessage = (
        e: MessageEvent<{ reqId: number; snapshot?: SmcSnapshot; computeMs?: number }>,
      ) => {
        const sentAt = sentAtRef.current.get(e.data.reqId);
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
          sentAtRef.current.delete(e.data.reqId);
        }
        if (e.data.computeMs != null) {
          recordChartPerformanceDuration("smc.worker.compute", e.data.computeMs, {
            reqId: e.data.reqId,
          });
        }
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
      const workerData = selectSmcInputWindow(data);
      incrementChartPerformanceCounter(
        "smc.worker.post.candlesAvoided",
        data.length - workerData.length,
      );
      const worker = workerRef.current;
      const reqId = ++reqRef.current;
      if (worker) {
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
