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
import { line, handle, chip, canvasFont } from "./shared";

/**
 * TradingView Position Tool colour palette.
 *
 * Fill colours are pre-mixed dark tones — TradingView does NOT use alpha
 * blending over bright green/red. This avoids stacking alpha every frame
 * and produces the correct subtle tint on both dark and light charts.
 */
export const POSITION_COLORS = {
  /** Profit zone fill — dark teal-green, no alpha needed. */
  PROFIT_FILL: "#0E2B26",
  /** Loss zone fill — dark red, no alpha needed. */
  LOSS_FILL: "#3C171A",
  /** Entry line — crisp 1 px TradingView teal. */
  ENTRY_LINE: "#089981",
  /** Take-profit dashed line — matches entry / long label. */
  TP_LINE: "#089981",
  /** Stop-loss dashed line — TradingView short red. */
  SL_LINE: "#F23645",
  /** Label used for long-side labels (profit side). */
  LONG_LABEL: "#089981",
  /** Label used for short-side labels (loss side). */
  SHORT_LABEL: "#F23645",
} as const;

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
  if (xR == null) return null;
  const yE = proj.toY(entry);
  const yT = proj.toY(target);
  const yS = proj.toY(stop);
  if (yE == null || yT == null || yS == null) return null;
  return { xL, xR, yE, yT, yS, entry, target, stop };
}

/** Scan candles after entry for the first bar that reached target or stop. */
function findHitCandle(d: Drawing, geo: Geo) {
  const candles = getDefaultStore().get(candlesAtom);
  if (candles.length === 0) return null;
  const isLong = d.tool === "long";
  const entryTime = d.points[0]?.time ?? 0;
  for (const c of candles) {
    if (c.time <= entryTime) continue;
    if (isLong) {
      if (c.high >= geo.target)
        return { status: "tp_hit" as const, time: c.time, price: geo.target };
      if (c.low <= geo.stop)
        return { status: "sl_hit" as const, time: c.time, price: geo.stop };
    } else {
      if (c.low <= geo.target)
        return { status: "tp_hit" as const, time: c.time, price: geo.target };
      if (c.high >= geo.stop)
        return { status: "sl_hit" as const, time: c.time, price: geo.stop };
    }
  }
  return null;
}

