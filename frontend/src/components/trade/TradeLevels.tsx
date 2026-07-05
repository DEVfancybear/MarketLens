"use client";
import { useEffect, useRef } from "react";
import type { IPriceLine } from "lightweight-charts";
import { useChartCtx } from "@/components/chart/ChartContext";
import { positionsAtom } from "@/store/tradeStore";
import { executionModeAtom, mt5PositionsAtom } from "@/store/mt5Store";
import { useAtomValue } from "jotai";
import { symbolAtom } from "@/store/chartStore";

/**
 * Draws entry / stop / target price lines on the candle series for live
 * positions in the current symbol. Pure chart side-effect; renders nothing.
 */
export function TradeLevels() {
  const ctx = useChartCtx();
  const positions = useAtomValue(positionsAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const symbol = useAtomValue(symbolAtom);
  const linesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!ctx) return;
    const series = ctx.candleSeries;
    // Clear previous lines.
    linesRef.current.forEach((l) => series.removePriceLine(l));
    linesRef.current = [];

    if (executionMode === "mt5") {
      const liveMt5 = mt5Positions.filter((p) => p.symbol === symbol);
      for (const p of liveMt5) {
        const tag = p.side === "long" ? "L" : "S";
        linesRef.current.push(
          series.createPriceLine({
            price: p.openPrice,
            color: "#2962ff",
            lineWidth: 1,
            lineStyle: 0,
            axisLabelVisible: true,
            title: `MT5 ${tag} entry`,
          }),
        );
        if (p.sl) {
          linesRef.current.push(
            series.createPriceLine({
              price: p.sl,
              color: "#ef5350",
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: "MT5 SL",
            }),
          );
        }
        if (p.tp) {
          linesRef.current.push(
            series.createPriceLine({
              price: p.tp,
              color: "#26a69a",
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: "MT5 TP",
            }),
          );
        }
      }
      return () => {
        linesRef.current.forEach((l) => series.removePriceLine(l));
        linesRef.current = [];
      };
    }

    const live = positions.filter(
      (p) =>
        (p.status === "open" || p.status === "pending") && p.symbol === symbol,
    );

    for (const p of live) {
      const tag = p.side === "long" ? "L" : "S";
      linesRef.current.push(
        series.createPriceLine({
          price: p.entry,
          color: p.status === "pending" ? "#868993" : "#2962ff",
          lineWidth: 1,
          lineStyle: p.status === "pending" ? 2 : 0,
          axisLabelVisible: true,
          title: `${tag} entry`,
        }),
      );
      if (p.stopLoss) {
        linesRef.current.push(
          series.createPriceLine({
            price: p.stopLoss,
            color: "#ef5350",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: "SL",
          }),
        );
      }
      if (p.takeProfit) {
        linesRef.current.push(
          series.createPriceLine({
            price: p.takeProfit,
            color: "#26a69a",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: "TP",
          }),
        );
      }
    }

    return () => {
      linesRef.current.forEach((l) => series.removePriceLine(l));
      linesRef.current = [];
    };
  }, [ctx, executionMode, mt5Positions, positions, symbol]);

  return null;
}
