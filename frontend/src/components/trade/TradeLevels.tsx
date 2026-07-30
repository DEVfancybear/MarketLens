"use client";
import { useEffect, useRef } from "react";
import {
  createSeriesMarkers,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { useChartCtx } from "@/components/chart/ChartContext";
import { positionsAtom } from "@/store/tradeStore";
import {
  executionModeAtom,
  mt5PendingOrdersAtom,
  mt5PositionsAtom,
} from "@/store/mt5Store";
import { useAtomValue } from "jotai";
import { symbolAtom } from "@/store/chartStore";
import { useReplayTrading } from "@/store/replayTradingClientStore";

/**
 * Draws entry / stop / target price lines on the candle series for live
 * positions in the current symbol. Pure chart side-effect; renders nothing.
 */
export function TradeLevels() {
  const ctx = useChartCtx();
  const positions = useAtomValue(positionsAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);
  const mt5PendingOrders = useAtomValue(mt5PendingOrdersAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const symbol = useAtomValue(symbolAtom);
  const replayTrading = useReplayTrading();
  const linesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const candleSeries = ctx?.candleSeries;

  useEffect(() => {
    if (!candleSeries) return;
    const markers = createSeriesMarkers(candleSeries, []);
    markersRef.current = markers;
    return () => {
      markers.detach();
      if (markersRef.current === markers) markersRef.current = null;
    };
  }, [candleSeries]);

  useEffect(() => {
    if (!candleSeries) return;
    const series = candleSeries;
    const seriesMarkers = markersRef.current;
    if (!seriesMarkers) return;
    // Clear previous lines.
    linesRef.current.forEach((l) => series.removePriceLine(l));
    linesRef.current = [];
    seriesMarkers.setMarkers([]);

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
            title: `LIVE #${p.ticket} ${tag} entry`,
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
              title: `LIVE #${p.ticket} SL`,
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
              title: `LIVE #${p.ticket} TP`,
            }),
          );
        }
      }
      for (const order of mt5PendingOrders.filter(
        (candidate) => candidate.symbol === symbol,
      )) {
        const tag = order.side === "buy" ? "L" : "S";
        linesRef.current.push(
          series.createPriceLine({
            price: order.price,
            color: "#868993",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `PENDING #${order.ticket} ${tag} entry`,
          }),
        );
        if (order.sl) {
          linesRef.current.push(
            series.createPriceLine({
              price: order.sl,
              color: "#ef5350",
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: `PENDING #${order.ticket} SL`,
            }),
          );
        }
        if (order.tp) {
          linesRef.current.push(
            series.createPriceLine({
              price: order.tp,
              color: "#26a69a",
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: `PENDING #${order.ticket} TP`,
            }),
          );
        }
      }
      return () => {
        linesRef.current.forEach((l) => series.removePriceLine(l));
        linesRef.current = [];
      };
    }

    if (replayTrading.active) {
      const orders = new Map(replayTrading.orders.map((order) => [order.id, order]));
      const markers: SeriesMarker<Time>[] = replayTrading.fills.map((fill) => {
        const order = orders.get(fill.orderId);
        const buy = order?.side === "buy";
        return {
          time: Math.floor(Date.parse(fill.simulatedAt) / 1000) as Time,
          position: buy ? "belowBar" : "aboveBar",
          color: buy ? "#089981" : "#f23645",
          shape: buy ? "arrowUp" : "arrowDown",
          text: `${buy ? "B" : "S"} ${fill.quantity.toFixed(2)} @ ${fill.price}`,
        };
      });
      seriesMarkers.setMarkers(markers);
      for (const position of replayTrading.positions.filter((item) =>
        item.symbol === symbol && Math.abs(item.netQuantity) > 1e-12
      )) {
        const tag = position.netQuantity > 0 ? "L" : "S";
        linesRef.current.push(series.createPriceLine({
          price: position.averagePrice, color: "#2962ff", lineWidth: 1,
          lineStyle: 0, axisLabelVisible: true, title: `Replay ${tag} entry`,
        }));
        if (position.stopLoss) linesRef.current.push(series.createPriceLine({
          price: position.stopLoss, color: "#ef5350", lineWidth: 1,
          lineStyle: 2, axisLabelVisible: true, title: "Replay SL",
        }));
        if (position.takeProfit) linesRef.current.push(series.createPriceLine({
          price: position.takeProfit, color: "#26a69a", lineWidth: 1,
          lineStyle: 2, axisLabelVisible: true, title: "Replay TP",
        }));
      }
      return () => {
        linesRef.current.forEach((line) => series.removePriceLine(line));
        linesRef.current = [];
        seriesMarkers.setMarkers([]);
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
  }, [candleSeries, executionMode, mt5PendingOrders, mt5Positions, positions, replayTrading.active, replayTrading.fills, replayTrading.orders, replayTrading.positions, symbol]);

  return null;
}