function render(
  g: CanvasRenderingContext2D,
  d: Drawing,
  proj: Projector,
  selected: boolean,
) {
  const geo = geometry(d, proj);
  if (!geo) return;

  // Save the original (unfrozen) right edge for handle rendering.
  // Handles must match getAnchors() positions which use geometry() independently.
  const origXR = geo.xR;

  // ── Hit detection & frozen right edge ──
  // If the drawing already has a persisted tradeStatus, use it to freeze the
  // right edge (survives pan/zoom).  Otherwise scan candles for a first hit.
  // hitTime is stored as an OFFSET from entry, so the freeze follows the
  // position when the user drags the drawing.
  let hit: {
    status: "tp_hit" | "sl_hit";
    candleTime: number;
    candlePrice: number;
  } | null = null;
  // While the user is actively dragging this position, never apply the TP/SL
  // hit-freeze: it extends the right edge to the hit candle, which makes the box
  // appear to suddenly grow / get pinned at the SL bar mid-drag. The freeze is
  // (re-)evaluated normally once the drag is committed and `_dragging` is gone.
  if (d._dragging) {
    hit = null;
  } else if (d.tradeStatus === "tp_hit" || d.tradeStatus === "sl_hit") {
    hit = {
      status: d.tradeStatus,
      candleTime: d.hitTime ?? 0,
      candlePrice: d.hitPrice ?? 0,
    };
    const frozenTime = d.points[0].time + hit.candleTime;
    const frozenX = proj.toX(frozenTime);
    // Only extend the right edge to the hit candle — never shrink.
    // TradingView preserves the user's intended width; freeze is a cap, not a crop.
    if (frozenX != null && frozenX > geo.xR) geo.xR = frozenX;
  } else if (d.hitTime == null) {
    // Only fresh-detect if never hit before.  When tradeStatus was cleared
    // by a drag but hitTime is still present, skip detection — the
    // subscription will re-detect if appropriate.
    const fresh = findHitCandle(d, geo);
    if (fresh) {
      const offset = fresh.time - d.points[0].time;
      hit = {
        status: fresh.status,
        candleTime: offset,
        candlePrice: fresh.price,
      };
      const frozenTime = d.points[0].time + offset;
      const frozenX = proj.toX(frozenTime);
      // Only extend — never shrink (same as persisted path above).
      if (frozenX != null && frozenX > geo.xR) geo.xR = frozenX;
      // The persistent update is handled by the candle subscription in
      // DrawingLayer — we only freeze the geometry here for rendering.
    }
  }

  const { xL, xR, yE, yT, yS, entry, target, stop } = geo;
  const left = Math.min(xL, xR);
  const w = Math.abs(xR - xL);

  // ── Anti-alias: snap fill geometry to integer pixels ──
  // TradingView renders crisp rectangles; floating-point fills produce
  // blurry semi-transparent edges on most browsers.
  const snapLeft = Math.round(left);
  const snapW = Math.round(w);
  const profitTop = Math.round(Math.min(yE, yT));
  const profitH = Math.round(Math.abs(yT - yE));
  const lossTop = Math.round(Math.min(yE, yS));
  const lossH = Math.round(Math.abs(yS - yE));

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
  const loseAlpha = baseAlpha * 0.4; // dim losing zone ~40 % of normal
  const isTpHit = hit?.status === "tp_hit";
  const isSlHit = hit?.status === "sl_hit";

  // ── Zones (fill only — no visible stroke) ──
  // TradingView uses pre-mixed dark colours rather than alpha-blending
  // bright green/red over the chart background.  User-adjustable opacity
  // is still respected via globalAlpha.
  g.save();
  g.globalAlpha =
    reachedTarget || isTpHit ? hitAlpha : isSlHit ? loseAlpha : baseAlpha;
  g.fillStyle = POSITION_COLORS.PROFIT_FILL;
  g.fillRect(snapLeft, profitTop, snapW, profitH);
  g.globalAlpha =
    reachedStop || isSlHit ? hitAlpha : isTpHit ? loseAlpha : baseAlpha;
  g.fillStyle = POSITION_COLORS.LOSS_FILL;
  g.fillRect(snapLeft, lossTop, snapW, lossH);
  g.restore();

  // ── Lines ──
  // TradingView entry line: crisp 1 px (default), user-adjustable via
  // lineWidth.  For odd-integer widths (1, 3, 5...) offset by 0.5 so the
  // stroke sits on whole-pixel centres instead of straddling two pixels.
  const lw = d.lineWidth || 1;
  const crispOffset = lw % 2 === 1 ? 0.5 : 0;
  g.save();
  g.lineWidth = lw;
  g.strokeStyle = POSITION_COLORS.ENTRY_LINE;
  g.setLineDash([]);
  const lineYE = Math.round(yE) + crispOffset;
  line(g, snapLeft, lineYE, snapLeft + snapW, lineYE);
  // TP / SL dashed lines
  g.lineWidth = lw;
  g.setLineDash([5, 3]);
  g.strokeStyle = POSITION_COLORS.TP_LINE;
  const lineYT = Math.round(yT) + crispOffset;
  line(g, snapLeft, lineYT, snapLeft + snapW, lineYT);
  g.strokeStyle = POSITION_COLORS.SL_LINE;
  const lineYS = Math.round(yS) + crispOffset;
  line(g, snapLeft, lineYS, snapLeft + snapW, lineYS);
  g.restore();

  // --- Labels ---
  // TradingView layout: Entry label left-aligned, TP/SL labels right-aligned
  // at the right edge of the box, R/R label at the right near entry.
  // We pre-measure every label so x-offsets are exact — no magic constants.
  if (d.showLabels !== false) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const rr = risk > 0 ? reward / risk : 0;
    const tPct = entry ? ((target - entry) / entry) * 100 : 0;
    const sPct = entry ? ((stop - entry) / entry) * 100 : 0;

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

    // Build label strings first so we can measure their pixel width.
    const entryLabel = `Entry ${fmtPrice(entry)}${qtyTxt}`;
    const targetLabel = `Target ${fmtPrice(target)}  ${tPct >= 0 ? "+" : ""}${tPct.toFixed(2)}%${profitTxt}${reachedTarget || isTpHit ? "  \u2713 HIT" : ""}`;
    const stopLabel = `Stop ${fmtPrice(stop)}  ${sPct >= 0 ? "+" : ""}${sPct.toFixed(2)}%${riskTxt}${reachedStop || isSlHit ? "  \u2715 HIT" : ""}`;
    const rrLabel = `R/R ${rr.toFixed(2)}`;

    // Pre-measure for right-alignment (target, stop, RR at the right edge).
    g.save();
    g.font = canvasFont(11);
    const targetW = g.measureText(targetLabel).width + 10; // 10 = chip padding
    const stopW = g.measureText(stopLabel).width + 10;
    const rrW = g.measureText(rrLabel).width + 10;
    g.restore();

    const rightEdge = snapLeft + snapW;

    // Entry: left edge, above the entry line (TradingView left-align).
    chip(g, entryLabel, xL, yE - 9, POSITION_COLORS.ENTRY_LINE, 0.92);
    // Target: right edge, vertically centred in the profit zone.
    chip(
      g,
      targetLabel,
      rightEdge - targetW,
      (yE + yT) / 2 - 9,
      POSITION_COLORS.LONG_LABEL,
      0.92,
    );
    // Stop: right edge, vertically centred in the loss zone.
    chip(
      g,
      stopLabel,
      rightEdge - stopW,
      (yE + yS) / 2 - 9,
      POSITION_COLORS.SHORT_LABEL,
      0.92,
    );
    // R/R: right edge, same vertical level as the entry line.
    chip(g, rrLabel, rightEdge - rrW, yE - 9, POSITION_COLORS.ENTRY_LINE, 0.92);
  }

  // --- Hit overlay (dashed trajectory) ---
  // TradingView draws a dashed diagonal from the entry right edge to the
  // TP/SL price at the hit candle.  Pixel-align for crisp rendering.
  if (hit) {
    const hitColor =
      hit.status === "tp_hit"
        ? POSITION_COLORS.TP_LINE
        : POSITION_COLORS.SL_LINE;
    const frozenTime = d.points[0].time + hit.candleTime;
    const hitX = proj.toX(frozenTime) ?? xR;
    const hitY = hit.status === "tp_hit" ? yT : yS;

    g.save();
    g.strokeStyle = hitColor;
    g.lineWidth = 1;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(Math.round(xR), Math.round(yE) + 0.5);
    g.lineTo(Math.round(hitX), Math.round(hitY) + 0.5);
    g.stroke();
    g.restore();
  }

  // --- Handles (selected state only) ---
  // Use origXR so handle positions match getAnchors() / hit-test.  The frozen
  // xR is only for zones, lines, labels and the hit overlay.  Handles must
  // stay at the editable position so interaction remains independent.
  if (selected) {
    // Selection outline: dashed rectangle around the entire position.
    // TradingView shows this in addition to the anchor handles.
    const selTop = Math.min(yE, yT, yS);
    const selBot = Math.max(yE, yT, yS);
    g.save();
    g.strokeStyle = "#9598a1";
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.strokeRect(
      Math.round(left) - 4,
      Math.round(selTop) - 4,
      Math.round(w) + 8,
      Math.round(selBot - selTop) + 8,
    );
    g.restore();

    handle(g, xL, yE, POSITION_COLORS.ENTRY_LINE);
    handle(g, origXR, yT, POSITION_COLORS.LONG_LABEL);
    handle(g, origXR, yS, POSITION_COLORS.SHORT_LABEL);
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

  const dE = pointDist(px, py, xL, yE);
  const dT = pointDist(px, py, xR, yT);
  const dS = pointDist(px, py, xR, yS);
  if (dE <= HANDLE_RADIUS)
    results.push({ drawing: d, target: "p0", distance: dE });
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
    { index: 0, x: geo.xL, y: geo.yE, target: "p0" },
    { index: 1, x: geo.xR, y: geo.yT, target: "p1" },
    { index: 2, x: geo.xR, y: geo.yS, target: "p2" },
  ];
}

