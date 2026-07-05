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
import { getMarketSymbol } from "@/services/market-data/symbols";
import type { Drawing, DrawingTool, Point } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import { candlesAtom, symbolAtom } from "@/store/chartStore";
import {
  type DrawingAdapter,
  type Anchor,
  registerTool,
  HANDLE_RADIUS,
  TOL,
  pointDist,
} from "../ToolRegistry";
import {
  formatPriceByTick,
  safeTickSize,
  ticksBetween,
} from "../positionMetrics";
import {
  movePosition,
  movePositionAnchor,
  POSITION_ANCHORS,
} from "../positionGeometry";
import { line, chip, canvasFont, applyStyle } from "./shared";

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

/** PriceChart renders volume in the lower 15% overlay. Keep position drawings
 * inside the price pane so far-away SL labels/zones do not cover volume bars. */
const PRICE_PANE_BOTTOM_RATIO = 0.85;
const TV_SELECTION_BLUE = "#2962ff";
const POSITION_HANDLE_SIZE = 7;
const LABEL_HIT_PAD = 20;

/** Latest traded price from the chart's master candle series, or null. */
function currentPrice(): number | null {
  const candles = getDefaultStore().get(candlesAtom);
  const last = candles[candles.length - 1];
  return last ? last.close : null;
}

function activeMarketMeta() {
  const symbol = getDefaultStore().get(symbolAtom);
  return getMarketSymbol(symbol);
}

function activeTickSize(): number {
  return safeTickSize(activeMarketMeta()?.tickSize);
}

function fmtPrice(p: number): string {
  const meta = activeMarketMeta();
  return formatPriceByTick(
    p,
    safeTickSize(meta?.tickSize),
    meta?.pricePrecision ?? 2,
  );
}

