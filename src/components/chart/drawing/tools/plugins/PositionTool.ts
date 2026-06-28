/**
 * PositionTool — TradingView-style Long / Short position (risk-reward) tool.
 *
 * Geometry is points-based so the standard drag engine can move it:
 *   points[0] = { time: leftEdge,  price: entry  }
 *   points[1] = { time: rightEdge, price: target }   ← draggable handle "p1"
 *   points[2] = { time: rightEdge, price: stop   }   ← draggable handle "p2"
 *
 * Defaults are auto-created in `chartStore.addDrawingAtom` on the first click.
 * The green zone is profit (entry→target); the red zone is risk (entry→stop) —
 * direction-agnostic, so the same renderer serves both Long and Short.
 */
import { getDefaultStore } from "jotai";
import type { Drawing, DrawingTool, Point } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import { candlesAtom } from "@/store/chartStore";
import {
  type DrawingAdapter,
  type Anchor,
  registerTool,
  HANDLE_RADIUS,
  TOL,
  pointDist,
} from "../ToolRegistry";
import { line, handle, chip } from "./shared";

const BULL = "#26a69a";
const BEAR = "#ef5350";
const ENTRY = "#b2b5be";

/** Latest traded price from the chart's master candle series, or null. */
function currentPrice(): number | null {
  const candles = getDefaultStore().get(candlesAtom);
  const last = candles[candles.length - 1];
  return last ? last.close : null;
}

function fmtPrice(p: number): string {
  const a = Math.abs(p);
  const dec = a >= 1000 ? 2 : a >= 1 ? 3 : 6;
  return p.toFixed(dec);
}

interface Geo {
  xL: number;
  xR: number;
  yE: number;
  yT: number;
  yS: number;
  entry: number;
  target: number;
  stop: number;
}

function geometry(d: Drawing, proj: Projector): Geo | null {
  const p0 = d.points[0];
  if (!p0) return null;
  const entry = p0.price;
  const target = d.points[1]?.price ?? d.target ?? entry;
  const stop = d.points[2]?.price ?? d.stop ?? entry;
  const xL = proj.toX(p0.time);
  if (xL == null) return null;
  const xR = d.points[1] ? proj.toX(d.points[1].time) : xL + 130;
  const yE = proj.toY(entry);
  const yT = proj.toY(target);
  const yS = proj.toY(stop);
  if (xR == null || yE == null || yT == null || yS == null) return null;
  return { xL, xR, yE, yT, yS, entry, target, stop };
}

function render(
  g: CanvasRenderingContext2D,
  d: Drawing,
  proj: Projector,
  selected: boolean,
) {
  const geo = geometry(d, proj);
  if (!geo) return;
  const { xL, xR, yE, yT, yS, entry, target, stop } = geo;
  const left = Math.min(xL, xR);
  const w = Math.abs(xR - xL);

  // Has price reached the target / stop? (direction-agnostic — works for both
  // Long and Short.) When it has, TradingView brightens that zone so the trader
  // sees the outcome of the position at a glance.
  const price = currentPrice();
  const reachedTarget =
    price != null && (target >= entry ? price >= target : price <= target);
  const reachedStop =
    price != null && (stop <= entry ? price <= stop : price >= stop);
  const baseAlpha = d.opacity ?? 0.15;
  const hitAlpha = Math.max(0.4, baseAlpha + 0.3);

  // --- Zones ---
  g.save();
  g.globalAlpha = reachedTarget ? hitAlpha : baseAlpha;
  g.fillStyle = BULL;
  g.fillRect(left, Math.min(yE, yT), w, Math.abs(yT - yE));
  g.globalAlpha = reachedStop ? hitAlpha : baseAlpha;
  g.fillStyle = BEAR;
  g.fillRect(left, Math.min(yE, yS), w, Math.abs(yS - yE));
  g.restore();

  // Glow outline + badge on whichever zone has been hit.
  if (reachedTarget || reachedStop) {
    g.save();
    g.setLineDash([]);
    g.lineWidth = 2;
    if (reachedTarget) {
      g.strokeStyle = BULL;
      g.strokeRect(left, Math.min(yE, yT), w, Math.abs(yT - yE));
    }
    if (reachedStop) {
      g.strokeStyle = BEAR;
      g.strokeRect(left, Math.min(yE, yS), w, Math.abs(yS - yE));
    }
    g.restore();
  }

  // --- Lines ---
  g.save();
  g.lineWidth = d.lineWidth || 1.5;
  g.strokeStyle = ENTRY;
  g.setLineDash([]);
  line(g, xL, yE, xR, yE);
  g.setLineDash([5, 3]);
  g.strokeStyle = BULL;
  line(g, xL, yT, xR, yT);
  g.strokeStyle = BEAR;
  line(g, xL, yS, xR, yS);
  g.restore();

  // --- Labels ---
  if (d.showLabels !== false) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const rr = risk > 0 ? reward / risk : 0;
    const tPct = entry ? ((target - entry) / entry) * 100 : 0;
    const sPct = entry ? ((stop - entry) / entry) * 100 : 0;
    const midX = left + w / 2;

    // Money amounts when account/risk are configured.
    let qtyTxt = "";
    let profitTxt = "";
    let riskTxt = "";
    if (d.accountSize != null && d.riskValue != null) {
      const riskAmount =
        (d.riskUnit ?? "%") === "%"
          ? d.accountSize * (d.riskValue / 100)
          : d.riskValue;
      const qty = risk > 0 ? (riskAmount / risk) * (d.lotSize ?? 1) : 0;
      const profitAmount = qty * reward;
      const cur = d.accountCurrency ?? "USD";
      const prec = d.qtyPrecision ?? 2;
      qtyTxt = `  Qty ${qty.toFixed(prec)}`;
      profitTxt = `  +${profitAmount.toFixed(2)} ${cur}`;
      riskTxt = `  -${riskAmount.toFixed(2)} ${cur}`;
    }

    chip(g, `Entry ${fmtPrice(entry)}${qtyTxt}`, xL, yE - 9, ENTRY);
    chip(
      g,
      `Target ${fmtPrice(target)}  ${tPct >= 0 ? "+" : ""}${tPct.toFixed(2)}%${profitTxt}${reachedTarget ? "  ✓ HIT" : ""}`,
      midX - 60,
      (yE + yT) / 2 - 9,
      BULL,
    );
    chip(
      g,
      `Stop ${fmtPrice(stop)}  ${sPct >= 0 ? "+" : ""}${sPct.toFixed(2)}%${riskTxt}${reachedStop ? "  ✕ HIT" : ""}`,
      midX - 60,
      (yE + yS) / 2 - 9,
      BEAR,
    );
    chip(g, `R/R ${rr.toFixed(2)}`, xR + 6, yE - 9, ENTRY);
  }

  // --- Handles ---
  if (selected) {
    handle(g, xL, yE, ENTRY);
    handle(g, xR, yT, BULL);
    handle(g, xR, yS, BEAR);
  }
}

