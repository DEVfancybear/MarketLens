"use client";
/**
 * AlertOverlay (Phase 2.1) — TradingView-style interactive alert lines.
 *
 * Replaces the static `series.createPriceLine` rendering (which receives no
 * pointer events) with a canvas overlay + thin per-line DOM "hit strips":
 *
 *  - Canvas (pointer-events: none) draws each alert line, its right-side label,
 *    hover/selection styling and drag handles.
 *  - One absolutely-positioned hit strip per line (pointer-events: auto) handles
 *    hover (grab cursor), click-to-select, drag-to-move, right-click + long-press
 *    context menu. Everywhere else the chart stays fully interactive (pan/zoom).
 *
 * Selection lives in `alertStore.selectedAlertId` (one at a time). Dragging
 * updates the line locally for lag-free movement and commits the new price (with
 * a recalculated above/below condition) on release. The engine is untouched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useChartCtx } from "./ChartContext";
import { useChartStore } from "@/store/chartStore";
import {
  useAlertStore,
  CONDITION_SYMBOL,
  type Alert,
  type AlertCondition,
} from "@/store/alertStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtPrice } from "@/utils/format";
import { AlertContextMenu, type AlertMenuState } from "./AlertContextMenu";
import { alertLineRegistry } from "./alertLineRegistry";

const HIT_PX = 7; // half-height of the interactive hit strip / proximity
const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD = 3;

/** Flip to true to log the alert-render diagnostics (the 8 checks) to the console. */
const ALERT_DEBUG = true;

/** Recompute the condition while dragging, keeping the alert's family (level vs cross). */
function sideCondition(
  base: AlertCondition,
  price: number,
  market: number | undefined,
): AlertCondition {
  if (market === undefined) return base;
  const above = price >= market;
  if (base === "crossUp" || base === "crossDown")
    return above ? "crossUp" : "crossDown";
  return above ? "above" : "below";
}