function fmtCurrency(amount: number, currency: string): string {
  const suffix = currency === "Default" ? "" : ` ${currency}`;
  const formatted = amount.toFixed(2).replace(/\.?0+$/, "");
  return `${formatted}${suffix}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function positionHandle(g: CanvasRenderingContext2D, x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const half = Math.floor(POSITION_HANDLE_SIZE / 2);
  const left = Math.round(x) - half;
  const top = Math.round(y) - half;
  g.save();
  g.fillStyle = "#111722";
  g.strokeStyle = TV_SELECTION_BLUE;
  g.lineWidth = 1.5;
  g.setLineDash([]);
  g.fillRect(left, top, POSITION_HANDLE_SIZE, POSITION_HANDLE_SIZE);
  g.strokeRect(
    left + 0.5,
    top + 0.5,
    POSITION_HANDLE_SIZE - 1,
    POSITION_HANDLE_SIZE - 1,
  );
  g.restore();
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

function positionAnchorsFromGeo(geo: Geo): Anchor[] {
  return [
    {
      index: POSITION_ANCHORS.TARGET_LEFT,
      x: geo.xL,
      y: geo.yT,
      target: "p0",
    },
    {
      index: POSITION_ANCHORS.ENTRY_LEFT,
      x: geo.xL,
      y: geo.yE,
      target: "p1",
    },
    {
      index: POSITION_ANCHORS.STOP_LEFT,
      x: geo.xL,
      y: geo.yS,
      target: "p2",
    },
    {
      index: POSITION_ANCHORS.TARGET_RIGHT,
      x: geo.xR,
      y: geo.yT,
      target: "p3",
    },
    {
      index: POSITION_ANCHORS.ENTRY_RIGHT,
      x: geo.xR,
      y: geo.yE,
      target: "p4",
    },
    {
      index: POSITION_ANCHORS.STOP_RIGHT,
      x: geo.xR,
      y: geo.yS,
      target: "p5",
    },
  ];
}

/** Minimal candle shape needed for hit detection. */
interface HitCandle {
  time: number;
  high: number;
  low: number;
}

/** Resolved outcome of a position: which level was hit, when, at what price. */
export interface PositionHit {
  status: "tp_hit" | "sl_hit";
  /** Absolute candle time of the hit bar. */
  time: number;
  /** The level price that was hit (target or stop). */
  price: number;
}

function persistedPositionHit(d: Drawing): PositionHit | null {
  if (
    !d.points[0] ||
    (d.tradeStatus !== "tp_hit" && d.tradeStatus !== "sl_hit") ||
    d.hitTime == null
  ) {
    return null;
  }
  const price =
    d.hitPrice ??
    (d.tradeStatus === "tp_hit"
      ? (d.points[1]?.price ?? d.target ?? d.points[0].price)
      : (d.points[2]?.price ?? d.stop ?? d.points[0].price));
  return {
    status: d.tradeStatus,
    time: d.points[0].time + d.hitTime,
    price,
  };
}

export function positionHitDataCoversEntry(
  d: Drawing,
  candles: readonly HitCandle[],
): boolean {
  const entry = d.points[0];
  return !!entry && candles.length > 0 && candles[0].time <= entry.time;
}

export function resolvePositionHit(
  d: Drawing,
  candles: readonly HitCandle[],
): PositionHit | null {
  const persisted = persistedPositionHit(d);
  if (!positionHitDataCoversEntry(d, candles)) return persisted;
  return detectPositionHit(d, candles);
}

/**
 * Determine a position's outcome from the candle series — the single source of
 * truth for TP/SL highlighting.
 *
 * Two phases, matching how a real order behaves:
 *
 *  1. **Fill (pending → running).** The order is not live until price actually
 *     trades through the entry level. We scan forward from the entry time for
 *     the first bar whose range straddles the entry price. Until then the
 *     position is *pending* and CANNOT hit TP/SL — this is why a long limit
 *     placed below market that first spikes up to the target (without ever
 *     retracing to the entry) is NOT a take-profit: it was never filled.
 *       - If the very first bar at/after the entry time already straddles the
 *         entry (entry ≈ market), it's a market fill; we skip TP/SL on that bar
 *         (intra-bar order vs. the entry is unknowable) and start the next bar.
 *       - If the fill happens on a later bar (a true limit fill), the remainder
 *         of that bar is post-entry, so TP/SL is evaluated on it.
 *
 *  2. **TP/SL.** From the fill onward, the first bar to touch either level wins
 *     (chronological). Within one bar the **stop is checked before the target**,
 *     so a bar that pierces both resolves conservatively to a stop hit
 *     (TradingView / standard backtest convention — never assume the optimistic
 *     fill).
 */
export function detectPositionHit(
  d: Drawing,
  candles: readonly HitCandle[],
): PositionHit | null {
  const p0 = d.points[0];
  if (!p0 || candles.length === 0) return null;
  const entry = p0.price;
  const target = d.points[1]?.price ?? d.target ?? entry;
  const stop = d.points[2]?.price ?? d.stop ?? entry;
  const entryTime = p0.time;
  const isLong = d.tool === "long";

  let filled = false;
  let firstBar = true;
  for (const c of candles) {
    if (c.time < entryTime) continue;
    if (!filled) {
      // Has price traded through the entry level yet?
      if (c.low <= entry && entry <= c.high) {
        filled = true;
        if (firstBar) {
          // Market fill on the entry bar — don't judge TP/SL on it.
          firstBar = false;
          continue;
        }
        // Limit fill on a later bar — fall through to evaluate TP/SL here.
      } else {
        firstBar = false;
        continue; // still pending — entry not reached
      }
    }
    if (isLong) {
      if (c.low <= stop) return { status: "sl_hit", time: c.time, price: stop };
      if (c.high >= target)
        return { status: "tp_hit", time: c.time, price: target };
    } else {
      if (c.high >= stop) return { status: "sl_hit", time: c.time, price: stop };
      if (c.low <= target)
        return { status: "tp_hit", time: c.time, price: target };
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

  // Save the original editable right edge for handle rendering.
  // Handles must match getAnchors() positions which use geometry() independently.
  const origXR = geo.xR;

  // Hit detection only; never mutate geometry from a TP/SL hit.
  // Candle data is authoritative only when the loaded history covers the entry
  // time. After a hard refresh the chart can load a later window first; in that
  // case preserve the persisted hit so an earlier SL cannot be overwritten by a
  // later visible TP.
  let hit: {
    status: "tp_hit" | "sl_hit";
    candleTime: number;
    candlePrice: number;
  } | null = null;
  // While the user is actively dragging this position, skip fresh TP/SL detection
  // so the preview cannot flicker or change hit labels mid-drag.
  if (!d._dragging) {
    const candles = getDefaultStore().get(candlesAtom);
    const fresh = resolvePositionHit(d, candles);
    if (fresh) {
      hit = {
        status: fresh.status,
        candleTime: fresh.time - d.points[0].time,
        candlePrice: fresh.price,
      };
    } else if (
      candles.length === 0 &&
      (d.tradeStatus === "tp_hit" || d.tradeStatus === "sl_hit")
    ) {
      // Backward-compatible fallback for old persisted drawings without hitTime.
      hit = {
        status: d.tradeStatus,
        candleTime: d.hitTime ?? 0,
        candlePrice: d.hitPrice ?? 0,
      };
    }
  }

  // TradingView keeps the Long/Short position width user-defined. TP/SL hit
  // state may change label/fill state, but must never resize the drawing.
  geo.xR = origXR;

  const { xL, xR, yE, yT, yS, entry, target, stop } = geo;
  const left = Math.min(xL, xR);
  const w = Math.abs(xR - xL);
  const pricePaneBottom = Math.floor(proj.height * PRICE_PANE_BOTTOM_RATIO) - 2;
  const clipTop = 0;
  const clipBottom = Math.max(clipTop + 1, pricePaneBottom);
  const clampToPricePane = (y: number) => clamp(y, clipTop, clipBottom);
  const clippedBand = (a: number, b: number) => {
    const top = clampToPricePane(Math.min(a, b));
    const bottom = clampToPricePane(Math.max(a, b));
    return { top, h: Math.max(0, bottom - top) };
  };

  // ── Anti-alias: snap fill geometry to integer pixels ──
  // TradingView renders crisp rectangles; floating-point fills produce
  // blurry semi-transparent edges on most browsers.
  const snapLeft = Math.round(left);
  const snapW = Math.round(w);
  const profitBand = clippedBand(yE, yT);
  const lossBand = clippedBand(yE, yS);
  const profitTop = Math.round(profitBand.top);
  const profitH = Math.round(profitBand.h);
  const lossTop = Math.round(lossBand.top);
  const lossH = Math.round(lossBand.h);

  // ── Colours (user-overridable via the Style tab) ──
  // A custom Target/Stop colour drives BOTH that side's line and zone fill;
  // when unset we keep TradingView's pre-mixed defaults (bright line + dark fill)
  // so the look is unchanged out of the box.
  const entryCol = d.color || POSITION_COLORS.ENTRY_LINE;
  const tpLine = d.targetColor || POSITION_COLORS.TP_LINE;
  const slLine = d.stopColor || POSITION_COLORS.SL_LINE;
  const tpFill = d.targetColor || POSITION_COLORS.TP_LINE;
  const slFill = d.stopColor || POSITION_COLORS.SL_LINE;

  // Has price reached the target / stop? (direction-agnostic — works for both
  // Long and Short.) When it has, TradingView brightens that zone so the trader
  // sees the outcome of the position at a glance.
  const price = currentPrice();
  const reachedTarget =
    price != null && (target >= entry ? price >= target : price <= target);
  const reachedStop =
    price != null && (stop <= entry ? price <= stop : price >= stop);
  const baseAlpha = d.opacity ?? 0.24;
  const hitAlpha = Math.max(0.42, baseAlpha + 0.18);
  const loseAlpha = baseAlpha * 0.4; // dim losing zone ~40 % of normal
  const isTpHit = hit?.status === "tp_hit";
  const isSlHit = hit?.status === "sl_hit";

  // ── Zones (fill alpha) ──
  // Hit status (isTpHit / isSlHit) takes ABSOLUTE priority over live-price
  // checks (reachedTarget / reachedStop).  Once TP or SL is confirmed hit,
  // the opposite zone stays dimmed even if price later crosses its level.
  g.save();
  g.globalAlpha = isTpHit
    ? hitAlpha
    : isSlHit
      ? loseAlpha
      : reachedTarget
        ? hitAlpha
        : baseAlpha;
  g.fillStyle = tpFill;
  if (profitH > 0) g.fillRect(snapLeft, profitTop, snapW, profitH);
  g.globalAlpha = isSlHit
    ? hitAlpha
    : isTpHit
      ? loseAlpha
      : reachedStop
        ? hitAlpha
        : baseAlpha;
  g.fillStyle = slFill;
  if (lossH > 0) g.fillRect(snapLeft, lossTop, snapW, lossH);
  g.restore();

  // ── Zone borders (1 px dashed, very subtle) ──
  // TradingView reads the projection as solid TP/SL bands.  Keep the border
  // subtle so it does not compete with candles.
  g.save();
  g.globalAlpha = 0.42;
  g.lineWidth = 1;
  g.setLineDash([]);
  g.strokeStyle = tpLine;
  if (profitH > 1)
    g.strokeRect(snapLeft + 0.5, profitTop + 0.5, snapW - 1, profitH - 1);
  g.strokeStyle = slLine;
  if (lossH > 1)
    g.strokeRect(snapLeft + 0.5, lossTop + 0.5, snapW - 1, lossH - 1);
  g.restore();

  // ── Lines ──
  // TradingView entry line: crisp 1 px (default), user-adjustable via
  // lineWidth.  For odd-integer widths (1, 3, 5...) offset by 0.5 so the
  // stroke sits on whole-pixel centres instead of straddling two pixels.
  const lw = d.lineWidth || 1;
  const crispOffset = lw % 2 === 1 ? 0.5 : 0;
  g.save();
  g.lineWidth = lw;
  g.strokeStyle = entryCol;
  applyStyle(g, d.lineStyle);
  const lineYE = Math.round(clampToPricePane(yE)) + crispOffset;
  line(g, snapLeft, lineYE, snapLeft + snapW, lineYE);
  // TP / SL follow the user-selected line style. Defaults stay solid like
  // TradingView's position projection.
  g.lineWidth = lw;
  applyStyle(g, d.lineStyle);
  g.strokeStyle = tpLine;
  const lineYT = Math.round(clampToPricePane(yT)) + crispOffset;
  line(g, snapLeft, lineYT, snapLeft + snapW, lineYT);
  g.strokeStyle = slLine;
  const lineYS = Math.round(clampToPricePane(yS)) + crispOffset;
  line(g, snapLeft, lineYS, snapLeft + snapW, lineYS);
  g.restore();

  // --- Hit overlay / diagonal guide ---
  // TradingView draws this BEFORE labels so it appears behind them.
  if (hit) {
    const hitColor = hit.status === "tp_hit" ? tpLine : slLine;
    const frozenTime = d.points[0].time + hit.candleTime;
    const hitX = proj.toX(frozenTime) ?? xR;
    const hitY = clampToPricePane(hit.status === "tp_hit" ? yT : yS);

    g.save();
    g.strokeStyle = hitColor;
    g.lineWidth = 1;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(Math.round(xR), Math.round(clampToPricePane(yE)) + 0.5);
    g.lineTo(Math.round(hitX), Math.round(hitY) + 0.5);
    g.stroke();
    g.restore();
  }

  // --- Labels ---
  // TradingView layout: Entry label left-aligned, TP/SL labels right-aligned
  // at the right edge of the box, R/R label at the right near entry.
  // We pre-measure every label so x-offsets are exact — no magic constants.
  if (d.showLabels !== false) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const rr = risk > 0 ? reward / risk : 0;
    const tPct = entry ? (reward / Math.abs(entry)) * 100 : 0;
    const sPct = entry ? (risk / Math.abs(entry)) * 100 : 0;
    const tickSize = activeTickSize();
    const tTicks = ticksBetween(entry, target, tickSize);
    const sTicks = ticksBetween(entry, stop, tickSize);
    const stats = new Set(
      d.positionStats?.length
        ? d.positionStats
        : (["percent", "ticks", "amount", "rr"] as const),
    );
    const showStats = selected || !!d.alwaysShowStats;
    const compact = !!d.compactStats;
    const fontSize = d.fontSize ?? 11;
    const textColor = d.textColor ?? "#fff";

    // Money amounts when account/risk are configured. TradingView's position
    // labels show projected account amount on TP/SL, plus open P&L and Qty on
    // the entry line.
    let qty = 0;
    let targetAmountTxt = "";
    let stopAmountTxt = "";
    let entryStatsTxt = "";
    if (d.accountSize != null && d.riskValue != null) {
      const riskAmount =
        (d.riskUnit ?? "%") === "%"
          ? d.accountSize * (d.riskValue / 100)
          : d.riskValue;
      qty = risk > 0 ? (riskAmount / risk) * (d.lotSize ?? 1) : 0;
      const profitAmount = qty * reward;
      const cur = d.accountCurrency ?? "USD";
      const prec = d.qtyPrecision ?? 2;
      const openPnl =
        price == null
          ? 0
          : (d.tool === "long" ? price - entry : entry - price) * qty;
      if (showStats && stats.has("amount")) {
        targetAmountTxt = `Amount: ${fmtCurrency(
          d.accountSize + profitAmount,
          cur,
        )}`;
        stopAmountTxt = `Amount: ${fmtCurrency(d.accountSize - riskAmount, cur)}`;
        entryStatsTxt = compact
          ? `P&L ${fmtCurrency(openPnl, cur)}  Qty ${qty.toFixed(prec)}`
          : `Open P&L: ${fmtCurrency(openPnl, cur)}  Qty: ${qty.toFixed(prec)}`;
      }
    }

    // Build label strings first so we can measure their pixel width.
    const fmtDistance = (value: number) => formatPriceByTick(value, tickSize, 2);
    const targetParts = [
      compact ? `TP: ${fmtPrice(target)}` : `Target: ${fmtPrice(target)}`,
    ];
    const stopParts = [
      compact ? `SL: ${fmtPrice(stop)}` : `Stop: ${fmtPrice(stop)}`,
    ];
    if (showStats && stats.has("percent")) {
      targetParts.push(`(${tPct.toFixed(2)}%)`);
      stopParts.push(`(${sPct.toFixed(2)}%)`);
    }
    if (showStats && stats.has("ticks")) {
      targetParts.push(
        compact
          ? `${fmtDistance(reward)} ${tTicks}t`
          : `${fmtDistance(reward)} ${tTicks}`,
      );
      stopParts.push(
        compact
          ? `${fmtDistance(risk)} ${sTicks}t`
          : `${fmtDistance(risk)} ${sTicks}`,
      );
    }
    if (targetAmountTxt) targetParts.push(targetAmountTxt);
    if (stopAmountTxt) stopParts.push(stopAmountTxt);
    if (isTpHit) targetParts.push(compact ? "HIT" : "\u2713 HIT");
    if (isSlHit) stopParts.push(compact ? "HIT" : "\u2715 HIT");

    const entryParts = [
      entryStatsTxt || `${compact ? "E:" : "Entry:"} ${fmtPrice(entry)}`,
    ];
    if (showStats && stats.has("rr")) {
      entryParts.push(
        compact ? `RR ${rr.toFixed(2)}` : `Risk/Reward Ratio: ${rr.toFixed(2)}`,
      );
    }
    const entryLabel = entryParts.join(compact ? " " : "  ");
    const targetLabel = targetParts.join(compact ? " " : "  ");
    const stopLabel = stopParts.join(compact ? " " : "  ");

    // Pre-measure for label placement.
    // chip() horizontal padding = 6 px total (3 each side).
    g.save();
    g.font = canvasFont(fontSize, { weight: 500 });
    const targetW = g.measureText(targetLabel).width + 6;
    const stopW = g.measureText(stopLabel).width + 6;
    const entryW = g.measureText(entryLabel).width + 6;
    g.restore();

    const chipH = Math.max(15, fontSize + 4);
    const labelPad = 2;
    const labelY = (y: number) =>
      clamp(
        clampToPricePane(y) - chipH,
        labelPad,
        Math.max(labelPad, clipBottom - chipH - labelPad),
      );
    const labelX = (x: number, width: number) =>
      clamp(x, labelPad, Math.max(labelPad, proj.width - width - labelPad));

    // Target/Stop: left-aligned inside the box. Entry: centered on the entry
    // line, matching TradingView's risk/reward chip placement.
    chip(
      g,
      targetLabel,
      labelX(snapLeft + 4, targetW),
      labelY(yT),
      tpLine,
      0.92,
      2,
      { fontSize, textColor },
    );
    // Stop: right edge, sits ON the SL line.
    chip(
      g,
      stopLabel,
      labelX(snapLeft + 4, stopW),
      labelY(yS),
      slLine,
      0.92,
      2,
      { fontSize, textColor },
    );
    chip(
      g,
      entryLabel,
      labelX(snapLeft + snapW / 2 - entryW / 2, entryW),
      labelY(yE),
      entryCol,
      0.92,
      2,
      { fontSize, textColor },
    );
  }

  // --- Handles (selected state only) ---
  // Use origXR so handle positions match getAnchors() / hit-test.  The frozen
  // xR is only for zones, lines, labels and the hit overlay.  Handles must
  // stay at the editable position so interaction remains independent.
  if (selected) {
    const drawHandle = (x: number, y: number) => {
      if (y >= clipTop && y <= clipBottom) positionHandle(g, x, y);
    };
    for (const anchor of positionAnchorsFromGeo({
      ...geo,
      xR: origXR,
    })) {
      if (anchor.x != null && anchor.y != null) drawHandle(anchor.x, anchor.y);
    }
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

  for (const anchor of positionAnchorsFromGeo(geo)) {
    if (anchor.x == null || anchor.y == null) continue;
    const distance = pointDist(px, py, anchor.x, anchor.y);
    if (distance <= HANDLE_RADIUS + 2) {
      results.push({
        drawing: d,
        target: anchor.target,
        anchorIndex: anchor.index,
        distance,
      });
    }
  }

  // Body: inside the box, or on the entry line.
  const left = Math.min(xL, xR);
  const right = Math.max(xL, xR);
  const top = Math.min(yT, yS, yE);
  const bottom = Math.max(yT, yS, yE);
  if (
    px >= left - TOL &&
    px <= right + TOL &&
    py >= top - LABEL_HIT_PAD &&
    py <= bottom + LABEL_HIT_PAD
  ) {
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
  return positionAnchorsFromGeo(geo);
}

/** Drag one of the six virtual TradingView-style position handles. */
function moveAnchor(
  origPoints: Point[],
  index: number,
  pointer: Point,
): Point[] {
  return movePositionAnchor(origPoints, index, pointer, activeTickSize());
}

/** Move the whole box (translate all points). */
function move(origPoints: Point[], pointer: Point, dragStart: Point): Point[] {
  return movePosition(origPoints, pointer, dragStart, activeTickSize());
}

function boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
  const geo = geometry(d, { toX, toY, width: 0, height: 0 } as Projector);
  if (!geo) return null;
  const { xL, xR, yE, yT, yS } = geo;
  const left = Math.min(xL, xR);
  const top = Math.min(yE, yT, yS);
  return {
    x: left,
    y: top - LABEL_HIT_PAD,
    w: Math.abs(xR - xL),
    h: Math.max(yE, yT, yS) - top + LABEL_HIT_PAD * 2,
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