function hitTest(
  d: Drawing,
  px: number,
  py: number,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult[] {
  const geo = geometry(d, { toX, toY, width: 0, height: 0 } as Projector);
  if (!geo) return [];
  const { xL, xR, yE, yT, yS } = geo;
  const results: HitResult[] = [];

  const dT = pointDist(px, py, xR, yT);
  const dS = pointDist(px, py, xR, yS);
  if (dT <= HANDLE_RADIUS)
    results.push({ drawing: d, target: "p1", distance: dT });
  if (dS <= HANDLE_RADIUS)
    results.push({ drawing: d, target: "p2", distance: dS });

  // Body: inside the box, or on the entry line.
  const left = Math.min(xL, xR);
  const right = Math.max(xL, xR);
  const top = Math.min(yT, yS, yE);
  const bottom = Math.max(yT, yS, yE);
  if (px >= left - TOL && px <= right + TOL && py >= top && py <= bottom) {
    results.push({
      drawing: d,
      target: "body",
      distance: Math.max(2, Math.abs(py - yE)),
    });
  }
  return results;
}

function getAnchors(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Anchor[] {
  const geo = geometry(d, { toX, toY, width: 0, height: 0 } as Projector);
  if (!geo) return [];
  return [
    { index: 1, x: geo.xR, y: geo.yT, target: "p1" },
    { index: 2, x: geo.xR, y: geo.yS, target: "p2" },
  ];
}

/** Drag a single handle. p1 = target, p2 = stop; both also set the right edge. */
function moveAnchor(origPoints: Point[], index: number, pointer: Point): Point[] {
  const next = origPoints.map((pt) => ({ ...pt }));
  if (index === 1) {
    next[1] = { time: pointer.time, price: pointer.price };
    if (next[2]) next[2] = { ...next[2], time: pointer.time };
  } else if (index === 2) {
    next[2] = { time: pointer.time, price: pointer.price };
    if (next[1]) next[1] = { ...next[1], time: pointer.time };
  } else if (next[index]) {
    next[index] = { time: pointer.time, price: pointer.price };
  }
  return next;
}

/** Move the whole box (translate all points). */
function move(origPoints: Point[], pointer: Point, dragStart: Point): Point[] {
  const dt = pointer.time - dragStart.time;
  const dp = pointer.price - dragStart.price;
  return origPoints.map((pt) => ({ time: pt.time + dt, price: pt.price + dp }));
}

function boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
  const geo = geometry(d, { toX, toY, width: 0, height: 0 } as Projector);
  if (!geo) return null;
  const { xL, xR, yE, yT, yS } = geo;
  const left = Math.min(xL, xR);
  const top = Math.min(yE, yT, yS);
  return {
    x: left,
    y: top - 18,
    w: Math.abs(xR - xL),
    h: Math.max(yE, yT, yS) - top + 36,
  };
}

function makeAdapter(tool: DrawingTool): DrawingAdapter {
  return {
    tool,
    minPoints: 1,
    render,
    hitTest,
    // movePoints kept for SimpleTool compat; the engine uses move/moveAnchor.
    movePoints: (orig, pointer, _t, dragStart) => move(orig, pointer, dragStart),
    move,
    moveAnchor,
    getAnchors,
    boundingBox,
  };
}

registerTool(makeAdapter("long"));
registerTool(makeAdapter("short"));
