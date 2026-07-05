import type { Drawing, OrderPrefill, OrderType, Side } from "@/types";
import {
  calculatePositionVolumeFromRisk,
  positionRiskAmount,
  type PositionLotSymbolInfo,
} from "../../../../services/positionLotSizing";

export function inferPositionOrderType(
  side: Side,
  entryPrice: number,
  marketPrice: number | null | undefined,
): OrderType {
  if (!Number.isFinite(marketPrice)) return "limit";
  if (side === "long") return entryPrice > Number(marketPrice) ? "stop" : "limit";
  return entryPrice < Number(marketPrice) ? "stop" : "limit";
}

export function buildOrderPrefillFromPositionDrawing(
  drawing: Drawing,
  marketPrice: number | null | undefined,
  context: { symbolInfo?: PositionLotSymbolInfo } = {},
): OrderPrefill | null {
  if (drawing.tool !== "long" && drawing.tool !== "short") return null;
  const entry = drawing.points[0]?.price;
  const target = drawing.points[1]?.price ?? drawing.target;
  const stop = drawing.points[2]?.price ?? drawing.stop;
  if (!Number.isFinite(entry)) return null;

  const side: Side = drawing.tool === "long" ? "long" : "short";
  const prefill: OrderPrefill = {
    source: "position-drawing",
    drawingId: drawing.id,
    side,
    type: inferPositionOrderType(side, Number(entry), marketPrice),
    price: Number(entry),
  };

  if (Number.isFinite(stop)) prefill.stopLoss = Number(stop);
  if (Number.isFinite(target)) prefill.takeProfit = Number(target);
  if (drawing.riskUnit === "%" && Number.isFinite(drawing.riskValue)) {
    prefill.riskPct = Number(drawing.riskValue);
  }
  if (context.symbolInfo && Number.isFinite(stop)) {
    const riskAmount = positionRiskAmount(
      drawing.accountSize,
      drawing.riskValue,
      drawing.riskUnit,
    );
    if (riskAmount != null) {
      const volume = calculatePositionVolumeFromRisk({
        entryPrice: Number(entry),
        stopPrice: Number(stop),
        riskAmount,
        symbolInfo: context.symbolInfo,
      });
      if (volume != null) prefill.quantity = volume;
    }
  }
  return prefill;
}