export function AlertOverlay() {
  const ctx = useChartCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const symbol = useChartStore((s) => s.symbol);
  const alerts = useAlertStore((s) => s.alerts);
  const selectedId = useAlertStore((s) => s.selectedAlertId);
  const selectAlert = useAlertStore((s) => s.selectAlert);
  const updateAlert = useAlertStore((s) => s.updateAlert);
  const deleteAlert = useAlertStore((s) => s.deleteAlert);
  const duplicateAlert = useAlertStore((s) => s.duplicateAlert);
  const editAlert = useAlertStore((s) => s.editAlert);

  const symbolAlerts = alerts.filter((a) => a.symbol === symbol);

  // Stash render data in refs so the draw callback always reads the latest values
  // without depending on symbolAlerts (which changes reference on every render).
  const alertsRef = useRef(alerts);
  const symbolRef = useRef(symbol);
  const selectedIdRef = useRef(selectedId);
  alertsRef.current = alerts;
  symbolRef.current = symbol;
  selectedIdRef.current = selectedId;

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; price: number } | null>(null);
  const [menu, setMenu] = useState<AlertMenuState | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prec = getMarketSymbol(symbol)?.pricePrecision ?? 2;
  const marketPrice = ctx?.candles[ctx.candles.length - 1]?.close;

  const toY = useCallback(
    (price: number): number | null =>
      ctx?.candleSeries.priceToCoordinate(price) ?? null,
    [ctx],
  );
  const priceAt = useCallback(
    (clientY: number): number | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || !ctx) return null;
      return ctx.candleSeries.coordinateToPrice(clientY - rect.top) as
        | number
        | null;
    },
    [ctx],
  );

  const displayPrice = (a: Alert) =>
    drag && drag.id === a.id ? drag.price : a.price;

  // ---------------------------------------------------------------- rendering
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) {
      if (ALERT_DEBUG)
        console.debug("[AlertOverlay] draw bail", {
          canvas: !!canvas,
          ctx: !!ctx,
        }); // checks 2/7
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (
      canvas.width !== rect.width * dpr ||
      canvas.height !== rect.height * dpr
    ) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);

    // Read latest data from refs to avoid stale-closure on symbolAlerts.
    const latestAlerts = alertsRef.current;
    const latestSymbol = symbolRef.current;
    const latestSelectedId = selectedIdRef.current;
    const filtered = latestAlerts.filter((a) => a.symbol === latestSymbol);

    if (ALERT_DEBUG) {
      const cs = getComputedStyle(canvas);
      console.debug("[AlertOverlay] draw", {
        storeAlerts: latestAlerts.length,
        symbolAlerts: filtered.length,
        symbol: latestSymbol,
        canvasSize: { w: rect.width, h: rect.height },
        css: {
          zIndex: cs.zIndex,
          visibility: cs.visibility,
          opacity: cs.opacity,
          display: cs.display,
        },
      });
    }

    let drawn = 0;
    for (const a of filtered) {
      const price = drag && drag.id === a.id ? drag.price : a.price;
      const y = toY(price);
      if (y == null) {
        if (ALERT_DEBUG)
          console.debug("[AlertOverlay] skip line — priceToCoordinate null", {
            symbol: a.symbol,
            price,
          }); // check 4
        continue;
      }
      const selected = a.id === latestSelectedId;
      const hover = a.id === hoverId || drag?.id === a.id;
      const base = a.enabled ? "#f7a600" : "#6b7280";

      // line
      g.save();
      g.strokeStyle = base;
      g.globalAlpha = a.enabled ? 1 : 0.55;
      g.lineWidth = selected ? 2 : hover ? 1.6 : 1;
      g.setLineDash(a.enabled ? [] : [4, 3]);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(rect.width, y);
      g.stroke();
      g.setLineDash([]);

      // right-side label chip
      const label = `🔔 ${CONDITION_SYMBOL[a.condition]} ${fmtPrice(price, prec)}`;
      g.font = "10px monospace";
      const tw = g.measureText(label).width;
      const padX = 6;
      const chipW = tw + padX * 2;
      const chipH = 16;
      const chipX = rect.width - chipW - 6;
      const chipY = y - chipH / 2;
      g.fillStyle = a.enabled ? "#f7a600" : "#6b7280";
      g.globalAlpha = a.enabled ? 1 : 0.6;
      roundRect(g, chipX, chipY, chipW, chipH, 3);
      g.fill();
      g.fillStyle = "#1a1a1a";
      g.globalAlpha = 1;
      g.textBaseline = "middle";
      g.fillText(label, chipX + padX, y + 0.5);

      // selection handles
      if (selected) {
        for (const hx of [
          rect.width * 0.25,
          rect.width * 0.5,
          rect.width * 0.75,
        ]) {
          g.fillStyle = "#fff";
          g.strokeStyle = base;
          g.lineWidth = 1.5;
          g.beginPath();
          g.rect(hx - 3, y - 3, 6, 6);
          g.fill();
          g.stroke();
        }
      }
      g.restore();
      drawn += 1;
    }
    if (ALERT_DEBUG) console.debug("[AlertOverlay] drew", drawn, "line(s)"); // checks 4/5
  }, [ctx, toY, prec, hoverId, drag]);

  // Repaint on data/selection/hover/drag/pan-zoom changes…
  useEffect(() => {
    draw();
  }, [draw, alerts.length]);

  // Backup: direct Zustand subscription ensures draw fires even if React
  // batches the re-render in a way that misses the effect trigger.
  // Uses a ref so we don't resubscribe when `draw` changes.
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    let rafId: number | null = null;
    const unsub = useAlertStore.subscribe(() => {
      // Coalesce multiple store updates into a single rAF.
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          drawRef.current();
        });
      }
    });
    return () => {
      unsub();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // …and on any container resize (covers the case where the overlay canvas is
  // first laid out at zero size and would otherwise never get a redraw).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // Mount diagnostics (checks 2 + 7).
  useEffect(() => {
    if (ALERT_DEBUG) console.debug("[AlertOverlay] MOUNTED");
    return () => {
      if (ALERT_DEBUG) console.debug("[AlertOverlay] UNMOUNTED");
    };
  }, []);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!selectedId) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const a = useAlertStore
          .getState()
          .alerts.find((x) => x.id === selectedId);
        if (a && !a.locked) deleteAlert(selectedId);
      } else if (e.key === "Escape") {
        selectAlert(null);
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, deleteAlert, selectAlert]);

  // ------------------------------------------------------- click-outside deselect
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (menu) return; // menu has its own outside handling
      const root = containerRef.current;
      if (root && !root.contains(e.target as Node)) selectAlert(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menu, selectAlert]);

  if (!ctx) return null;

  // ------------------------------------------------------------- interaction
  const clearLongPress = () => {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
  };

  const openMenu = (a: Alert, x: number, y: number) => {
    selectAlert(a.id);
    setMenu({ id: a.id, x, y });
  };

  const onStripPointerDown = (a: Alert) => (e: React.PointerEvent) => {
    if (e.button === 2) return; // right-click handled by onContextMenu
    e.preventDefault();
    selectAlert(a.id);
    setMenu(null);

    // Long-press → context menu (touch).
    if (e.pointerType === "touch") {
      clearLongPress();
      longPress.current = setTimeout(() => {
        openMenu(a, e.clientX, e.clientY);
      }, LONG_PRESS_MS);
    }

    if (a.locked) return; // locked alerts select but don't drag

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const origPrice = a.price;
    let moved = false;
    let lastPrice = origPrice;
    let rafId: number | null = null;

    const onMove = (ev: PointerEvent) => {
      clearLongPress();
      const newPrice = priceAt(ev.clientY);
      if (newPrice == null || newPrice <= 0) return;
      // Track whether this is a real drag (3px threshold for commit).
      if (!moved && Math.abs(ev.clientY - startY) >= DRAG_THRESHOLD) {
        moved = true;
      }
      lastPrice = newPrice;
      // Update hit strip (instant direct DOM).
      const newY = toY(newPrice);
      if (newY != null) target.style.top = `${newY - HIT_PX}px`;
      // Update native line in real-time so it follows the cursor.
      const nativeLine = alertLineRegistry.get(a.id);
      if (nativeLine) {
        try {
          nativeLine.applyOptions({ price: newPrice });
        } catch {
          /* ignore */
        }
      }
      // Batch React state updates at 60fps for smooth canvas redraw.
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          setDrag({ id: a.id, price: lastPrice });
        });
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      target.removeEventListener("pointermove", onMove as EventListener);
      target.removeEventListener("pointerup", onUp as EventListener);
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      clearLongPress();
      if (moved && lastPrice !== origPrice) {
        const condition = sideCondition(a.condition, lastPrice, marketPrice);
        updateAlert(a.id, { price: lastPrice, condition });
      }
      setDrag(null);
    };

    target.addEventListener("pointermove", onMove as EventListener);
    target.addEventListener("pointerup", onUp as EventListener);
  };

  const onStripContextMenu = (a: Alert) => (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(a, e.clientX, e.clientY);
  };

  return (
    <>
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "none" }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ pointerEvents: "none" }}
        />

        {/* Delete handle for the selected alert */}
        {(() => {
          const sel = symbolAlerts.find(
            (a) => a.id === selectedId && !a.locked,
          );
          if (!sel) return null;
          const y = toY(displayPrice(sel));
          if (y == null) return null;
          return (
            <button
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              onClick={() => deleteAlert(sel.id)}
              className="absolute flex h-5 w-5 items-center justify-center rounded bg-bear text-white shadow hover:brightness-110"
              style={{ top: y - 10, left: 8, pointerEvents: "auto" }}
              title="Delete alert (Del)"
              aria-label="Delete alert"
            >
              <X size={12} />
            </button>
          );
        })()}

        {menu && (
          <AlertContextMenu
            state={menu}
            onClose={() => setMenu(null)}
            onEdit={(id) => editAlert(id)}
            onClone={(id) => duplicateAlert(id)}
            onToggleEnabled={(id, enabled) => updateAlert(id, { enabled })}
            onDelete={(id) => deleteAlert(id)}
          />
        )}
      </div>

      {/* Hit strips rendered OUTSIDE the pointer-events:none container
          so they reliably receive pointer events in all browsers. */}
      {symbolAlerts.map((a) => {
        const y = toY(displayPrice(a));
        if (y == null) return null;
        const dragging = drag?.id === a.id;
        return (
          <div
            key={a.id}
            onPointerDown={onStripPointerDown(a)}
            onPointerEnter={() => setHoverId(a.id)}
            onPointerLeave={() => setHoverId((h) => (h === a.id ? null : h))}
            onContextMenu={onStripContextMenu(a)}
            className="absolute left-0 right-0 z-10"
            style={{
              top: y - HIT_PX,
              height: HIT_PX * 2,
              pointerEvents: "auto",
              cursor: a.locked ? "not-allowed" : dragging ? "grabbing" : "grab",
              touchAction: "none",
            }}
          />
        );
      })}
    </>
  );
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