/** Drag a single handle. p1 = target, p2 = stop; both also set the right edge. */
function moveAnchor(
  origPoints: Point[],
  index: number,
  pointer: Point,
): Point[] {
  const next = origPoints.map((pt) => ({ ...pt }));
  // Clamp non-finite values that can appear during extreme drags.
  const safeTime = Number.isFinite(pointer.time)
    ? pointer.time
    : (origPoints[0]?.time ?? 0);
  const safePrice = Number.isFinite(pointer.price)
    ? pointer.price
    : (origPoints[0]?.price ?? 0);
  if (index === 0) {
    // Entry handle: adjust the entry price only; the left-edge time stays put
    // so the box keeps its width (TradingView drags the entry line vertically).
    next[0] = { ...next[0], price: safePrice };
  } else if (index === 1) {
    next[1] = { time: safeTime, price: safePrice };
    if (next[2]) next[2] = { ...next[2], time: safeTime };
  } else if (index === 2) {
    next[2] = { time: safeTime, price: safePrice };
    if (next[1]) next[1] = { ...next[1], time: safeTime };
  } else if (next[index]) {
    next[index] = { time: safeTime, price: safePrice };
  }
  return next;
}

/** Move the whole box (translate all points). */
function move(origPoints: Point[], pointer: Point, dragStart: Point): Point[] {
  let dt = pointer.time - dragStart.time;
  let dp = pointer.price - dragStart.price;
  if (!Number.isFinite(dt)) dt = 0;
  if (!Number.isFinite(dp)) dp = 0;
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
    movePoints: (orig, pointer, _t, dragStart) =>
      move(orig, pointer, dragStart),
    move,
    moveAnchor,
    getAnchors,
    boundingBox,
  };
}

registerTool(makeAdapter("long"));
registerTool(makeAdapter("short"));
